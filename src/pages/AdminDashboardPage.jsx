// src/pages/AdminDashboardPage.jsx — Attio redesign.
//
// PHASE 24 — READS. The three listeners this page opened by hand were duplicates
// of ones the app already has open. They now go through the shared store using the
// SAME query keys as useAllContacts/useVolunteers, so an admin arriving from
// Contacts is billed nothing for the individuals sweep. The queries themselves are
// unchanged — which documents arrive, and therefore every number on this page, is
// exactly as before.
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { computeOverviewStats, computeVolunteerStats } from '../services/statsService';
import { getHouseholdIdsForAreas } from '../services/reminderService';
import { useAuth } from '../hooks/usePermissions';
import RequirePermission from '../components/RequirePermission';
import { useCallOutcomes } from '../hooks/useCallOutcomes';
import { useSharedCollection } from '../hooks/useSharedCollection';
import { useVolunteers } from '../hooks/useVolunteers';
import { Card } from '../components/ui/Card';

const BATCH_SPEC = [{ key: 'batches', source: 'batches', build: () => collection(db, 'batches') }];

function AdminDashboardInner() {
  const { permissions, assignedAreas, assignedMandals } = useAuth();
  const { colorClasses: statusColorClasses } = useCallOutcomes();
  const [householdIds, setHouseholdIds] = useState([]);

  const unscoped = permissions.includes('view_all_contacts');
  const areasKey = (assignedAreas || []).join(',');

  // Area-scoped volunteers only load their area's individuals; admins load all.
  // No areas assigned yet → no spec at all, which shows empty stats without
  // spending a read to discover that.
  const indSpecs = useMemo(() => {
    const col = collection(db, 'individuals');
    if (unscoped) {
      return [{ key: 'individuals|all', source: 'individuals', build: () => query(col, orderBy('name')) }];
    }
    const areas = (assignedAreas || []).slice(0, 30);
    if (!areas.length) return [];
    return [{
      key: `individuals|area|${areas.join(',')}`,
      source: 'individuals (area)',
      build: () => query(col, where('area', 'in', areas)),
    }];
  }, [unscoped, areasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rows: individuals, loading } = useSharedCollection(indSpecs);
  const { volunteers } = useVolunteers();
  const { rows: batches } = useSharedCollection(BATCH_SPEC);

  useEffect(() => {
    if (unscoped) { setHouseholdIds([]); return; }
    getHouseholdIdsForAreas(assignedAreas || []).then(setHouseholdIds);
  }, [unscoped, areasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const scope = useMemo(() => ({ unscoped, mandals: assignedMandals || [], householdIds, areas: assignedAreas || [] }), [unscoped, assignedMandals, householdIds, assignedAreas]);
  const overview = useMemo(() => computeOverviewStats(individuals, scope), [individuals, scope]);
  const volunteerStats = useMemo(() => computeVolunteerStats(individuals, batches, volunteers, scope), [individuals, batches, volunteers, scope]);

  const pct = overview.total ? Math.round((overview.called / overview.total) * 100) : 0;
  const interested = (overview.statusBreakdown['Interested'] || 0) + (overview.statusBreakdown['Already Volunteer'] || 0);
  const statusRows = Object.entries(overview.statusBreakdown).sort((a, b) => b[1] - a[1]);
  const mandalRows = Object.entries(overview.byMandal).sort((a, b) => b[1].total - a[1].total);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading stats…</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{unscoped ? 'Admin Dashboard' : 'Area Dashboard'}</h1>
        <p className="text-sm text-slate-400">
          {unscoped
            ? 'Live overview across all areas and Mandals'
            : assignedAreas?.length
              ? `Showing stats for: ${assignedAreas.join(', ')}`
              : 'No areas assigned to your account yet'}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <SummaryCard label="Total" value={overview.total} color="text-slate-900" />
        <SummaryCard label="Called" value={overview.called} color="text-orange-600" />
        <SummaryCard label="Interested" value={interested} color="text-emerald-600" />
      </div>

      <Card className="p-5">
        <p className="mb-2 text-sm font-medium text-slate-700">Overall Progress · {pct}%</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-orange-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-400">{overview.called} called · {overview.total - overview.called} remaining</p>

        <div className="mt-5 space-y-2">
          {statusRows.length === 0 ? <p className="text-sm text-slate-400">No data yet.</p> : statusRows.map(([status, n]) => {
            const bp = overview.total ? Math.round((n / overview.total) * 100) : 0;
            return (
              <div key={status} className="flex items-center gap-2 sm:gap-3">
                <span className={`min-w-[104px] rounded-full border px-2 py-1 text-center text-[11px] font-medium sm:min-w-[140px] sm:px-2.5 sm:text-xs ${statusColorClasses(status)}`}>{status}</span>
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
                  <p className="mt-1 text-xs text-slate-400">{m.called} called · {m.interested} interested · {mpct}%</p>
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
                  <p className="mt-1 text-xs text-slate-400">{called}/{assigned} called · {interested} interested · {remaining} remaining</p>
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
    <Card className="p-3 text-center sm:p-5">
      <p className={`text-2xl font-bold sm:text-3xl ${color}`}>{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400 sm:text-xs">{label}</p>
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
