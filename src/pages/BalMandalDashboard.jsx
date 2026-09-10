// src/pages/BalMandalDashboard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Bal Mandal program dashboard with 10 key metrics.
//
// Accessible to Nirdeshak, Sanchalak, Nirikshak, SK (area-scoped), and Admin.
// Shows real-time statistics for children's program management: standard
// breakdown, SK workload, promotion preview, attendance trends, and notes activity.
//
// PHASE 32 — WHY EVERY METRIC READ ZERO.
//
// Two independent faults, one of which hid the other:
//
//   1. Both queries lived in ONE try/catch and `setContacts` came AFTER the
//      events query. The events query always failed, so the contacts — which
//      had loaded perfectly — were thrown away with it. That is why the page
//      showed 0 rather than "contacts fine, sabhas missing".
//   2. Both queries were hard-coded to `mandal in ['Bal Mandal','Sishu Mandal']`
//      with no area narrowing. Rules are not filters: Firestore refuses a list
//      query outright if any document it returns fails the rule, and
//      canReadEvent() checks `data.mandal in c.mandals` per document. A
//      volunteer assigned only Bal Mandal was therefore denied the whole events
//      query on account of the Sishu Mandal rows. Same story on the area axis
//      for an area-scoped Sanchalak.
//
// The fix is to ask only for what this volunteer is allowed to be given: the
// program mandals that are actually in their scope, one area at a time when the
// area axis binds them. That also costs FEWER reads than the old city-wide
// query, because a scoped volunteer no longer pulls documents that were only
// going to be filtered out on the client.
//
// The two loads are now independent, so a sabha problem can no longer blank out
// the contact metrics — it reports itself in a banner instead.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/usePermissions';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { matchesScope, writableAreas, writableMandals } from '../lib/scope';
import { canAccessBalMandal } from '../lib/roleView';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import VCFExportPanel from '../components/bal-mandal/VCFExportPanel';
import BalMandalBatchGenerator from '../components/bal-mandal/BalMandalBatchGenerator';
import { Users, GraduationCap, UserCheck, Calendar, TrendingUp, AlertCircle, Activity, MessageSquare, Award, Target } from 'lucide-react';
import { cn } from '../lib/cn';
import { STANDARD_OPTIONS } from '../lib/areaMandalCodes';

// The two mandals this programme covers. They stay separate everywhere in the
// data — see MANDAL_GROUPS in src/lib/scope.js for why one team covers both.
const PROGRAM_MANDALS = ['Bal Mandal', 'Sishu Mandal'];

function describeQueryError(err) {
  if (err?.code === 'permission-denied') {
    return 'Firestore refused this query. The deployed rules are behind the app — run: firebase deploy --only firestore:rules';
  }
  if (err?.code === 'failed-precondition') {
    return 'This query needs an index that has not been created yet — run: firebase deploy --only firestore:indexes';
  }
  return err?.message || 'Could not load.';
}

