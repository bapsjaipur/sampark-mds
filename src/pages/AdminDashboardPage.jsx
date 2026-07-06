// src/pages/AdminDashboardPage.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { computeOverviewStats, computeVolunteerStats } from '../services/statsService';
import { getHouseholdIdsForAreas } from '../services/reminderService';
import { useAuth } from '../hooks/usePermissions';
import RequirePermission from '../components/RequirePermission';
import { statusColorClasses } from '../lib/callingStatuses';
import { Card } from '../components/ui/Card';

function AdminDashboardInner() {
  const { permissions, assignedAreas, assignedMandals } = useAuth();
  const [individuals, setIndividuals] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [householdIds, setHouseholdIds] = useState([]);
  const [loading, setLoading] = useState(true);

  const unscoped = permissions.includes('view_all_contacts');

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'individuals'), (snap) => { setIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); }),
      onSnapshot(collection(db, 'volunteers'), (snap) => setVolunteers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'batches'), (snap) => setBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    if (unscoped) { setHouseholdIds([]); return; }
    getHouseholdIdsForAreas(assignedAreas || []).then(setHouseholdIds);
  }, [unscoped, assignedAreas?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const scope = useMemo(() => ({ unscoped, mandals: assignedMandals || [], householdIds, areas: assignedAreas || [] }), [unscoped, assignedMandals, householdIds, assignedAreas]);
  const overview = useMemo(() => computeOverviewStats(individuals, scope), [individuals, scope]);
  const volunteerStats = useMemo(() => computeVolunteerStats(individuals, batches, volunteers, scope), [individuals, batches, volunteers, scope]);

  const pct = overview.total ? Math.round((overview.called / overview.total) * 100) : 0;
  const interested = (overview.statusBreakdown['Interested'] || 0) + (overview.statusBreakdown['Already Volunteer'] || 0);
  const statusRows = Object.entries(overview.statusBreakdown).sort((a, b) => b[1] - a[1]);
  const mandalRows = Object.entries(overview.byMandal).sort((a, b) => b[1].total - a[1].total);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading stats\u2026</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">{unscoped ? 'Admin Dashboard' : 'Moderator Dashboard'}</h1>
        <p className="text-sm text-slate-400">{unscoped ? 'Live overview across all Mandals and volunteers' : `Scoped to your assigned areas: ${(assignedAreas || []).join(', ') || 'none set'}`}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Total" value={overview.total} color="text-slate-900" />
        <SummaryCard label="Called" value={overview.called} color="text-orange-600" />
        <SummaryCard label="Interested" value={interested} color="text-emerald-600" />
      </div>

      <Card className="p-5">
        <p className="mb-2 text-sm font-medium text-slate-700">Overall Progress \u00b7 {pct}%</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-orange-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-400">{overview.called} called \u00b7 {overview.total - overview.called} remaining</p>

        <div className="mt-5 space-y-2">
          {statusRows.length === 0 ? <p className="text-sm text-slate-400">No data yet.</p> : statusRows.map(([status, n]) => {
            const bp = overview.total ? Math.round((n / overview.total) * 100) : 0;
            return (
              <div key={status} className="flex items-center gap-3">
                <span className={`min-w-[140px] rounded-full border px-2.5 py-1 text-center text-xs font-medium ${statusColorClasses(status)}`}>{status}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-400 transition-all" style={{ width: `${bp}%` }} /></div>
                <span className="w-8 text-right text-sm font-semibold text-slate-700">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {mandalRows.length > 0 && (
        <div>
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">By Mandal</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {mandalRows.map(([mandal, m]) => {
              const mpct = m.total ? Math.round((m.called / m.total) * 100) : 0;
              return (
                <Card key={mandal} className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-900">{mandal}</p>
                    <span className="text-xs text-slate-400">{m.total} people</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-400" style={{ width: `${mpct}%` }} /></div>
                  <p className="mt-1 text-xs text-slate-400">{m.called} called \u00b7 {m.interested} interested \u00b7 {mpct}%</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Volunteer Activity</h2>
        {volunteerStats.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No volunteers with an assigned batch yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {volunteerStats.map(({ volunteer, assigned, called, interested, remaining }) => {
              const vpct = assigned ? Math.round((called / assigned) * 100) : 0;
              return (
                <Card key={volunteer.id} className="p-4">
                  <p className="font-medium text-slate-900">{volunteer.name || 'Unnamed'}</p>
                  <p className="text-xs text-slate-400">{volunteer.mobile}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${vpct >= 100 ? 'bg-emerald-500' : 'bg-orange-400'}`} style={{ width: `${vpct}%` }} /></div>
                  <p className="mt-1 text-xs text-slate-400">{called}/{assigned} called \u00b7 {interested} interested \u00b7 {remaining} remaining</p>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <Card className="p-5 text-center">
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{label}</p>
    </Card>
  );
}

export default function AdminDashboardPage() {
  return (
    <RequirePermission anyOf={['view_all_contacts', 'view_assigned_contacts']} fallback={<div className="p-6 text-sm text-slate-500">You need View All or View Assigned Contacts permission to see the dashboard.</div>}>
      <AdminDashboardInner />
    </RequirePermission>
  );
}
