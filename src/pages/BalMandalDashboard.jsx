// src/pages/BalMandalDashboard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Bal Mandal program dashboard with 10 key metrics.
//
// Accessible to Nirdeshak, Sanchalak, Nirikshak, SK (area-scoped), and Admin.
// Shows real-time statistics for children's program management: standard
// breakdown, SK workload, promotion preview, attendance trends, and notes activity.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/usePermissions';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import VCFExportPanel from '../components/bal-mandal/VCFExportPanel';
import BalMandalBatchGenerator from '../components/bal-mandal/BalMandalBatchGenerator';
import { Users, GraduationCap, UserCheck, Calendar, TrendingUp, AlertCircle, Activity, MessageSquare, Award, Target } from 'lucide-react';
import { cn } from '../lib/cn';
import { STANDARD_OPTIONS } from '../lib/areaMandalCodes';

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
  const { volunteer, hasPermission } = useAuth();
  const { areas } = useAreasAndMandals();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedArea, setSelectedArea] = useState('all');

  const canAccess = hasPermission('manage_events') &&
    ['nirdeshak', 'sanchalak', 'nirikshak', 'sk', 'admin'].includes(volunteer?.roleKey);

  const availableAreas = useMemo(() => {
    if (volunteer?.roleKey === 'admin' || volunteer?.roleKey === 'nirdeshak') {
      return areas;
    }
    if (volunteer?.assignedAreas?.length) {
      return areas.filter(a => volunteer.assignedAreas.includes(a.name));
    }
    return [];
  }, [areas, volunteer]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    loadData();
  }, [canAccess, selectedArea]);

  async function loadData() {
    setLoading(true);

    try {
      // Load Bal Mandal contacts
      const individualsRef = collection(db, 'individuals');
      let contactQuery = query(
        individualsRef,
        where('mandal', 'in', ['Bal Mandal', 'Sishu Mandal'])
      );

      if (selectedArea !== 'all') {
        contactQuery = query(
          individualsRef,
          where('mandal', 'in', ['Bal Mandal', 'Sishu Mandal']),
          where('area', '==', selectedArea)
        );
      }

      const contactSnap = await getDocs(contactQuery);
      const contactList = contactSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Load recent Bal Mandal events (last 90 days)
      const eventsRef = collection(db, 'events');
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const dateStr = ninetyDaysAgo.toISOString().slice(0, 10);

      const eventQuery = query(
        eventsRef,
        where('mandal', 'in', ['Bal Mandal', 'Sishu Mandal']),
        where('date', '>=', dateStr)
      );

      const eventSnap = await getDocs(eventQuery);
      const eventList = eventSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      setContacts(contactList);
      setEvents(eventList);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
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
