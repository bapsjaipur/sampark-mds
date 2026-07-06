// src/components/reminders/RemindersDashboard.jsx — Attio redesign.
import { useEffect, useState } from 'react';
import { Phone, Cake, Heart } from 'lucide-react';
import { getReminders } from '../../services/reminderService';
import { logActivity } from '../../lib/activityLog';
import { useAuth } from '../../hooks/usePermissions';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

function ReminderRow({ entry, volunteerId }) {
  const { individual, type, monthDay } = entry;

  async function handleCall() {
    await logActivity({ volunteerId, individualId: individual.id, action: 'call_initiated', details: `${type === 'dob' ? 'Birthday' : 'Anniversary'} reminder call (${monthDay})` });
    window.location.href = `tel:${individual.mobile}`;
  }

  const Icon = type === 'dob' ? Cake : Heart;

  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Avatar name={individual.name} size="sm" />
        <div>
          <p className="text-sm font-medium text-slate-900">{individual.name}</p>
          <p className="flex items-center gap-1 text-xs text-slate-400"><Icon className="h-3 w-3" /> {type === 'dob' ? 'Birthday' : 'Anniversary'} \u00b7 {monthDay}</p>
        </div>
      </div>
      <Button variant="accent" size="sm" onClick={handleCall}><Phone className="h-3 w-3" /> Call now</Button>
    </div>
  );
}

export default function RemindersDashboard() {
  const { volunteer, permissions } = useAuth();
  const [data, setData] = useState({ thisWeek: [], thisMonth: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!volunteer) return;
    setLoading(true);
    getReminders({ volunteer, permissions }).then(setData).finally(() => setLoading(false));
  }, [volunteer, permissions]);

  if (loading) return <div className="mx-auto max-w-3xl px-6 py-8 text-sm text-slate-400">Loading reminders\u2026</div>;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Reminders</h1>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold text-slate-900">This Week ({data.thisWeek.length})</h3>
        {data.thisWeek.length === 0 && <p className="text-xs text-slate-400">Nothing due this week.</p>}
        <div className="space-y-1.5">{data.thisWeek.map((e) => <ReminderRow key={`${e.individual.id}-${e.type}`} entry={e} volunteerId={volunteer.id} />)}</div>
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold text-slate-900">This Month ({data.thisMonth.length})</h3>
        {data.thisMonth.length === 0 && <p className="text-xs text-slate-400">Nothing else due this month.</p>}
        <div className="space-y-1.5">{data.thisMonth.map((e) => <ReminderRow key={`${e.individual.id}-${e.type}`} entry={e} volunteerId={volunteer.id} />)}</div>
      </section>
    </div>
  );
}
