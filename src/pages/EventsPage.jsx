// src/pages/EventsPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Events & Sabha — the calendar, attendance marking, per-event exports and the
// admin report for one sabha.
//
// This page owns the three subscriptions the whole screen shares:
//   • events                — the list
//   • all attendance        — one listener, grouped into per-event counts AND
//                             per-event rows (see subscribeToAllAttendance)
//   • individuals           — needed to turn attendance rows into names, and to
//                             work out who was in scope but not marked
// Every child is then pure: what the card badge says, what the dashboard charts
// and what the CSV/PDF contain all come from the same snapshot.
//
// PHASE 24 — READS. Three of those subscriptions were opened by hand here, which
// meant an admin who visited Contacts and then Events paid for all ~3,100
// individuals twice. They now come from the shared hooks (useAllContacts,
// useVolunteers), so Events reuses the listener Contacts already has and a scoped
// volunteer loads only their own people. The area dropdown no longer derives its
// list from all ~420 households either — useAreasAndMandals is 17 documents and
// is already open everywhere.
//
// PHASE 25 — the page now has two views. "Calendar" is the original per-sabha
// screen. "Season" is SabhaAnalytics: the same events and the same attendance
// snapshot read as a series, which is what a weekly-per-mandal rhythm actually
// needs and what no screen answered before. It costs no extra reads — both views
// are derived from the two subscriptions already open here.
//
// The list also gained search and a mandal filter. With one sabha a week per
// mandal the list passes 50 rows inside a year, and scrolling for "last week's
// Sanganer sabha" stops being viable well before that.
//
// Layout: two columns from lg up. Below that the event list would push the
// detail panel off-screen, so on a phone the list collapses once an event is
// picked and a "Change" bar takes its place.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Users, CalendarDays, ChevronLeft, LayoutDashboard, CheckSquare,
  Search, X, TrendingUp, ListFilter, CalendarClock,
} from 'lucide-react';
import {
  subscribeToEvents, subscribeToAllAttendance, createEvent, updateEvent, deleteEvent, pickUpcomingEvent,
} from '../services/eventService';
import { buildEventAttendanceRows, computeEventStats, formatEventDate, formatEventTime } from '../lib/eventExports';
import { useAllContacts } from '../hooks/useAllContacts';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { useVolunteers } from '../hooks/useVolunteers';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { confirmDialog } from '../components/ui/ConfirmHost';
import EventForm from '../components/events/EventForm';
import AttendanceMarking from '../components/events/AttendanceMarking';
import EventExportButtons from '../components/events/EventExportButtons';
import EventDashboard from '../components/events/EventDashboard';
import ObserverAttendancePanel from '../components/bal-mandal/ObserverAttendancePanel';
import SabhaAnalytics from '../components/events/SabhaAnalytics';
import AllAreaSabhas from '../components/events/AllAreaSabhas';
import { isEventPast } from '../lib/eventAnalytics';
import Modal from '../components/ui/Modal';
import RequirePermission from '../components/RequirePermission';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { cn } from '../lib/cn';
import { writableMandals, eventInScope, eventAreas, areaLabel } from '../lib/scope';

// One definition of "already happened", shared with the season analytics so the
// Upcoming/Past split and the analytics window can never disagree.
const isPast = (event) => isEventPast(event);

