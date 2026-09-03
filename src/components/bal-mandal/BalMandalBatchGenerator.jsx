// src/components/bal-mandal/BalMandalBatchGenerator.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Batch generation for Bal Mandal contacts with SK assignment.
//
// Generates sampark batches for Bal Mandal contacts, similar to existing batch
// generation but with round-robin SK auto-assignment. Accessible to Nirdeshak,
// Sanchalak (area-scoped), and Admin.
//
// Mobile is optional; contacts without mobile are included in batches and shown
// with "(No mobile)" indicator. Duplicates are allowed (siblings share father's
// number).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { findLeastLoadedSK } from '../../services/skAssignmentService';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Label, Select } from '../ui/Input';
import Modal from '../ui/Modal';
import { Users, AlertCircle } from 'lucide-react';

const WRITE_BATCH_LIMIT = 450;

export default function BalMandalBatchGenerator({ areas = [] }) {
  const { volunteer, hasPermission } = useAuth();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState('');
  const [batchSize, setBatchSize] = useState('20');
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);

  const canGenerate = hasPermission('manage_events') && ['nirdeshak', 'sanchalak', 'admin'].includes(volunteer?.roleKey);

  // Filter areas based on volunteer scope
  const availableAreas = volunteer?.roleKey === 'sanchalak' && volunteer?.areas?.length
    ? areas.filter(a => volunteer.areas.includes(a.name))
    : areas;

  async function loadPreview() {
    if (!selectedArea || !batchSize) {
      showToast({ type: 'error', message: 'Select area and batch size' });
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
      where('mandal', 'in', ['Bal Mandal', 'Sishu Mandal'])
    );

    const snap = await getDocs(q);
    const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (contacts.length === 0) {
      showToast({ type: 'error', message: 'No contacts found in this area' });
      return;
    }

    // Sort by SK assignment status (unassigned first), then name
    contacts.sort((a, b) => {
      if (!a.samparkKaryakartaName && b.samparkKaryakartaName) return -1;
      if (a.samparkKaryakartaName && !b.samparkKaryakartaName) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    // Split into batches
    const batches = [];
    for (let i = 0; i < contacts.length; i += size) {
      batches.push(contacts.slice(i, i + size));
    }

    setPreview({
      area: selectedArea,
      size,
      totalContacts: contacts.length,
      batchCount: batches.length,
      batches,
      unassignedSKCount: contacts.filter(c => !c.samparkKaryakartaName).length,
    });
    setOpen(true);
  }

  async function executeBatchGeneration() {
    if (!preview) return;

    setGenerating(true);

    try {
      const firestoreBatches = [];
      let currentBatch = writeBatch(db);
      let opsInBatch = 0;

      for (let i = 0; i < preview.batches.length; i++) {
        const batch = preview.batches[i];

        // Find SK for this batch (round-robin by contact count)
        const sk = await findLeastLoadedSK(preview.area);
        const skName = sk?.name || '';
        const skMobile = sk?.mobile || '';

        // Create batch document
        const batchRef = doc(collection(db, 'batches'));
        currentBatch.set(batchRef, {
          area: preview.area,
          mandal: 'Bal Mandal',
          assignedTo: skName,
          assignedToMobile: skMobile,
          contactIds: batch.map(c => c.id),
          createdAt: serverTimestamp(),
          createdBy: volunteer?.id || '',
          status: 'pending',
          program: 'Bal Mandal',
        });

        opsInBatch++;

        // Update contacts with SK assignment (if not already assigned)
        for (const contact of batch) {
          if (!contact.samparkKaryakartaName && sk) {
            const contactRef = doc(db, 'individuals', contact.id);
            currentBatch.update(contactRef, {
              samparkKaryakartaName: skName,
              samparkKaryakartaNumber: skMobile,
            });
            opsInBatch++;
          }

          if (opsInBatch >= WRITE_BATCH_LIMIT) {
            firestoreBatches.push(currentBatch);
            currentBatch = writeBatch(db);
            opsInBatch = 0;
          }
        }
      }

      if (opsInBatch > 0) firestoreBatches.push(currentBatch);

      await Promise.all(firestoreBatches.map(b => b.commit()));

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
              Create sampark batches for Bal Mandal contacts with auto SK assignment
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

            {preview.unassignedSKCount > 0 && (
              <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">
                  {preview.unassignedSKCount} contacts will be assigned SK during batch creation using round-robin.
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
