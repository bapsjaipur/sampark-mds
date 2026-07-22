// src/components/admin-tools/FollowUpTrackingTab.jsx
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Card } from '../ui/Card';

export default function FollowUpTrackingTab() {
  const [activities, setActivities] = useState([]);
  const [vols, setVols] = useState([]);

  useEffect(() => {
    // 1. Get all follow-up activities
    const q = query(collection(db, 'activity'), where('action', 'in', ['followup_call', 'followup_whatsapp']));
    const unsub = onSnapshot(q, (snap) => {
      setActivities(snap.docs.map(d => ({id: d.id, ...d.data()})));
    });
    // 2. Get all volunteers
    const unsubVols = onSnapshot(collection(db, 'volunteers'), (snap) => {
      setVols(snap.docs.map(d => ({id: d.id, ...d.data()})));
    });
    return () => { unsub(); unsubVols(); };
  }, []);

  const stats = useMemo(() => {
    const map = {};
    activities.forEach(a => {
      if (!map[a.volunteerId]) map[a.volunteerId] = 0;
      map[a.volunteerId]++;
    });
    return vols.map(v => ({ name: v.name, count: map[v.id] || 0 }));
  }, [activities, vols]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Follow-up Tracking</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {stats.sort((a,b) => b.count - a.count).map(s => (
          <Card key={s.name} className="p-4 flex items-center justify-between">
            <span className="font-medium text-slate-700">{s.name}</span>
            <span className="text-2xl font-bold text-orange-600">{s.count}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}
