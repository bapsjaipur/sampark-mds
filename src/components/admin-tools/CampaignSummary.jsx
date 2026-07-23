// src/components/admin-tools/CampaignSummary.jsx
import { useEffect, useMemo, useState } from 'react';
import { collection, getCountFromServer } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Home, Users, CheckCircle, Target, Database } from 'lucide-react';
import { Card } from '../ui/Card';

export default function CampaignSummary({ events }) {
  const [globalTotal, setGlobalTotal] = useState(null);

  useEffect(() => {
    // Fetch the true global count of households in the database efficiently
    getCountFromServer(collection(db, 'households'))
      .then(snap => setGlobalTotal(snap.data().count))
      .catch(console.error);
  }, []);

  const stats = useMemo(() => {
    let totalHouseholds = 0;
    let visitedCount = 0;

    events.forEach(ev => {
      const hhs = ev.households || [];
      totalHouseholds += hhs.length;
      visitedCount += hhs.filter(h => h.status === 'completed').length;
    });

    return {
      events: events.length,
      households: totalHouseholds, // Scheduled homes
      visited: visitedCount,
      percentage: totalHouseholds > 0 ? Math.round((visitedCount / totalHouseholds) * 100) : 0,
      globalReach: globalTotal ? Math.round((totalHouseholds / globalTotal) * 100) : 0
    };
  }, [events, globalTotal]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      <Card className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-full bg-violet-50 text-violet-600"><Database className="h-5 w-5" /></div>
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold">Total DB</p>
          <p className="text-xl font-bold text-slate-900">{globalTotal === null ? '...' : globalTotal}</p>
        </div>
      </Card>
      <Card className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-full bg-blue-50 text-blue-600"><Target className="h-5 w-5" /></div>
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold">Events</p>
          <p className="text-xl font-bold text-slate-900">{stats.events}</p>
        </div>
      </Card>
      <Card className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-full bg-indigo-50 text-indigo-600"><Home className="h-5 w-5" /></div>
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold">Scheduled</p>
          <p className="text-xl font-bold text-slate-900">{stats.households}</p>
        </div>
      </Card>
      <Card className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-full bg-emerald-50 text-emerald-600"><CheckCircle className="h-5 w-5" /></div>
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold">Visited</p>
          <p className="text-xl font-bold text-slate-900">{stats.visited}</p>
        </div>
      </Card>
      <Card className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-full bg-orange-50 text-orange-600"><Users className="h-5 w-5" /></div>
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold">Completion</p>
          <p className="text-xl font-bold text-slate-900">
            {stats.percentage}%
          </p>
        </div>
      </Card>
    </div>
  );
}
