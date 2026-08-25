// src/components/events/SabhaAnalytics.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 25 — the season view. "Events tab should be more advance and stats
// because every week that will use for each mandal. and advance stats."
//
// EventDashboard answers everything about ONE sabha. This answers the questions
// that only exist once there are twelve of them:
//
//   • is turnout climbing or sliding, and by how much
//   • which mandal is actually filling its hall, week after week
//   • who are the regulars, and — the useful one — who USED to come and stopped
//   • who has never come at all, despite being on the roster
//
// All of it is derived in memory by lib/eventAnalytics.js from the attendance
// listener EventsPage already keeps open, so opening this tab costs zero reads.
//
// The lists are not decoration: every name has a tel: link on it, because the
// point of finding out that eleven people lapsed is ringing them.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import {
  Users, TrendingUp, TrendingDown, Minus, UserPlus, UserMinus, Repeat, Percent,
  CalendarRange, Download, Phone, Sparkles, Target, ChevronDown, ChevronUp, UserX, Clock,
  FileText, PhoneOff, PhoneCall, Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { buildSabhaAnalytics, analyticsToCsv, RATE_BANDS, LAPSE_MISSES } from '../../lib/eventAnalytics';
import { formatEventDate } from '../../lib/eventExports';
import { exportSeasonPdf } from '../../lib/seasonExports';
import { Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import { setCallingPoolBulk } from '../../services/callingPoolService';
import { cn } from '../../lib/cn';

const WINDOW_OPTIONS = [
  { value: 4, label: 'Last 4 sabhas' },
  { value: 8, label: 'Last 8 sabhas' },
  { value: 12, label: 'Last 12 sabhas' },
  { value: 26, label: 'Last 26 sabhas' },
  { value: 0, label: 'All time' },
];

const BAND_STYLE = {
  regular: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100', bar: 'bg-emerald-500' },
  occasional: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-100', bar: 'bg-sky-500' },
  rare: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-100', bar: 'bg-amber-400' },
  dormant: { dot: 'bg-slate-300', chip: 'bg-slate-50 text-slate-500 ring-slate-100', bar: 'bg-slate-200' },
};

function StatTile({ icon: Icon, label, value, sub, tone = 'slate' }) {
  const TONES = {
    slate: 'bg-slate-50 text-slate-600 ring-slate-100',
    orange: 'bg-orange-50 text-orange-600 ring-orange-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    sky: 'bg-sky-50 text-sky-600 ring-sky-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
    rose: 'bg-rose-50 text-rose-600 ring-rose-100',
  };
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className={cn('mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1', TONES[tone])}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-lg font-bold leading-none tracking-tight text-slate-900 sm:text-xl">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{sub}</p>}
    </div>
  );
}

