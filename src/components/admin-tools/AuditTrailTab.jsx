// src/components/admin-tools/AuditTrailTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The audit trail, rebuilt around the two questions people actually bring to it:
// "what happened on <date>?" and "who touched <this person>?".
//
// What changed from the first version, and why:
//
//   • DATE RANGE IS PUSHED TO THE SERVER. The old version always pulled the
//     latest 300 rows and filtered in the browser, so "what happened last
//     Tuesday" was unanswerable the moment the log grew past 300 entries.
//     `timestamp` is both the range field and the orderBy field, so Firestore
//     serves this from the automatic single-field index — no composite index
//     and no firestore.indexes.json change.
//
//   • VOLUNTEER AND ACTION STAY CLIENT-SIDE. Combining an equality filter with
//     the timestamp range WOULD need a composite index per combination. Those
//     two filters only ever narrow rows already fetched for the chosen date
//     window, so doing them in memory costs nothing and keeps deploys simple.
//
//   • FREE-TEXT SEARCH across volunteer name, contact name, the action label,
//     the raw action key and the details blob — with the matched substring
//     highlighted, since a hit in a long details string is otherwise invisible.
//
//   • CONTACT NAMES ARE FETCHED, NOT SUBSCRIBED. The old version opened an
//     onSnapshot on the ENTIRE individuals collection just to turn ids into
//     names — thousands of document reads to label a few hundred rows. Now the
//     ids present in the loaded page are fetched in chunks of 30 (Firestore's
//     `in` ceiling) and cached, so the cost tracks what is on screen.
//
// Rows are grouped under day headings, and the filtered set can be exported to
// CSV so a month can be handed to someone who does not have a login.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, documentId, getDocs, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { Search, X, Download, RotateCcw, ChevronDown } from 'lucide-react';
import { db } from '../../lib/firebase';
import { Input, Select, Label } from '../ui/Input';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';

// Every action string written anywhere in the app. Grep for `action:` before
// adding a feature that logs — an unlisted action still renders, but it shows
// its raw key ("bulk_delete_individuals") instead of a readable label.
const ACTIONS = [
  { key: 'create_household',         label: 'Created household',   tone: 'emerald' },
  { key: 'update_household',         label: 'Updated household',   tone: 'sky' },
  { key: 'delete_household',         label: 'Deleted household',   tone: 'rose' },
  { key: 'delete_household_only',    label: 'Deleted household shell', tone: 'rose' },
  { key: 'merge_household',          label: 'Merged households',   tone: 'amber' },
  { key: 'create_individual',        label: 'Created contact',     tone: 'emerald' },
  { key: 'update_individual',        label: 'Updated contact',     tone: 'sky' },
  { key: 'delete_individual',        label: 'Deleted contact',     tone: 'rose' },
  { key: 'bulk_delete_individuals',  label: 'Bulk-deleted contacts', tone: 'rose' },
  { key: 'status_changed',           label: 'Changed outcome',     tone: 'orange' },
  { key: 'status_reset',             label: 'Reset outcome',       tone: 'amber' },
  { key: 'reference_updated',        label: 'Updated reference',   tone: 'slate' },
  { key: 'upload_photo',             label: 'Uploaded photo',      tone: 'violet' },
  { key: 'call_logged',              label: 'Logged a call',       tone: 'orange' },
  // PHASE 29 — a volunteer taking a stray Call tap back off the counter. Its own
  // action rather than another call_logged row, so "how many calls did we make"
  // stays answerable and the correction is visible as a correction.
  { key: 'call_count_corrected',     label: 'Corrected call count', tone: 'slate' },
  // Written by the Reminders board AND by My Contacts, so the label can't name
  // either one — which screen it came from is in the row's details text.
  { key: 'call_initiated',           label: 'Tapped call',         tone: 'orange' },
  { key: 'whatsapp_sent',            label: 'Sent WhatsApp',       tone: 'emerald' },
  // Retired with the Phase 25 My Contacts rebuild (it writes call_initiated /
  // whatsapp_sent now). Kept so the rows already in the trail stay readable.
  { key: 'followup_call',            label: 'Follow-up call',      tone: 'orange' },
  { key: 'followup_whatsapp',        label: 'Follow-up WhatsApp',  tone: 'emerald' },
  { key: 'merge_areas',              label: 'Merged areas',        tone: 'amber' },
  { key: 'merge_mandals',            label: 'Merged mandals',      tone: 'amber' },
  // Written by the "Unlisted areas / mandals" panel when an import-introduced
  // name is kept as a real taxonomy option rather than merged away.
  { key: 'create_area',              label: 'Added area',          tone: 'emerald' },
  { key: 'create_mandal',            label: 'Added mandal',        tone: 'emerald' },
  // PHASE 27 — one row per contact when an admin closes a sabha's calling round.
  // The details text carries what they said and whether they came, which is the
  // only place that pairing survives after `status` is cleared for next week.
  { key: 'round_closed',             label: 'Closed calling round', tone: 'violet' },
  // PHASE 28 — one row per hand-edit of a batch's roster, not per contact: it is a
  // single deliberate act, and forty identical rows would bury the rest of the
  // trail. The details text carries the counts and the new size.
  { key: 'batch_contacts_edited',    label: 'Edited batch contacts', tone: 'sky' },
];

