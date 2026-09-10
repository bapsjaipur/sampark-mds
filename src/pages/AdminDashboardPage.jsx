// src/pages/AdminDashboardPage.jsx — Attio redesign.
//
// PHASE 24 — READS. The three listeners this page opened by hand were duplicates
// of ones the app already has open. They now go through the shared store using the
// SAME query keys as useAllContacts/useVolunteers, so an admin arriving from
// Contacts is billed nothing for the individuals sweep. The queries themselves are
// unchanged — which documents arrive, and therefore every number on this page, is
// exactly as before.
//
// PHASE 29 — the numbers can now be reset from here. Every figure on this page is
// one field read back (`status` on the contact), and nothing on this screen could
// clear it, so "Called 468" only ever went up. The reset lives behind the button
// in the header; see components/sampark/ResetRoundModal.jsx for what it does and,
// more importantly, what it refuses to touch.
// PHASE 31 — SCOPE. This page built its own `individuals` query, area-only, from
// `assignedAreas`. Two consequences, both bad: an admin paid for a second listener
// that duplicated Contacts', and a MANDAL-scoped Super Moderator (who has no
// assigned areas at all — their territory is a mandal across every area) produced
// no spec, so every tile read 0 with nothing on screen to say why. It now uses the
// same buildIndividualSpecs() and the same canonical scope object as Contacts, so
// the numbers cover exactly the people that volunteer is responsible for and cost
// nothing when Contacts is already open.
import { useEffect, useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { RotateCcw } from 'lucide-react';
import { db } from '../lib/firebase';
import { computeOverviewStats, computeVolunteerStats, filterInScope } from '../services/statsService';
import { getHouseholdIdsForAreas } from '../services/reminderService';
import { useAuth } from '../hooks/usePermissions';
import RequirePermission from '../components/RequirePermission';
import { useCallOutcomes } from '../hooks/useCallOutcomes';
import { useSharedCollection } from '../hooks/useSharedCollection';
import { buildIndividualSpecs } from '../hooks/useAllContacts';
import { useVolunteers } from '../hooks/useVolunteers';
import { describeScope, SCOPE_KINDS } from '../lib/scope';
import ResetRoundModal from '../components/sampark/ResetRoundModal';
import { Card } from '../components/ui/Card';

const BATCH_SPEC = [{ key: 'batches', source: 'batches', build: () => collection(db, 'batches') }];

function AdminDashboardInner() {
  const { scope } = useAuth();
  const { colorClasses: statusColorClasses } = useCallOutcomes();
  const [householdIds, setHouseholdIds] = useState([]);
  const [resetOpen, setResetOpen] = useState(false);

  const unscoped = scope.unrestricted;
  const areasKey = (scope.areas || []).join(',');
  const mandalsKey = (scope.mandals || []).join(',');

  // Same specs, same keys, as useAllContacts — so this is free whenever Contacts
  // is already open, and a mandal head gets a `where('mandal','in',[…])` that bills
  // only their own members instead of the whole collection.
  const indSpecs = useMemo(
    () => buildIndividualSpecs(scope),
    [scope.unrestricted, scope.kind, scope.empty, areasKey, mandalsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { rows: individuals, loading } = useSharedCollection(indSpecs);
  const { volunteers } = useVolunteers();
  const { rows: batches } = useSharedCollection(BATCH_SPEC);

  // Only an AREA-ish scope needs the household lookup: it resolves the area of a
  // member whose own `area` field is still blank. A MANDAL scope reads `mandal`
  // straight off the individual, so spending the reads would buy nothing.
  const needsHouseholdIds = !unscoped
    && scope.kind !== SCOPE_KINDS.MANDAL
    && scope.kind !== SCOPE_KINDS.NONE
    && (scope.areas || []).length > 0;

  useEffect(() => {
    if (!needsHouseholdIds) { setHouseholdIds([]); return; }
    getHouseholdIdsForAreas(scope.areas || []).then(setHouseholdIds);
  }, [needsHouseholdIds, areasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const statsScope = useMemo(() => ({ ...scope, householdIds }), [scope, householdIds]);
  const overview = useMemo(() => computeOverviewStats(individuals, statsScope), [individuals, statsScope]);
  const volunteerStats = useMemo(() => computeVolunteerStats(individuals, batches, volunteers, statsScope), [individuals, batches, volunteers, statsScope]);
  // The exact contacts these numbers are about, and therefore the only ones the
  // reset is allowed to clear. Same predicate computeOverviewStats uses, so the
  // count in the modal can never disagree with the count on the card.
  const scopedIndividuals = useMemo(() => filterInScope(individuals, statsScope), [individuals, statsScope]);

  const pct = overview.total ? Math.round((overview.called / overview.total) * 100) : 0;
  const interested = (overview.statusBreakdown['Interested'] || 0) + (overview.statusBreakdown['Already Volunteer'] || 0);
  const statusRows = Object.entries(overview.statusBreakdown).sort((a, b) => b[1] - a[1]);
  const mandalRows = Object.entries(overview.byMandal).sort((a, b) => b[1].total - a[1].total);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading stats…</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {unscoped ? 'Admin Dashboard' : scope.kind === SCOPE_KINDS.MANDAL ? 'Mandal Dashboard' : 'Area Dashboard'}
          </h1>
          <p className="text-sm text-slate-400">
            {unscoped
              ? 'Live overview across all areas and Mandals'
              : scope.empty
                ? 'No areas or mandals assigned to your account yet'
                : `Showing stats for: ${describeScope(scope)}`}
          </p>
        </div>

        {/* Where the stale number is, is where the reset has to be. Editing a
            contact is the underlying write, so that is the gate. */}
        <RequirePermission permission="edit_contacts">
          <button
            onClick={() => setResetOpen(true)}
            className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4 text-slate-400" /> Start a new round
          </button>
        </RequirePermission>
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

      <ResetRoundModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        individuals={scopedIndividuals}
        scopeLabel={unscoped ? '' : describeScope(scope)}
      />
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
