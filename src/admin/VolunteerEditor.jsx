// src/admin/VolunteerEditor.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { X } from 'lucide-react';
import { db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import { isValidPhone } from '../lib/authHelpers';
import { Input, Select, Label } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';

function TagInput({ label, values, onChange, placeholder }) {
  const [draft, setDraft] = useState('');

  function commitDraft() {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitDraft(); }
    else if (e.key === 'Backspace' && draft === '' && values.length > 0) onChange(values.slice(0, -1));
  }

  function removeValue(v) { onChange(values.filter((x) => x !== v)); }

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 focus-within:ring-1 focus-within:ring-slate-300">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
            {v}
            <button type="button" onClick={() => removeValue(v)} className="text-orange-400 hover:text-orange-700"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={handleKeyDown} onBlur={commitDraft} placeholder={values.length === 0 ? placeholder : ''} className="flex-1 min-w-[8ch] border-none px-1 py-0.5 text-sm focus:outline-none focus:ring-0" />
      </div>
    </div>
  );
}

function CreateVolunteerForm({ roles, onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', password: '', roleRef: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setSuccess(false);
    if (!form.name.trim()) return setError('Name is required.');
    if (!isValidPhone(form.phone)) return setError('Enter a valid 10-digit phone number.');
    if (form.password.length < 6) return setError('Password must be at least 6 characters.');

    setSaving(true);
    try {
      const functions = getFunctions();
      const createVolunteerAccount = httpsCallable(functions, 'createVolunteerAccount');
      await createVolunteerAccount({ name: form.name.trim(), phone: form.phone.replace(/\D/g, ''), password: form.password, roleRef: form.roleRef || null, assignedAreas: [], assignedMandals: [] });
      setForm({ name: '', phone: '', password: '', roleRef: '' });
      setSuccess(true);
      onCreated?.();
    } catch (err) {
      setError(err.message || 'Couldn\u2019t create the volunteer login.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-dashed border-slate-200 p-4 space-y-3 mb-6">
      <h3 className="text-sm font-semibold text-slate-900">Create new volunteer login</h3>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Volunteer created. Assign their areas/mandals below.</div>}
      <div className="grid grid-cols-2 gap-3">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit phone" inputMode="numeric" />
        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Temporary password (6+ chars)" />
        <Select value={form.roleRef} onChange={(e) => setForm({ ...form, roleRef: e.target.value })}>
          <option value="">No role yet</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </div>
      <Button type="submit" variant="accent" disabled={saving}>{saving ? 'Creating\u2026' : 'Create login'}</Button>
      <p className="text-xs text-slate-400">Share the phone number and temporary password with the volunteer directly \u2014 there\u2019s no email/SMS delivery built yet.</p>
    </form>
  );
}

function VolunteerEditorInner() {
  const [volunteers, setVolunteers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsubVol = onSnapshot(collection(db, 'volunteers'), (snap) => setVolunteers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubRoles = onSnapshot(collection(db, 'roles'), (snap) => setRoles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => { unsubVol(); unsubRoles(); };
  }, []);

  useEffect(() => {
    if (!selectedId) { setDraft(null); return; }
    const v = volunteers.find((x) => x.id === selectedId);
    if (v) {
      setDraft({
        name: v.name || '', mobile: v.mobile || '', roleRef: v.roleRef || '',
        assignedAreas: Array.isArray(v.assignedAreas) ? v.assignedAreas : [],
        assignedMandals: Array.isArray(v.assignedMandals) ? v.assignedMandals : [],
      });
    }
  }, [selectedId, volunteers]);

  const filteredVolunteers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return volunteers;
    return volunteers.filter((v) => (v.name || '').toLowerCase().includes(q) || (v.mobile || '').includes(q));
  }, [volunteers, search]);

  const roleName = (roleId) => roles.find((r) => r.id === roleId)?.name || '\u2014';

  async function handleSave() {
    if (!selectedId || !draft) return;
    setSaving(true); setError(null);
    try {
      await updateDoc(doc(db, 'volunteers', selectedId), { roleRef: draft.roleRef || null, assignedAreas: draft.assignedAreas, assignedMandals: draft.assignedMandals });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-1">
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight mb-4">Volunteers</h1>
        <CreateVolunteerForm roles={roles} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or mobile" className="mb-3" />
        <div className="rounded-lg border border-slate-100 divide-y divide-slate-50 max-h-[70vh] overflow-y-auto">
          {filteredVolunteers.map((v) => (
            <button key={v.id} onClick={() => setSelectedId(v.id)} className={`flex w-full items-center gap-2.5 text-left px-3 py-2.5 text-sm hover:bg-slate-50 ${selectedId === v.id ? 'bg-slate-50 border-l-2 border-orange-500' : ''}`}>
              <Avatar name={v.name} size="sm" />
              <div>
                <div className="font-medium text-slate-900">{v.name || 'Unnamed'}</div>
                <div className="text-xs text-slate-400">{v.mobile || 'no number'} \u00b7 {roleName(v.roleRef)}</div>
              </div>
            </button>
          ))}
          {filteredVolunteers.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">No volunteers found.</div>}
        </div>
      </div>

      <div className="md:col-span-2">
        {!draft ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg p-12">
            Select a volunteer to edit their access.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-100 p-5 space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={draft.name} />
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900">{draft.name}</h2>
                <p className="text-sm text-slate-400">{draft.mobile}</p>
              </div>
            </div>

            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

            <div>
              <Label>Role</Label>
              <Select value={draft.roleRef} onChange={(e) => setDraft({ ...draft, roleRef: e.target.value })}>
                <option value="">\u2014 No role assigned \u2014</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <p className="mt-1 text-xs text-slate-400">Permissions come entirely from the assigned role.</p>
            </div>

            <TagInput label="Assigned Areas" values={draft.assignedAreas} onChange={(v) => setDraft({ ...draft, assignedAreas: v })} placeholder="Type an area, press Enter" />
            <TagInput label="Assigned Mandals" values={draft.assignedMandals} onChange={(v) => setDraft({ ...draft, assignedMandals: v })} placeholder="Type a mandal, press Enter" />

            <div className="pt-2 flex justify-end">
              <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? 'Saving\u2026' : 'Save changes'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function VolunteerEditor() {
  return (
    <RequirePermission permission="manage_users" fallback={<div className="p-6 text-sm text-slate-500">You don't have permission to manage volunteers.</div>}>
      <VolunteerEditorInner />
    </RequirePermission>
  );
}

export default VolunteerEditor;
