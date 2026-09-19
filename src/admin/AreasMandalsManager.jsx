// src/admin/AreasMandalsManager.jsx
//
// PHASE 22 — renames now actually propagate, and Areas/Mandals can be merged.
//
// Areas, Mandals, Levels and Sub-areas are stored on every record as NAME TEXT,
// never as a reference to areas/{id}. That has one consequence this screen has to
// respect everywhere: editing `name` on the taxonomy document renames the
// dropdown option and nothing else. Every existing household keeps the old
// spelling, and worse, volunteers.assignedAreas[] keeps it too — and
// firestore.rules gates every read with an exact string match against that
// array, so an un-propagated rename silently empties the contact list of every
// karyakarta assigned to it. No error, no empty-state explanation.
//
// Before this phase only Mandal renames cascaded, and only across `individuals`
// and `households`. Area renames did not cascade at all, while the blurb at the
// top of the page claimed they did. Now every rename here goes through
// services/taxonomyService.js, which knows the full list of collections that
// store a taxonomy name, and the page's promise is true.
import { useEffect, useState } from 'react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, writeBatch, getDocs,
} from 'firebase/firestore';
import { BarChart2, X } from 'lucide-react';
import { db } from '../lib/firebase';
import { confirmDialog } from '../components/ui/ConfirmHost';
import { RequirePermission } from '../components/RequirePermission';
import {
  DEFAULT_MANDALS, DEFAULT_LEVELS,
  MEMBER_FIELD_DEFS, FULL_MEMBER_FIELDS, MINIMAL_MEMBER_FIELDS,
} from '../lib/areaMandalCodes';
import {
  countTaxonomyUsage, describeTaxonomyError, describeUsage,
  renameTaxonomyValue, TAXONOMY_LABELS,
} from '../services/taxonomyService';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { AreaTable } from './AreaTable';
import { MergeTaxonomyPanel } from './MergeTaxonomyPanel';
import { UnlistedTaxonomyPanel } from './UnlistedTaxonomyPanel';

// ── Rename: count, confirm, cascade ──────────────────────────────────────────
// Returns { applied, records } — `applied: false` means the admin cancelled at
// the confirmation, so the caller must not touch the taxonomy document either.
//
// Records are rewritten BEFORE the taxonomy document, deliberately. If the
// cascade throws, the option in the dropdown still reads with its old name and
// re-running the rename finishes the rest. The reverse order would leave the
// records orphaned behind a name that no longer exists anywhere.
async function confirmAndCascade({ kind, oldValue, newValue, parentArea = null, onProgress }) {
  const label = (TAXONOMY_LABELS[kind] || 'value').toLowerCase();
  const usage = await countTaxonomyUsage(kind, oldValue, { parentArea });
  if (usage.total === 0) return { applied: true, records: 0 };

  const affectsVolunteers = usage.rows.some((r) => r.collection === 'volunteers' && r.count > 0);
  const go = await confirmDialog({
    title: `Rename ${label} "${oldValue}" to "${newValue}"?`,
    message:
      `This also rewrites ${describeUsage(usage)}.\n\n`
      + (affectsVolunteers
        ? 'Karyakarta assignments are included — they have to be, or everyone assigned '
          + `to "${oldValue}" would stop seeing their own contacts.\n\n`
        : '')
      + 'Leave this page open until it finishes.',
    confirmText: 'Rename',
    tone: 'danger',
  });
  if (!go) return { applied: false, records: 0 };

  const res = await renameTaxonomyValue(kind, oldValue, newValue, { parentArea, onProgress });
  return { applied: true, records: res.total };
}

