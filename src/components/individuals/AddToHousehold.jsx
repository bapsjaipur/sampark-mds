// src/components/individuals/AddToHousehold.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { moveIndividualToHousehold } from '../../services/householdService';
import { useToast } from '../../contexts/ToastContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

export default function AddToHousehold({ contact, onDone, onCancel }) {
  const { showToast } = useToast();
  const [households, setHouseholds] = useState([]);
  const [individuals, setIndividuals] = useState([]);
  const [search, setSearch] = useState('');
  const [moving, setMoving] = useState(false);

  useEffect(() => onSnapshot(collection(db, 'households'), (snap) => setHouseholds(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), []);
  useEffect(() => onSnapshot(collection(db, 'individuals'), (snap) => setIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), []);

  const primaryNameByHousehold = useMemo(() => {
    const map = new Map();
    individuals.forEach((i) => { if (i.isPrimary || !map.has(i.householdId)) map.set(i.householdId, i.name); });
    return map;
  }, [individuals]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return households
      .map((h) => ({ ...h, _headName: primaryNameByHousehold.get(h.id) || '' }))
      .filter((h) => h._headName.toLowerCase().includes(q) || h.address?.toLowerCase().includes(q) || h.area?.toLowerCase().includes(q))
      .slice(0, 15);
  }, [search, households, primaryNameByHousehold]);

  async function handleAttach(household) {
    setMoving(true);
    try {
      await moveIndividualToHousehold({ individualId: contact.id, fromHouseholdId: contact.householdId, toHouseholdId: household.id });
      showToast({ type: 'success', message: `${contact.name} added to ${household._headName || household.address}.` });
      onDone?.();
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn\u2019t add them to that household. Try again.' });
    } finally {
      setMoving(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">Search by the head-of-household's name, address, or area.</p>
      <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search households\u2026" />
      <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
        {search.trim() && results.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No matches.</p>}
        {results.map((h) => (
          <div key={h.id} className="flex items-center justify-between px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-slate-800">{h._headName || h.address || 'Unnamed household'}</p>
              <p className="text-xs text-slate-400">{h.area}{h.mandal ? ` \u00b7 ${h.mandal}` : ''}</p>
            </div>
            <Button variant="accent" size="sm" onClick={() => handleAttach(h)} disabled={moving}>{moving ? 'Adding\u2026' : 'Add here'}</Button>
          </div>
        ))}
      </div>
      <Button variant="ghost" onClick={onCancel} className="mt-4 w-full">Cancel</Button>
    </div>
  );
}
