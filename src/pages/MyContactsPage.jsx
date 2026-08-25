// src/pages/MyContactsPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 25 — rebuilt as a working board, in the same idiom as the Reminders tab.
//
// WHAT THIS SCREEN IS FOR. Every contact whose `samparkKaryakartaNumber` is the
// signed-in volunteer's mobile is "theirs" — the people they personally follow
// up with, independent of area/mandal scope. The old version was a flat list with
// one search box: it could tell you WHO was assigned to you, but not the only
// thing the karyakarta actually asks each evening, which is "who have I not
// spoken to yet". So the four counts at the top are the filter, not decoration,
// and "Pending" is the default view.
//
// Three fixes carried over from the old version, each of which was a real bug:
//   1. It opened its OWN onSnapshot on `individuals`. It now goes through
//      useSharedCollection, so navigating away and back is free (see
//      lib/sharedQuery.js) and the read shows up on the usage dashboard.
//   2. Tapping Call opened the dialer AND popped the log modal at the same time,
//      so on a phone the modal was behind the call and the note was lost. The
//      dialer link and "Log" are now separate actions.
//   3. The note textarea was read with document.getElementById at submit time,
//      which meant React never saw the value and it survived across contacts.
//      It is controlled state now, and it is cleared when the modal opens.
//
// Numbers are normalised through lib/whatsapp (buildTelUrl / buildWhatsAppUrl)
// rather than string-concatenated, so a stored "+91 98290 12345" dials correctly
// and a WhatsApp message arrives prefilled instead of blank.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import {
  Phone, MessageCircle, User, Search, X, Users, CircleDot, CheckCircle2,
  RotateCcw, NotebookPen, Cake, Heart, Inbox, PhoneCall,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/usePermissions';
import { useSharedCollection } from '../hooks/useSharedCollection';
import { useVolunteerIdentity } from '../hooks/useVolunteerIdentity';
import { useCallOutcomes } from '../hooks/useCallOutcomes';
import { useSettings } from '../hooks/useSettings';
import { logActivity } from '../lib/activityLog';
import { buildTelUrl, buildWhatsAppUrl, normalizePhone, DEFAULT_WA_TEMPLATE } from '../lib/whatsapp';
import { VolunteerBadge, VolunteerRing } from '../components/ui/VolunteerBadge';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import { Avatar } from '../components/ui/Avatar';
import Modal from '../components/ui/Modal';
import { cn } from '../lib/cn';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Sep" from a stored YYYY-MM-DD, without the year — this is a reminder cue,
 *  not a record, and the year only adds noise to a chip. */
function shortDate(value) {
  const [, m, d] = String(value || '').split('-').map(Number);
  if (!m || !d || m < 1 || m > 12) return '';
  return `${d} ${MONTHS[m - 1]}`;
}

/** The four views. `test` runs against a decorated contact (see `rows` below). */
const VIEWS = [
  { key: 'all', label: 'Assigned', Icon: Users, test: () => true },
  { key: 'pending', label: 'Not called', Icon: CircleDot, test: (c) => !c.status },
  { key: 'followUp', label: 'Follow-up', Icon: RotateCcw, test: (c) => c._isFollowUp },
  { key: 'done', label: 'Done', Icon: CheckCircle2, test: (c) => Boolean(c.status) && !c._isFollowUp },
];

function Chip({ className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', className)}>
      {children}
    </span>
  );
}

