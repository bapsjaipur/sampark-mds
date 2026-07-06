// src/components/sampark/BatchAssignment.jsx — Attio redesign.
import { useState, useEffect } from 'react';
import { getIndividualsByArea, createBatch } from '../../services/batchService';
import { useAuth } from '../../hooks/usePermissions';
import { PERMISSIONS, hasPermission } from '../../constants/permissions';
import { Select, Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export default function BatchAssignment({ areas, volunteers }) {
  const { volunteer, permissions } = useAuth();
  const canAssign = hasPermission(permissions, PERMISSIONS.ASSIGN_BATCHES);
  const [area, setArea] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [batchName, setBatchName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!area) { setCandidates([]); return; }
    setLoading(true);
    getIndividualsByArea(area).then(setCandidates).finally(() => setLoading(false));
  }, [area]);

  function toggle(id) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function handleCreate() {
    if (!batchName || !assignee || selected.size === 0) return;
    setStatus('saving');
    try {
      await createBatch({ name: batchName, area, individualIds: [...selected], assignedVolunteerId: assignee, createdBy: volunteer?.id });
      setStatus('done');
      setSelected(new Set());
      setBatchName('');
    } catch (e) {
      setStatus('error');
    }
  }

  if (!canAssign) return <p className="text-sm text-slate-500">You don't have permission to assign batches.</p>;

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Create a batch</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Area</label>
          <Select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Select area</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Batch name</label>
          <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="e.g. Malviya Nagar - July" />
        </div>
      </div>

      {loading && <p className="mt-3 text-xs text-slate-400">Loading contacts\u2026</p>}

      {!loading && candidates.length > 0 && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 rounded accent-orange-600" />
              <span>{c.name}</span>
              <span className="text-xs text-slate-400">{c.mobile}</span>
            </label>
          ))}
        </div>
      )}

      {!loading && area && candidates.length === 0 && <p className="mt-3 text-xs text-slate-400">No contacts found in this area.</p>}

      <div className="mt-3 flex items-center gap-3">
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-auto">
          <option value="">Assign to\u2026</option>
          {volunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <Button variant="primary" onClick={handleCreate} disabled={status === 'saving'}>
          {status === 'saving' ? 'Creating\u2026' : `Create batch (${selected.size})`}
        </Button>
      </div>

      {status === 'done' && <p className="mt-2 text-xs text-emerald-600">Batch created.</p>}
      {status === 'error' && <p className="mt-2 text-xs text-rose-600">Something went wrong.</p>}
    </Card>
  );
}
