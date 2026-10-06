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
import { CheckCircle2, UserPlus, Search, X, Pencil } from 'lucide-react';
import { markPresent, unmarkPresent } from '../../services/eventService';
import { createStandaloneContact, saveContact } from '../../services/contactService';
import { getWindowState } from '../../lib/attendanceWindow';
import { useAuth } from '../../hooks/usePermissions';
import { useSettings } from '../../hooks/useSettings';
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
  // PHASE 43 — the 30-minute window is now an admin toggle, not a hard law. When
  // an admin turns it off (settings/app.attendanceWindowEnforced === false) the
  // screen stops gating on the clock, so a late-starting sabha or a next-morning
  // back-fill can still be marked. Read is open to every volunteer (see the
  // settings rules), so a door karyekar with no admin permission still gets the
  // right answer. Defaults to enforced, i.e. the old behaviour, when unread.
  const { settings: appSettings } = useSettings('app');
  const windowEnforced = appSettings?.attendanceWindowEnforced !== false;
  // PHASE 21 — the person on the door needs to see at a glance which of these
  // names is a karyakarta, so the sevak list and the haribhakt list don't have to
  // be reconciled from memory afterwards.
  const { identify } = useVolunteerIdentity();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  // PHASE 42 — the contact whose details are open for editing, or null. Editing
  // here, rather than sending the karyekar off to Contacts and back, is the whole
  // point: a wrong mandal or a missing photo is noticed at the door, when the
  // person is standing there to confirm it.
  const [editTarget, setEditTarget] = useState(null);
  const [windowState, setWindowState] = useState(() => getWindowState(event));
  // Walk-ins added right here, kept in local state so they appear as present the
  // instant the writes resolve — see the reconcile effect and handleWalkIn below.
  const [walkIns, setWalkIns] = useState([]); // [{ id, name, mandal, area, profilePhotoURL, marked }]

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

  // ── Walk-ins, shown optimistically ──────────────────────────────────────────
  // The create and the mark are two writes that reach this screen only after two
  // SEPARATE live listeners up in EventsPage (contacts + attendance) round-trip
  // and converge — and presentPeople above drops any row whose contact hasn't
  // loaded yet. On a sabha-hall connection that gap (or a dropped mark write) is
  // exactly what made a just-added person look unmarked and sent the karyekar
  // back to the search box. Holding them in local state shows them the instant
  // the writes resolve; each clears once the real listeners catch up (the person
  // is present AND loaded as a contact). Reset per event so a previous sabha's
  // walk-ins don't bleed into the next one.
  useEffect(() => { setWalkIns([]); }, [event?.id]);

  useEffect(() => {
    setWalkIns((cur) => {
      if (!cur.length) return cur;
      const next = cur.filter((w) => !(presentIds.has(w.id) && byId.has(w.id)));
      return next.length === cur.length ? cur : next; // same ref when nothing converged → no loop
    });
  }, [presentIds, byId]);

  const pendingWalkIns = useMemo(
    () => walkIns.filter((w) => !(presentIds.has(w.id) && byId.has(w.id))),
    [walkIns, presentIds, byId],
  );

  // Confirmed rows plus the optimistic walk-ins already marked — so the headline
  // count never dips in the second between the save and the listener echo.
  const markedCount = presentPeople.length + pendingWalkIns.filter((w) => w.marked).length;

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return individuals
      .filter((i) => i.name?.toLowerCase().includes(q) || i.mobile?.includes(q))
      .slice(0, 20);
  }, [search, individuals]);

  // PHASE 43 — enforcement is now conditional. With the window turned off the
  // screen is open whatever the clock says; the only banner then is a quiet note
  // explaining WHY it is open outside the usual times, so an admin can tell the
  // toggle is doing something rather than the window being broken.
  const isOpen = !windowEnforced || windowState === 'open';
  const banner = windowEnforced
    ? WINDOW_LABELS[windowState]
    : (windowState !== 'open'
      ? { text: 'Attendance window is off in Admin settings — marking is open at any time.', tone: 'bg-sky-50 text-sky-700 border-sky-100' }
      : null);

  // Marking can drop on a flaky sabha-hall connection; one quiet retry turns most
  // of those into a success instead of a failure the karyekar has to notice and
  // redo. markPresent is idempotent (deterministic doc id), so a retry is safe.
  async function markWithRetry(individualId, attempts = 2) {
    for (let i = 0; i < attempts; i += 1) {
      try {
        await markPresent({ eventId: event.id, individualId, markedBy: volunteer?.id });
        return true;
      } catch (err) {
        if (i === attempts - 1) return false;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return false;
  }

  async function handleMark(individual) {
    if (await markWithRetry(individual.id)) {
      showToast({ type: 'success', message: `${individual.name} marked present.` });
      setSearch('');
    } else {
      showToast({ type: 'error', message: 'Couldn’t mark attendance — check your connection and try again.' });
    }
  }

  async function handleUnmark(individual) {
    try {
      await unmarkPresent({ eventId: event.id, individualId: individual.id });
      setWalkIns((cur) => cur.filter((w) => w.id !== individual.id));
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn’t undo. Try again.' });
    }
  }

  /**
   * Create-and-mark, the walk-in path. The two writes are deliberately sequential
   * and not a batch: a batch that failed halfway would roll back the contact too,
   * and a contact without its attendance row is a far better failure than losing
   * the person's details. The new contact is shown as present IMMEDIATELY from
   * local state (setWalkIns), so it no longer depends on the contacts/attendance
   * listeners having converged — which is what used to make a just-added person
   * look unmarked and send the karyekar back to the search box. If the mark write
   * itself fails, the row stays with a one-tap "Mark present", so recovery never
   * needs a search either.
   */
  async function handleWalkIn(payload) {
    const newId = await createStandaloneContact({ data: payload, volunteerId: volunteer?.id });
    if (!newId) {
      showToast({ type: 'error', message: 'Couldn’t save the new contact. Nothing was marked.' });
      return false;
    }
    setWalkIns((cur) => [
      {
        id: newId,
        name: payload.name,
        mandal: payload.mandal || null,
        area: payload.area || null,
        profilePhotoURL: payload.profilePhotoURL || null,
        marked: true,
      },
      ...cur.filter((w) => w.id !== newId),
    ]);

    if (await markWithRetry(newId)) {
      showToast({ type: 'success', message: `${payload.name} added and marked present.` });
    } else {
      setWalkIns((cur) => cur.map((w) => (w.id === newId ? { ...w, marked: false } : w)));
      showToast({
        type: 'error',
        message: `${payload.name} was saved. Marking them present didn’t go through — tap “Mark present” on their row to retry.`,
      });
    }
    return true;
  }

  // Retry the mark for a walk-in whose attendance write failed — one tap, no
  // search, using the id we already hold.
  async function handleRemarkWalkIn(w) {
    if (await markWithRetry(w.id)) {
      setWalkIns((cur) => cur.map((x) => (x.id === w.id ? { ...x, marked: true } : x)));
      showToast({ type: 'success', message: `${w.name} marked present.` });
    } else {
      showToast({ type: 'error', message: 'Still couldn’t mark — check your connection and try again.' });
    }
  }

  /**
   * Edit-in-place. `saveContact` returns truthy on success, which is the contract
   * IndividualForm needs to close itself — so a successful save drops the modal
   * and lands back on this same attendance list with the row already repainted:
   * `individuals` is a live onSnapshot up in EventsPage, so the updated name /
   * photo / mandal flows back down with no extra read and no manual refresh.
   */
  async function handleEditSave(payload) {
    if (!editTarget) return false;
    const ok = await saveContact({ individualId: editTarget.id, data: payload, volunteerId: volunteer?.id });
    showToast(ok
      ? { type: 'success', message: `${payload.name || 'Contact'} updated.` }
      : { type: 'error', message: 'Couldn’t save changes. Check your permissions.' });
    return ok;
  }

  return (
    <div className="space-y-4">
      {banner && <div className={`rounded-lg border px-3 py-2 text-sm ${banner.tone}`}>{banner.text}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> <strong>{markedCount}</strong> marked present
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
                // A row, not a single button: the Edit control is interactive and
                // can't be nested inside the mark-present button (invalid, and it
                // would fire a mark on every edit tap). The mark region keeps the
                // full-width tap target; Edit sits at the end.
                <div key={i.id} className="flex items-center hover:bg-slate-50">
                  <button
                    onClick={() => !already && handleMark(i)}
                    disabled={already}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left disabled:opacity-50"
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
                  <RequirePermission permission="edit_contacts">
                    <button
                      onClick={() => setEditTarget(i)}
                      aria-label={`Edit ${i.name || 'contact'}`}
                      title="Edit details"
                      className="shrink-0 px-3 py-2.5 text-slate-300 hover:text-slate-600"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </RequirePermission>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Present list ──────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Present ({markedCount})
        </p>
        {markedCount === 0 && pendingWalkIns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No one marked yet.</p>
        ) : (
          <div className="space-y-1.5">
            {/* Just-added walk-ins, straight from local state so a new contact
                never looks unmarked while the listeners catch up. A row whose mark
                write dropped carries a one-tap retry — no search needed. */}
            {pendingWalkIns.map((w) => (
              <div
                key={`walkin-${w.id}`}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 sm:px-3',
                  w.marked ? 'border-emerald-100 bg-emerald-50/40' : 'border-amber-200 bg-amber-50',
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar src={w.profilePhotoURL} name={w.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{w.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {[w.mandal, w.area].filter(Boolean).join(' · ') || 'Just added'}
                    </p>
                  </div>
                </div>
                {w.marked ? (
                  <span className="shrink-0 text-xs font-medium text-emerald-600">Present</span>
                ) : (
                  <Button variant="accent" size="sm" onClick={() => handleRemarkWalkIn(w)} className="shrink-0">
                    Mark present
                  </Button>
                )}
              </div>
            ))}
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
                  <div className="flex shrink-0 items-center gap-0.5">
                    <RequirePermission permission="edit_contacts">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditTarget(person)}
                        className="text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    </RequirePermission>
                    <Button variant="ghost" size="sm" onClick={() => handleUnmark(person)} className="text-rose-500 hover:bg-rose-50">Undo</Button>
                  </div>
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

      {/* Edit an existing contact without leaving attendance. A successful save
          returns truthy, so IndividualForm closes itself and we land back here. */}
      {editTarget && (
        <Modal open onClose={() => setEditTarget(null)} title={`Edit ${editTarget.name || 'contact'}`} size="lg">
          <IndividualForm
            individual={editTarget}
            onSubmit={handleEditSave}
            onCancel={() => setEditTarget(null)}
            withinHousehold={Boolean(editTarget.householdId)}
            householdArea={editTarget.area || ''}
          />
        </Modal>
      )}
    </div>
  );
}
