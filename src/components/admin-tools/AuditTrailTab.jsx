// src/components/admin-tools/AuditTrailTab.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Select } from '../ui/Input';

const ACTION_LABELS = {
  create_household: 'Created household', update_household: 'Updated household', delete_household: 'Deleted household',
  create_individual: 'Created contact', update_individual: 'Updated contact', delete_individual: 'Deleted contact',
  status_changed: 'Changed status', reference_updated: 'Updated reference', call_logged: 'Logged a call', call_initiated: 'Reminder call',
};

function formatTimestamp(ts) {
  if (!ts) return '\u2014';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AuditTrailTab() {
  const [entries, setEntries] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [individuals, setIndividuals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [volunteerFilter, setVolunteerFilter] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(300));
    return onSnapshot(q, (snap) => { setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); });
  }, []);
  useEffect(() => onSnapshot(collection(db, 'volunteers'), (snap) => setVolunteers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), []);
  useEffect(() => onSnapshot(collection(db, 'individuals'), (snap) => setIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), []);

  const volunteerName = (id) => volunteers.find((v) => v.id === id)?.name || 'Unknown volunteer';
  const individualName = (id) => individuals.find((i) => i.id === id)?.name;

  const filtered = useMemo(() => entries.filter((e) => !actionFilter || e.action === actionFilter).filter((e) => !volunteerFilter || e.volunteerId === volunteerFilter), [entries, actionFilter, volunteerFilter]);

  if (loading) return <p className="text-sm text-slate-400">Loading activity\u2026</p>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="w-44">
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={volunteerFilter} onChange={(e) => setVolunteerFilter(e.target.value)} className="w-44">
          <option value="">All volunteers</option>
          {volunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <span className="text-xs text-slate-400">Showing last {entries.length} of up to 300 recent actions</span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">No activity matches your filters.</p>
      ) : (
        <div className="space-y-0.5">
          {filtered.map((e) => (
            <div key={e.id} className="flex items-start gap-3 border-b border-slate-50 py-2 text-sm">
              <span className="w-32 shrink-0 text-xs text-slate-400">{formatTimestamp(e.timestamp)}</span>
              <span className="w-28 shrink-0 truncate font-medium text-slate-700">{volunteerName(e.volunteerId)}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{ACTION_LABELS[e.action] || e.action}</span>
              {e.individualId && individualName(e.individualId) && <span className="truncate text-slate-500">on {individualName(e.individualId)}</span>}
              {e.details && <span className="truncate text-xs text-slate-400">{typeof e.details === 'string' ? e.details : JSON.stringify(e.details)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