function MetricCard({ icon: Icon, label, value, sub, tone = 'slate', badge }) {
  const TONES = {
    slate: 'bg-slate-50 text-slate-600 ring-slate-100',
    teal: 'bg-teal-50 text-teal-600 ring-teal-100',
    orange: 'bg-orange-50 text-orange-600 ring-orange-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    sky: 'bg-sky-50 text-sky-600 ring-sky-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1', TONES[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        {badge && <Badge tone={tone}>{badge}</Badge>}
      </div>
      <p className="mt-3 text-2xl font-bold leading-none tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

export default function BalMandalDashboard() {
  const { volunteer, permissions, scope } = useAuth();
  const { areas } = useAreasAndMandals();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedArea, setSelectedArea] = useState('all');
  const [contactError, setContactError] = useState('');
  const [eventError, setEventError] = useState('');

  const canAccess = canAccessBalMandal(permissions, volunteer);

  // PHASE 31 — was a literal `scope.kind === 'mandal'` test, which fails open
  // for UNION (the kind a volunteer holding both an area and a mandal role
  // resolves to) and closed for INTERSECT. writableAreas() answers the actual
  // question — does the area axis bind this person — in one place.
  const allowedAreas = useMemo(() => writableAreas(scope), [scope]);
  const availableAreas = useMemo(
    () => (allowedAreas ? areas.filter((a) => allowedAreas.includes(a.name)) : areas),
    [areas, allowedAreas],
  );

  // Only the programme mandals this volunteer may actually read. Asking for one
  // they are not assigned is what got the whole query refused.
  const allowedMandals = useMemo(() => writableMandals(scope), [scope]);
  const targetMandals = useMemo(
    () => (allowedMandals ? PROGRAM_MANDALS.filter((m) => allowedMandals.includes(m)) : PROGRAM_MANDALS),
    [allowedMandals],
  );

  // One entry per query to run. `null` means "no area filter" — correct only
  // when the area axis does not bind this volunteer, i.e. an admin or a mandal
  // head who works the whole city.
  const areaFilters = useMemo(() => {
    if (selectedArea !== 'all') return [selectedArea];
    return allowedAreas ? allowedAreas : [null];
  }, [selectedArea, allowedAreas]);

  const scopeKey = `${targetMandals.join('|')}::${areaFilters.join('|')}`;

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    loadData(() => cancelled);
    return () => { cancelled = true; };
    // scopeKey collapses scope + area selection into one primitive, so this does
    // not re-fire on every render just because useAuth handed back a new object.
  }, [canAccess, scopeKey]);

  async function loadData(isCancelled) {
    setLoading(true);
    setContactError('');
    setEventError('');

    if (targetMandals.length === 0 || areaFilters.length === 0) {
      setContacts([]);
      setEvents([]);
      setLoading(false);
      return;
    }

    // Both loads run independently and are awaited together: a failure in one
    // no longer discards the other's results.
    const [contactList, eventList] = await Promise.all([
      loadContacts().catch((err) => {
        console.error('Failed to load Bal Mandal contacts:', err);
        setContactError(describeQueryError(err));
        return null;
      }),
      loadEvents().catch((err) => {
        console.error('Failed to load Bal Mandal sabhas:', err);
        setEventError(describeQueryError(err));
        return null;
      }),
    ]);

    if (isCancelled()) return;
    setContacts(contactList || []);
    setEvents(eventList || []);
    setLoading(false);
  }

  async function loadContacts() {
    const ref = collection(db, 'individuals');
    const snaps = await Promise.all(areaFilters.map((area) => getDocs(
      area
        ? query(ref, where('area', '==', area), where('mandal', 'in', targetMandals))
        : query(ref, where('mandal', 'in', targetMandals)),
    )));

    // The queries are already narrowed to readable ground, but an INTERSECT
    // scope needs both axes checked together and no query can express AND
    // across two assignment lists.
    return snaps.flatMap((snap) => snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => matchesScope(scope, { area: c.area, mandal: c.mandal })));
  }

  async function loadEvents() {
    const ref = collection(db, 'events');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateStr = ninetyDaysAgo.toISOString().slice(0, 10);

    const snaps = await Promise.all(areaFilters.map((area) => getDocs(
      area
        ? query(ref, where('area', '==', area), where('mandal', 'in', targetMandals), where('date', '>=', dateStr))
        : query(ref, where('mandal', 'in', targetMandals), where('date', '>=', dateStr)),
    )));

    return snaps.flatMap((snap) => snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => matchesScope(scope, { area: e.area, mandal: e.mandal })));
  }

  const metrics = useMemo(() => {
    const totalContacts = contacts.length;
    const balMandal = contacts.filter(c => c.mandal === 'Bal Mandal').length;
    const sishuMandal = contacts.filter(c => c.mandal === 'Sishu Mandal').length;

    // Standard breakdown
    const standardBreakdown = {};
    STANDARD_OPTIONS.forEach(std => {
      standardBreakdown[std] = contacts.filter(c => c.standard === std).length;
    });
    const unassignedStandard = contacts.filter(c => !c.standard).length;

    // SK assignment
    const assignedSK = contacts.filter(c => c.samparkKaryakartaName).length;
    const unassignedSK = totalContacts - assignedSK;

    // Promotion preview (8th standard)
    const promotionReady = contacts.filter(c => c.standard === '8th').length;

    // Mobile coverage
    const withMobile = contacts.filter(c => c.mobile).length;
    const withoutMobile = totalContacts - withMobile;

    // Notes activity
    const withNotes = contacts.filter(c => c.notes && c.notes.trim()).length;

    // Recent events
    const recentEvents = events.length;
    const upcomingEvents = events.filter(e => e.date > new Date().toISOString().slice(0, 10)).length;

    // Attendance (from recent events)
    const totalAttendance = events.reduce((sum, e) => sum + (e.presentCount || 0), 0);
    const avgAttendance = recentEvents > 0 ? Math.round(totalAttendance / recentEvents) : 0;

    return {
      totalContacts,
      balMandal,
      sishuMandal,
      standardBreakdown,
      unassignedStandard,
      assignedSK,
      unassignedSK,
      skCoverage: totalContacts > 0 ? Math.round((assignedSK / totalContacts) * 100) : 0,
      promotionReady,
      withMobile,
      withoutMobile,
      mobileCoverage: totalContacts > 0 ? Math.round((withMobile / totalContacts) * 100) : 0,
      withNotes,
      notesCoverage: totalContacts > 0 ? Math.round((withNotes / totalContacts) * 100) : 0,
      recentEvents,
      upcomingEvents,
      avgAttendance,
    };
  }, [contacts, events]);

  if (!canAccess) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">Access restricted</p>
          <p className="mt-1 text-xs text-slate-400">Only Bal Mandal volunteers can access this dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bal Mandal Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Children's program management and metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-48">
            <Select value={selectedArea} onChange={(e) => setSelectedArea(e.target.value)}>
              <option value="all">All Areas</option>
              {availableAreas.map(a => (
                <option key={a.code} value={a.name}>{a.name}</option>
              ))}
            </Select>
          </div>
          <VCFExportPanel contacts={contacts} label="bal-mandal-contacts" />
        </div>
      </div>

      {(contactError || eventError || targetMandals.length === 0 || areaFilters.length === 0) && (
        <div className="space-y-2">
          {targetMandals.length === 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                Neither Bal Mandal nor Sishu Mandal is in your assigned mandals, so there is nothing to
                count here. Ask an admin to add one on Admin → Volunteers.
              </p>
            </div>
          )}
          {areaFilters.length === 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                No area is assigned to you yet, so no contacts can be listed. Ask an admin to set your
                assigned areas.
              </p>
            </div>
          )}
          {contactError && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-red-800">Contacts could not be loaded</p>
                <p className="mt-0.5 break-words text-xs text-red-700">{contactError}</p>
              </div>
              <Button variant="ghost" onClick={() => loadData(() => false)}>Retry</Button>
            </div>
          )}
          {eventError && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-amber-800">
                  Sabha metrics unavailable — contact metrics below are still accurate
                </p>
                <p className="mt-0.5 break-words text-xs text-amber-700">{eventError}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-500" />
        </div>
      ) : (
        <>
          {/* Primary Metrics */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <MetricCard
              icon={Users}
              label="Total Contacts"
              value={metrics.totalContacts}
              sub={`${metrics.balMandal} Bal, ${metrics.sishuMandal} Sishu`}
              tone="teal"
            />
            <MetricCard
              icon={GraduationCap}
              label="Unassigned Standard"
              value={metrics.unassignedStandard}
              sub={`${metrics.totalContacts - metrics.unassignedStandard} assigned`}
              tone="amber"
              badge={metrics.totalContacts > 0 ? `${Math.round((metrics.unassignedStandard / metrics.totalContacts) * 100)}%` : '0%'}
            />
            <MetricCard
              icon={UserCheck}
              label="SK Coverage"
              value={`${metrics.skCoverage}%`}
              sub={`${metrics.assignedSK} assigned, ${metrics.unassignedSK} pending`}
              tone="emerald"
            />
            <MetricCard
              icon={TrendingUp}
              label="Promotion Ready"
              value={metrics.promotionReady}
              sub="8th standard → Yuvak transfer"
              tone="sky"
            />
            <MetricCard
              icon={Activity}
              label="Avg Attendance"
              value={metrics.avgAttendance}
              sub={`${metrics.recentEvents} events (90 days)`}
              tone="orange"
            />
          </div>

          {/* Secondary Metrics */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <MetricCard
              icon={Target}
              label="Mobile Coverage"
              value={`${metrics.mobileCoverage}%`}
              sub={`${metrics.withoutMobile} without mobile`}
              tone="slate"
            />
            <MetricCard
              icon={MessageSquare}
              label="Notes Activity"
              value={`${metrics.notesCoverage}%`}
              sub={`${metrics.withNotes} contacts have notes`}
              tone="slate"
            />
            <MetricCard
              icon={Calendar}
              label="Upcoming Events"
              value={metrics.upcomingEvents}
              sub={`${metrics.recentEvents} total (90 days)`}
              tone="slate"
            />
            <div className="col-span-2">
              <Card className="h-full p-4">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-teal-600" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Standard Breakdown</h3>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {STANDARD_OPTIONS.slice(0, 10).map(std => (
                    <div key={std} className="text-center">
                      <p className="text-lg font-bold text-slate-900">{metrics.standardBreakdown[std] || 0}</p>
                      <p className="text-[10px] font-medium text-slate-400">{std}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* Batch Generator */}
          <BalMandalBatchGenerator areas={availableAreas} />
        </>
      )}
    </div>
  );
}
