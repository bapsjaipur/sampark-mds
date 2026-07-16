// src/components/individuals/LinkExistingContact.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { moveIndividualToHousehold } from '../../services/householdService';
import { useToast } from '../../contexts/ToastContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';

export default function LinkExistingContact({ currentHouseholdId, onLinked, onCancel }) {
  const { showToast } = useToast();
  const [allIndividuals, setAllIndividuals] = useState([]);
  const [search, setSearch] = useState('');
  const [moving, setMoving] = useState(null);

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

  async function handleLink(individual) {
    setMoving(individual.id);
    try {
      await moveIndividualToHousehold({ individualId: individual.id, fromHouseholdId: individual.householdId, toHouseholdId: currentHouseholdId });
      showToast({ type: 'success', message: `${individual.name} moved into this household.` });
      onLinked?.();
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn’t move that contact. Try again.' });
    } finally {
      setMoving(null);
    }
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
            <Button variant="accent" size="sm" onClick={() => handleLink(r)} disabled={moving === r.id}>
              {moving === r.id ? 'Moving…' : 'Move here'}
            </Button>
          </div>
        ))}
      </div>
      <Button variant="ghost" onClick={onCancel} className="mt-4 w-full">Cancel</Button>
    </div>
  );
}
