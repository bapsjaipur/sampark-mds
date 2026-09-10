// src/components/bal-mandal/StandardPromotionPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Yearly standard promotion for Bal Mandal children.
//
// Bulk operation typically run in March: promotes all children by one standard
// (UKG→LKG, 1st→2nd, etc.), transfers 8th→Yuvak, and generates a PDF report of
// transferred children for Yuvak Mandal coordinators.
//
// Accessible to: Nirdeshak, Admin. Sanchalak can view preview but not execute.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { promoteStandard } from '../../constants/balMandalConfig';
import { useAuth } from '../../hooks/usePermissions';
import { canRunStandardPromotion } from '../../lib/roleView';
import { matchesScope, writableAreas, writableMandals } from '../../lib/scope';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import Modal from '../ui/Modal';
import { TrendingUp, Download, AlertTriangle } from 'lucide-react';
import { WRITE_BATCH_LIMIT } from '../../lib/batchUtils';

// The two mandals this programme covers — see MANDAL_GROUPS in src/lib/scope.js.
const PROGRAM_MANDALS = ['Bal Mandal', 'Sishu Mandal'];

export default function StandardPromotionPanel() {
  const { volunteer, permissions, scope } = useAuth();
  const { showToast } = useToast();
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [executing, setExecuting] = useState(false);

  // PHASE 32 — was gated on `volunteer?.roleKey`, a field that does not exist,
  // so the execute button never enabled for anybody. Same rule as the full
  // Standard Promotion page — one helper, so the panel and the page can never
  // disagree about who may run this.
  const canExecute = canRunStandardPromotion(permissions, volunteer);

  // Which mandals and areas this volunteer may rewrite. Everything loadPreview()
  // returns is rewritten by executePromotion(), so the query has to be narrowed
  // to the caller's scope — an unscoped read here would let a scoped Nirdeshak
  // promote children in areas that are not theirs.
  const allowedMandals = useMemo(() => writableMandals(scope), [scope]);
  const targetMandals = useMemo(
    () => (allowedMandals ? PROGRAM_MANDALS.filter((m) => allowedMandals.includes(m)) : PROGRAM_MANDALS),
    [allowedMandals],
  );
  const allowedAreas = useMemo(() => writableAreas(scope), [scope]);
  const areaFilters = useMemo(() => (allowedAreas || [null]), [allowedAreas]);

  async function loadPreview() {
    if (targetMandals.length === 0 || areaFilters.length === 0) {
      showToast({ type: 'error', message: 'No Bal Mandal area is assigned to you.' });
      return;
    }

    const individualsRef = collection(db, 'individuals');
    let snaps;
    try {
      // `standard != ''` cannot be combined with a second `in` on another field,
      // so the standard filter moves to the client. It costs nothing extra: the
      // area+mandal query already returns only this volunteer's children.
      snaps = await Promise.all(areaFilters.map((area) => getDocs(
        area
          ? query(individualsRef, where('area', '==', area), where('mandal', 'in', targetMandals))
          : query(individualsRef, where('mandal', 'in', targetMandals)),
      )));
    } catch (err) {
      console.error('Promotion preview query failed:', err);
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'You do not have permission to read these contacts.'
          : 'Could not load contacts for promotion.',
      });
      return;
    }

    const children = snaps
      .flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      .filter((c) => c.standard && matchesScope(scope, { area: c.area, mandal: c.mandal }));

    if (children.length === 0) {
      showToast({ type: 'error', message: 'No children have a standard set yet, so there is nothing to promote.' });
      return;
    }

    const promotions = children.map(child => {
      const result = promoteStandard(child.standard);
      return {
        id: child.id,
        name: child.name,
        currentStandard: child.standard,
        nextStandard: result.standard,
        transferToYuvak: result.transferToYuvak,
        area: child.area,
        mobile: child.mobile,
        // executePromotion() prepends a history line to this; reading it back as
        // undefined would write the literal string "undefined" into the note.
        notes: child.notes || '',
      };
    });

    const toYuvak = promotions.filter(p => p.transferToYuvak);
    const regularPromo = promotions.filter(p => !p.transferToYuvak);

    setPreview({
      all: promotions,
      toYuvak,
      regularPromo,
      totalCount: promotions.length,
      transferCount: toYuvak.length,
    });
    setPreviewOpen(true);
  }

  async function executePromotion() {
    if (!preview || !canExecute) return;

    setExecuting(true);

    try {
      const batches = [];
      let currentBatch = writeBatch(db);
      let opsInBatch = 0;

      for (const promo of preview.all) {
        const ref = doc(db, 'individuals', promo.id);

        if (promo.transferToYuvak) {
          // Transfer to Yuvak: update mandal, clear standard, preserve history in notes
          currentBatch.update(ref, {
            mandal: 'Yuvak Mandal',
            standard: '',
            notes: `[Auto-promoted from 8th to Yuvak on ${new Date().toLocaleDateString()}]\n${promo.notes || ''}`,
          });
        } else {
          // Regular promotion: just update standard
          currentBatch.update(ref, {
            standard: promo.nextStandard,
          });
        }

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
        message: `Promoted ${preview.totalCount} children. ${preview.transferCount} transferred to Yuvak.`,
      });

      setPreviewOpen(false);
      setPreview(null);
    } catch (err) {
      console.error('Promotion failed:', err);
      showToast({
        type: 'error',
        message: 'Promotion failed. Check console and try again.',
      });
    } finally {
      setExecuting(false);
    }
  }

  function downloadTransferList() {
    if (!preview?.toYuvak.length) return;

    const csv = [
      'Name,Mobile,Area,Previous Standard',
      ...preview.toYuvak.map(p => `${p.name},${p.mobile || ''},${p.area || ''},${p.currentStandard}`)
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bal-to-yuvak-transfer-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-orange-100 p-2.5 text-orange-700">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Standard Promotion</h2>
            <p className="mt-1 text-xs text-slate-500">
              Bulk promote all children by one standard. Typically run in March. 8th standard children transfer to Yuvak Mandal.
            </p>
            <div className="mt-4">
              <Button onClick={loadPreview} variant="primary">
                Preview Promotion
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Standard Promotion Preview">
        {preview && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total Promotions</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{preview.totalCount}</p>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-orange-600">Transfer to Yuvak</p>
                <p className="mt-1 text-2xl font-semibold text-orange-700">{preview.transferCount}</p>
              </div>
            </div>

            {/* Transfer list */}
            {preview.transferCount > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">8th → Yuvak Transfer</h3>
                  <Button size="sm" variant="ghost" onClick={downloadTransferList}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
                  </Button>
                </div>
                <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                  {preview.toYuvak.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900">{p.name}</p>
                        <p className="truncate text-xs text-slate-500">{p.area || 'No area'} · {p.mobile || 'No mobile'}</p>
                      </div>
                      <Badge tone="orange">8th → Yuvak</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warning */}
            <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              <div className="text-xs text-amber-800">
                <p className="font-medium">This action updates {preview.totalCount} contacts.</p>
                <p className="mt-1">Transferred children will appear in Yuvak rosters. Their Bal Mandal attendance history is preserved in notes.</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="ghost" onClick={() => setPreviewOpen(false)} disabled={executing}>
                Cancel
              </Button>
              {canExecute ? (
                <Button variant="primary" onClick={executePromotion} disabled={executing}>
                  {executing ? 'Promoting...' : `Promote ${preview.totalCount} Children`}
                </Button>
              ) : (
                <Button variant="primary" disabled title="Only Nirdeshak and Admin can execute promotion">
                  Execute (No Permission)
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