function EventListItem({ event, count, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition',
        selected ? 'border-orange-300 bg-orange-50/60' : 'border-slate-100 bg-white hover:border-slate-200',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{event.title}</p>
        {/* Present count, live. 0 stays visible rather than being hidden — a
            sabha showing "0" is itself the signal that nobody marked it. */}
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400',
          )}
          title={`${count} marked present`}
        >
          <Users className="h-3 w-3" /> {count}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {formatEventDate(event.date, { day: 'numeric', month: 'short', year: 'numeric' })}
        {event.time && ` · ${formatEventTime(event.time)}`}
        {event.durationMinutes && ` · ${event.durationMinutes}m`}
      </p>
      {(event.speaker || event.mandal || areaLabel(event)) && (
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {[event.speaker ? `Speaker: ${event.speaker}` : null, event.mandal, areaLabel(event)].filter(Boolean).join(' · ')}
        </p>
      )}
    </button>
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [attendance, setAttendance] = useState({ counts: {}, byEvent: {} });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [tab, setTab] = useState('mark');
  const [view, setView] = useState('calendar');
  const [listQuery, setListQuery] = useState('');
  const [listMandal, setListMandal] = useState('');
  // Scoped for a karyakarta, complete for an admin — and shared with the Contacts
  // page either way, so opening this tab after that one costs nothing.
  const { contacts: individuals, isViewAll } = useAllContacts();
  const { volunteers } = useVolunteers();
  const { areas: areaDefs, mandals: mandalDefs } = useAreasAndMandals();
  const { volunteer, permissions, scope } = useAuth();
  const { showToast } = useToast();

  const canSeeDashboard = permissions.includes('view_all_contacts') || permissions.includes('manage_events');
  // Opt-out (Phase B): a role with hide_past_sabhas marks only the upcoming sabha
  // and never sees the Past list (Roles → "Hide Past Sabhas (upcoming only)").
  // Presentation only — the events/attendance subscriptions are unchanged, so
  // this adds no Firestore reads.
  const hidePast = permissions.includes('hide_past_sabhas');
  // PHASE 31 — was a literal `scope.kind === 'mandal'` test, which fell open for
  // anyone whose resolved kind came out INTERSECT (an area AND a mandal assigned)
  // or UNION: they got the unrestricted form and could file a sabha under any
  // mandal in the city. writableMandals() answers the actual question — is the
  // mandal axis binding for this shape? — and returns null when it isn't.
  const eventMandalScope = writableMandals(scope);
  const areas = useMemo(
    () => [...new Set((areaDefs || []).map((a) => a.name || a).filter(Boolean))].sort(),
    [areaDefs],
  );
  // The filter list is the reference collection plus anything an event or a
  // contact actually carries — imported sabhas predate the mandals collection,
  // and a value you cannot select is a value you cannot find.
  const mandalOptions = useMemo(() => [...new Set([
    ...(mandalDefs || []).map((m) => m.name || m),
    ...events.map((e) => e.mandal),
    ...individuals.map((i) => i.mandal),
  ].filter(Boolean))].sort(), [mandalDefs, events, individuals]);

  // Events carry both scope axes themselves, unlike attendance rows. Filter at
  // the subscription boundary so every calendar, search, dashboard and export
  // below works only with the caller's permitted mandal/area events. eventInScope
  // understands a joint sabha's areas[] and a city-wide sabha (Phase 34), so a
  // mandal head still sees the all-area sabha that belongs to their mandal.
  useEffect(() => subscribeToEvents((evts) => {
    setEvents(evts.filter((event) => eventInScope(scope, event)));
    setLoading(false);
  }, scope), [scope]);
  useEffect(() => subscribeToAllAttendance(setAttendance), []);

  useEffect(() => {
    if (!selectedEventId && events.length) {
      const upcoming = pickUpcomingEvent(events);
      // With hidePast, never fall back to the newest PAST sabha — a role limited
      // to upcoming marking must not open a closed one. Leave nothing selected
      // until an upcoming sabha exists.
      if (upcoming) setSelectedEventId(upcoming.id);
      else if (!hidePast) setSelectedEventId(events[events.length - 1].id);
    }
  }, [events, selectedEventId, hidePast]);

  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;

  const individualsById = useMemo(() => {
    const m = new Map();
    individuals.forEach((i) => m.set(i.id, i));
    return m;
  }, [individuals]);

  const volunteersById = useMemo(() => {
    const m = new Map();
    volunteers.forEach((v) => m.set(v.id, v));
    return m;
  }, [volunteers]);

  const selectedRows = useMemo(() => (
    selectedEvent
      ? buildEventAttendanceRows({
          event: selectedEvent,
          attendance: attendance.byEvent[selectedEvent.id] || [],
          individualsById,
          volunteersById,
          unknownLabel: isViewAll ? '(contact deleted)' : '(outside your area / mandal)',
        })
      : []
  ), [selectedEvent, attendance.byEvent, individualsById, volunteersById, isViewAll]);

  const selectedStats = useMemo(() => (
    selectedEvent ? computeEventStats({ event: selectedEvent, rows: selectedRows, individuals }) : null
  ), [selectedEvent, selectedRows, individuals]);

  // The last 8 sabhas that have already happened, oldest → newest, so the
  // dashboard can put one number in context. subscribeToEvents already sorts by
  // date ascending.
  const trend = useMemo(() => {
    const done = events.filter((e) => isPast(e) || e.id === selectedEventId);
    return done.slice(-8).map((e) => ({ event: e, count: attendance.counts[e.id] || 0 }));
  }, [events, attendance.counts, selectedEventId]);

  const { upcoming, past } = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    const matches = (e) => {
      if (listMandal && (e.mandal || '') !== listMandal) return false;
      if (!q) return true;
      // Date is searchable as typed too — "2026-01" or "jan" both find January.
      return [e.title, e.speaker, e.mandal, ...eventAreas(e), e.date,
        formatEventDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })]
        .some((v) => String(v || '').toLowerCase().includes(q));
    };
    const shown = events.filter(matches);
    return {
      upcoming: shown.filter((e) => !isPast(e)),
      // Newest first — nobody scrolls to the bottom for last week's sabha.
      // hidePast blanks the list entirely for roles limited to upcoming marking,
      // which also collapses the "Past (n)" section and the counters below.
      past: hidePast ? [] : shown.filter(isPast).slice().reverse(),
    };
  }, [events, listQuery, listMandal, hidePast]);

  const filtering = Boolean(listQuery.trim() || listMandal);
  const upcomingAll = useMemo(() => events.filter((e) => !isPast(e)).length, [events]);

  function selectEvent(id) {
    setSelectedEventId(id);
    setListOpen(false);
    setTab('mark');
    setView('calendar');
  }

  async function handleCreate(data) {
    try {
      const ref = await createEvent({ ...data, createdBy: volunteer?.id });
      showToast({ type: 'success', message: 'Event created.' });
      if (ref?.id) selectEvent(ref.id);
      return true;
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn’t create the event.' });
      return false;
    }
  }

  async function handleUpdate(data) {
    try {
      await updateEvent(editingEvent.id, data);
      showToast({ type: 'success', message: 'Event updated.' });
      return true;
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn’t update the event.' });
      return false;
    }
  }

  async function handleDelete(event) {
    const marked = attendance.counts[event.id] || 0;
    const ok = await confirmDialog({
      title: `Delete “${event.title}”?`,
      message: marked > 0
        ? `${marked} attendance record${marked === 1 ? '' : 's'} will be left orphaned — they stay in the database but stop appearing anywhere. Export the CSV first if you need it.`
        : undefined,
      confirmText: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteEvent(event.id);
    if (selectedEventId === event.id) setSelectedEventId(null);
  }

  const showList = !selectedEvent || listOpen;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Events &amp; Sabha</h1>
          <p className="text-sm text-slate-400">
            {events.length} on the calendar · {upcomingAll} upcoming
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Calendar vs season. The season view is cross-event, so it lives at
              page level rather than inside one sabha's card. */}
          {canSeeDashboard && (
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
              <button
                onClick={() => setView('calendar')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition',
                  view === 'calendar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <CalendarDays className="h-3.5 w-3.5" /> Calendar
              </button>
              <button
                onClick={() => setView('season')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition',
                  view === 'season' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Season stats
              </button>
              {/* PHASE 33 — the recurring sabhas and their track record. Sits
                  next to Season stats because it is the other cross-event view:
                  season answers "how many came", this answers "did it happen at
                  all, and where didn't it". */}
              <button
                onClick={() => setView('schedules')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition',
                  view === 'schedules' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <CalendarClock className="h-3.5 w-3.5" /> All Area Sabhas
              </button>
            </div>
          )}
          <RequirePermission permission="manage_events">
            <Button variant="accent" onClick={() => { setEditingEvent(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> New event
            </Button>
          </RequirePermission>
        </div>
      </div>

      {view === 'season' && canSeeDashboard ? (
        <SabhaAnalytics
          events={events}
          byEvent={attendance.byEvent}
          individuals={individuals}
          mandals={mandalOptions}
          areas={areas}
        />
      ) : view === 'schedules' && canSeeDashboard ? (
        // Both props come from the subscriptions already open above, so the
        // whole grid is derived rather than fetched.
        <AllAreaSabhas
          events={events}
          counts={attendance.counts}
          onOpenEvent={selectEvent}
        />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[290px_1fr]">
        {/* ── Event list ───────────────────────────────────────────────────── */}
        <aside className={cn('lg:block', showList ? 'block' : 'hidden')}>
          {/* Search + mandal filter. Sticky on desktop so they stay put while the
              list below scrolls. */}
          {events.length > 0 && (
            <div className="mb-3 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                  placeholder="Search title, speaker, date…"
                  className="pl-8 pr-8 text-[13px]"
                />
                {listQuery && (
                  <button
                    onClick={() => setListQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {mandalOptions.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <ListFilter className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <Select
                    value={listMandal}
                    onChange={(e) => setListMandal(e.target.value)}
                    className="text-[13px]"
                  >
                    <option value="">All mandals</option>
                    {mandalOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  </Select>
                </div>
              )}
              {filtering && (
                <p className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>{upcoming.length + past.length} of {events.length} shown</span>
                  <button
                    onClick={() => { setListQuery(''); setListMandal(''); }}
                    className="font-medium text-orange-600 hover:underline"
                  >
                    Clear
                  </button>
                </p>
              )}
            </div>
          )}
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">No events yet.</p>
          ) : upcoming.length + past.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
              No event matches that.
            </p>
          ) : (
            <div className="space-y-4 lg:max-h-[calc(100dvh-17rem)] lg:overflow-y-auto lg:pr-1">
              {upcoming.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <CalendarDays className="h-3 w-3" /> Upcoming ({upcoming.length})
                  </p>
                  <div className="space-y-1.5">
                    {upcoming.map((e) => (
                      <EventListItem key={e.id} event={e} count={attendance.counts[e.id] || 0} selected={selectedEventId === e.id} onClick={() => selectEvent(e.id)} />
                    ))}
                  </div>
                </div>
              )}
              {past.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Past ({past.length})</p>
                  <div className="space-y-1.5">
                    {past.map((e) => (
                      <EventListItem key={e.id} event={e} count={attendance.counts[e.id] || 0} selected={selectedEventId === e.id} onClick={() => selectEvent(e.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ── Detail ───────────────────────────────────────────────────────── */}
        <div className={cn('min-w-0', showList && selectedEvent ? 'hidden lg:block' : 'block')}>
          {!selectedEvent ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
              Select an event to mark attendance.
            </div>
          ) : (
            <Card className="p-4 sm:p-6">
              {/* Back to the list — phones only; on lg the list is always there */}
              <button
                onClick={() => setListOpen(true)}
                className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 lg:hidden"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> All events
              </button>

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-slate-900 sm:text-base">{selectedEvent.title}</h2>
                  <p className="text-sm text-slate-400">
                    {[
                      formatEventDate(selectedEvent.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
                      formatEventTime(selectedEvent.time),
                      selectedEvent.speaker,
                      selectedEvent.mandal,
                      areaLabel(selectedEvent),
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <RequirePermission permission="manage_events">
                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => { setEditingEvent(selectedEvent); setFormOpen(true); }} aria-label="Edit event">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(selectedEvent)} aria-label="Delete event">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </RequirePermission>
              </div>

              {/* Exports sit above the tabs — they apply to the event, not to
                  whichever tab happens to be open. */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 py-2.5">
                <EventExportButtons event={selectedEvent} rows={selectedRows} stats={selectedStats} />
                {canSeeDashboard && (
                  <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                    <button
                      onClick={() => setTab('mark')}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition',
                        tab === 'mark' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      <CheckSquare className="h-3.5 w-3.5" /> Attendance
                    </button>
                    <button
                      onClick={() => setTab('dashboard')}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition',
                        tab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4">
                {tab === 'dashboard' && canSeeDashboard ? (
                  <EventDashboard
                    event={selectedEvent}
                    rows={selectedRows}
                    stats={selectedStats}
                    individuals={individuals}
                    trend={trend}
                  />
                ) : (
                  <AttendanceMarking
                    event={selectedEvent}
                    individuals={individuals}
                    present={attendance.byEvent[selectedEvent.id] || []}
                  />
                )}
              </div>

              {/* Observer attendance for Bal Mandal events */}
              {(selectedEvent.mandal === 'Bal Mandal' || selectedEvent.mandal === 'Sishu Mandal') && (
                <div className="mt-4">
                  <ObserverAttendancePanel event={selectedEvent} />
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingEvent ? 'Edit event' : 'New event'}>
        <EventForm event={editingEvent} allowedMandals={eventMandalScope} onSubmit={editingEvent ? handleUpdate : handleCreate} onCancel={() => setFormOpen(false)} />
      </Modal>
    </div>
  );
}
