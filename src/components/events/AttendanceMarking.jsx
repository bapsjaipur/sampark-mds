// src/components/events/AttendanceMarking.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { CheckCircle2 } from 'lucide-react';
import { db } from '../../lib/firebase';
import { markPresent, unmarkPresent, subscribeToAttendance } from '../../services/eventService';
import { getWindowState } from '../../lib/attendanceWindow';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { Input } from '../ui/Input';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

const WINDOW_LABELS = {
  before: { text: 'Attendance opens 30 minutes before the event starts.', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  after: { text: 'Attendance window has closed for this event.', tone: 'bg-slate-50 text-slate-500 border-slate-100' },
  unknown: { text: 'Set a date and time on this event to enable attendance.', tone: 'bg-slate-50 text-slate-500 border-slate-100' },
  open: null,
};

export default function AttendanceMarking({ event }) {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const [allIndividuals, setAllIndividuals] = useState([]);
  const [present, setPresent] = useState([]);
  const [search, setSearch] = useState('');
  const [windowState, setWindowState] = useState(() => getWindowState(event));

  useEffect(() => {
    const q = query(collection(db, 'individuals'), orderBy('name'));
    return onSnapshot(q, (snap) => setAllIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => subscribeToAttendance(event.id, setPresent), [event.id]);

  useEffect(() => {
    setWindowState(getWindowState(event));
    const interval = setInterval(() => setWindowState(getWindowState(event)), 30000);
    return () => clearInterval(interval);
  }, [event]);

  const presentIds = useMemo(() => new Set(present.map((p) => p.individualId)), [present]);
  const presentPeople = useMemo(
    () => present.map((p) => ({ ...p, person: allIndividuals.find((i) => i.id === p.individualId) })).filter((p) => p.person),
    [present, allIndividuals]
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allIndividuals.filter((i) => i.name?.toLowerCase().includes(q) || i.mobile?.includes(q)).slice(0, 20);
  }, [search, allIndividuals]);

  const isOpen = windowState === 'open';
  const banner = WINDOW_LABELS[windowState];

  async function handleMark(individual) {
    try {
      await markPresent({ eventId: event.id, individualId: individual.id, markedBy: volunteer?.id });
      showToast({ type: 'success', message: `${individual.name} marked present.` });
      setSearch('');
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn\u2019t mark attendance. Try again.' });
    }
  }

  async function handleUnmark(individual) {
    try {
      await unmarkPresent({ eventId: event.id, individualId: individual.id });
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn\u2019t undo. Try again.' });
    }
  }

  return (
    <div className="space-y-4">
      {banner && <div className={`rounded-lg border px-3 py-2 text-sm ${banner.tone}`}>{banner.text}</div>}

      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> <strong>{presentPeople.length}</strong> member{presentPeople.length === 1 ? '' : 's'} marked present
      </div>

      <div className={isOpen ? '' : 'pointer-events-none opacity-40'}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or mobile to mark present\u2026" />
        {searchResults.length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
            {searchResults.map((i) => (
              <button
                key={i.id}
                onClick={() => !presentIds.has(i.id) && handleMark(i)}
                disabled={presentIds.has(i.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <span>{i.name} <span className="text-xs text-slate-400">{i.mobile}</span></span>
                {presentIds.has(i.id) ? <span className="text-xs text-emerald-600">Already present</span> : <span className="text-xs text-orange-600">Mark present</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Present ({presentPeople.length})</p>
        {presentPeople.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No one marked yet.</p>
        ) : (
          <div className="space-y-1.5">
            {presentPeople.map(({ person }) => (
              <div key={person.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <Avatar name={person.name} size="sm" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{person.name}</p>
                    <p className="text-xs text-slate-400">{person.mobile}{person.mandal ? ` \u00b7 ${person.mandal}` : ''}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleUnmark(person)} className="text-rose-500 hover:bg-rose-50">Undo</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
