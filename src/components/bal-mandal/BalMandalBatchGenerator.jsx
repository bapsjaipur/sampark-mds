// src/components/bal-mandal/BalMandalBatchGenerator.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Batch generation for Bal Mandal contacts with SK assignment.
//
// PHASE 31 — THIS CARD HAD NEVER RENDERED FOR ANYBODY.
//
// The gate was `['nirdeshak','sanchalak','admin'].includes(volunteer?.roleKey)`,
// and no save path in this app writes `roleKey` to a volunteer document — roles
// live in `roleRefs` and are identified by their permissions (lib/roleView.js).
// So `canGenerate` was always false and the component returned null every time.
// The same phantom field narrowed the area list and picked the SK, so even had
// the card rendered it would have produced unassigned batches.
//
// Three things changed:
//
//   1. The gate is now `generate_batches` + Bal Mandal programme access. Phase 21
//      split ASSIGN_BATCHES ("hand out an existing batch") from GENERATE_BATCHES
//      ("cut new ones"), and cutting is the Nirdeshak/Admin end of that split —
//      the Sanchalak template deliberately holds assign-only.
//   2. Area and mandal come from `scope`, the same source every other screen
//      uses. writableAreas/writableMandals answer null when that axis does not
//      bind the user, so an unrestricted admin is not accidentally narrowed.
//   3. Batches are cut PER MANDAL and written in the schema batchService uses
//      (individualIds / contactCount / assignedVolunteerId / batchNumber). The
//      old code wrote `contactIds` + `assignedTo` and stamped every batch
//      `mandal: 'Bal Mandal'` — so a Sishu Mandal batch was mis-tagged, and
//      filterBatchesByScope would have hidden it from the very person who cut it.
//
// Mobile is optional; contacts without mobile are included in batches.
// Duplicates are allowed (siblings share father's number).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/usePermissions';
import { useVolunteers } from '../../hooks/useVolunteers';
import { useToast } from '../../contexts/ToastContext';
import { balMandalSKCandidates, rankSKsByLoad } from '../../services/skAssignmentService';
import { nextBatchNumber } from '../../services/batchService';
import { canAccessBalMandal } from '../../lib/roleView';
import { matchesScope, writableAreas, writableMandals } from '../../lib/scope';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Label, Select } from '../ui/Input';
import Modal from '../ui/Modal';
import { Users, AlertCircle } from 'lucide-react';

const WRITE_BATCH_LIMIT = 450;

// The two mandals this programme covers. Anything outside them is a different
// programme's roster and is never batched from here.
const PROGRAM_MANDALS = ['Bal Mandal', 'Sishu Mandal'];

