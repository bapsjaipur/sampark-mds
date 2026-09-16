// src/components/events/AttendanceMarking.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Mark who came to one sabha.
//
// The contact list and the attendance rows are passed in rather than subscribed
// to here: the events screen already holds one listener over `attendance` for
// the present-counts on every card, and re-subscribing per selected event meant
// two listeners over the same collection that could briefly disagree.
//
// Walk-in adds: at a real sabha, people turn up who aren't in the database yet.
// Before this, the karyekar had to leave the screen, add them under Contacts,
// come back and find the event again — so in practice they were written on paper
// and usually never entered. The add here creates the contact and marks them
// present in one go.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, UserPlus, Search, X } from 'lucide-react';
import { markPresent, unmarkPresent } from '../../services/eventService';
import { createStandaloneContact } from '../../services/contactService';
import { getWindowState } from '../../lib/attendanceWindow';
import { useAuth } from '../../hooks/usePermissions';
import { useVolunteerIdentity } from '../../hooks/useVolunteerIdentity';
import { useToast } from '../../contexts/ToastContext';
import RequirePermission from '../RequirePermission';
import IndividualForm from '../individuals/IndividualForm';
import Modal from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { VolunteerBadge, VolunteerRing } from '../ui/VolunteerBadge';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';

const WINDOW_LABELS = {
  before: { text: 'Attendance opens 30 minutes before the event starts.', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  after: { text: 'Attendance window has closed for this event.', tone: 'bg-slate-50 text-slate-500 border-slate-100' },
  unknown: { text: 'Set a date and time on this event to enable attendance.', tone: 'bg-slate-50 text-slate-500 border-slate-100' },
  open: null,
};

export default function AttendanceMarking({ event, individuals = [], present = [] }) {
  const { volunteer } = useAuth();
  // PHASE 21 — the person on the door needs to see at a glance which of these
  // names is a karyakarta, so the sevak list and the haribhakt list don't have to
  // be reconciled from memory afterwards.
  const { identify } = useVolunteerIdentity();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [windowState, setWindowState] = useState(() => getWindowState(event));

  useEffect(() => {
    setWindowState(getWindowState(event));
    const interval = setInterval(() => setWindowState(getWindowState(event)), 30000);
    return () => clearInterval(interval);
  }, [event]);

  const byId = useMemo(() => {
    const m = new Map();
    individuals.forEach((i) => m.set(i.id, i));
    return m;
  }, [individuals]);

  const presentIds = useMemo(() => new Set(present.map((p) => p.individualId)), [present]);

  const presentPeople = useMemo(
    () => present
      .map((p) => ({ ...p, person: byId.get(p.individualId) }))
      .filter((p) => p.person)
      .sort((a, b) => (a.person.name || '').localeCompare(b.person.name || '')),
    [present, byId],
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return individuals
      .filter((i) => i.name?.toLowerCase().includes(q) || i.mobile?.includes(q))
      .slice(0, 20);
  }, [search, individuals]);

  const isOpen = windowState === 'open';
  const banner = WINDOW_LABELS[windowState];

  async function handleMark(individual) {
    try {
      await markPresent({ eventId: event.id, individualId: individual.id, markedBy: volunteer?.id });
      showToast({ type: 'success', message: `${individual.name} marked present.` });
      setSearch('');
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn’t mark attendance. Try again.' });
    }
  }

  async function handleUnmark(individual) {
    try {
      await unmarkPresent({ eventId: event.id, individualId: individual.id });
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn’t undo. Try again.' });
    }
  }

  /**
   * Create-and-mark. The two writes are deliberately sequential and not a batch:
   * `individuals` create needs edit_contacts and `attendance` create needs
   * edit_contacts too, but a batch that fails halfway would roll back the
   * contact as well — and a contact that exists without the attendance row is a
   * far better failure than losing the person's details entirely. If the mark
   * fails the toast says so and the karyekar can tap them in the list.
   */
  async function handleWalkIn(payload) {
    const newId = await createStandaloneContact({ data: payload, volunteerId: volunteer?.id });
    if (!newId) {
      showToast({ type: 'error', message: 'Couldn’t save the new contact. Nothing was marked.' });
      return false;
    }
    try {
      await markPresent({ eventId: event.id, individualId: newId, markedBy: volunteer?.id });
      showToast({ type: 'success', message: `${payload.name} added and marked present.` });
    } catch (err) {
      showToast({
        type: 'error',
        message: `${payload.name} was saved as a contact, but marking them present failed. Search for them below.`,
      });
    }
    return true;
  }

  return (
    <div className="space-y-4">
      {banner && <div className={`rounded-lg border px-3 py-2 text-sm ${banner.tone}`}>{banner.text}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> <strong>{presentPeople.length}</strong> marked present
        </div>
        {presentPeople.length !== present.length && (
          <span className="text-[11px] text-slate-400">
            {present.length - presentPeople.length} row{present.length - presentPeople.length === 1 ? '' : 's'} point at a deleted contact
          </span>
        )}
      </div>

      {/* ── Search + walk-in add ───────────────────────────────────────────── */}
      <div className={isOpen ? '' : 'pointer-events-none opacity-40'}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or mobile to mark present…"
              inputMode="search"
              className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-9 text-[15px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 sm:h-9 sm:text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <RequirePermission permission="edit_contacts">
            <Button variant="accent" onClick={() => setAddOpen(true)} className="h-10 shrink-0 sm:h-9">
              <UserPlus className="h-3.5 w-3.5" /> New contact
            </Button>
          </RequirePermission>
        </div>

        {search.trim() && searchResults.length === 0 && (
          <p className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-sm text-slate-400">
            Nobody matches “{search.trim()}”. Use <strong>New contact</strong> to add them and mark them present.
          </p>
        )}

        {searchResults.length > 0 && (
          <div className="mt-2 max-h-64 divide-y divide-slate-50 overflow-y-auto rounded-lg border border-slate-100">
            {searchResults.map((i) => {
              const already = presentIds.has(i.id);
              return (
                <button
                  key={i.id}
                  onClick={() => !already && handleMark(i)}
                  disabled={already}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50"
                >
                  <VolunteerRing active={Boolean(identify(i))}>
                    <Avatar src={i.profilePhotoURL} name={i.name} size="sm" />
                  </VolunteerRing>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm text-slate-800">{i.name}</span>
                      <VolunteerBadge volunteer={identify(i)} />
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {/* Mandal AND area: two people with the same name in the same
                          mandal are told apart by area, which is the fastest thing
                          to confirm out loud while somebody is standing there. */}
                      {[i.mobile, i.mandal, i.area].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-xs font-medium', already ? 'text-emerald-600' : 'text-orange-600')}>
                    {already ? 'Present' : 'Mark'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Present list ──────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Present ({presentPeople.length})
        </p>
        {presentPeople.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No one marked yet.</p>
        ) : (
          <div className="space-y-1.5">
            {presentPeople.map(({ person }) => {
              const sevak = identify(person);
              return (
                <div
                  key={person.id}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 sm:px-3',
                    sevak ? 'border-indigo-100 bg-indigo-50/40' : 'border-slate-100',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <VolunteerRing active={Boolean(sevak)}>
                      <Avatar src={person.profilePhotoURL} name={person.name} size="sm" />
                    </VolunteerRing>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-slate-900">{person.name}</span>
                        <VolunteerBadge volunteer={sevak} />
                      </p>
                      <p className="truncate text-xs text-slate-400">{[person.mobile, person.mandal, person.area].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleUnmark(person)} className="shrink-0 text-rose-500 hover:bg-rose-50">Undo</Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add contact & mark present" size="lg">
        <p className="mb-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-800">
          Saving this form creates the contact and marks them present at <strong>{event?.title}</strong> in one step.
        </p>
        <IndividualForm
          onSubmit={handleWalkIn}
          onCancel={() => setAddOpen(false)}
          initialValues={{ mandal: event?.mandal || '', area: event?.area || '' }}
        />
      </Modal>
    </div>
  );
}
