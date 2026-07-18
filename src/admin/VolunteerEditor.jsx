// src/admin/VolunteerEditor.jsx
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { X, KeyRound, Clock, Trash2, BarChart2, ChevronRight } from 'lucide-react';
import { db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { isValidPhone } from '../lib/authHelpers';
import { Input, Select, Label } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import Modal from '../components/ui/Modal';

function formatLastLogin(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Was a freeform text TagInput before — typing "Vaishali Nagar" here but
// the household's Area dropdown having saved "Vaishali nagar" (different
// case) or a trailing space meant `data.area in c.areas` in firestore.rules
// would never match, silently hiding every contact in that area with no
// error shown anywhere. This picks only from the actual saved Areas/
// Mandals list (same source as every other dropdown in the app), so what's
// assigned here can only ever be an exact match.
function AreaMandalPicker({ label, values, onChange, options }) {
  const available = options.filter((o) => !values.includes(o));
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 mb-1.5">
        {values.length === 0 && <span className="px-1 py-0.5 text-sm text-slate-400">None assigned</span>}
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="text-orange-400 hover:text-orange-700"><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <select
        value=""
        onChange={(e) => { if (e.target.value) onChange([...values, e.target.value]); }}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
        disabled={available.length === 0}
      >
        <option value="">{available.length === 0 ? 'All added' : `+ Add ${label.toLowerCase()}…`}</option>
        {available.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// 3.1 — create from existing contact
// FIX: previously fetched only the first 500 individuals (arbitrary
// Firestore document order, no orderBy) and searched only within that
// slice — with 2409 total contacts, most were never actually searchable,
// which is why a real, existing phone number could come back "No contacts
// found." Now fetches the full collection once (matches the pattern
// useAllContacts.js/ContactsPage already use successfully) and filters
// live in memory — also makes search instant-as-you-type instead of
// requiring a button click, since there's no per-keystroke network call.
function ContactSearchPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [allContacts, setAllContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    getDocs(collection(db, 'individuals'))
      .then((snap) => setAllContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((err) => setLoadError(err.message || 'Couldn\u2019t load contacts. Check your permissions.'))
      .finally(() => setLoading(false));
  }, []);

  const term = q.trim();
  const lower = term.toLowerCase();
  const results = term
    ? allContacts.filter((c) => c.name?.toLowerCase().includes(lower) || c.mobile?.includes(term)).slice(0, 30)
    : [];

  return (
    <div className="space-y-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={loading ? 'Loading contacts…' : 'Search by name or mobile…'}
        disabled={loading}
      />
      {results.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <Avatar name={c.name} size="sm" />
              <div>
                <div className="font-medium text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-400">{c.mobile || 'no number'}{c.area ? ` · ${c.area}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {loadError && <p className="text-xs text-rose-500">{loadError}</p>}
      {term && results.length === 0 && !loading && !loadError && (
        <p className="text-xs text-slate-400">No contacts found — try a different search.</p>
      )}
    </div>
  );
}

function CreateVolunteerForm({ roles, onCreated }) {
  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [pickedContact, setPickedContact] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', password: '', roleRef: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  function handlePick(contact) {
    setPickedContact(contact);
    setForm((f) => ({ ...f, name: contact.name || '', phone: contact.mobile || '' }));
  }

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
      await createVolunteerAccount({
        name: form.name.trim(),
        phone: form.phone.replace(/\D/g, ''),
        password: form.password,
        roleRef: form.roleRef || null,
        assignedAreas: [],
        assignedMandals: [],
        linkedIndividualId: mode === 'existing' && pickedContact ? pickedContact.id : null,
      });
      setForm({ name: '', phone: '', password: '', roleRef: '' });
      setPickedContact(null);
      setSuccess(true);
      onCreated?.();
    } catch (err) {
      setError(err.message || "Couldn’t create the volunteer login.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-dashed border-slate-200 p-4 space-y-3 mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Create volunteer login</h3>
        <div className="flex rounded-lg border border-slate-200 text-xs overflow-hidden">
          <button type="button" onClick={() => { setMode('new'); setPickedContact(null); }} className={`px-2.5 py-1 ${mode === 'new' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>New person</button>
          <button type="button" onClick={() => setMode('existing')} className={`px-2.5 py-1 ${mode === 'existing' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>From contact</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Volunteer created. Assign their areas/mandals below.</div>}

      {mode === 'existing' && !pickedContact && (
        <ContactSearchPicker onPick={handlePick} />
      )}

      {(mode === 'new' || pickedContact) && (
        <div className="space-y-3">
          {pickedContact && (
            <div className="flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2">
              <Avatar name={pickedContact.name} size="sm" />
              <div className="flex-1 text-sm font-medium text-orange-800">{pickedContact.name}</div>
              <button type="button" onClick={() => setPickedContact(null)} className="text-orange-400 hover:text-orange-700"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" disabled={Boolean(pickedContact)} />
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit phone" inputMode="numeric" disabled={Boolean(pickedContact && form.phone)} />
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Temporary password (6+ chars)" />
            <Select value={form.roleRef} onChange={(e) => setForm({ ...form, roleRef: e.target.value })}>
              <option value="">No role yet</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
          <Button type="submit" variant="accent" disabled={saving}>{saving ? 'Creating…' : 'Create login'}</Button>
        </div>
      )}

      <p className="text-xs text-slate-400">Share the phone number and temporary password with the volunteer directly.</p>
    </form>
  );
}

// 3.2 — reset password modal
function ResetPasswordModal({ volunteer, onClose }) {
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleReset() {
    if (newPassword.length < 6) return setError('Password must be at least 6 characters.');
    setError(null); setBusy(true);
    try {
      const functions = getFunctions();
      const resetVolunteerPassword = httpsCallable(functions, 'resetVolunteerPassword');
      await resetVolunteerPassword({ volunteerId: volunteer.id, newPassword });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Password reset failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password — ${volunteer.name}`} size="sm">
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Password updated. Share the new password with the volunteer directly.</div>
          <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Close</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Set a new temporary password for <span className="font-medium text-slate-700">{volunteer.name}</span>.</p>
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (6+ chars)" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="accent" onClick={handleReset} disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function VolunteerEditorInner() {
  const [volunteers, setVolunteers] = useState([]);
  const [roles, setRoles] = useState([]);
  const { areas, mandals } = useAreasAndMandals();
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterArea, setFilterArea] = useState('');
  const [filterMandal, setFilterMandal] = useState('');
  const [showStats, setShowStats] = useState(true);
  const [resetTarget, setResetTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  const roleName = (roleId) => roles.find((r) => r.id === roleId)?.name || '—';

  const filteredVolunteers = useMemo(() => {
    let result = volunteers;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((v) => (v.name || '').toLowerCase().includes(q) || (v.mobile || '').includes(q));
    if (filterArea) result = result.filter((v) => v.assignedAreas?.includes(filterArea));
    if (filterMandal) result = result.filter((v) => v.assignedMandals?.includes(filterMandal));
    return result;
  }, [volunteers, search, filterArea, filterMandal]);

  const roleStats = useMemo(() => {
    const counts = {};
    volunteers.forEach((v) => { const name = roleName(v.roleRef); counts[name] = (counts[name] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [volunteers, roles]);

  const mandalStats = useMemo(() => {
    const counts = {};
    volunteers.forEach((v) => {
      if (v.assignedMandals?.length) v.assignedMandals.forEach((m) => { counts[m] = (counts[m] || 0) + 1; });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [volunteers]);

  async function handleSave() {
    if (!selectedId || !draft) return;
    setSaving(true); setError(null);
    try {
      await updateDoc(doc(db, 'volunteers', selectedId), {
        name: draft.name.trim(),
        mobile: draft.mobile.trim(),
        roleRef: draft.roleRef || null,
        assignedAreas: draft.assignedAreas,
        assignedMandals: draft.assignedMandals,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedVolunteer = volunteers.find((v) => v.id === selectedId);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Try calling the Cloud Function to also delete the Firebase Auth user.
      // If the function doesn't exist yet, fall back to just deleting the Firestore doc.
      try {
        const functions = getFunctions();
        const deleteVolunteerAccount = httpsCallable(functions, 'deleteVolunteerAccount');
        await deleteVolunteerAccount({ volunteerId: deleteTarget.id });
      } catch {
        // Function not deployed — delete Firestore doc only
        await deleteDoc(doc(db, 'volunteers', deleteTarget.id));
      }
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (err) {
      setError(err.message || 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-1">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Volunteers</h1>
          <span className="text-xs text-slate-400">{volunteers.length} total</span>
        </div>

        {/* Stats overview */}
        {volunteers.length > 0 && (
          <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50">
            <button onClick={() => setShowStats((s) => !s)} className="flex w-full items-center justify-between px-3 py-2 text-left">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <BarChart2 className="h-3.5 w-3.5" /> Overview
              </span>
              <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${showStats ? 'rotate-90' : ''}`} />
            </button>
            {showStats && (
              <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1.5">By role</p>
                  <div className="flex flex-wrap gap-1.5">
                    {roleStats.map(([role, count]) => (
                      <span key={role} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700">
                        <span className="font-semibold text-slate-900">{count}</span> {role}
                      </span>
                    ))}
                  </div>
                </div>
                {mandalStats.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1.5">By mandal</p>
                    <div className="flex flex-wrap gap-1.5">
                      {mandalStats.map(([mandal, count]) => (
                        <span key={mandal} className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                          <span className="font-semibold">{count}</span> {mandal}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <CreateVolunteerForm roles={roles} />

        {/* Search + filters */}
        <div className="space-y-2 mb-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or mobile" />
          <div className="grid grid-cols-2 gap-2">
            <select value={filterArea} onChange={(e) => setFilterArea(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-300">
              <option value="">All areas</option>
              {areas.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
            <select value={filterMandal} onChange={(e) => setFilterMandal(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-300">
              <option value="">All mandals</option>
              {mandals.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          {(filterArea || filterMandal) && (
            <button onClick={() => { setFilterArea(''); setFilterMandal(''); }} className="text-xs text-orange-600 hover:underline">
              Clear filters · {filteredVolunteers.length} shown
            </button>
          )}
        </div>

        <div className="rounded-lg border border-slate-100 divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
          {filteredVolunteers.map((v) => {
            const lastLogin = formatLastLogin(v.lastLoginAt);
            const isRecent = v.lastLoginAt && (Date.now() - (v.lastLoginAt.toDate?.() ?? new Date(v.lastLoginAt)).getTime()) < 24 * 60 * 60 * 1000;
            return (
              <div key={v.id} className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-slate-50 ${selectedId === v.id ? 'bg-slate-50 border-l-2 border-orange-500' : ''}`}>
                <button onClick={() => setSelectedId(v.id)} className="flex flex-1 items-center gap-2.5 text-left min-w-0">
                  <Avatar name={v.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 truncate">{v.name || 'Unnamed'}</div>
                    <div className="text-xs text-slate-400 truncate">{v.mobile || 'no number'} · {roleName(v.roleRef)}</div>
                    {lastLogin ? (
                      <div className={`flex items-center gap-1 text-xs mt-0.5 ${isRecent ? 'text-emerald-600' : 'text-slate-300'}`}>
                        <Clock className="h-3 w-3" /> {lastLogin}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-300 mt-0.5">Never logged in</div>
                    )}
                  </div>
                </button>
                <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(v); }}
                  className="shrink-0 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500" aria-label={`Remove ${v.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {filteredVolunteers.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-slate-400">No volunteers found.</div>
          )}
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
              <Avatar name={draft.name || selectedVolunteer?.name} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 truncate">{selectedVolunteer?.name || 'Volunteer'}</div>
                {selectedVolunteer?.lastLoginAt ? (
                  <div className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" /> Last login {formatLastLogin(selectedVolunteer.lastLoginAt)}
                  </div>
                ) : (
                  <div className="text-xs text-slate-300 mt-0.5">Never logged in</div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setResetTarget(selectedVolunteer)}>
                  <KeyRound className="h-3.5 w-3.5" /> Reset password
                </Button>
                <Button variant="danger" size="sm" onClick={() => setDeleteTarget(selectedVolunteer)}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </div>

            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full name" />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} placeholder="10-digit mobile" inputMode="numeric" />
              </div>
            </div>

            <div>
              <Label>Role</Label>
              <Select value={draft.roleRef} onChange={(e) => setDraft({ ...draft, roleRef: e.target.value })}>
                <option value="">— No role assigned —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <p className="mt-1 text-xs text-slate-400">Permissions come entirely from the assigned role.</p>
            </div>

            <AreaMandalPicker label="Assigned Areas" values={draft.assignedAreas} onChange={(v) => setDraft({ ...draft, assignedAreas: v })} options={areas.map((a) => a.name)} />
            <AreaMandalPicker label="Assigned Mandals" values={draft.assignedMandals} onChange={(v) => setDraft({ ...draft, assignedMandals: v })} options={mandals.map((m) => m.name)} />

            <div className="pt-2 flex justify-end">
              <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </div>
        )}
      </div>

      {resetTarget && (
        <ResetPasswordModal volunteer={resetTarget} onClose={() => setResetTarget(null)} />
      )}

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Remove volunteer?" size="sm">
        <p className="text-sm text-slate-500">
          This removes <span className="font-medium text-slate-700">{deleteTarget?.name}</span> as a volunteer and revokes their login access. This cannot be undone.
        </p>
        {error && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setDeleteTarget(null); setError(null); }}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Removing…' : 'Remove volunteer'}
          </Button>
        </div>
      </Modal>
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
