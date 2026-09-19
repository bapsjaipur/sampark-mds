// src/pages/StandardPromotionPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Yearly standard promotion workflow for Bal Mandal contacts.
//
// Accessible to Nirdeshak and Admin. Run once per year (approximately in March)
// to promote all children to the next standard. 8th standard students are
// flagged for transfer to Yuvak Mandal with preview and confirmation.
//
// Process:
// 1. Preview shows all contacts grouped by current standard
// 2. Shows which students will transfer to Yuvak (8th → 9th)
// 3. Bulk update: increment standard, transfer 8th to Yuvak
// 4. Generate PDF report of transferred students
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/usePermissions';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { canRunStandardPromotion } from '../lib/roleView';
import { matchesScope, writableAreas, writableMandals } from '../lib/scope';
import { useToast } from '../contexts/ToastContext';
import { confirmDialog } from '../components/ui/ConfirmHost';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { promoteStandard } from '../constants/balMandalConfig';
import { STANDARD_OPTIONS } from '../lib/areaMandalCodes';
import { TrendingUp, AlertCircle, Users, ArrowRight, FileText, Download } from 'lucide-react';
import { cn } from '../lib/cn';

// The two mandals this programme covers. They stay separate in the data — see
// MANDAL_GROUPS in src/lib/scope.js for why one team covers both.
const PROGRAM_MANDALS = ['Bal Mandal', 'Sishu Mandal'];

const WRITE_BATCH_LIMIT = 450;

