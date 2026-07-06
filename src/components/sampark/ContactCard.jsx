// src/components/sampark/ContactCard.jsx — Attio redesign.
import { useState } from 'react';
import { Phone } from 'lucide-react';
import { useAuth } from '../../hooks/usePermissions';
import { PERMISSIONS, hasPermission } from '../../constants/permissions';
import { updateContactField, incrementCallCount, STATUS_OPTIONS } from '../../services/contactService';
import { Select, Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export default function ContactCard({ individual, onUpdated }) {
  const { volunteer, permissions } = useAuth();
  const canEdit = hasPermission(permissions, PERMISSIONS.EDIT_CONTACTS);
  const [saving, setSaving] = useState(null);
  const [local, setLocal] = useState(individual);

  async function handleStatusChange(e) {
    const value = e.target.value;
    setSaving('status');
    setLocal((prev) => ({ ...prev, status: value }));
    try {
      await updateContactField({ individualId: individual.id, field: 'status', value, volunteerId: volunteer?.id, action: 'status_changed', details: `Status set to ${value}` });
      onUpdated?.();
    } finally {
      setSaving(null);
    }
  }

  async function handleReferenceBlur(e) {
    const value = e.target.value.trim();
    if (value === (individual.reference || '')) return;
    setSaving('reference');
    try {
      await updateContactField({ individualId: individual.id, field: 'reference', value, volunteerId: volunteer?.id, action: 'reference_updated', details: value });
      onUpdated?.();
    } finally {
      setSaving(null);
    }
  }

  async function handleCall() {
    setSaving('call');
    try {
      const nextCount = await incrementCallCount({ individualId: individual.id, currentCount: local.callCount, volunteerId: volunteer?.id });
      setLocal((prev) => ({ ...prev, callCount: nextCount }));
      onUpdated?.();
    } finally {
      setSaving(null);
      window.location.href = `tel:${individual.mobile}`;
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{individual.name}</p>
          <p className="text-xs text-slate-400">{individual.mobile}</p>
        </div>
        <Button variant="accent" size="sm" onClick={handleCall} disabled={saving === 'call'}><Phone className="h-3 w-3" /> Call now</Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Status</label>
          <Select value={local.status || ''} onChange={handleStatusChange} disabled={!canEdit || saving === 'status'}>
            <option value="">Not contacted yet</option>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Call count</label>
          <p className="py-1.5 text-sm text-slate-700">{local.callCount || 0}</p>
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-slate-500">Reference</label>
        <Input defaultValue={individual.reference || ''} onBlur={handleReferenceBlur} disabled={!canEdit} placeholder="e.g. referred by ..." />
      </div>

      {saving && <p className="mt-2 text-xs text-slate-400">Saving\u2026</p>}
    </Card>
  );
}
