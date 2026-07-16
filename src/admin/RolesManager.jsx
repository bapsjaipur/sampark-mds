// src/admin/RolesManager.jsx — Attio redesign.
import { useEffect, useState } from 'react';
import { collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '../constants/permissions';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

function RolesManagerInner() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');
  const [savingCell, setSavingCell] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'roles'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setRoles(rows);
      setLoading(false);
    }, (err) => { setError(err.message); setLoading(false); });
    return () => unsub();
  }, []);

  async function togglePermission(role, permission) {
    const cellKey = `${role.id}:${permission}`;
    const current = Array.isArray(role.permissions) ? role.permissions : [];
    const next = current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission];
    setSavingCell(cellKey);
    try {
      await updateDoc(doc(db, 'roles', role.id), { permissions: next });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCell(null);
    }
  }

  async function createRole() {
    const name = newRoleName.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, 'roles'), { name, permissions: [], createdAt: serverTimestamp() });
      setNewRoleName('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteRole(role) {
    if (!window.confirm(`Delete role "${role.name}"? Volunteers assigned to it will lose access until reassigned.`)) return;
    try {
      await deleteDoc(doc(db, 'roles', role.id));
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading roles…</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-4 text-xl font-semibold text-slate-900 tracking-tight">Roles &amp; Permissions</h1>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <div className="mb-6 flex gap-2">
        <Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createRole()} placeholder="New role name (e.g. Area Coordinator)" className="flex-1" />
        <Button variant="accent" onClick={createRole} disabled={!newRoleName.trim()}>Add role</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50/60">
            <tr>
              <th className="sticky left-0 bg-slate-50/60 px-4 py-3 text-left font-medium text-slate-600">Role</th>
              {ALL_PERMISSIONS.map((perm) => <th key={perm} className="px-3 py-3 text-center font-medium text-slate-600 whitespace-nowrap">{PERMISSION_LABELS[perm] || perm}</th>)}
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {roles.map((role) => {
              const current = Array.isArray(role.permissions) ? role.permissions : [];
              return (
                <tr key={role.id} className="hover:bg-slate-50/50">
                  <td className="sticky left-0 bg-white px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{role.name}</td>
                  {ALL_PERMISSIONS.map((perm) => {
                    const cellKey = `${role.id}:${perm}`;
                    return (
                      <td key={perm} className="px-3 py-3 text-center">
                        <input type="checkbox" checked={current.includes(perm)} disabled={savingCell === cellKey} onChange={() => togglePermission(role, perm)} className="h-4 w-4 rounded border-slate-300 accent-orange-600 disabled:opacity-40" />
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => deleteRole(role)} className="text-xs text-rose-500 hover:underline">Delete</button>
                  </td>
                </tr>
              );
            })}
            {roles.length === 0 && <tr><td colSpan={ALL_PERMISSIONS.length + 2} className="px-4 py-6 text-center text-slate-400">No roles yet — add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RolesManager() {
  return (
    <RequirePermission permission="manage_roles" fallback={<div className="p-6 text-sm text-slate-500">You don't have permission to manage roles.</div>}>
      <RolesManagerInner />
    </RequirePermission>
  );
}

export default RolesManager;
