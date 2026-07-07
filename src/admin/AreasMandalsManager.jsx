// src/admin/AreasMandalsManager.jsx
import { useEffect, useState, useMemo } from 'react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, writeBatch, getDocs, query, where,
} from 'firebase/firestore';
import { BarChart2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import {
  DEFAULT_AREAS, DEFAULT_MANDALS, DEFAULT_LEVELS,
  MEMBER_FIELD_DEFS, FULL_MEMBER_FIELDS, MINIMAL_MEMBER_FIELDS,
} from '../lib/areaMandalCodes';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

// ── 5.1 helper: count usages across individuals + households ─────────────────
async function countUsages(field, value) {
  const [indSnap, hhSnap] = await Promise.all([
    getDocs(query(collection(db, 'individuals'), where(field, '==', value))),
    getDocs(query(collection(db, 'households'), where(field, '==', value))),
  ]);
  return { individuals: indSnap.size, households: hhSnap.size };
}

// ── 5.2 helper: cascade-rename field across individuals + households ──────────
async function cascadeRename(field, oldValue, newValue) {
  const [indSnap, hhSnap] = await Promise.all([
    getDocs(query(collection(db, 'individuals'), where(field, '==', oldValue))),
    getDocs(query(collection(db, 'households'), where(field, '==', oldValue))),
  ]);
  const CHUNK = 400;
  const all = [
    ...indSnap.docs.map((d) => ({ ref: doc(db, 'individuals', d.id) })),
    ...hhSnap.docs.map((d) => ({ ref: doc(db, 'households', d.id) })),
  ];
  for (let i = 0; i < all.length; i += CHUNK) {
    const batch = writeBatch(db);
    all.slice(i, i + CHUNK).forEach(({ ref }) => batch.update(ref, { [field]: newValue }));
    await batch.commit();
  }
  return all.length;
}

// ── 5.3 Area stats panel ──────────────────────────────────────────────────────
function AreaStats({ areas }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [indSnap, hhSnap] = await Promise.all([
        getDocs(collection(db, 'individuals')),
        getDocs(collection(db, 'households')),
      ]);
      const indByArea = {};
      const hhByArea = {};
      indSnap.docs.forEach((d) => {
        const a = d.data().area || '(none)';
        indByArea[a] = (indByArea[a] || 0) + 1;
      });
      hhSnap.docs.forEach((d) => {
        const a = d.data().area || '(none)';
        hhByArea[a] = (hhByArea[a] || 0) + 1;
      });
      const rows = areas.map((a) => ({
        name: a.name,
        individuals: indByArea[a.name] || 0,
        households: hhByArea[a.name] || 0,
      }));
      const unassigned = indByArea['(none)'] || 0;
      setStats({ rows, unassigned });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <BarChart2 className="h-4 w-4 text-slate-400" /> Area Statistics
        </h2>
        <Button variant="secondary" size="sm" onClick={() => { setOpen((v) => !v); if (!open && !stats) load(); }}>
          {open ? 'Hide' : 'Show stats'}
        </Button>
      </div>
      {open && (
        loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : stats ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-slate-100">
              <thead className="bg-slate-50/60">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Area</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600">Households</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600">People</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {stats.rows.map((r) => (
                  <tr key={r.name} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-800">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.households}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.individuals}</td>
                  </tr>
                ))}
                {stats.unassigned > 0 && (
                  <tr className="bg-amber-50/40">
                    <td className="px-3 py-2 text-slate-400 italic">No area assigned</td>
                    <td className="px-3 py-2 text-right" />
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600">{stats.unassigned}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null
      )}
    </Card>
  );
}

// ── Generic CodeTable (Areas / Levels) with 5.1 + 5.2 ────────────────────────
function CodeTable({ title, collectionName, defaults, codeRequired = true, renameField = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // { row, individuals, households }
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, collectionName), (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setLoading(false); setLoadError(null);
    }, (err) => { setLoading(false); setLoadError(err.message || "Couldn't load this collection."); });
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

  // 5.2 — on blur, check if name changed and offer cascade rename
  async function handleNameBlur(row, newName) {
    if (!newName.trim() || newName === row.name) return;
    if (!renameField) {
      await updateDoc(doc(db, collectionName, row.id), { name: newName.trim() });
      return;
    }
    const usages = await countUsages(renameField, row.name);
    const total = usages.individuals + usages.households;
    if (total === 0) {
      await updateDoc(doc(db, collectionName, row.id), { name: newName.trim() });
      return;
    }
    const go = window.confirm(
      `Rename "${row.name}" to "${newName.trim()}"?\n\nThis will also update ${total} existing record(s) (${usages.households} household(s), ${usages.individuals} individual(s)).`
    );
    if (!go) return;
    await Promise.all([
      updateDoc(doc(db, collectionName, row.id), { name: newName.trim() }),
      cascadeRename(renameField, row.name, newName.trim()),
    ]);
  }

  async function handleUpdate(row, field, value) {
    try { await updateDoc(doc(db, collectionName, row.id), { [field]: value }); } catch (err) { setError(err.message); }
  }

  // 5.1 — check usages before delete
  async function handleDelete(row) {
    if (!renameField) {
      if (!window.confirm(`Delete "${row.name}"?`)) return;
      await deleteDoc(doc(db, collectionName, row.id));
      return;
    }
    const usages = await countUsages(renameField, row.name);
    setPendingDelete({ row, ...usages });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, collectionName, pendingDelete.row.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
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
      {loadError && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">Couldn't load: {loadError}.</div>}

      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1" />
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-24 uppercase" />
        <Button variant="accent" onClick={handleAdd}>Add</Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 && !loadError ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center">
          <p className="mb-2 text-sm text-slate-400">Nothing here yet.</p>
          <Button variant="primary" size="sm" onClick={handleSeedDefaults} disabled={seeding}>{seeding ? 'Seeding…' : `Seed ${defaults.length} default values`}</Button>
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5">
              <input
                defaultValue={r.name}
                onBlur={(e) => handleNameBlur(r, e.target.value)}
                className="flex-1 rounded border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300 focus:outline-none"
              />
              <input
                defaultValue={r.code}
                onBlur={(e) => e.target.value !== r.code && handleUpdate(r, 'code', e.target.value.toUpperCase())}
                className="w-20 rounded border border-transparent px-1.5 py-1 text-sm uppercase hover:border-slate-200 focus:border-slate-300 focus:outline-none"
              />
              <button onClick={() => handleDelete(r)} className="text-xs text-rose-500 hover:underline">Delete</button>
            </div>
          ))}
        </div>
      )}

      {/* 5.1 — delete confirmation with usage count */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900">Delete "{pendingDelete.row.name}"?</h3>
            {(pendingDelete.individuals + pendingDelete.households) > 0 ? (
              <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This value is used by <strong>{pendingDelete.households}</strong> household(s) and <strong>{pendingDelete.individuals}</strong> individual(s). Those records will keep the old value as a plain string — it won't appear in dropdowns anymore.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Not used anywhere — safe to delete.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="dangerSolid" size="sm" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete anyway'}</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── MandalTable with 5.1 + 5.2 ────────────────────────────────────────────────
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
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'mandals'), (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setLoading(false); setLoadError(null);
    }, (err) => { setLoading(false); setLoadError(err.message || "Couldn't load mandals."); });
    return unsub;
  }, []);

  async function handleAdd() {
    if (!name.trim() || !code.trim()) { setError('Name and code are required.'); return; }
    if (rows.some((r) => r.code?.toLowerCase() === code.trim().toLowerCase())) { setError('That code is already in use.'); return; }
    setError(null);
    try {
      await addDoc(collection(db, 'mandals'), { name: name.trim(), code: code.trim().toUpperCase(), gender, fields: FULL_MEMBER_FIELDS });
      setName(''); setCode(''); setGender('');
    } catch (err) {
      setError(err.message);
    }
  }

  // 5.2 — cascade rename mandal
  async function handleNameBlur(row, newName) {
    if (!newName.trim() || newName === row.name) return;
    const usages = await countUsages('mandal', row.name);
    const total = usages.individuals + usages.households;
    if (total === 0) {
      await updateDoc(doc(db, 'mandals', row.id), { name: newName.trim() });
      return;
    }
    const go = window.confirm(
      `Rename "${row.name}" to "${newName.trim()}"?\n\nThis will also update ${total} existing record(s) (${usages.individuals} individual(s)).`
    );
    if (!go) return;
    await Promise.all([
      updateDoc(doc(db, 'mandals', row.id), { name: newName.trim() }),
      cascadeRename('mandal', row.name, newName.trim()),
    ]);
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

  // 5.1 — check usages before delete
  async function handleDelete(row) {
    const usages = await countUsages('mandal', row.name);
    setPendingDelete({ row, ...usages });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'mandals', pendingDelete.row.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
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
      <p className="mb-3 text-xs text-slate-400">Gender groups your Mandals for reporting. Checkboxes control which extra questions appear when adding a member under that Mandal.</p>
      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {loadError && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">Couldn't load: {loadError}.</div>}

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
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 && !loadError ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center">
          <p className="mb-2 text-sm text-slate-400">Nothing here yet.</p>
          <Button variant="primary" size="sm" onClick={handleSeedDefaults} disabled={seeding}>{seeding ? 'Seeding…' : `Seed ${DEFAULT_MANDALS.length} default values`}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center gap-2">
                <input
                  defaultValue={r.name}
                  onBlur={(e) => handleNameBlur(r, e.target.value)}
                  className="flex-1 rounded border border-transparent px-1.5 py-1 text-sm font-medium hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                />
                <input
                  defaultValue={r.code}
                  onBlur={(e) => e.target.value !== r.code && handleUpdate(r, 'code', e.target.value.toUpperCase())}
                  className="w-20 rounded border border-transparent px-1.5 py-1 text-sm uppercase hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                />
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

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900">Delete "{pendingDelete.row.name}"?</h3>
            {pendingDelete.individuals > 0 ? (
              <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <strong>{pendingDelete.individuals}</strong> individual(s) are assigned to this Mandal. They'll keep the old value as a string — it won't appear in dropdowns anymore.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Not assigned to anyone — safe to delete.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="dangerSolid" size="sm" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete anyway'}</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function AreasMandalsManagerInner() {
  const [areas, setAreas] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'areas'), (snap) => {
      setAreas(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    });
    return unsub;
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Areas, Mandals &amp; Levels</h1>
      <p className="text-sm text-slate-400">These drive every dropdown in the app. Renaming propagates to all existing records; deleting in-use values keeps existing data intact.</p>
      <AreaStats areas={areas} />
      <CodeTable title="Areas" collectionName="areas" defaults={DEFAULT_AREAS} renameField="area" />
      <MandalTable />
      <CodeTable title="Levels" collectionName="levels" defaults={DEFAULT_LEVELS} codeRequired={false} renameField={null} />
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
