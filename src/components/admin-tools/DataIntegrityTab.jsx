// src/components/admin-tools/DataIntegrityTab.jsx — Attio redesign.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PartyPopper, MapPin } from 'lucide-react';
import { useAllContacts } from '../../hooks/useAllContacts';
import { useToast } from '../../contexts/ToastContext';
import { findDuplicatePhones, findMissingInfo, findMissingAreaInHousehold } from '../../services/integrityService';
import { backfillMemberAreas } from '../../services/bulkService';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

function DuplicateGroup({ phone, group, onDelete }) {
  return (
    <Card className="border-amber-200 bg-amber-50/40 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Phone {phone} — {group.length} records</p>
      <div className="space-y-2">
        {group.map((ind) => (
          <div key={ind.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
            <div>
              <p className="font-medium text-slate-900">{ind.name}</p>
              <p className="text-xs text-slate-400">{ind.mandal || 'No Mandal'} · {ind.status || 'Not contacted'} · {ind.householdId ? 'In a household' : 'Standalone'}</p>
            </div>
            <div className="flex gap-2">
              <Link to={ind.householdId ? `/households/${ind.householdId}` : '/contacts'}><Button variant="secondary" size="sm">View</Button></Link>
              <Button variant="danger" size="sm" onClick={() => onDelete(ind)}>Delete this one</Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function DataIntegrityTab() {
  const { contacts, deleteContact } = useAllContacts();
  const { showToast } = useToast();
  const [tab, setTab] = useState('duplicates');
  const [backfilling, setBackfilling] = useState(false);

  const duplicates = useMemo(() => findDuplicatePhones(contacts), [contacts]);
  const missing = useMemo(() => findMissingInfo(contacts), [contacts]);
  const missingArea = useMemo(() => findMissingAreaInHousehold(contacts), [contacts]);

  async function handleDeleteDuplicate(ind) {
    if (!window.confirm(`Delete "${ind.name}"? Review the other record first — this can't be undone.`)) return;
    await deleteContact(ind.id);
  }

  async function handleBackfillAreas() {
    if (!window.confirm(`Copy the household's Area onto ${missingArea.length} member(s) currently missing one? This only fills blanks — it never overwrites an area already set.`)) return;
    setBackfilling(true);
    try {
      const { updated, skippedNoHouseholdArea } = await backfillMemberAreas();
      const extra = skippedNoHouseholdArea > 0 ? ` ${skippedNoHouseholdArea} skipped (their household has no Area set).` : '';
      showToast({ type: 'success', message: `Fixed ${updated} member area(s).${extra}` });
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: "Couldn't backfill areas. Try again." });
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab('duplicates')} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'duplicates' ? 'bg-orange-50 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}>Duplicate phones ({duplicates.length})</button>
        <button onClick={() => setTab('missing')} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'missing' ? 'bg-orange-50 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}>Missing info ({missing.missingPhone.length + missing.missingMandal.length})</button>
        <button onClick={() => setTab('area')} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'area' ? 'bg-orange-50 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}>Missing area ({missingArea.length})</button>
      </div>

      {tab === 'duplicates' && (
        duplicates.length === 0 ? (
          <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 py-10 text-sm text-slate-400"><PartyPopper className="h-4 w-4" /> No duplicate phone numbers found.</p>
        ) : (
          <div className="space-y-3">{duplicates.map((d) => <DuplicateGroup key={d.phone} phone={d.phone} group={d.group} onDelete={handleDeleteDuplicate} />)}</div>
        )
      )}

      {tab === 'missing' && (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Missing or invalid phone number ({missing.missingPhone.length})</p>
            {missing.missingPhone.length === 0 ? <p className="text-sm text-slate-400">None — everyone has a valid 10-digit number.</p> : (
              <div className="space-y-1">
                {missing.missingPhone.slice(0, 50).map((ind) => (
                  <div key={ind.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <span>{ind.name}</span>
                    <Link to={ind.householdId ? `/households/${ind.householdId}` : '/contacts'} className="text-xs text-orange-600 hover:underline">Fix</Link>
                  </div>
                ))}
                {missing.missingPhone.length > 50 && <p className="text-xs text-slate-400">+{missing.missingPhone.length - 50} more…</p>}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Missing Mandal ({missing.missingMandal.length})</p>
            {missing.missingMandal.length === 0 ? <p className="text-sm text-slate-400">None — everyone has a Mandal assigned.</p> : (
              <div className="space-y-1">
                {missing.missingMandal.slice(0, 50).map((ind) => (
                  <div key={ind.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <span>{ind.name}</span>
                    <Link to={ind.householdId ? `/households/${ind.householdId}` : '/contacts'} className="text-xs text-orange-600 hover:underline">Fix</Link>
                  </div>
                ))}
                {missing.missingMandal.length > 50 && <p className="text-xs text-slate-400">+{missing.missingMandal.length - 50} more…</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'area' && (
        <div>
          <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-orange-200 bg-orange-50/40 p-4">
            <div className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-slate-800">Members in a household with no Area</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  These inherit their household's Area. New members do this automatically now;
                  this one-time fix backfills members added before that change. Blanks only — it never overwrites an existing area.
                </p>
              </div>
            </div>
            <Button variant="accent" size="sm" onClick={handleBackfillAreas} disabled={backfilling || missingArea.length === 0}>
              {backfilling ? 'Fixing…' : `Fix missing areas (${missingArea.length})`}
            </Button>
          </Card>

          {missingArea.length === 0 ? (
            <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 py-10 text-sm text-slate-400"><PartyPopper className="h-4 w-4" /> Every household member has an Area.</p>
          ) : (
            <div className="space-y-1">
              {missingArea.slice(0, 50).map((ind) => (
                <div key={ind.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span>{ind.name}</span>
                  <Link to={`/households/${ind.householdId}`} className="text-xs text-orange-600 hover:underline">View household</Link>
                </div>
              ))}
              {missingArea.length > 50 && <p className="text-xs text-slate-400">+{missingArea.length - 50} more…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