// ── Delete confirmation, shared by all four tables ───────────────────────────
function DeleteTaxonomyDialog({ pending, busy, onCancel, onConfirm }) {
  if (!pending) return null;
  const { row, usage, kind } = pending;
  const label = (TAXONOMY_LABELS[kind] || 'value').toLowerCase();
  const inUse = usage && usage.total > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-900">Delete {label} “{row.name}”?</h3>
        {inUse ? (
          <>
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Still used by <strong>{describeUsage(usage)}</strong>. Those records keep the text
              “{row.name}”, which will no longer appear in any dropdown — so they become hard to
              find and, for karyakarta assignments, stop matching anything at all.
            </p>
            {(kind === 'area' || kind === 'mandal') && (
              <p className="mt-2 text-xs text-slate-500">
                To move them somewhere instead of stranding them, cancel and use
                “Merge {label}s” — it rewrites every record onto another {label} first.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Not used by any record — safe to delete.</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="dangerSolid" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : inUse ? 'Delete anyway' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Area stats panel ──────────────────────────────────────────────────────────
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
      // Area names on records that no longer match any option in the dropdown —
      // usually the debris of a rename made before renames cascaded. Surfaced
      // here because these records are otherwise invisible to every scoped
      // query in the app.
      const known = new Set(areas.map((a) => a.name));
      const orphans = Object.keys({ ...indByArea, ...hhByArea })
        .filter((name) => name !== '(none)' && !known.has(name))
        .map((name) => ({
          name,
          individuals: indByArea[name] || 0,
          households: hhByArea[name] || 0,
        }));
      const unassigned = indByArea['(none)'] || 0;
      setStats({ rows, unassigned, orphans });
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
        <Button variant="secondary" size="sm" onClick={() => { setOpen((v) => !v); if (!open) load(); }}>
          {open ? 'Hide' : 'Show stats'}
        </Button>
      </div>
      {open && (
        loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : stats ? (
          <>
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
                  {stats.orphans.map((r) => (
                    <tr key={`orphan-${r.name}`} className="bg-rose-50/40">
                      <td className="px-3 py-2 text-rose-700">
                        {r.name}
                        <span className="ml-1.5 text-xs text-rose-400">not in the list</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-600">{r.households}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-600">{r.individuals}</td>
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
            {stats.orphans.length > 0 && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                The rows in red hold an area name that is not in the Areas list, so no dropdown
                offers it and area-scoped karyakartas cannot see them. Add an area with exactly
                that name to adopt the records, then use “Merge areas” to fold it into the right one.
              </p>
            )}
          </>
        ) : null
      )}
    </Card>
  );
}

// ── Generic CodeTable (Levels) ───────────────────────────────────────────────
// `kind` is a taxonomyService key ('level'); pass null for a list that no record
// stores by name.
function CodeTable({ title, collectionName, defaults, codeRequired = true, kind = null, onNotice }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // { row, usage, kind }
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, collectionName), (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setLoading(false); setLoadError(null);
    }, (err) => { setLoading(false); setLoadError(err.message || "Couldn't load this collection."); });
    return unsub;
  }, [collectionName]);

  async function handleAdd() {
    if (!name.trim() || (codeRequired && !code.trim())) { setError('Name (and code) are required.'); return; }
    if (rows.some((r) => (r.name || '').toLowerCase() === name.trim().toLowerCase())) { setError(`"${name.trim()}" already exists.`); return; }
    if (code.trim() && rows.some((r) => r.code?.toLowerCase() === code.trim().toLowerCase())) { setError('That code is already in use.'); return; }
    setError(null);
    try {
      await addDoc(collection(db, collectionName), { name: name.trim(), code: code.trim().toUpperCase() });
      setName(''); setCode('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleNameBlur(row, el) {
    const next = el.value.trim();
    if (!next || next === row.name) return;
    if (rows.some((r) => r.id !== row.id && (r.name || '').toLowerCase() === next.toLowerCase())) {
      setError(`"${next}" already exists in this list.`);
      el.value = row.name;
      return;
    }
    setError(null);
    if (!kind) {
      try { await updateDoc(doc(db, collectionName, row.id), { name: next }); }
      catch (err) { el.value = row.name; setError(err.message); }
      return;
    }
    setBusy(true);
    try {
      const { applied, records } = await confirmAndCascade({ kind, oldValue: row.name, newValue: next });
      if (!applied) { el.value = row.name; return; }
      await updateDoc(doc(db, collectionName, row.id), { name: next });
      onNotice?.(`Renamed “${row.name}” to “${next}”.`
        + (records ? ` ${records} record(s) updated.` : ''));
    } catch (err) {
      el.value = row.name;
      setError(describeTaxonomyError(err, kind));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(row, field, value) {
    try { await updateDoc(doc(db, collectionName, row.id), { [field]: value }); } catch (err) { setError(err.message); }
  }

  async function handleDelete(row) {
    if (!kind) {
      setPendingDelete({ row, usage: null, kind });
      return;
    }
    try {
      setPendingDelete({ row, usage: await countTaxonomyUsage(kind, row.name), kind });
    } catch (err) {
      setError(describeTaxonomyError(err, kind));
    }
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

      <div className="mb-3 flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 min-w-[140px]" />
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
                key={`n-${r.name}`}
                defaultValue={r.name}
                onBlur={(e) => handleNameBlur(r, e.target)}
                disabled={busy}
                className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300 focus:outline-none disabled:bg-slate-50"
              />
              <input
                key={`c-${r.code}`}
                defaultValue={r.code}
                onBlur={(e) => e.target.value !== r.code && handleUpdate(r, 'code', e.target.value.toUpperCase())}
                className="w-20 shrink-0 rounded border border-transparent px-1.5 py-1 text-sm uppercase hover:border-slate-200 focus:border-slate-300 focus:outline-none"
              />
              <button onClick={() => handleDelete(r)} className="shrink-0 text-xs text-rose-500 hover:underline">Delete</button>
            </div>
          ))}
        </div>
      )}

      <DeleteTaxonomyDialog
        pending={pendingDelete}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}

// ── MandalTable ──────────────────────────────────────────────────────────────
function MandalTable({ rows, loading, loadError, onNotice }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [gender, setGender] = useState('');
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [savingCell, setSavingCell] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  async function handleAdd() {
    if (!name.trim() || !code.trim()) { setError('Name and code are required.'); return; }
    if (rows.some((r) => (r.name || '').toLowerCase() === name.trim().toLowerCase())) { setError(`"${name.trim()}" already exists.`); return; }
    if (rows.some((r) => r.code?.toLowerCase() === code.trim().toLowerCase())) { setError('That code is already in use.'); return; }
    setError(null);
    try {
      await addDoc(collection(db, 'mandals'), { name: name.trim(), code: code.trim().toUpperCase(), gender, fields: FULL_MEMBER_FIELDS });
      setName(''); setCode(''); setGender('');
    } catch (err) {
      setError(err.message);
    }
  }

  // `el`, not the string: a cancelled or refused rename has to put the stored
  // name back in the box. Typed text left next to unchanged data reads exactly
  // like a save that worked.
  async function handleNameBlur(row, el) {
    const next = el.value.trim();
    if (!next || next === row.name) return;
    if (rows.some((r) => r.id !== row.id && (r.name || '').toLowerCase() === next.toLowerCase())) {
      setError(`"${next}" is already a Mandal. Use “Merge mandals” below to combine the two.`);
      el.value = row.name;
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { applied, records } = await confirmAndCascade({
        kind: 'mandal', oldValue: row.name, newValue: next, onProgress: setProgress,
      });
      if (!applied) { el.value = row.name; return; }
      await updateDoc(doc(db, 'mandals', row.id), { name: next });
      onNotice?.(`Renamed Mandal “${row.name}” to “${next}”.`
        + (records ? ` ${records} record(s) updated.` : ''));
    } catch (err) {
      el.value = row.name;
      setError(describeTaxonomyError(err, 'mandal'));
    } finally {
      setBusy(false);
      setProgress(null);
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
    try {
      setPendingDelete({ row, usage: await countTaxonomyUsage('mandal', row.name), kind: 'mandal' });
    } catch (err) {
      setError(describeTaxonomyError(err, 'mandal'));
    }
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
      {progress && (
        <p className="mb-3 text-xs text-slate-500">Updating records — {progress.done} of {progress.total}…</p>
      )}

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
              <div className="flex flex-wrap items-center gap-2">
                {/* Full width on a phone. Sharing one line with the code box,
                    the gender select and Delete left the name 45px wide, so
                    "Balak Mandal" edited as "Bal M" — the field you actually
                    rename was the one squeezed out. */}
                <input
                  key={`n-${r.name}`}
                  defaultValue={r.name}
                  onBlur={(e) => handleNameBlur(r, e.target)}
                  disabled={busy}
                  className="w-full min-w-0 rounded border border-transparent px-1.5 py-1 text-sm font-medium hover:border-slate-200 focus:border-slate-300 focus:outline-none disabled:bg-slate-50 sm:w-auto sm:flex-1"
                />
                <input
                  key={`c-${r.code}`}
                  defaultValue={r.code}
                  onBlur={(e) => e.target.value !== r.code && handleUpdate(r, 'code', e.target.value.toUpperCase())}
                  className="w-20 shrink-0 rounded border border-transparent px-1.5 py-1 text-sm uppercase hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                />
                <select value={r.gender || ''} onChange={(e) => handleUpdate(r, 'gender', e.target.value)} className="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-300">
                  <option value="">No gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                <button onClick={() => handleDelete(r)} className="shrink-0 text-xs text-rose-500 hover:underline">Delete</button>
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

      <DeleteTaxonomyDialog
        pending={pendingDelete}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}

function AreasMandalsManagerInner() {
  const [areas, setAreas] = useState([]);
  const [mandals, setMandals] = useState([]);
  const [mandalsLoading, setMandalsLoading] = useState(true);
  const [mandalsError, setMandalsError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'areas'), (snap) => {
      setAreas(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    });
    return unsub;
  }, []);

  // Lifted out of MandalTable so the merge panel below it can see the same list.
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'mandals'), (snap) => {
      setMandals(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setMandalsLoading(false); setMandalsError(null);
    }, (err) => { setMandalsLoading(false); setMandalsError(err.message || "Couldn't load mandals."); });
    return unsub;
  }, []);

  function announce(message) { setError(null); setNotice(message); }

  // Returns false when nothing was applied, so AreaTable can put the stored name
  // back in the box instead of leaving the typed text there.
  async function handleRenameArea(area, { name }) {
    setError(null); setNotice(null);
    try {
      const { applied, records } = await confirmAndCascade({
        kind: 'area', oldValue: area.name, newValue: name, onProgress: setProgress,
      });
      if (!applied) return false;
      await updateDoc(doc(db, 'areas', area.id), { name });
      announce(`Renamed area “${area.name}” to “${name}”.`
        + (records ? ` ${records} record(s) updated.` : ' Nothing else referenced it.'));
      return true;
    } catch (err) {
      setError(describeTaxonomyError(err, 'area'));
      return false;
    } finally {
      setProgress(null);
    }
  }

  async function handleRenameSubArea(area, oldSub, { name, code }) {
    setError(null); setNotice(null);
    try {
      let records = 0;
      // Only a name change reaches records — households store subArea as text.
      if (name !== oldSub.name) {
        const res = await confirmAndCascade({
          kind: 'subArea', oldValue: oldSub.name, newValue: name,
          parentArea: area.name, onProgress: setProgress,
        });
        if (!res.applied) return false;
        records = res.records;
      }
      const subAreas = (area.subAreas || []).map((s) => (
        s.name === oldSub.name && s.code === oldSub.code ? { name, code } : s
      ));
      await updateDoc(doc(db, 'areas', area.id), { subAreas });
      if (name !== oldSub.name) {
        announce(`Renamed sub-area “${oldSub.name}” to “${name}” in ${area.name}.`
          + (records ? ` ${records} record(s) updated.` : ''));
      }
      return true;
    } catch (err) {
      setError(describeTaxonomyError(err, 'subArea'));
      return false;
    } finally {
      setProgress(null);
    }
  }

  async function handleDeleteSubArea(area, sub) {
    setError(null); setNotice(null);
    try {
      const usage = await countTaxonomyUsage('subArea', sub.name, { parentArea: area.name });
      const go = await confirmDialog({
        title: `Delete sub-area "${sub.name}" from ${area.name}?`,
        message: usage.total
          ? `${describeUsage(usage)} still carry it. They keep the text, which will no longer appear in the Sub-area dropdown.`
          : 'Nothing uses it.',
        confirmText: 'Delete',
        tone: 'danger',
      });
      if (!go) return;
      await updateDoc(doc(db, 'areas', area.id), {
        subAreas: (area.subAreas || []).filter((s) => s.name !== sub.name || s.code !== sub.code),
      });
      if (usage.total) {
        announce(`Removed sub-area “${sub.name}”. ${describeUsage(usage)} still carry the old text.`);
      }
    } catch (err) {
      setError(describeTaxonomyError(err, 'subArea'));
    }
  }

  async function handleAskDeleteArea(area) {
    setError(null); setNotice(null);
    try {
      setPendingDelete({ row: area, usage: await countTaxonomyUsage('area', area.name), kind: 'area' });
    } catch (err) {
      setError(describeTaxonomyError(err, 'area'));
    }
  }

  async function confirmDeleteArea() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'areas', pendingDelete.row.id));
      setPendingDelete(null);
    } catch (err) {
      setError(describeTaxonomyError(err, 'area'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Areas, Mandals &amp; Levels</h1>
        <p className="mt-1 text-sm text-slate-400">
          These drive every dropdown in the app. Renaming rewrites the name on every household,
          contact, calling batch, event and karyakarta assignment that uses it, so nothing is left
          behind on the old spelling. Deleting an in-use value strands those records instead — merge
          it into another one if you want them moved.
        </p>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-emerald-600 hover:text-emerald-800"><X className="h-4 w-4" /></button>
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 text-rose-500 hover:text-rose-700"><X className="h-4 w-4" /></button>
        </div>
      )}
      {progress && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          Updating records — {progress.done} of {progress.total}. Keep this page open.
        </div>
      )}

      <AreaStats areas={areas} />
      <AreaTable
        areas={areas}
        onRename={handleRenameArea}
        onUpdateCode={(area, code) => updateDoc(doc(db, 'areas', area.id), { code })}
        onDelete={handleAskDeleteArea}
        onRenameSubArea={handleRenameSubArea}
        onDeleteSubArea={handleDeleteSubArea}
      />
      <MergeTaxonomyPanel kind="area" rows={areas} onDone={announce} />
      {/* Sits after Merge, deliberately: Merge handles two options that both
          exist, this handles a name that only exists on records. Same fix, but
          you only come looking for it after finding the option missing. */}
      <UnlistedTaxonomyPanel kind="area" rows={areas} onDone={announce} />

      <MandalTable rows={mandals} loading={mandalsLoading} loadError={mandalsError} onNotice={announce} />
      <MergeTaxonomyPanel kind="mandal" rows={mandals} onDone={announce} />
      <UnlistedTaxonomyPanel kind="mandal" rows={mandals} onDone={announce} />

      <CodeTable
        title="Levels"
        collectionName="levels"
        defaults={DEFAULT_LEVELS}
        codeRequired={false}
        kind="level"
        onNotice={announce}
      />

      <DeleteTaxonomyDialog
        pending={pendingDelete}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteArea}
      />
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