function StatTile({ active, label, count, Icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-xl border px-2.5 py-2.5 text-left transition-colors sm:px-3',
        active
          ? 'border-orange-300 bg-orange-50/70 ring-1 ring-orange-100'
          : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50',
      )}
    >
      <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', active ? 'text-orange-700' : 'text-slate-500')}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('mt-0.5 block text-xl font-semibold tabular-nums', active ? 'text-orange-900' : 'text-slate-900')}>
        {count}
      </span>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-slate-100" />
        </div>
      </div>
      <div className="mt-3 h-7 animate-pulse rounded bg-slate-50" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ContactCard({ contact, sevak, volunteerId, volunteerName, template, outcomes, onLog }) {
  const phone = normalizePhone(contact.mobile);
  const telUrl = buildTelUrl(contact.mobile);
  const waUrl = buildWhatsAppUrl({
    mobile: contact.mobile,
    template: template || DEFAULT_WA_TEMPLATE,
    contact,
    extra: { volunteerName },
  });

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-sm',
        contact._isFollowUp ? 'border-amber-200' : 'border-slate-100',
        sevak && 'border-indigo-200',
      )}
    >
      {/* Colour spine — called / follow-up / untouched, readable without reading. */}
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          contact._isFollowUp
            ? 'bg-gradient-to-b from-amber-400 to-orange-500'
            : contact.status
              ? 'bg-gradient-to-b from-emerald-400 to-teal-500'
              : 'bg-slate-200',
        )}
        aria-hidden="true"
      />

      <div className="py-3 pl-4 pr-3">
        <Link to={`/contacts/${contact.id}`} className="group flex items-start gap-3">
          <VolunteerRing active={Boolean(sevak)}>
            <Avatar src={contact.profilePhotoURL} name={contact.name} size="md" />
          </VolunteerRing>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-orange-700">
                {contact.name || 'Unnamed'}
              </p>
              <VolunteerBadge volunteer={sevak} />
            </div>

            <p className="mt-0.5 text-xs tabular-nums text-slate-500">
              {phone ? `+91 ${phone}` : 'No mobile saved'}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {contact.status ? (
                <Chip className={outcomes.colorClasses(contact.status)}>
                  {outcomes.emoji(contact.status)} {outcomes.label(contact.status)}
                </Chip>
              ) : (
                <Chip className="border-slate-200 bg-slate-50 text-slate-500">Not called yet</Chip>
              )}
              {contact.mandal && <Chip className="border-slate-200 bg-slate-50 text-slate-600">{contact.mandal}</Chip>}
              {contact.area && <Chip className="border-slate-200 bg-slate-50 text-slate-600">{contact.area}</Chip>}
              {contact.dob && (
                <Chip className="border-amber-200 bg-amber-50 text-amber-800">
                  <Cake className="h-3 w-3" /> {shortDate(contact.dob)}
                </Chip>
              )}
              {contact.anniversary && (
                <Chip className="border-rose-200 bg-rose-50 text-rose-800">
                  <Heart className="h-3 w-3" /> {shortDate(contact.anniversary)}
                </Chip>
              )}
            </div>
          </div>
        </Link>

        {/* Actions. Call and WhatsApp leave the app, so logging is its own button
            rather than an onClick on the link — see the header note. */}
        <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
          <Link to={`/contacts/${contact.id}`} className="flex-1">
            <Button variant="secondary" size="sm" className="w-full">
              <User className="h-3.5 w-3.5" /> Profile
            </Button>
          </Link>
          {telUrl && (
            <a
              href={telUrl}
              className="flex-1"
              onClick={() => logActivity({
                volunteerId,
                individualId: contact.id,
                action: 'call_initiated',
                details: 'Called from My Contacts',
              })}
            >
              <Button variant="accent" size="sm" className="w-full">
                <Phone className="h-3.5 w-3.5" /> Call
              </Button>
            </a>
          )}
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1"
              onClick={() => logActivity({
                volunteerId,
                individualId: contact.id,
                action: 'whatsapp_sent',
                details: 'WhatsApp from My Contacts',
              })}
            >
              <Button variant="secondary" size="sm" className="w-full border-[#128C7E]/30 text-[#0e7469] hover:bg-emerald-50">
                <MessageCircle className="h-3.5 w-3.5" /> Chat
              </Button>
            </a>
          )}
          <Button
            variant="ghost"
            size="icon"
            title="Log a follow-up note"
            aria-label={`Log a follow-up note for ${contact.name || 'this contact'}`}
            onClick={() => onLog(contact)}
          >
            <NotebookPen className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MyContactsPage() {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const { identify } = useVolunteerIdentity();
  const outcomes = useCallOutcomes();
  const { settings: templates } = useSettings('messageTemplate');

  const [view, setView] = useState('pending');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [mandalFilter, setMandalFilter] = useState('');
  const [logModal, setLogModal] = useState({ open: false, contact: null });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Shared listener, keyed on the mobile it filters by: two volunteers on the
  // same device never share a store, and re-entering this tab within the grace
  // period costs nothing. `null` while the mobile is unknown so no listener opens.
  const specs = useMemo(() => {
    const mobile = volunteer?.mobile;
    if (!mobile) return null;
    return [{
      key: `individuals|sampark|${mobile}`,
      source: 'individuals (my contacts)',
      build: () => query(collection(db, 'individuals'), where('samparkKaryakartaNumber', '==', mobile)),
    }];
  }, [volunteer?.mobile]);

  const { rows: raw, loading, error } = useSharedCollection(specs);

  // Decorated once: which outcomes count as "needs another call" comes from the
  // live admin-edited vocabulary, not a hardcoded list, so renaming a chip in
  // Admin Tools keeps the Follow-up tile correct.
  const followUpValues = useMemo(
    () => new Set(outcomes.outcomes.filter((o) => o.followUp).map((o) => o.value)),
    [outcomes.outcomes],
  );

  const rows = useMemo(() => raw
    .map((c) => ({ ...c, _isFollowUp: Boolean(c.status) && followUpValues.has(c.status) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [raw, followUpValues]);

  const counts = useMemo(() => {
    const out = {};
    VIEWS.forEach((v) => { out[v.key] = rows.filter(v.test).length; });
    return out;
  }, [rows]);

  const mandalOptions = useMemo(
    () => [...new Set(rows.map((c) => c.mandal).filter(Boolean))].sort(),
    [rows],
  );
  // Only the outcomes actually present on this volunteer's list — a dropdown of
  // nine chips where seven match nobody is just a way to reach an empty screen.
  const statusOptions = useMemo(
    () => [...new Set(rows.map((c) => c.status).filter(Boolean))].sort(),
    [rows],
  );

  // A filter that no longer matches anything would otherwise strand the list on
  // a blank screen with no visible cause (delete the last "Donated" contact and
  // the select still says Donated).
  useEffect(() => {
    if (statusFilter && !statusOptions.includes(statusFilter)) setStatusFilter('');
  }, [statusOptions, statusFilter]);
  useEffect(() => {
    if (mandalFilter && !mandalOptions.includes(mandalFilter)) setMandalFilter('');
  }, [mandalOptions, mandalFilter]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const test = (VIEWS.find((v) => v.key === view) || VIEWS[0]).test;
    return rows.filter((c) => {
      if (!test(c)) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (mandalFilter && c.mandal !== mandalFilter) return false;
      if (term) {
        const hay = `${c.name || ''} ${c.mobile || ''} ${c.mandal || ''} ${c.area || ''} ${c.status || ''}`;
        if (!hay.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [rows, view, statusFilter, mandalFilter, search]);

  const filtered = Boolean(search.trim() || statusFilter || mandalFilter);

  function openLog(contact) {
    setNote('');
    setLogModal({ open: true, contact });
  }

  async function saveLog() {
    const contact = logModal.contact;
    if (!contact) return;
    setSaving(true);
    try {
      await logActivity({
        volunteerId: volunteer?.id,
        individualId: contact.id,
        action: 'call_logged',
        details: note.trim()
          ? `Follow-up note for ${contact.name}: ${note.trim()}`
          : `Follow-up logged for ${contact.name}`,
      });
      showToast({ type: 'success', message: 'Note added to the activity trail.' });
      setLogModal({ open: false, contact: null });
      setNote('');
    } catch {
      showToast({ type: 'error', message: "Couldn't log that. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">My Contacts</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-500">
            People assigned to you for sampark
            {volunteer?.mobile && (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12px] font-medium tabular-nums text-slate-700">
                {volunteer.mobile}
              </span>
            )}
          </p>
        </div>
        {rows.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800">
            <PhoneCall className="h-3.5 w-3.5" />
            {counts.done + counts.followUp} of {rows.length} contacted
          </span>
        )}
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          Couldn&apos;t load your contacts. Check your connection and reload the page.
        </div>
      )}

      {/* ── Counts, doubling as the view filter ──────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex">
        {VIEWS.map((v) => (
          <StatTile
            key={v.key}
            active={view === v.key}
            label={v.label}
            count={counts[v.key]}
            Icon={v.Icon}
            onClick={() => setView(v.key)}
          />
        ))}
      </div>

      {/* ── Search + narrowers ───────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, mobile, mandal…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {statusOptions.length > 1 && (
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-44">
            <option value="">Any outcome</option>
            {statusOptions.map((s) => <option key={s} value={s}>{outcomes.label(s)}</option>)}
          </Select>
        )}
        {mandalOptions.length > 1 && (
          <Select value={mandalFilter} onChange={(e) => setMandalFilter(e.target.value)} className="sm:w-40">
            <option value="">All mandals</option>
            {mandalOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        )}
      </div>

      {/* ── Board ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">
            {rows.length === 0
              ? 'No contacts are assigned to you yet'
              : filtered ? 'Nothing matches those filters' : `Nothing in "${(VIEWS.find((v) => v.key === view) || VIEWS[0]).label}"`}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
            {rows.length === 0
              ? 'A contact appears here once an admin sets you as their sampark karyakarta on the contact’s profile.'
              : filtered
                ? 'Try clearing the search, or switch to the Assigned tile.'
                : 'Switch to another tile above to see the rest of your list.'}
          </p>
          {(filtered || (rows.length > 0 && view !== 'all')) && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => { setSearch(''); setStatusFilter(''); setMandalFilter(''); setView('all'); }}
            >
              Show everyone assigned to me
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              sevak={identify(c)}
              volunteerId={volunteer?.id}
              volunteerName={volunteer?.name}
              template={templates?.whatsappTemplate}
              outcomes={outcomes}
              onLog={openLog}
            />
          ))}
        </div>
      )}

      {/* ── Log a note ───────────────────────────────────────────────────── */}
      <Modal
        open={logModal.open}
        onClose={() => setLogModal({ open: false, contact: null })}
        title={`Log a follow-up — ${logModal.contact?.name || ''}`}
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            This goes to the activity trail as a note. To record the call outcome itself,
            use the calling screen or the contact&apos;s profile.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            autoFocus
            className="w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200"
            placeholder="What happened on this follow-up? (optional)"
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setLogModal({ open: false, contact: null })}
            >
              Cancel
            </Button>
            <Button variant="accent" className="flex-1" disabled={saving} onClick={saveLog}>
              {saving ? 'Saving…' : 'Save note'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