export default function BalMandalBatchGenerator({ areas = [] }) {
  const { volunteer, permissions, hasPermission, scope } = useAuth();
  const { volunteers } = useVolunteers();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState('');
  const [batchSize, setBatchSize] = useState('20');
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);

  const canGenerate = hasPermission('generate_batches')
    && canAccessBalMandal(permissions, volunteer);

  // null from writableAreas means "the area axis does not restrict this person"
  // (an admin, or a mandal head who works every area). An array means those
  // areas and no others; an empty array means none at all.
  const allowedAreas = useMemo(() => writableAreas(scope), [scope]);
  const availableAreas = useMemo(
    () => (allowedAreas ? areas.filter((a) => allowedAreas.includes(a.name)) : areas),
    [areas, allowedAreas],
  );

  const allowedMandals = useMemo(() => writableMandals(scope), [scope]);
  const targetMandals = useMemo(
    () => (allowedMandals ? PROGRAM_MANDALS.filter((m) => allowedMandals.includes(m)) : PROGRAM_MANDALS),
    [allowedMandals],
  );

  async function loadPreview() {
    if (!selectedArea || !batchSize) {
      showToast({ type: 'error', message: 'Select area and batch size' });
      return;
    }
    if (targetMandals.length === 0) {
      showToast({ type: 'error', message: 'Neither Bal Mandal nor Sishu Mandal is assigned to you.' });
      return;
    }

    const size = Number(batchSize);
    if (size < 1 || size > 100) {
      showToast({ type: 'error', message: 'Batch size must be between 1 and 100' });
      return;
    }

    const individualsRef = collection(db, 'individuals');
    const q = query(
      individualsRef,
      where('area', '==', selectedArea),
      where('mandal', 'in', targetMandals),
    );

    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      // Almost always permission-denied: Firestore refuses a query it cannot
      // prove is entirely readable. Saying so beats an unhandled rejection and
      // a Preview button that appears to do nothing.
      console.error('Batch preview query failed:', err);
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'You do not have permission to read these contacts.'
          : 'Could not load contacts for this area.',
      });
      return;
    }

    // The query is already narrowed to this area and the mandals the user may
    // write to, but an INTERSECT scope needs both axes checked together — the
    // query cannot express AND across two assignment lists.
    const contacts = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => matchesScope(scope, { area: c.area, mandal: c.mandal }));

    if (contacts.length === 0) {
      showToast({ type: 'error', message: 'No contacts found in this area' });
      return;
    }

    // SK candidates and their current load, both computed from data already in
    // hand: the roster comes from the shared volunteers listener and the load is
    // counted off the contacts just fetched. Zero extra reads.
    const candidates = balMandalSKCandidates(volunteers, selectedArea);
    const ranked = rankSKsByLoad(candidates, contacts);
    const load = ranked.map((sk) => ({ ...sk }));

    // One group per mandal, so a Sishu Mandal batch is tagged Sishu Mandal.
    const planned = [];
    for (const mandal of targetMandals) {
      const rows = contacts.filter((c) => c.mandal === mandal);
      if (rows.length === 0) continue;

      // Unassigned children first, so the people who still need an SK land in
      // the earliest batches and get one on this run.
      rows.sort((a, b) => {
        if (!a.samparkKaryakartaName && b.samparkKaryakartaName) return -1;
        if (a.samparkKaryakartaName && !b.samparkKaryakartaName) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });

      for (let i = 0; i < rows.length; i += size) {
        const rowsInBatch = rows.slice(i, i + size);
        // Round-robin by running total rather than by index: after a batch is
        // handed out its holder's count goes up, so the next batch goes to
        // whoever is genuinely lightest.
        let sk = null;
        if (load.length) {
          sk = load.reduce((best, c) => (c.contactCount < best.contactCount ? c : best), load[0]);
          sk.contactCount += rowsInBatch.filter((c) => !c.samparkKaryakartaName).length;
        }
        planned.push({ mandal, rows: rowsInBatch, sk: sk ? { id: sk.id, name: sk.name, mobile: sk.mobile } : null });
      }
    }

    setPreview({
      area: selectedArea,
      size,
      totalContacts: contacts.length,
      batchCount: planned.length,
      planned,
      skCount: ranked.length,
      unassignedSKCount: contacts.filter((c) => !c.samparkKaryakartaName).length,
      byMandal: targetMandals
        .map((m) => ({ mandal: m, count: contacts.filter((c) => c.mandal === m).length }))
        .filter((r) => r.count > 0),
    });
    setOpen(true);
  }

  async function executeBatchGeneration() {
    if (!preview) return;

    setGenerating(true);

    try {
      let numbering = await nextBatchNumber();
      let currentBatch = writeBatch(db);
      let opsInBatch = 0;
      const commits = [];

      const flushIfFull = () => {
        if (opsInBatch < WRITE_BATCH_LIMIT) return;
        commits.push(currentBatch.commit());
        currentBatch = writeBatch(db);
        opsInBatch = 0;
      };

      for (const plan of preview.planned) {
        const ids = plan.rows.map((c) => c.id);
        const batchRef = doc(collection(db, 'batches'));
        // Same shape batchService.generateBatches writes. A different shape here
        // is what made these batches invisible to the Batches page and to the
        // calling screen.
        currentBatch.set(batchRef, {
          name: `${plan.mandal} — ${preview.area} — Batch ${numbering}`,
          area: preview.area,
          mandal: plan.mandal,
          batchNumber: numbering,
          individualIds: ids,
          contactCount: ids.length,
          assignedVolunteerId: plan.sk?.id || null,
          assignedAt: plan.sk ? serverTimestamp() : null,
          createdBy: volunteer?.id || null,
          createdAt: serverTimestamp(),
          eventId: null,
          eventDate: null,
          program: 'Bal Mandal',
        });
        numbering++;
        opsInBatch++;
        flushIfFull();

        // Stamp the SK onto children who do not have one yet. Children already
        // assigned keep their SK — reshuffling an existing relationship is not
        // what "generate batches" means.
        if (plan.sk) {
          for (const contact of plan.rows) {
            if (contact.samparkKaryakartaName) continue;
            currentBatch.update(doc(db, 'individuals', contact.id), {
              samparkKaryakartaName: plan.sk.name,
              samparkKaryakartaNumber: plan.sk.mobile,
            });
            opsInBatch++;
            flushIfFull();
          }
        }
      }

      if (opsInBatch > 0) commits.push(currentBatch.commit());
      await Promise.all(commits);

      showToast({
        type: 'success',
        message: `Generated ${preview.batchCount} batches for ${preview.totalContacts} contacts`,
      });

      setOpen(false);
      setPreview(null);
      setSelectedArea('');
      setBatchSize('20');
    } catch (err) {
      console.error('Batch generation failed:', err);
      showToast({ type: 'error', message: 'Batch generation failed' });
    } finally {
      setGenerating(false);
    }
  }

  if (!canGenerate) return null;

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-teal-100 p-2.5 text-teal-700">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Generate Batches</h2>
            <p className="mt-1 text-xs text-slate-500">
              Create sampark batches for {targetMandals.join(' and ') || 'Bal Mandal'} contacts with auto SK assignment
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Area</Label>
                <Select value={selectedArea} onChange={(e) => setSelectedArea(e.target.value)}>
                  <option value="">Select area…</option>
                  {availableAreas.map(a => (
                    <option key={a.code} value={a.name}>{a.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Batch Size</Label>
                <Select value={batchSize} onChange={(e) => setBatchSize(e.target.value)}>
                  <option value="10">10 contacts</option>
                  <option value="20">20 contacts</option>
                  <option value="30">30 contacts</option>
                  <option value="50">50 contacts</option>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={loadPreview} variant="primary" className="w-full">
                  Preview
                </Button>
              </div>
            </div>
            {availableAreas.length === 0 && (
              <p className="mt-3 text-xs text-amber-600">
                No area is assigned to you yet, so there is nothing to batch. Ask an admin to set your assigned areas.
              </p>
            )}
            {targetMandals.length === 0 && (
              <p className="mt-3 text-xs text-amber-600">
                Neither Bal Mandal nor Sishu Mandal is in your assigned mandals.
              </p>
            )}
          </div>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Batch Generation Preview">
        {preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total Contacts</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{preview.totalContacts}</p>
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-teal-600">Batches</p>
                <p className="mt-1 text-2xl font-semibold text-teal-700">{preview.batchCount}</p>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-orange-600">Unassigned SK</p>
                <p className="mt-1 text-2xl font-semibold text-orange-700">{preview.unassignedSKCount}</p>
              </div>
            </div>

            {preview.byMandal.length > 1 && (
              <p className="text-xs text-slate-500">
                Cut separately per mandal:{' '}
                {preview.byMandal.map((r) => `${r.mandal} (${r.count})`).join(' · ')}
              </p>
            )}

            {preview.skCount === 0 ? (
              <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">
                  No active Bal Mandal volunteer is assigned to {preview.area}, so these batches will be
                  created unassigned. Assign them from the Batches tab afterwards.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200">
                <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Who gets what
                </p>
                <ul className="max-h-48 overflow-auto divide-y divide-slate-100">
                  {preview.planned.map((plan, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span className="text-slate-600">
                        {plan.mandal} · Batch {i + 1} · {plan.rows.length} contacts
                      </span>
                      <span className={plan.sk ? 'font-medium text-slate-700' : 'text-slate-400'}>
                        {plan.sk?.name || 'Unassigned'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.unassignedSKCount > 0 && preview.skCount > 0 && (
              <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">
                  {preview.unassignedSKCount} contacts will be assigned SK during batch creation using round-robin.
                  Children who already have an SK keep theirs.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={generating}>
                Cancel
              </Button>
              <Button variant="primary" onClick={executeBatchGeneration} disabled={generating}>
                {generating ? 'Generating...' : `Generate ${preview.batchCount} Batches`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
