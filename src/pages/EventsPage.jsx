// src/pages/EventsPage.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { subscribeToEvents, createEvent, updateEvent, deleteEvent, pickUpcomingEvent } from '../services/eventService';
import { useHouseholds } from '../hooks/useHouseholds';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import EventForm from '../components/events/EventForm';
import AttendanceMarking from '../components/events/AttendanceMarking';
import Modal from '../components/ui/Modal';
import RequirePermission from '../components/RequirePermission';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const { households } = useHouseholds();
  const { volunteer } = useAuth();
  const { showToast } = useToast();

  const areas = useMemo(() => [...new Set(households.map((h) => h.area).filter(Boolean))].sort(), [households]);

  useEffect(() => {
    const unsub = subscribeToEvents((evts) => { setEvents(evts); setLoading(false); });
    return unsub;
  }, []);

  useEffect(() => {
    if (!selectedEventId && events.length) {
      const upcoming = pickUpcomingEvent(events);
      if (upcoming) setSelectedEventId(upcoming.id);
    }
  }, [events, selectedEventId]);

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  async function handleCreate(data) {
    try {
      await createEvent({ ...data, createdBy: volunteer?.id });
      showToast({ type: 'success', message: 'Event created.' });
      return true;
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn\u2019t create the event.' });
      return false;
    }
  }

  async function handleUpdate(data) {
    try {
      await updateEvent(editingEvent.id, data);
      showToast({ type: 'success', message: 'Event updated.' });
      return true;
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn\u2019t update the event.' });
      return false;
    }
  }

  async function handleDelete(event) {
    if (!window.confirm(`Delete "${event.title}"? Attendance records for it will remain but won\u2019t show anywhere.`)) return;
    await deleteEvent(event.id);
    if (selectedEventId === event.id) setSelectedEventId(null);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Events & Sabha</h1>
          <p className="text-sm text-slate-400">{events.length} events on the calendar</p>
        </div>
        <RequirePermission permission="manage_events">
          <Button variant="accent" onClick={() => { setEditingEvent(null); setFormOpen(true); }}><Plus className="h-3.5 w-3.5" /> New event</Button>
        </RequirePermission>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-1">
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">No events yet.</p>
          ) : (
            <div className="space-y-1.5">
              {events.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEventId(e.id)}
                  className={`w-full rounded-lg border p-3 text-left text-sm ${selectedEventId === e.id ? 'border-slate-300 bg-slate-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                >
                  <p className="font-medium text-slate-900">{e.title}</p>
                  <p className="text-xs text-slate-400">{e.date} {e.time && `\u00b7 ${e.time}`}</p>
                  {(e.mandal || e.area) && <p className="text-xs text-slate-400">{[e.mandal, e.area].filter(Boolean).join(' \u00b7 ')}</p>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          {!selectedEvent ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 p-12 text-sm text-slate-400">
              Select an event to mark attendance.
            </div>
          ) : (
            <Card className="p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[15px] font-semibold text-slate-900">{selectedEvent.title}</h2>
                  <p className="text-sm text-slate-400">{selectedEvent.date} {selectedEvent.time && `\u00b7 ${selectedEvent.time}`} {selectedEvent.speaker && `\u00b7 ${selectedEvent.speaker}`}</p>
                </div>
                <RequirePermission permission="manage_events">
                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => { setEditingEvent(selectedEvent); setFormOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(selectedEvent)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </RequirePermission>
              </div>
              <AttendanceMarking event={selectedEvent} />
            </Card>
          )}
        </div>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingEvent ? 'Edit event' : 'New event'}>
        <EventForm event={editingEvent} areas={areas} onSubmit={editingEvent ? handleUpdate : handleCreate} onCancel={() => setFormOpen(false)} />
      </Modal>
    </div>
  );
}
