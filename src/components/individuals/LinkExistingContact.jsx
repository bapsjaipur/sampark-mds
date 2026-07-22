// src/components/individuals/LinkExistingContact.jsx
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { moveIndividualToHousehold } from '../../services/householdService';
import { useToast } from '../../contexts/ToastContext';
import { Input, Select, Label } from '../ui/Input';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';

const RELATIONS = [
  { value: 'head',   label: 'Head of household' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'member', label: 'Family member' },
];

export default function LinkExistingContact({ currentHouseholdId, onLinked, onCancel }) {
  const { showToast } = useToast();
  const [allIndividuals, setAllIndividuals] = useState([]);
  const [search, setSearch] = useState('');
  const [moving, setMoving] = useState(null);
  // pending = { individual, relation } — shown when user clicks "Move here"
  const [pending, setPending] = useState(null);

  useEffect(() => onSnapshot(query(collection(db, 'individuals'), orderBy('name')), (snap) => {
    setAllIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }), []);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allIndividuals
      .filter((i) => i.householdId !== currentHouseholdId)
      .filter((i) => i.name?.toLowerCase().includes(q) || i.mobile?.includes(q))
      .slice(0, 15);
  }, [search, allIndividuals, currentHouseholdId]);

  async function handleConfirmLink() {
    if (!pending) return;
    setMoving(pending.individual.id);
    try {
      await moveIndividualToHousehold({
        individualId: pending.individual.id,
        fromHouseholdId: pending.individual.householdId,
        toHouseholdId: currentHouseholdId,
        relation: pending.relation,
      });
      showToast({ type: 'success', message: `${pending.individual.name} moved into this household.` });
      onLinked?.();
    } catch (err) {
      showToast({ type: 'error', message: "Couldn't move that contact. Try again." });
    } finally {
      setMoving(null);
      setPending(null);
    }
  }

  if (pending) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Adding <span className="font-medium text-slate-900">{pending.individual.name}</span> to this household.
        </p>
        <div>
          <Label required>Relation in this household</Label>
          <Select
            value={pending.relation}
            onChange={(e) => setPending((p) => ({ ...p, relation: e.target.value }))}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            {RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => setPending(null)}>Back</Button>
          <Button variant="accent" onClick={handleConfirmLink} disabled={Boolean(moving)}>
            {moving ? 'Moving…' : 'Confirm & move'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">Search for a person already in the system to move them into this household.</p>
      <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or mobile…" />
      <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
        {search.trim() && results.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No matches.</p>}
        {results.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={r.name} size="sm" />
              <div>
                <p className="text-sm font-medium text-slate-800">{r.name}</p>
                <p className="text-xs text-slate-400">{r.mobile || 'No mobile'}{r.mandal ? ` · ${r.mandal}` : ''}</p>
              </div>
            </div>
            <Button variant="accent" size="sm" onClick={() => setPending({ individual: r, relation: 'member' })}>
              Select
            </Button>
          </div>
        ))}
      </div>
      <Button variant="ghost" onClick={onCancel} className="mt-4 w-full">Cancel</Button>
    </div>
  );
}