/** The week-by-week bars. The delta under each one is what people read first. */
function TrendChart({ sabhas, eligible }) {
  if (!sabhas.length) return null;
  const peak = Math.max(...sabhas.map((s) => s.present), 1);
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Attendance, sabha by sabha
        </p>
        {eligible > 0 && (
          <p className="text-[11px] text-slate-400">out of {eligible} on the roster</p>
        )}
      </div>
      <div className="flex h-40 items-end gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {sabhas.map((s) => (
          <div key={s.id} className="flex min-w-[34px] flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-slate-700">{s.present}</span>
            <div className="flex w-full flex-1 items-end">
              <div
                className={cn(
                  'w-full rounded-t transition-all',
                  s.present === peak ? 'bg-orange-500' : 'bg-orange-200',
                )}
                style={{ height: `${Math.max((s.present / peak) * 100, s.present ? 4 : 1)}%` }}
                title={`${s.title} · ${s.date} · ${s.present} present${s.outside ? ` (+${s.outside} from outside)` : ''}`}
              />
            </div>
            {/* New faces get their own tick, because a flat total hiding three
                new people and three who left is not a flat week. */}
            {s.newFaces > 0 && (
              <span className="text-[9px] font-semibold text-emerald-600" title={`${s.newFaces} first-timers`}>
                +{s.newFaces}
              </span>
            )}
            <span className="whitespace-nowrap text-[9px] text-slate-400">
              {formatEventDate(s.date, { day: 'numeric', month: 'short' })}
            </span>
            {s.delta != null && s.delta !== 0 && (
              <span className={cn('text-[9px] font-medium', s.delta > 0 ? 'text-emerald-600' : 'text-rose-500')}>
                {s.delta > 0 ? '▲' : '▼'}{Math.abs(s.delta)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sparkline for one mandal's row in the comparison table. */
function MiniTrend({ values }) {
  const peak = Math.max(...values, 1);
  return (
    <span className="inline-flex h-5 items-end gap-px">
      {values.map((v, i) => (
        <span
          key={i}
          className={cn('w-1 rounded-sm', v ? 'bg-orange-400' : 'bg-slate-200')}
          style={{ height: `${Math.max((v / peak) * 100, v ? 12 : 6)}%` }}
        />
      ))}
    </span>
  );
}

/** One mandal (or area) per row: the "each mandal" comparison the request asks for. */
function GroupTable({ title, rows, subject }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-slate-100 bg-white">
      <p className="border-b border-slate-100 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 sm:px-4">
        {title}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium sm:px-4">{subject}</th>
              <th className="px-2 py-2 text-right font-medium">Roster</th>
              <th className="px-2 py-2 text-right font-medium" title="Average present per sabha">Avg</th>
              <th className="px-2 py-2 text-right font-medium" title="Average present as a share of the roster">Turnout</th>
              <th className="px-2 py-2 text-right font-medium" title="Share of the roster who came at least once">Reach</th>
              <th className="px-2 py-2 text-right font-medium" title="At 7 in 10 sabhas or more">Regulars</th>
              <th className="px-2 py-2 text-right font-medium" title={`Attended, then missed ${LAPSE_MISSES} in a row`}>Lapsed</th>
              <th className="px-3 py-2 font-medium sm:px-4">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.prev == null ? null : r.last - r.prev;
              return (
                <tr key={r.name} className="border-t border-slate-100">
                  <td className="max-w-[10rem] truncate px-3 py-2 font-medium text-slate-800 sm:px-4" title={r.name}>{r.name}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{r.eligible}</td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">
                    {r.avgPresent}
                    {delta != null && delta !== 0 && (
                      <span className={cn('ml-1 text-[10px]', delta > 0 ? 'text-emerald-600' : 'text-rose-500')}>
                        {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-600">{r.avgTurnout}%</td>
                  <td className="px-2 py-2 text-right text-slate-600">{r.reach}%</td>
                  <td className="px-2 py-2 text-right text-emerald-700">{r.regulars}</td>
                  <td className={cn('px-2 py-2 text-right', r.lapsed ? 'font-semibold text-rose-600' : 'text-slate-400')}>
                    {r.lapsed}
                  </td>
                  <td className="px-3 py-2 sm:px-4"><MiniTrend values={r.trend} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A collapsible list of people, each with a tel: link.
 *
 * Grows a page at a time rather than expanding to everything: "never attended"
 * on a 3,000-contact roster is a 3,000-row list, and rendering that in one go
 * locks the phone up for several seconds. Anyone who genuinely wants the whole
 * thing wants the CSV.
 */
const PAGE = 50;

function PeopleList({
  icon: Icon, title, blurb, people, tone = 'slate', initial = 8, emptyText, poolAction = null,
}) {
  const [limit, setLimit] = useState(initial);
  const shown = people.slice(0, limit);
  const TONES = {
    slate: 'text-slate-400', emerald: 'text-emerald-600', rose: 'text-rose-500', amber: 'text-amber-600',
  };
  // How many of this segment the bulk action would actually touch. Printed on the
  // button, because "Take 612 off the list" on a segment where 600 are already off
  // is a button that lies about what it does.
  const changeable = poolAction ? people.filter((p) => p.onCallList !== poolAction.inPool).length : 0;
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 sm:p-4">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', TONES[tone])} />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {title} {people.length > 0 && <span className="text-slate-300">· {people.length}</span>}
        </p>
      </div>
      {blurb && <p className="mb-2.5 text-[11px] leading-snug text-slate-400">{blurb}</p>}
      {/* The bulk action sits under the blurb, above the names — read the
          description of who these people are, then act on all of them. */}
      {poolAction && changeable > 0 && (
        <button
          type="button"
          onClick={poolAction.onClick}
          disabled={poolAction.busy}
          className={cn(
            'mb-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5',
            'text-[11px] font-medium transition-colors disabled:opacity-60',
            poolAction.inPool
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
          )}
          title={poolAction.inPool
            ? 'Include them when batches are generated for weekly follow-up'
            : 'Stop pulling them into weekly batches. They stay on the roster and a yearly sweep still reaches them.'}
        >
          {poolAction.busy
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : poolAction.inPool ? <PhoneCall className="h-3 w-3" /> : <PhoneOff className="h-3 w-3" />}
          {poolAction.busy
            ? 'Saving…'
            : `${poolAction.inPool ? 'Add' : 'Take'} ${changeable} ${poolAction.inPool ? 'to' : 'off'} the calling list`}
        </button>
      )}
      {people.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyText}</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-50">
            {shown.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <Link
                  to={`/contacts/${p.id}`}
                  className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 hover:text-orange-600 hover:underline"
                >
                  {p.name}
                </Link>
                {/* Off the calling list — marked here so a karyakarta reading this
                    list is never left wondering why a name never reaches a batch.
                    The title lives on the span, not the svg: an SVG element needs
                    a <title> child to show a tooltip, an attribute does nothing. */}
                {p.onCallList === false && (
                  <span className="shrink-0" title="Off the follow-up calling list">
                    <PhoneOff className="h-3 w-3 text-slate-300" />
                  </span>
                )}
                <span className="hidden shrink-0 truncate text-[11px] text-slate-400 sm:inline sm:max-w-[8rem]">
                  {[p.mandal, p.area].filter(Boolean).join(' · ')}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                  {p.attended}/{p.of}
                </span>
                {p.mobile ? (
                  <a
                    href={`tel:${p.mobile}`}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                    title={`Call ${p.mobile}`}
                  >
                    <Phone className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="h-6 w-6 shrink-0" />
                )}
              </li>
            ))}
          </ul>
          {people.length > initial && (
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              {limit < people.length && (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="inline-flex items-center gap-1 font-medium text-orange-600 hover:underline"
                >
                  Show {Math.min(PAGE, people.length - limit)} more <ChevronDown className="h-3 w-3" />
                </button>
              )}
              {limit > initial && (
                <button
                  type="button"
                  onClick={() => setLimit(initial)}
                  className="inline-flex items-center gap-1 font-medium text-slate-500 hover:underline"
                >
                  Collapse <ChevronUp className="h-3 w-3" />
                </button>
              )}
              <span className="text-slate-400">
                {Math.min(limit, people.length)} of {people.length}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SabhaAnalytics({ events, byEvent, individuals, mandals = [], areas = [] }) {
  const [windowSize, setWindowSize] = useState(12);
  const [mandal, setMandal] = useState('');
  const [area, setArea] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  // Which segment's bulk action is mid-flight, so only that one card shows a
  // spinner instead of the whole page going busy.
  const [poolBusy, setPoolBusy] = useState('');
  const { showToast } = useToast();
  const { hasPermission, user } = usePermissions();
  const canEditPool = hasPermission(PERMISSIONS.EDIT_CONTACTS);

  const a = useMemo(
    () => buildSabhaAnalytics({ events, byEvent, individuals, mandal, area, windowSize }),
    [events, byEvent, individuals, mandal, area, windowSize],
  );

  const { totals, segments } = a;

  const bandCounts = RATE_BANDS.map((b) => ({
    ...b,
    count: segments[b.key]?.length || 0,
  }));

  function downloadCsv() {
    const scope = [mandal, area].filter(Boolean).join('-') || 'all';
    const csv = analyticsToCsv(a);
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sabha-season-${scope}-${a.window.from || 'start'}-to-${a.window.to || 'end'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * The same numbers, as a report. `a` is handed over rather than rebuilt inside
   * the exporter, so the PDF is by construction the window / mandal / area that
   * is on screen — there is no second code path that could apply the filters
   * differently. See lib/seasonExports.js.
   */
  function downloadPdf() {
    setPdfBusy(true);
    // Yielded to the browser first: jsPDF lays out every table synchronously, and
    // on a season with a 1,000-name roster that is a second or two during which
    // nothing repaints. Without the frame, the button never visibly changes and
    // the phone looks frozen instead of busy.
    requestAnimationFrame(() => {
      try {
        exportSeasonPdf({ analytics: a, filters: { windowSize, mandal, area } });
      } catch (err) {
        console.error('[exportSeasonPdf]', err);
        showToast?.({ type: 'error', message: 'Couldn’t build the PDF. The CSV has the same data.' });
      } finally {
        setPdfBusy(false);
      }
    });
  }

  /**
   * PHASE 26 — move a whole segment on or off the follow-up calling list.
   *
   * This is the point of the segments. "600+ never come, only one time in a year,
   * that why they exclude only from calling" is a sentence about a list on this
   * very page — the people who have never been to a sabha, or who drifted away
   * years ago. Ticking them off one contact at a time is a thousand clicks; here
   * it is one, on a list the numbers themselves produced.
   *
   * Nothing is deleted and nobody leaves the roster: they stop being pulled into
   * the weekly batches, and the yearly sweep still reaches them (Batches →
   * Generate → "Everyone on the roster"). See services/callingPoolService.js.
   */
  async function applyPool(key, people, inPool) {
    // Only the ones that would actually change. Writing `false` over `false` is a
    // write that costs quota and changes nothing, and the confirm text would then
    // claim to move people who were already moved.
    const targets = people.filter((p) => p.onCallList !== inPool);
    if (!targets.length) {
      showToast({
        type: 'info',
        message: inPool
          ? 'They are all on the calling list already.'
          : 'None of them are on the calling list.',
      });
      return;
    }

    const verb = inPool ? 'Add' : 'Remove';
    const where = inPool ? 'to the follow-up calling list' : 'from the follow-up calling list';
    // eslint-disable-next-line no-restricted-globals, no-alert
    const ok = window.confirm(
      `${verb} ${targets.length} contact${targets.length === 1 ? '' : 's'} ${where}?\n\n`
      + (inPool
        ? 'They will be included when batches are generated for weekly follow-up.'
        : 'They stay on the roster and keep their history — they just stop being pulled into weekly batches. '
          + 'A yearly sweep can still reach them: Batches → Generate → "Everyone on the roster".'),
    );
    if (!ok) return;

    setPoolBusy(key);
    try {
      const { updated } = await setCallingPoolBulk(
        targets.map((p) => p.id),
        inPool,
        { by: user?.uid },
      );
      showToast({
        type: 'success',
        message: `${updated} contact${updated === 1 ? '' : 's'} ${inPool ? 'added to' : 'taken off'} the calling list.`,
      });
    } catch (err) {
      console.error('[callingPool]', err);
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Firestore refused the change — your role needs Edit Contacts.'
          : 'Could not update the calling list. Nothing was changed.',
      });
    } finally {
      setPoolBusy('');
    }
  }

  if (!a.window.available) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
        No sabhas have happened yet{mandal || area ? ' for this filter' : ''}. Season stats appear once the
        first one is over and attendance is marked.
      </p>
    );
  }

  const MomentumIcon = totals.momentum == null || totals.momentum === 0
    ? Minus
    : totals.momentum > 0 ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-4">
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[9rem] flex-1 sm:max-w-[11rem]">
          <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <CalendarRange className="h-3 w-3" /> Window
          </label>
          <Select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))}>
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}{o.value > a.window.available ? ` (only ${a.window.available})` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[9rem] flex-1 sm:max-w-[11rem]">
          <label className="mb-1 block text-[11px] font-medium text-slate-500">Mandal</label>
          <Select value={mandal} onChange={(e) => setMandal(e.target.value)}>
            <option value="">All mandals</option>
            {mandals.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </div>
        <div className="min-w-[9rem] flex-1 sm:max-w-[11rem]">
          <label className="mb-1 block text-[11px] font-medium text-slate-500">Area</label>
          <Select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {areas.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </div>
        {/* Both exports carry the filters above. The PDF is the one to forward or
            take into a meeting; the CSV is the one to edit — it is the same wide
            shape the importer reads, so a season can go out and come back. */}
        <div className="flex gap-1.5">
          <Button
            variant="accent" size="sm" onClick={downloadPdf} disabled={pdfBusy}
            title="Full season report — summary, every sabha, every mandal and area, and the follow-up lists"
          >
            <FileText className="h-3.5 w-3.5" /> {pdfBusy ? 'Building…' : 'PDF'}
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadCsv} title="One row per person, one column per sabha">
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        {totals.sabhas} sabha{totals.sabhas === 1 ? '' : 's'} from{' '}
        {formatEventDate(a.window.from, { day: 'numeric', month: 'short', year: 'numeric' })} to{' '}
        {formatEventDate(a.window.to, { day: 'numeric', month: 'short', year: 'numeric' })}
        {' · '}{totals.eligible} contact{totals.eligible === 1 ? '' : 's'} on the roster
        {totals.marks > 0 && ` · ${totals.marks.toLocaleString('en-IN')} marks`}
      </p>

      {/* ── Headline numbers ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile
          icon={Users} label="Average present" value={totals.avgPresent} tone="orange"
          sub={`median ${totals.medianPresent} · best ${totals.bestSabha?.present ?? 0}`}
        />
        <StatTile
          icon={Percent} label="Turnout" value={`${totals.avgTurnout}%`}
          sub={`of ${totals.eligible} on the roster`}
        />
        <StatTile
          icon={Target} label="Reach" value={`${totals.reach}%`} tone="sky"
          sub={`${totals.uniqueAttendees} came at least once`}
        />
        <StatTile
          icon={MomentumIcon} label="Momentum"
          value={totals.momentum == null ? '—' : `${totals.momentum > 0 ? '+' : ''}${totals.momentum}`}
          tone={totals.momentum == null || totals.momentum === 0 ? 'slate' : totals.momentum > 0 ? 'emerald' : 'rose'}
          sub={totals.momentum == null ? 'needs 4+ sabhas' : 'recent half vs earlier half'}
        />
        <StatTile
          icon={Repeat} label="Week-on-week" value={`${totals.avgRetention}%`} tone="sky"
          sub="came back the following sabha"
        />
        <StatTile
          icon={Sparkles} label="Regulars" value={totals.regulars} tone="emerald"
          sub="at 7 in 10 sabhas or more"
        />
        <StatTile
          icon={UserPlus} label="New faces" value={totals.newFaces} tone="emerald"
          sub="first ever sabha in this window"
        />
        <StatTile
          icon={UserMinus} label="Lapsed" value={totals.lapsed}
          tone={totals.lapsed ? 'rose' : 'slate'}
          sub={`missed the last ${LAPSE_MISSES} in a row`}
        />
      </div>

      <TrendChart sabhas={a.sabhas} eligible={totals.eligible} />

      {/* ── How the roster splits ────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-100 bg-white p-3 sm:p-4">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          How often each of the {totals.eligible} attends
        </p>
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {bandCounts.map((b) => (
            b.count > 0 && (
              <div
                key={b.key}
                className={BAND_STYLE[b.key].bar}
                style={{ width: `${(b.count / Math.max(totals.eligible, 1)) * 100}%` }}
                title={`${b.label}: ${b.count} — ${b.blurb}`}
              />
            )
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {bandCounts.map((b) => (
            <span key={b.key} className="inline-flex items-center gap-1.5 text-[11px]">
              <span className={cn('h-2 w-2 rounded-full', BAND_STYLE[b.key].dot)} />
              <span className="font-medium text-slate-700">{b.label}</span>
              <span className="text-slate-400">{b.count}</span>
            </span>
          ))}
        </div>
      </div>

      <GroupTable title="Mandal by mandal" rows={a.byMandal} subject="Mandal" />
      <GroupTable title="Area by area" rows={a.byArea} subject="Area" />

      {/* ── The follow-up calling list ───────────────────────────────────
          "only follow up selected contacts approx 400+ out of 1000+ … 600+
          never come only one time in a year. that why they exclude only from
          calling." This is that split, on the page where the evidence for it
          lives, with the buttons that change it on the lists themselves. */}
      <div className="rounded-xl border border-slate-100 bg-white p-3 sm:p-4">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Follow-up calling list
          </p>
          <p className="text-[11px] text-slate-400">
            {totals.onCallList} of {totals.eligible} on the roster
          </p>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="bg-orange-500"
            style={{ width: `${(totals.onCallList / Math.max(totals.eligible, 1)) * 100}%` }}
            title={`${totals.onCallList} on the calling list`}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <PhoneCall className="h-3 w-3 text-orange-500" />
            <span className="font-medium text-slate-700">Being called</span>
            <span className="text-slate-400">{totals.onCallList}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <PhoneOff className="h-3 w-3 text-slate-300" />
            <span className="font-medium text-slate-700">Excluded</span>
            <span className="text-slate-400">{totals.offCallList}</span>
          </span>
        </div>
        <p className="mt-2.5 text-[11px] leading-snug text-slate-400">
          Weekly batches are cut from the {totals.onCallList} being called.
          {totals.offCallList > 0 && ` The other ${totals.offCallList} stay on the roster with their full history — `}
          {totals.offCallList > 0 && 'a once-a-year sweep still reaches them: '}
          {totals.offCallList === 0 && ' To reach the whole roster in one go, use '}
          <Link to="/admin/batches" className="font-medium text-orange-600 hover:underline">
            Batches → Generate
          </Link>
          {' → “Everyone on the roster”.'}
          {!canEditPool && ' Changing the list needs the Edit Contacts permission.'}
        </p>
      </div>

      {/* ── Who to call ──────────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <PeopleList
          icon={UserMinus}
          tone="rose"
          title="Stopped coming"
          blurb={`Attended earlier in this window, then missed the last ${LAPSE_MISSES} sabhas or more. Longest absence first — this is the call list.`}
          people={segments.lapsed}
          emptyText="Nobody has lapsed in this window."
          poolAction={canEditPool ? {
            inPool: true,
            busy: poolBusy === 'lapsed',
            onClick: () => applyPool('lapsed', segments.lapsed, true),
          } : null}
        />
        <PeopleList
          icon={UserPlus}
          tone="emerald"
          title="New faces"
          blurb="Their first ever recorded sabha falls inside this window. Worth a welcome call."
          people={segments.newFaces}
          emptyText="No first-timers in this window."
          poolAction={canEditPool ? {
            inPool: true,
            busy: poolBusy === 'newFaces',
            onClick: () => applyPool('newFaces', segments.newFaces, true),
          } : null}
        />
        <PeopleList
          icon={Sparkles}
          tone="emerald"
          title="Regulars"
          blurb="At 7 in 10 sabhas or more. The people to lean on for seva."
          people={segments.regular}
          emptyText="No one has hit 7 in 10 yet."
        />
        <PeopleList
          icon={Clock}
          tone="amber"
          title="Drifted away"
          blurb="Came to a sabha at some point, but not one in this window. Most recently seen first."
          people={segments.driftedAway}
          emptyText="Everyone who has ever attended came at least once in this window."
        />
        <PeopleList
          icon={UserX}
          title="Never at a sabha"
          blurb="On the roster, never marked present at any sabha on record. Some may simply never have been marked — attendance only exists when somebody records it."
          people={segments.neverEver}
          emptyText="Everyone on the roster has attended at least one sabha."
          poolAction={canEditPool ? {
            inPool: false,
            busy: poolBusy === 'neverEver',
            onClick: () => applyPool('neverEver', segments.neverEver, false),
          } : null}
        />
      </div>

      {/* ── Retention detail + best day ──────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        {a.retention.length > 0 && (
          <div className="rounded-xl border border-slate-100 bg-white p-3 sm:p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Week-on-week retention
            </p>
            <p className="mb-2.5 text-[11px] leading-snug text-slate-400">
              Of the people at one sabha, how many were at the next one.
            </p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {a.retention.slice().reverse().map((r) => (
                <li key={`${r.from}-${r.to}`} className="flex items-center gap-2.5 text-[11px]">
                  <span className="w-24 shrink-0 whitespace-nowrap text-slate-500">
                    {formatEventDate(r.to, { day: 'numeric', month: 'short' })}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn('h-full rounded-full', r.pct >= 70 ? 'bg-emerald-500' : r.pct >= 45 ? 'bg-amber-400' : 'bg-rose-400')}
                      style={{ width: `${Math.max(r.pct, 2)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-slate-600">
                    <span className="font-semibold text-slate-800">{r.pct}%</span> {r.kept}/{r.base}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {a.byWeekday.length > 1 && (
          <div className="rounded-xl border border-slate-100 bg-white p-3 sm:p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Which day fills the hall
            </p>
            <p className="mb-2.5 text-[11px] leading-snug text-slate-400">
              Average present, by the day of the week the sabha was held on.
            </p>
            <ul className="space-y-2">
              {a.byWeekday.map((d) => {
                const top = a.byWeekday[0].avg || 1;
                return (
                  <li key={d.day} className="flex items-center gap-2.5 text-[11px]">
                    <span className="w-8 shrink-0 font-medium text-slate-600">{d.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.max((d.avg / top) * 100, 2)}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-slate-600">
                      <span className="font-semibold text-slate-800">{d.avg}</span> · {d.sabhas} sabha{d.sabhas === 1 ? '' : 's'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