const ACTION_LABELS = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label]));
const ACTION_TONES = Object.fromEntries(ACTIONS.map((a) => [a.key, a.tone]));

// Written out in full rather than composed — Tailwind's purge only keeps class
// names it can see literally in the source.
const TONE_CLASSES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  sky: 'bg-sky-50 text-sky-700 border-sky-100',
  rose: 'bg-rose-50 text-rose-700 border-rose-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  orange: 'bg-orange-50 text-orange-700 border-orange-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-100',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
};

const PAGE_SIZE = 150;
const MAX_ROWS = 1500;

// ── Date helpers ─────────────────────────────────────────────────────────────

function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(date) {
  // Local-time YYYY-MM-DD. toISOString() would shift IST back into the previous
  // day for anything logged before 05:30, which is exactly the kind of off-by-one
  // that makes an audit trail untrustworthy.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

const PRESETS = [
  { key: 'today', label: 'Today',        from: () => daysAgo(0) },
  { key: '7',     label: 'Last 7 days',  from: () => daysAgo(6) },
  { key: '30',    label: 'Last 30 days', from: () => daysAgo(29) },
  { key: 'all',   label: 'All time',     from: () => '' },
];

function formatTime(date) {
  if (!date) return '—';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatDayHeading(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  if (iso === daysAgo(0)) return 'Today';
  if (iso === daysAgo(1)) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function detailsText(details) {
  if (details == null || details === '') return '';
  if (typeof details === 'string') return details;
  if (typeof details !== 'object') return String(details);
  // Objects come from the follow-up logger ({ note, contactName }). Render the
  // values rather than JSON so the text is searchable the way a person expects.
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

// ── Search-term highlighting ─────────────────────────────────────────────────

function Highlight({ text, term }) {
  const value = String(text ?? '');
  if (!term) return value;
  const idx = value.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return value;
  return (
    <>
      {value.slice(0, idx)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-slate-900">{value.slice(idx, idx + term.length)}</mark>
      {value.slice(idx + term.length)}
    </>
  );
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function exportCsv(rows) {
  const header = ['Date', 'Time', 'Volunteer', 'Action', 'Contact', 'Details'];
  const lines = rows.map((r) => [
    r.date ? isoDay(r.date) : '',
    formatTime(r.date),
    r.volunteerName,
    r.actionLabel,
    r.contactName || '',
    r.details,
  ].map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));

  // Leading BOM so Excel on Windows opens it as UTF-8 instead of mangling
  // Gujarati and Devanagari names.
  const blob = new Blob([`﻿${[header.join(','), ...lines].join('\r\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-trail-${isoDay(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AuditTrailTab() {
  const [entries, setEntries] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [contactNames, setContactNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [volunteerFilter, setVolunteerFilter] = useState('');
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState('');

  // ── Activity, windowed by date on the server ──────────────────────────────
  useEffect(() => {
    setLoading(true);
    const clauses = [];
    if (from) clauses.push(where('timestamp', '>=', new Date(`${from}T00:00:00`)));
    if (to) clauses.push(where('timestamp', '<=', new Date(`${to}T23:59:59.999`)));

    const q = query(
      collection(db, 'activity'),
      ...clauses,
      orderBy('timestamp', 'desc'),
      limit(pageLimit),
    );

    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('activity subscription failed', err);
        setError(
          err.code === 'permission-denied'
            ? "Your role can't read the activity log."
            : 'Could not load the activity log.',
        );
        setLoading(false);
      },
    );
  }, [from, to, pageLimit]);

  // Volunteers is a small collection (tens of docs) — a live subscription is
  // cheaper than re-fetching, and new volunteers appear in the filter at once.
  useEffect(() => onSnapshot(
    collection(db, 'volunteers'),
    (snap) => setVolunteers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setVolunteers([]),
  ), []);

  // ── Resolve just the contacts referenced by the loaded rows ───────────────
  const requestedRef = useRef(new Set());
  useEffect(() => {
    const missing = [...new Set(
      entries.map((e) => e.individualId).filter((id) => id && !requestedRef.current.has(id)),
    )];
    if (missing.length === 0) return;
    missing.forEach((id) => requestedRef.current.add(id));

    let cancelled = false;
    (async () => {
      const found = {};
      for (let i = 0; i < missing.length; i += 30) { // 30 = Firestore's `in` cap
        const chunk = missing.slice(i, i + 30);
        try {
          const snap = await getDocs(
            query(collection(db, 'individuals'), where(documentId(), 'in', chunk)),
          );
          snap.forEach((d) => { found[d.id] = d.data().name || ''; });
        } catch {
          // A deleted contact or a scoped role simply leaves the name blank —
          // the action itself is still shown, which is the point of an audit log.
        }
      }
      if (!cancelled && Object.keys(found).length) {
        setContactNames((prev) => ({ ...prev, ...found }));
      }
    })();
    return () => { cancelled = true; };
  }, [entries]);

  const volunteerNames = useMemo(
    () => Object.fromEntries(volunteers.map((v) => [v.id, v.name || 'Unnamed volunteer'])),
    [volunteers],
  );

  // Flatten every row into the shape the search, the list and the CSV all read
  // from, so what is exported is exactly what is on screen.
  const rows = useMemo(() => entries.map((e) => ({
    id: e.id,
    date: toDate(e.timestamp),
    volunteerId: e.volunteerId || '',
    volunteerName: volunteerNames[e.volunteerId] || 'Unknown volunteer',
    action: e.action || '',
    actionLabel: ACTION_LABELS[e.action] || e.action || '—',
    contactName: e.individualId ? (contactNames[e.individualId] || '') : '',
    details: detailsText(e.details),
  })), [entries, volunteerNames, contactNames]);

  const term = search.trim();
  const filtered = useMemo(() => {
    const needle = term.toLowerCase();
    return rows.filter((r) => {
      if (actionFilter && r.action !== actionFilter) return false;
      if (volunteerFilter && r.volunteerId !== volunteerFilter) return false;
      if (!needle) return true;
      return (
        r.volunteerName.toLowerCase().includes(needle) ||
        r.contactName.toLowerCase().includes(needle) ||
        r.actionLabel.toLowerCase().includes(needle) ||
        r.action.toLowerCase().includes(needle) ||
        r.details.toLowerCase().includes(needle)
      );
    });
  }, [rows, actionFilter, volunteerFilter, term]);

  // Group under day headings — the fastest way to read "what happened when".
  const grouped = useMemo(() => {
    const out = [];
    let current = null;
    filtered.forEach((r) => {
      const day = r.date ? isoDay(r.date) : 'unknown';
      if (!current || current.day !== day) {
        current = { day, rows: [] };
        out.push(current);
      }
      current.rows.push(r);
    });
    return out;
  }, [filtered]);

  // Actions are split rather than filtered. Showing only what's present keeps a
  // list of 17 from being noise when the window holds three kinds of action, but
  // it can't be the whole story for two reasons:
  //
  //   • An action absent from the current window is still worth selecting — you
  //     pick "Follow-up call" precisely because you want to go find them, and
  //     with a narrow date range it would never appear to be pickable.
  //   • If the selected action drops out of the list when the range narrows, the
  //     <Select> has no matching <option> but `actionFilter` stays set, so rows
  //     are filtered by something the user can neither see nor clear.
  //
  // Both go away by keeping every action in the DOM and just grouping them.
  const [presentActions, absentActions] = useMemo(() => {
    const seen = new Set(rows.map((r) => r.action));
    return [ACTIONS.filter((a) => seen.has(a.key)), ACTIONS.filter((a) => !seen.has(a.key))];
  }, [rows]);

  const activePreset = PRESETS.find((p) => p.from() === from && !to)?.key || 'custom';
  const hasFilters = Boolean(term || actionFilter || volunteerFilter || to) || from !== daysAgo(29);
  const atCap = entries.length >= pageLimit && pageLimit < MAX_ROWS;

  function resetFilters() {
    setSearch('');
    setActionFilter('');
    setVolunteerFilter('');
    setFrom(daysAgo(29));
    setTo('');
    setPageLimit(PAGE_SIZE);
  }

  return (
    <div>
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="mb-4 space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a name, an outcome, a note…"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 sm:h-9"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Date presets — one tap covers the common questions; the two date
            inputs below handle "that Sunday in June". */}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => { setFrom(p.from()); setTo(''); setPageLimit(PAGE_SIZE); }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                activePreset === p.key
                  ? 'border-orange-300 bg-orange-50 text-orange-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 2-up even on a phone. Four stacked fields pushed the actual results
            entirely below the fold on a 375px screen; a date input and a short
            select both fit comfortably in half of 343px. */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div>
            <Label className="text-[11px]">From</Label>
            <Input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPageLimit(PAGE_SIZE); }} />
          </div>
          <div>
            <Label className="text-[11px]">To</Label>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPageLimit(PAGE_SIZE); }} />
          </div>
          <div>
            <Label className="text-[11px]">Action</Label>
            <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All actions</option>
              {presentActions.length > 0 && (
                <optgroup label="In this date range">
                  {presentActions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </optgroup>
              )}
              {absentActions.length > 0 && (
                <optgroup label="Not in this date range">
                  {absentActions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </optgroup>
              )}
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Volunteer</Label>
            <Select value={volunteerFilter} onChange={(e) => setVolunteerFilter(e.target.value)}>
              <option value="">All volunteers</option>
              {volunteers
                .slice()
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((v) => <option key={v.id} value={v.id}>{v.name || 'Unnamed'}</option>)}
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">
            {loading ? 'Loading…' : (
              <>
                <strong className="text-slate-700">{filtered.length}</strong>
                {filtered.length === rows.length ? ' actions' : ` of ${rows.length} loaded`}
                {from ? ` since ${formatDayHeading(from)}` : ' (all time)'}
              </>
            )}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>
      ) : loading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          {rows.length === 0
            ? 'Nothing was logged in this date range.'
            : 'No actions match these filters.'}
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.day}>
              <div className="sticky top-0 z-10 -mx-1 mb-1.5 bg-white/95 px-1 py-1 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {formatDayHeading(group.day)} · {group.rows.length}
                </p>
              </div>
              <div className="divide-y divide-slate-50 rounded-lg border border-slate-100">
                {group.rows.map((r) => (
                  <div key={r.id} className="px-3 py-2.5 text-sm sm:flex sm:items-baseline sm:gap-3">
                    {/* Stacks on a phone: time+action on one line, then who and
                        what. Side-by-side columns from sm up. */}
                    <div className="flex items-center gap-2 sm:contents">
                      <span className="shrink-0 font-mono text-[11px] text-slate-400 sm:w-14">{formatTime(r.date)}</span>
                      <span className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        TONE_CLASSES[ACTION_TONES[r.action]] || TONE_CLASSES.slate,
                      )}>
                        <Highlight text={r.actionLabel} term={term} />
                      </span>
                    </div>
                    <div className="mt-1 min-w-0 flex-1 sm:mt-0">
                      <span className="font-medium text-slate-700">
                        <Highlight text={r.volunteerName} term={term} />
                      </span>
                      {r.contactName && (
                        <span className="text-slate-500">
                          {' · '}<Highlight text={r.contactName} term={term} />
                        </span>
                      )}
                      {r.details && (
                        <span className="block break-words text-xs text-slate-400">
                          <Highlight text={r.details} term={term} />
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {atCap && (
            <div className="pt-1 text-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPageLimit((n) => Math.min(n + PAGE_SIZE, MAX_ROWS))}
              >
                <ChevronDown className="h-3.5 w-3.5" /> Load {PAGE_SIZE} more
              </Button>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Showing the newest {entries.length} actions in this range. Narrow the dates to see older ones.
              </p>
            </div>
          )}
          {!atCap && pageLimit >= MAX_ROWS && (
            <p className="pt-1 text-center text-[11px] text-slate-400">
              Capped at {MAX_ROWS} rows — narrow the date range to go further back.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