function StandardGroup({ standard, contacts, nextStandard, willTransfer }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg font-bold',
            willTransfer ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-700'
          )}>
            {standard}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{contacts.length} students</p>
            <p className="text-xs text-slate-500">
              {willTransfer ? 'Will transfer to Yuvak Mandal' : `Will promote to ${nextStandard}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {willTransfer && <Badge tone="sky">Transfer</Badge>}
          <ArrowRight className="h-4 w-4 text-slate-400" />
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded font-semibold text-xs',
            willTransfer ? 'bg-sky-500 text-white' : 'bg-slate-200 text-slate-600'
          )}>
            {nextStandard}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function StandardPromotionPage() {
  const { volunteer, permissions, scope } = useAuth();
  const { areas } = useAreasAndMandals();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [executing, setExecuting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // PHASE 32 — was `hasPermission('manage_users') && ['nirdeshak','admin']
  // .includes(volunteer?.roleKey)`. Volunteer documents carry no `roleKey`, so
  // this page was unreachable for everyone, admins included — it always rendered
  // "Only Nirdeshak and Admin can access this page". canRunStandardPromotion()
  // restates that same intent in permissions, which is what roles are actually
  // identified by; see src/lib/roleView.js for the reasoning.
  const canAccess = canRunStandardPromotion(permissions, volunteer);

  // Which mandals and areas this volunteer may actually rewrite. Same shape the
  // Bal Mandal dashboard uses — null from writableAreas/writableMandals means
  // "that axis does not bind this person" (an admin), an array means those only.
  const allowedMandals = useMemo(() => writableMandals(scope), [scope]);
  const targetMandals = useMemo(
    () => (allowedMandals ? PROGRAM_MANDALS.filter((m) => allowedMandals.includes(m)) : PROGRAM_MANDALS),
    [allowedMandals],
  );
  const allowedAreas = useMemo(() => writableAreas(scope), [scope]);
  const areaFilters = useMemo(() => (allowedAreas || [null]), [allowedAreas]);
  const scopeKey = `${targetMandals.join('|')}::${areaFilters.join('|')}`;

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    loadContacts();
  }, [canAccess, scopeKey]);

  async function loadContacts() {
    setLoading(true);

    if (targetMandals.length === 0 || areaFilters.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    try {
      const individualsRef = collection(db, 'individuals');
      // SCOPED, and it must stay that way: everything this query returns is
      // rewritten by executePromotion() below. Before Phase 32 the page was
      // unreachable (a dead `roleKey` gate), so nobody ever noticed that it
      // pulled every child in the city regardless of who was asking — the day
      // the gate was fixed, that became a scoped Nirdeshak promoting other
      // people's areas. One query per area, exactly as the Bal Mandal dashboard
      // does, which is also fewer reads than the city-wide version it replaces.
      const snaps = await Promise.all(areaFilters.map((area) => getDocs(
        area
          ? query(
            individualsRef,
            where('area', '==', area),
            where('mandal', 'in', targetMandals),
            where('standard', 'in', STANDARD_OPTIONS),
          )
          : query(
            individualsRef,
            where('mandal', 'in', targetMandals),
            where('standard', 'in', STANDARD_OPTIONS),
          ),
      )));

      const contactList = snaps.flatMap((snap) => snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => matchesScope(scope, { area: c.area, mandal: c.mandal })));

      setContacts(contactList);
    } catch (err) {
      console.error('Failed to load contacts:', err);
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Firestore refused this query — the deployed rules are behind the app.'
          : 'Failed to load contacts',
      });
    } finally {
      setLoading(false);
    }
  }

  const promotionPlan = useMemo(() => {
    const groups = {};
    const transfers = [];

    contacts.forEach(contact => {
      const current = contact.standard;
      if (!current) return;

      const result = promoteStandard(current);

      if (!groups[current]) {
        groups[current] = {
          standard: current,
          contacts: [],
          nextStandard: result.standard,
          willTransfer: result.transferToYuvak,
        };
      }

      groups[current].contacts.push(contact);

      if (result.transferToYuvak) {
        transfers.push({
          ...contact,
          newStandard: result.standard,
        });
      }
    });

    return {
      groups: Object.values(groups).sort((a, b) =>
        STANDARD_OPTIONS.indexOf(a.standard) - STANDARD_OPTIONS.indexOf(b.standard)
      ),
      transfers,
      totalStudents: contacts.length,
      transferCount: transfers.length,
    };
  }, [contacts]);

  async function executePromotion() {
    const ok = await confirmDialog({
      title: 'Run standard promotion?',
      message: `This will promote ${promotionPlan.totalStudents} students and transfer ${promotionPlan.transferCount} to Yuvak Mandal.`,
      confirmText: 'Promote',
      tone: 'danger',
    });
    if (!ok) return;

    setExecuting(true);

    try {
      const batches = [];
      let currentBatch = writeBatch(db);
      let opsInBatch = 0;

      for (const contact of contacts) {
        if (!contact.standard) continue;

        const result = promoteStandard(contact.standard);
        const contactRef = doc(db, 'individuals', contact.id);

        const updates = {
          standard: result.standard,
        };

        // Transfer to Yuvak Mandal if promoting from 8th
        if (result.transferToYuvak) {
          updates.mandal = 'Yuvak Mandal';
          updates.transferredFromBalMandal = true;
          updates.transferredAt = serverTimestamp();
          updates.balMandalHistory = contact.notes || '';
        }

        currentBatch.update(contactRef, updates);
        opsInBatch++;

        if (opsInBatch >= WRITE_BATCH_LIMIT) {
          batches.push(currentBatch);
          currentBatch = writeBatch(db);
          opsInBatch = 0;
        }
      }

      if (opsInBatch > 0) batches.push(currentBatch);

      await Promise.all(batches.map(b => b.commit()));

      showToast({
        type: 'success',
        message: `Promoted ${promotionPlan.totalStudents} students, ${promotionPlan.transferCount} transferred to Yuvak`,
      });

      setCompleted(true);
    } catch (err) {
      console.error('Promotion failed:', err);
      showToast({ type: 'error', message: 'Promotion failed' });
    } finally {
      setExecuting(false);
    }
  }

  function exportTransferReport() {
    if (promotionPlan.transfers.length === 0) return;

    const csv = [
      ['Name', 'Mobile', 'Area', 'Current Standard', 'New Standard', 'Transfer To'].join(','),
      ...promotionPlan.transfers.map(c => [
        c.name || '',
        c.mobile || '',
        c.area || '',
        '8th',
        '9th',
        'Yuvak Mandal',
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bal-to-yuvak-transfer-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!canAccess) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">Access restricted</p>
          <p className="mt-1 text-xs text-slate-400">
            Standard promotion needs Edit Contacts plus Manage Users or Import Contacts &amp; History —
            the Nirdeshak, Super Moderator and Admin level.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Standard Promotion</h1>
        <p className="mt-1 text-sm text-slate-500">
          Yearly promotion workflow • Run once per year (approximately in March)
        </p>
      </div>

      {loading ? (
        <div className="flex h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-500" />
        </div>
      ) : completed ? (
        <Card className="p-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <TrendingUp className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">Promotion Complete</h2>
          <p className="mt-2 text-sm text-slate-600">
            {promotionPlan.totalStudents} students promoted, {promotionPlan.transferCount} transferred to Yuvak Mandal
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Refresh Page
            </Button>
            {promotionPlan.transferCount > 0 && (
              <Button variant="primary" onClick={exportTransferReport}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download Transfer Report
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100">
                  <Users className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{promotionPlan.totalStudents}</p>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total Students</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                  <TrendingUp className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{promotionPlan.groups.length}</p>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Standard Groups</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100">
                  <ArrowRight className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{promotionPlan.transferCount}</p>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">To Yuvak Mandal</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Warning */}
          {promotionPlan.transferCount > 0 && (
            <div className="flex gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-sky-600" />
              <div className="text-sm text-sky-800">
                <p className="font-semibold">Transfer Preview</p>
                <p className="mt-1">
                  {promotionPlan.transferCount} students in 8th standard will be transferred to Yuvak Mandal.
                  Their Bal Mandal attendance history will be preserved in notes.
                </p>
              </div>
            </div>
          )}

          {/* Promotion Plan */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Promotion Plan</h2>
              {promotionPlan.transferCount > 0 && (
                <Button size="sm" variant="ghost" onClick={exportTransferReport}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Preview Transfer Report
                </Button>
              )}
            </div>
            {promotionPlan.groups.map(group => (
              <StandardGroup key={group.standard} {...group} />
            ))}
          </div>

          {/* Actions */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">
                <p className="font-semibold">Ready to execute promotion?</p>
                <p className="mt-1 text-xs">
                  This action cannot be undone. All students will be promoted to the next standard.
                </p>
              </div>
              <Button
                variant="primary"
                onClick={executePromotion}
                disabled={executing || promotionPlan.totalStudents === 0}
              >
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
                {executing ? 'Promoting...' : `Promote ${promotionPlan.totalStudents} Students`}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
