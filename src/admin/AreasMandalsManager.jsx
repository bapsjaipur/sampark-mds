// src/admin/AreasMandalsManager.jsx — Attio redesign.
// Mandals got their own table (MandalTable, below) instead of reusing the
// generic CodeTable: each Mandal now also carries a Gender ("Male"/
// "Female") and a `fields` map that says which optional member-detail
// questions get asked when adding a person under that Mandal — the
// Google-Forms-style "customize what this Mandal asks" behavior. Areas and
// Levels don't need any of that, so they keep using the plain CodeTable.
import { useEffect, useState } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import { DEFAULT_AREAS, DEFAULT_MANDALS, DEFAULT_LEVELS, MEMBER_FIELD_DEFS, FULL_MEMBER_FIELDS, MINIMAL_MEMBER_FIELDS } from '../lib/areaMandalCodes';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

function CodeTable({ title, collectionName, defaults, codeRequired = true }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, collectionName), (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setLoading(false); setLoadError(null);
    }, (err) => { setLoading(false); setLoadError(err.message || 'Couldn\u2019t load this collection.'); });
    return unsub;
  }, [collectionName]);

  async function handleAdd() {
    if (!name.trim() || (codeRequired && !code.trim())) { setError('Name (and code) are required.'); return; }
    if (code.trim() && rows.some((r) => r.code?.toLowerCase() === code.trim().toLowerCase())) { setError('That code is already in use.'); return; }
    setError(null);
    try {
      await addDoc(collection(db, collectionName), { name: name.trim(), code: code.trim().toUpperCase() });
      setName(''); setCode('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdate(row, field, value) {
    try { await updateDoc(doc(db, collectionName, row.id), { [field]: value }); } catch (err) { setError(err.message); }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete "${row.name}"? This won't affect existing records already using this value.`)) return;
    await deleteDoc(doc(db, collectionName, row.id));
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    try {
      const batch = writeBatch(db);
      defaults.forEach((d) => batch.set(doc(collection(db, collectionName)), d));
      await batch.commit();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {loadError && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">Couldn\u2019t load: {loadError}. Make sure the latest firestore.rules is deployed and you\u2019re signed in with a role that has manage_users.</div>}

      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1" />
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-24 uppercase" />
        <Button variant="accent" onClick={handleAdd}>Add</Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading\u2026</p>
      ) : rows.length === 0 && !loadError ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center">
          <p className="mb-2 text-sm text-slate-400">Nothing here yet.</p>
          <Button variant="primary" size="sm" onClick={handleSeedDefaults} disabled={seeding}>{seeding ? 'Seeding\u2026' : `Seed ${defaults.length} default values`}</Button>
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5">
              <input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && handleUpdate(r, 'name', e.target.value)} className="flex-1 rounded border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300 focus:outline-none" />
              <input defaultValue={r.code} onBlur={(e) => e.target.value !== r.code && handleUpdate(r, 'code', e.target.value.toUpperCase())} className="w-20 rounded border border-transparent px-1.5 py-1 text-sm uppercase hover:border-slate-200 focus:border-slate-300 focus:outline-none" />
              <button onClick={() => handleDelete(r)} className="text-xs text-rose-500 hover:underline">Delete</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MandalTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [gender, setGender] = useState('');
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [savingCell, setSavingCell] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'mandals'), (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setLoading(false); setLoadError(null);
    }, (err) => { setLoading(false); setLoadError(err.message || 'Couldn\u2019t load this collection.'); });
    return unsub;
  }, []);

  async function handleAdd() {
    if (!name.trim() || !code.trim()) { setError('Name and code are required.'); return; }
    if (rows.some((r) => r.code?.toLowerCase() === code.trim().toLowerCase())) { setError('That code is already in use.'); return; }
    setError(null);
    try {
      // New Mandals default to asking everything until the admin narrows it
      // down — safer default than silently hiding fields nobody chose to hide.
      await addDoc(collection(db, 'mandals'), { name: name.trim(), code: code.trim().toUpperCase(), gender, fields: FULL_MEMBER_FIELDS });
      setName(''); setCode(''); setGender('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdate(row, field, value) {
    try { await updateDoc(doc(db, 'mandals', row.id), { [field]: value }); } catch (err) { setError(err.message); }
  }

  async function toggleField(row, fieldKey) {
    const cellKey = `${row.id}:${fieldKey}`;
    const current = row.fields || {};
    const next = { ...current, [fieldKey]: !current[fieldKey] };
    setSavingCell(cellKey);
    try {
      await updateDoc(doc(db, 'mandals', row.id), { fields: next });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCell(null);
    }
  }

  async function applyPreset(row, preset) {
    try { await updateDoc(doc(db, 'mandals', row.id), { fields: preset }); } catch (err) { setError(err.message); }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete "${row.name}"? This won't affect existing records already using this value.`)) return;
    await deleteDoc(doc(db, 'mandals', row.id));
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    try {
      const batch = writeBatch(db);
      DEFAULT_MANDALS.forEach((d) => batch.set(doc(collection(db, 'mandals')), d));
      await batch.commit();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Mandals</h2>
      <p className="mb-3 text-xs text-slate-400">Gender groups your Mandals for reporting. The checkboxes control which extra questions get asked when adding a member under that Mandal — Name, Mobile number, and Photo are always asked.</p>
      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {loadError && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">Couldn\u2019t load: {loadError}. Make sure the latest firestore.rules is deployed and you\u2019re signed in with a role that has manage_users.</div>}

      <div className="mb-3 flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 min-w-[140px]" />
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-24 uppercase" />
        <select value={gender} onChange={(e) => setGender(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300">
          <option value="">No gender</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
        <Button variant="accent" onClick={handleAdd}>Add</Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading\u2026</p>
      ) : rows.length === 0 && !loadError ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center">
          <p className="mb-2 text-sm text-slate-400">Nothing here yet.</p>
          <Button variant="primary" size="sm" onClick={handleSeedDefaults} disabled={seeding}>{seeding ? 'Seeding\u2026' : `Seed ${DEFAULT_MANDALS.length} default values`}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center gap-2">
                <input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && handleUpdate(r, 'name', e.target.value)} className="flex-1 rounded border border-transparent px-1.5 py-1 text-sm font-medium hover:border-slate-200 focus:border-slate-300 focus:outline-none" />
                <input defaultValue={r.code} onBlur={(e) => e.target.value !== r.code && handleUpdate(r, 'code', e.target.value.toUpperCase())} className="w-20 rounded border border-transparent px-1.5 py-1 text-sm uppercase hover:border-slate-200 focus:border-slate-300 focus:outline-none" />
                <select value={r.gender || ''} onChange={(e) => handleUpdate(r, 'gender', e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-300">
                  <option value="">No gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                <button onClick={() => handleDelete(r)} className="text-xs text-rose-500 hover:underline">Delete</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-1.5">
                {MEMBER_FIELD_DEFS.map((f) => {
                  const checked = Boolean((r.fields || {})[f.key]);
                  const cellKey = `${r.id}:${f.key}`;
                  return (
                    <label key={f.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={checked} disabled={savingCell === cellKey} onChange={() => toggleField(r, f.key)} className="h-3.5 w-3.5 rounded accent-orange-600" />
                      {f.label}
                    </label>
                  );
                })}
                <button onClick={() => applyPreset(r, FULL_MEMBER_FIELDS)} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">Ask everything</button>
                <button onClick={() => applyPreset(r, MINIMAL_MEMBER_FIELDS)} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">Name &amp; mobile only</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AreasMandalsManagerInner() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Areas, Mandals &amp; Levels</h1>
      <p className="text-sm text-slate-400">These drive every dropdown in the app. Editing here doesn't change existing households/individuals already using a value.</p>
      <CodeTable title="Areas" collectionName="areas" defaults={DEFAULT_AREAS} />
      <MandalTable />
      <CodeTable title="Levels" collectionName="levels" defaults={DEFAULT_LEVELS} codeRequired={false} />
    </div>
  );
}

export function AreasMandalsManager() {
  return (
    <RequirePermission permission="manage_users" fallback={<div className="p-6 text-sm text-slate-500">You don't have permission to manage Areas & Mandals.</div>}>
      <AreasMandalsManagerInner />
    </RequirePermission>
  );
}

export default AreasMandalsManager;
