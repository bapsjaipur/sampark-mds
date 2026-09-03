// src/admin/VolunteerEditor.jsx
//
// PHASE 21 — a volunteer can hold MULTIPLE roles, and their area/mandal
// assignment is now what gives those roles something to act on.
//
// The two halves are deliberately separate: the ROLE decides the SHAPE of what
// someone sees (their whole area, their whole mandal, or just the one cell where
// the two cross) and the volunteer's assigned areas/mandals decide WHICH ones.
// That is why one "Moderator (Area head)" role can serve all 17 area heads
// instead of needing 17 near-identical roles.
//
// `roleRefs[]` is the stored field. `roleRef` is still written, pointing at the
// most senior role, because firestore.rules cannot loop an array doing a get()
// per element (10 get()/exists() per request, no map/reduce) — so the rules stay
// a conservative subset of what this screen grants.
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { X, KeyRound, Clock, Trash2, Check, Eye, AlertTriangle, ShieldAlert, Search, Users, Wifi, Download, FileText, UserPlus } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { useAllContacts } from '../hooks/useAllContacts';
import { useVolunteers } from '../hooks/useVolunteers';
import { isValidPhone } from '../lib/authHelpers';
import { Input, Select, Label } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import ChipMultiSelect from '../components/ui/ChipMultiSelect';
import Modal from '../components/ui/Modal';
import { resolveScope, describeScope, statedScopeKind, roleStatedScopeKind, inferScopeKind, SCOPE_KINDS, SCOPE_KIND_META } from '../lib/scope';
import { DEFAULT_ROLE_RANK, isSantoRole } from '../constants/roleTemplates';
import { expandLegacyPermissions, isLegacyRole } from '../constants/permissions';
import { buildVolunteerRows, computeVolunteerStats, exportVolunteerCsv, exportVolunteerPdf } from '../lib/volunteerExports';
import { cn } from '../lib/cn';

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

function rankOf(role) {
  return Number.isFinite(role?.rank) ? role.rank : DEFAULT_ROLE_RANK;
}

/** Timestamp | Date | string | null → epoch ms, 0 when unusable. */
function toMillis(ts) {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.toDate) return ts.toDate().getTime();
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * "This callable isn't deployed yet" — which does NOT arrive as
 * `functions/not-found`, despite the obvious guess.
 *
 * A missing function 404s the CORS *preflight*, so the browser never gets to make
 * the real call: it reports a network failure and the SDK turns that into
 * `functions/internal` with the bare message "internal". (Verified against this
 * project before the Phase 22 functions were deployed.) Our own
 * HttpsError('internal', …) always carries a real sentence, so the two are
 * distinguishable — and it matters, because "not deployed" is fixed by a deploy
 * while everything else is not.
 */
function isCallableMissing(err) {
  if (err?.code === 'functions/not-found') return true;
  return err?.code === 'functions/internal'
    && /^internal$/i.test(String(err?.message || '').trim());
}

/** roleRefs[] is authoritative; roleRef is the pre-Phase-21 single-role field. */
function roleIdsOf(v) {
  const many = Array.isArray(v?.roleRefs) ? v.roleRefs.filter(Boolean) : [];
  if (many.length) return [...new Set(many)];
  return v?.roleRef ? [v.roleRef] : [];
}

const DAY = 86400000;

/**
 * PHASE 25 — the roster views, in the same idiom as the Reminders board: the
 * summary numbers ARE the filter, so "4 never signed in" is one tap away from the
 * list of those four instead of a number you then have to go hunting for.
 *
 * `never` and `disabled` are the two that earn their place. An account created
 * with a password that never reached the person looks identical to a working one
 * on the old flat list, and a disabled login is only marked by 50% opacity.
 */
const VIEWS = [
  { key: 'all', label: 'All', Icon: Users, tone: 'slate', test: () => true },
  { key: 'live', label: 'Online now', Icon: Wifi, tone: 'emerald', test: (r) => r.isLive },
  { key: 'week', label: 'This week', Icon: Clock, tone: 'orange', test: (r) => r.lastLogin && Date.now() - r.lastLogin.getTime() < 7 * DAY },
  { key: 'never', label: 'Never in', Icon: AlertTriangle, tone: 'rose', test: (r) => !r.lastLogin },
  { key: 'disabled', label: 'Disabled', Icon: ShieldAlert, tone: 'slate', test: (r) => !r.isActive },
];

const TILE_ACTIVE = {
  slate: 'border-slate-300 bg-slate-50 ring-1 ring-slate-200',
  emerald: 'border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-100',
  orange: 'border-orange-300 bg-orange-50/70 ring-1 ring-orange-100',
  rose: 'border-rose-300 bg-rose-50/70 ring-1 ring-rose-100',
};

const TILE_ICON = {
  slate: 'text-slate-400',
  emerald: 'text-emerald-500',
  orange: 'text-orange-500',
  rose: 'text-rose-500',
};

function StatTile({ view, count, active, onClick }) {
  const { Icon } = view;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-xl border px-2.5 py-2 text-left transition-colors sm:px-3 sm:py-2.5',
        active ? TILE_ACTIVE[view.tone] : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50',
      )}
    >
      <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
        <Icon className={cn('h-3 w-3 shrink-0', TILE_ICON[view.tone])} />
        <span className="truncate">{view.label}</span>
      </span>
      <span className="mt-0.5 block text-lg font-semibold tabular-nums text-slate-900 sm:text-xl">{count}</span>
    </button>
  );
}

/**
 * MULTIPLE ROLES PER VOLUNTEER.
 *
 * Not a <select multiple>: ctrl-click does not exist on a phone, and this screen
 * is used on one. Each role is a tap target showing what it actually grants, so
 * "Moderator + Karyakarta" is a visible combination rather than two highlighted
 * lines in a scroll box.
 *
 * Permissions across roles are a UNION, and the scope taken is the WIDEST — so
 * adding a role can only ever add access. Stated on screen because the opposite
 * assumption ("the narrower one wins") is a reasonable guess.
 */
function RolePicker({ roles, values, onChange }) {
  const sorted = useMemo(
    () => [...roles].sort((a, b) => rankOf(b) - rankOf(a) || (a.name || '').localeCompare(b.name || '')),
    [roles],
  );

  function toggle(id) {
    onChange(values.includes(id) ? values.filter((x) => x !== id) : [...values, id]);
  }

  return (
    <div>
      <Label>Roles</Label>
      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
          No roles exist yet — create them on the Roles tab first.
        </p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((r) => {
            const on = values.includes(r.id);
            const kind = SCOPE_KIND_META[roleStatedScopeKind(r)] || null;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                aria-pressed={on}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                  on ? 'border-orange-300 bg-orange-50/70' : 'border-slate-200 bg-white hover:bg-slate-50',
                )}
              >
                <span className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  on ? 'border-orange-600 bg-orange-600' : 'border-slate-300 bg-white',
                )}>
                  {on && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[13px] font-medium', on ? 'text-orange-900' : 'text-slate-800')}>
                    {r.name}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {kind ? kind.short : 'Scope not set'} · {(r.permissions || []).length} permissions
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                  {rankOf(r)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-1.5 text-xs text-slate-400">
        More than one role is allowed. Permissions are combined, and the widest scope wins — so adding
        a role only ever grants more, never less.
      </p>
    </div>
  );
}

/**
 * What this volunteer will ACTUALLY see once saved — computed with the same
 * resolveScope() the app itself uses at runtime, so this is not a second
 * description that can drift from the real behaviour.
 *
 * Exists because the failure it catches is invisible otherwise: a role scoped to
 * an area, on a volunteer with no areas assigned, produces an empty everything
 * and no error anywhere.
 */
function ScopePreview({ selectedRoles, assignedAreas, assignedMandals }) {
  const permissions = useMemo(() => Array.from(new Set(
    selectedRoles.flatMap((r) => {
      const own = Array.isArray(r.permissions) ? r.permissions : [];
      return isLegacyRole(r) ? expandLegacyPermissions(own) : own;
    }),
  )), [selectedRoles]);

  const scope = useMemo(
    () => resolveScope({
      roles: selectedRoles,
      volunteer: { assignedAreas, assignedMandals },
      permissions,
    }),
    [selectedRoles, assignedAreas, assignedMandals, permissions],
  );

  const meta = SCOPE_KIND_META[scope.kind];
  const needsAreas = meta?.uses.includes('areas') && assignedAreas.length === 0;
  const needsMandals = meta?.uses.includes('mandals') && assignedMandals.length === 0;
  // NONE is empty by design — a Santo reads no contacts and that is the correct
  // answer, not a misconfiguration. Only a SCOPED role with nothing assigned is
  // broken, which is the case this panel exists to catch.
  const broken = !scope.unrestricted && scope.empty && scope.kind !== SCOPE_KINDS.NONE;

  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5',
      broken ? 'border-amber-200 bg-amber-50' : 'border-sky-100 bg-sky-50/70',
    )}>
      <p className={cn(
        'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider',
        broken ? 'text-amber-700' : 'text-sky-700',
      )}>
        {broken ? <AlertTriangle className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        This volunteer will see
      </p>
      <p className={cn('mt-1 text-[13px] font-medium', broken ? 'text-amber-900' : 'text-sky-900')}>
        {selectedRoles.length === 0 ? 'Nothing — no role assigned, so they cannot use the app.' : describeScope(scope)}
      </p>
      {selectedRoles.length > 0 && !scope.unrestricted && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {meta.help}
          {needsAreas && <span className="block font-medium text-amber-700">Assign at least one area below, or they will see nothing.</span>}
          {needsMandals && <span className="block font-medium text-amber-700">Assign at least one mandal below, or they will see nothing.</span>}
        </p>
      )}
    </div>
  );
}


// 3.1 — create from existing contact
// FIX: previously fetched only the first 500 individuals (arbitrary
// Firestore document order, no orderBy) and searched only within that
// slice — with 2409 total contacts, most were never actually searchable,
// which is why a real, existing phone number could come back "No contacts
// found." Now the whole list is searched and filtered live in memory, so
// search is instant-as-you-type instead of a per-keystroke network call.
//
// PHASE 25 — READS. That fix replaced 500 unmetered reads with 3,100 unmetered
// reads, on a picker that is opened and closed while deciding whether to create a
// volunteer at all. It now goes through useAllContacts, which means:
//   • the listener is SHARED with Contacts and Data Integrity, so opening this
//     picker minutes after visiting Contacts costs nothing at all;
//   • the spend is metered, so it shows up on the quota tile in Admin Tools;
//   • there is one "load the contacts" code path in the app instead of two.
function ContactSearchPicker({ onPick }) {
  const [q, setQ] = useState('');
  const { contacts: allContacts, loading, error } = useAllContacts();
  const loadError = error
    ? (error.message || 'Couldn’t load contacts. Check your permissions.')
    : null;

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
              <Avatar src={c.profilePhotoURL} name={c.name} size="sm" />
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
  // PHASE 25 — collapsed by default. Expanded, this form is ~330px tall and sat
  // permanently between the page header and the roster, so on a phone every visit
  // to this screen started with scrolling past a form you almost never wanted:
  // 22 volunteers already exist and are edited far more often than new ones are
  // created.
  const [open, setOpen] = useState(false);
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
        // Sent as an array even from this single-select: a volunteer starts with
        // one role and picks up more from the editor below, and the function
        // stores roleRefs[] either way.
        roleRefs: form.roleRef ? [form.roleRef] : [],
        roleRef: form.roleRef || null,
        // Denormalised scope shape — see the comment in handleSave(). A new
        // volunteer has no territory yet, so this only decides HOW their areas
        // and mandals will be read once an admin assigns them. Sent as null when
        // the role states nothing, so firestore.rules infers the shape from the
        // assignment instead of being pinned to the widest one for ever.
        scopeKind: statedScopeKind(
          [roleStatedScopeKind(roles.find((r) => r.id === form.roleRef))],
        ),
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:border-orange-200 hover:bg-orange-50/50 hover:text-orange-700"
      >
        <UserPlus className="h-4 w-4" /> Create volunteer login
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-xl border border-dashed border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Create volunteer login</h3>
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs">
            <button type="button" onClick={() => { setMode('new'); setPickedContact(null); }} className={`px-2.5 py-1 ${mode === 'new' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>New person</button>
            <button type="button" onClick={() => setMode('existing')} className={`px-2.5 py-1 ${mode === 'existing' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>From contact</button>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close create form">
            <X className="h-3.5 w-3.5" />
          </button>
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
              <Avatar src={pickedContact.profilePhotoURL} name={pickedContact.name} size="sm" />
              <div className="flex-1 text-sm font-medium text-orange-800">{pickedContact.name}</div>
              <button type="button" onClick={() => setPickedContact(null)} className="text-orange-400 hover:text-orange-700"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
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
      setError(isCallableMissing(err)
        ? 'The password reset function is not deployed on this project yet. Run: '
          + 'firebase deploy --only functions'
        : (err.message || 'Password reset failed.'));
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

// 3.3 — pending password-reset requests
//
// PHASE 22 — the approval half of the reset flow.
//
// The login screen's "Forgot?" used to set the account password to the mobile
// number that had just been typed in, which made every volunteer's account
// openable by anyone who could read a contact list. It now writes a row here
// instead and changes nothing. That only helps if an admin can actually SEE the
// row — a locked-out karyakarta with an invisible request is worse off than
// before — so this panel is part of the fix, not decoration.
//
// Approve reuses ResetPasswordModal: the same admin-only callable both sets the
// password and closes the request server-side, so there is exactly one code path
// that can change a password. Deny is a plain client write, which the rules allow
// for a manage_users holder.
function PendingResetRequests({ volunteers, onApprove }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    // No orderBy and no where: requestedAt is a serverTimestamp, so it reads back
    // as null for a moment on a brand-new document and an orderBy would hide the
    // newest request — the one that matters most. The collection cannot grow past
    // one document per volunteer mobile (the function uses the phone as the doc
    // id and refuses unknown numbers), so reading it whole stays cheap.
    return onSnapshot(
      collection(db, 'passwordResets'),
      (snap) => {
        setRequests(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .filter((r) => r.status === 'pending')
            .sort((a, b) => toMillis(b.requestedAt) - toMillis(a.requestedAt)),
        );
        setError(null);
      },
      (err) => setError(err?.code === 'permission-denied'
        ? 'Password reset requests can’t be read yet — the rules for the "passwordResets" '
          + 'collection are not deployed. Run: firebase deploy --only firestore:rules'
        : (err?.message || 'Could not load password reset requests.')),
    );
  }, []);

  async function deny(req) {
    setBusyId(req.id);
    try {
      await updateDoc(doc(db, 'passwordResets', req.id), {
        status: 'denied',
        resolvedAt: serverTimestamp(),
        resolvedBy: auth.currentUser?.uid || null,
      });
    } catch (err) {
      setError(err?.message || 'Could not update the request.');
    } finally {
      setBusyId(null);
    }
  }

  if (!requests.length && !error) return null;

  return (
    <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50/60">
      <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2 sm:px-4">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-[13px] font-semibold text-amber-900">
          Password reset requests
          {requests.length > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
              {requests.length}
            </span>
          )}
        </span>
      </div>

      {error && (
        <div className="border-b border-amber-200 px-3 py-2 text-xs text-rose-700 sm:px-4">{error}</div>
      )}

      {requests.length > 0 && (
        <>
          <p className="px-3 pt-2.5 text-xs text-amber-800 sm:px-4">
            These volunteers said they are locked out. Confirm it is really them — by phone, or in
            person — then set a new password and pass it on directly. Nothing changes until you do.
          </p>
          <div className="divide-y divide-amber-200/70">
            {requests.map((req) => {
              const volunteer = volunteers.find((v) => v.id === req.volunteerId);
              const when = formatLastLogin(req.requestedAt);
              return (
                <div key={req.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {volunteer?.name || req.volunteerName || 'Unknown volunteer'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {req.mobile || req.id}
                      {when ? ` · asked ${when}` : ''}
                      {req.requestCount > 1 ? ` · ${req.requestCount} requests` : ''}
                    </div>
                    {!volunteer && (
                      <div className="mt-0.5 text-xs text-rose-600">
                        No volunteer record matches this request — it can only be denied.
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!volunteer || busyId === req.id}
                      onClick={() => onApprove(volunteer)}
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Set password
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busyId === req.id} onClick={() => deny(req)}>
                      {busyId === req.id ? 'Saving…' : 'Deny'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function VolunteerEditorInner() {
  // PHASE 24 — the roster comes from the shared listener (see useVolunteers), so
  // this screen, Roles, Batches, Events and the Admin dashboard bill it once
  // between them instead of once each.
  const { volunteers } = useVolunteers();
  const [roles, setRoles] = useState([]);
  const { areas, mandals } = useAreasAndMandals();
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [filterArea, setFilterArea] = useState('');
  const [filterMandal, setFilterMandal] = useState('');
  const [statusView, setStatusView] = useState('all');
  const [resetTarget, setResetTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsubRoles = onSnapshot(collection(db, 'roles'), (snap) => setRoles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => { unsubRoles(); };
  }, []);

  useEffect(() => {
    if (!selectedId) { setDraft(null); return; }
    const v = volunteers.find((x) => x.id === selectedId);
    if (v) {
      setDraft({
        name: v.name || '',
        mobile: v.mobile || '',
        reportEmail: v.reportEmail || '',
        roleRefs: roleIdsOf(v),
        isActive: v.isActive !== false, // default to true
        assignedAreas: Array.isArray(v.assignedAreas) ? v.assignedAreas : [],
        assignedMandals: Array.isArray(v.assignedMandals) ? v.assignedMandals : [],
        // PHASE 30 — program assignment (Yuvak or Bal Mandal). Defaults to Yuvak
        // for existing volunteers with no program field, so nothing breaks.
        program: v.program || 'Yuvak',
      });
    }
  }, [selectedId, volunteers]);

  const rolesById = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r])), [roles]);

  /**
   * PHASE 25 — ONE derivation feeding the roster, the tiles, the CSV and the PDF.
   *
   * buildVolunteerRows() already resolves roles, the access shape (via the same
   * resolveScope() the app scopes queries with) and the login timestamps, so the
   * printed report cannot disagree with what is on screen — which was the whole
   * risk in adding an export: a PDF that says someone is an Area head when the
   * app treats them as a karyakarta is worse than no PDF.
   */
  const allRows = useMemo(() => buildVolunteerRows({ volunteers, rolesById }), [volunteers, rolesById]);

  /** Santo logins live in this collection but are not karyakartas — city-wide, like
   *  an Admin. Split out here so the header count matches the PDF's, which counts
   *  the same way. The list below still shows them: this screen is where you go to
   *  manage a Santo's login, so hiding them would be the wrong kind of tidy. */
  const santoCount = useMemo(() => allRows.filter((r) => r.isSanto).length, [allRows]);
  const karyakartaCount = allRows.length - santoCount;

  /** Search + area + mandal, but NOT the status tiles — the tile counts below are
   *  taken from this, so they describe the subset you are actually looking at. */
  const scopedRows = useMemo(() => {
    let result = allRows;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((r) => r.name.toLowerCase().includes(q) || r.mobile.includes(q));
    if (filterArea) result = result.filter((r) => r.areas.includes(filterArea));
    if (filterMandal) result = result.filter((r) => r.mandals.includes(filterMandal));
    return result;
  }, [allRows, search, filterArea, filterMandal]);

  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.key, scopedRows.filter(v.test).length])),
    [scopedRows],
  );

  const currentView = VIEWS.find((v) => v.key === statusView) || VIEWS[0];
  const visibleRows = useMemo(() => scopedRows.filter(currentView.test), [scopedRows, currentView]);

  const areaNames = useMemo(() => areas.map((a) => a.name), [areas]);
  const mandalNames = useMemo(() => mandals.map((m) => m.name), [mandals]);

  /** What the reader of the export is looking at, printed on both the CSV meta
   *  block and the PDF header — a filtered roster that says nothing about its
   *  filter is the kind of document that gets acted on wrongly a month later. */
  const filterLabel = useMemo(() => {
    const bits = [];
    if (statusView !== 'all') bits.push(currentView.label);
    if (filterArea) bits.push(`Area: ${filterArea}`);
    if (filterMandal) bits.push(`Mandal: ${filterMandal}`);
    if (search.trim()) bits.push(`Search: "${search.trim()}"`);
    return bits.join('  ·  ');
  }, [statusView, currentView, filterArea, filterMandal, search]);

  const exportStats = useMemo(
    () => computeVolunteerStats({
      rows: visibleRows,
      // The DOCUMENTS, not just the names — the PDF's area section lists each
      // area's sub-areas and codes, which only exist on the document.
      areas,
      mandals,
      // Coverage is measured against everyone, never the filtered subset.
      coverageRows: allRows,
    }),
    [visibleRows, areas, mandals, allRows],
  );

  /** On a phone the editor is BELOW a scrolling roster, so tapping a name used to
   *  look like nothing happened. */
  function selectVolunteer(id) {
    setSelectedId(id);
    setError(null);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      requestAnimationFrame(() => {
        document.getElementById('volunteer-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  async function handleSave() {
    if (!selectedId || !draft) return;
    setSaving(true); setError(null);

    // firestore.rules reads the single `roleRef`, so it is kept pointing at the
    // most senior selected role — rules then enforce a subset of what this screen
    // grants rather than more than it.
    const selected = draft.roleRefs.map((id) => rolesById[id]).filter(Boolean);
    const primaryRole = [...selected].sort((a, b) => rankOf(b) - rankOf(a))[0];

    // …with one exception, denormalised here: the SCOPE SHAPE. With several
    // roles the UI honours the widest of their scopeKinds, but rules can only
    // read one role document (no array iteration, 10 get() cap), so an Area head
    // who is also a Mandal head would be granted UNION by the screen and only
    // AREA by the server — writes would fail with "insufficient permissions"
    // for no visible reason. Stamping the resolved shape on the volunteer lets
    // ctx() read it directly. Only a manage_users holder can write this field,
    // which is the same trust level as changing roleRef, so it adds no new
    // escalation path.
    //
    // PHASE 23: when none of the roles states a shape, the INFERRED one is
    // stamped rather than a blanket 'union' — the same inference resolveScope()
    // and firestore.rules now use. Stamping it makes this volunteer's shape
    // explicit from here on, so it stops depending on the fallback at all.
    const scopeKind = statedScopeKind(selected.map(roleStatedScopeKind))
      || inferScopeKind({ areas: draft.assignedAreas, mandals: draft.assignedMandals });

    // SANTOS ARE SELF-CLEANING (same spirit as the Phase 23 stamp above). A Santo
    // serves all of Jaipur and holds no territory, so any area/mandal left on the
    // record from a previous role is stale data — and stale data here is not
    // harmless: it puts them in the coverage report as the karyakarta for an area
    // nobody is actually covering. The UI shows what will be dropped before Save,
    // so this is carrying out a stated intention, not a silent deletion. NONE is
    // stamped explicitly rather than inferred, so firestore.rules reads the same
    // shape the screen does.
    const santo = draftIsSanto;
    const assignedAreas = santo ? [] : draft.assignedAreas;
    const assignedMandals = santo ? [] : draft.assignedMandals;
    const savedScopeKind = santo ? SCOPE_KINDS.NONE : scopeKind;

    try {
      const functions = getFunctions();
      const updateVolunteerAccount = httpsCallable(functions, 'updateVolunteerAccount');
      await updateVolunteerAccount({
        volunteerId: selectedId,
        name: draft.name.trim(),
        mobile: draft.mobile.trim(),
        reportEmail: draft.reportEmail.trim(),
        roleRefs: draft.roleRefs,
        roleRef: primaryRole?.id || null,
        scopeKind: savedScopeKind,
        assignedAreas,
        assignedMandals,
        isActive: draft.isActive,
        // PHASE 30 — program assignment
        program: draft.program || 'Yuvak',
      });

      // The callable is the intended path — it also syncs the Auth email when the
      // mobile changes. This second, tiny write exists because a Cloud Functions
      // deploy is a separate step: an OLD deployed updateVolunteerAccount simply
      // ignores `roleRefs` (update() drops keys it wasn't given), so multi-role
      // would report "Saved" and change nothing — the exact silent-drop bug the
      // isActive switch had. firestore.rules already permits this write for a
      // manage_users holder, so it is safe either way and idempotent once the
      // functions are redeployed.
      await updateDoc(doc(db, 'volunteers', selectedId), {
        roleRefs: draft.roleRefs,
        roleRef: primaryRole?.id || null,
        scopeKind: savedScopeKind,
        program: draft.program || 'Yuvak',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedVolunteer = volunteers.find((v) => v.id === selectedId);
  const selectedRoleDocs = useMemo(
    () => (draft?.roleRefs || []).map((id) => rolesById[id]).filter(Boolean),
    [draft?.roleRefs, rolesById],
  );

  /**
   * Is the account being edited a Santo — city-wide, like an Admin, with no area
   * or mandal of its own?
   *
   * EVERY role must be a Santo role, not just one of them. Someone who holds Santo
   * AND Karyakarta genuinely does have a territory for the karyakarta half of their
   * seva, and hiding the pickers would strand them with nothing to see.
   *
   * Read off the DRAFT, not the stored document, so the pickers vanish the moment
   * the role is changed — before Save, while the admin can still see why.
   */
  const draftIsSanto = useMemo(() => {
    if (!selectedRoleDocs.length) return false;
    return selectedRoleDocs.every((r) => isSantoRole({
      scopeKind: r?.scopeKind || null,
      permissions: isLegacyRole(r)
        ? expandLegacyPermissions(r.permissions || [])
        : (r.permissions || []),
    }));
  }, [selectedRoleDocs]);

  // Assignments already on the record that this role has no use for. Shown as a
  // warning rather than cleared silently, because "Save quietly deleted the two
  // areas I set last month" is exactly the kind of surprise that stops people
  // trusting the screen.
  const santoStaleAssignments = draftIsSanto
    ? [...(draft?.assignedAreas || []), ...(draft?.assignedMandals || [])]
    : [];

  /**
   * PHASE 22 — the fallback is gone, and that is the whole fix.
   *
   * This used to call `deleteVolunteerAccount` — a function that had never been
   * written — catch the resulting error and quietly `deleteDoc()` the volunteer
   * record instead. So "Remove volunteer" always took the fallback: it deleted
   * the record and left the Firebase Auth login working, on a phone number that
   * no longer appears anywhere in this screen. That login can still sign in, and
   * nothing in the app can find it again to remove it.
   *
   * The callable now exists (functions/deleteVolunteerAccount.js) and deletes the
   * Auth user FIRST, so a failure cannot leave a working login behind. Any error
   * is therefore shown rather than swallowed — a delete that half-worked must not
   * look identical to one that worked.
   */
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'deleteVolunteerAccount');
      const res = await fn({ volunteerId: deleteTarget.id });
      const { batchesUnassigned = 0, contactsUnlinked = 0 } = res?.data || {};
      setNotice(
        `Removed ${deleteTarget.name || 'volunteer'} and their login.`
        + (batchesUnassigned ? ` ${batchesUnassigned} batch(es) went back to the unassigned pool.` : '')
        + (contactsUnlinked ? ` ${contactsUnlinked} contact record(s) unlinked.` : ''),
      );
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (err) {
      setError(isCallableMissing(err)
        ? 'The deleteVolunteerAccount function is not deployed yet, so their login cannot be '
          + 'removed. Nothing has been changed — deleting only the record here would leave a '
          + 'working password behind. Run: firebase deploy --only functions'
        : (err?.message || 'Delete failed.'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {notice && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 sm:px-4">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 rounded p-0.5 text-emerald-600 hover:bg-emerald-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <PendingResetRequests
        volunteers={volunteers}
        onApprove={(v) => { setNotice(null); setResetTarget(v); }}
      />

      {/* Header spans both columns. It used to sit inside the roster column, which
          on a phone meant the title, the count and (now) two export buttons were
          all competing for a third of the width. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Volunteers</h1>
          <p className="mt-1 text-sm text-slate-500">
            {karyakartaCount} karyakarta{karyakartaCount === 1 ? '' : 's'}
            {santoCount > 0 && ` · ${santoCount} Santo${santoCount === 1 ? '' : 's'} (city-wide)`}
            {visibleRows.length !== allRows.length && ` · ${visibleRows.length} shown`}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Exports take the FILTERED list on purpose — the useful document is
              usually "the karyakartas of one area", and the filter is printed on
              both files so the reader knows which list they are holding. */}
          <Button
            variant="secondary"
            size="sm"
            disabled={!visibleRows.length}
            onClick={() => exportVolunteerCsv({ rows: visibleRows, stats: exportStats, filterLabel })}
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!visibleRows.length}
            onClick={() => exportVolunteerPdf({ rows: visibleRows, stats: exportStats, filterLabel })}
          >
            <FileText className="h-3.5 w-3.5" /> PDF
          </Button>
        </div>
      </div>

      {/* The numbers are the filter. See the note on VIEWS. */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {VIEWS.map((v) => (
          <StatTile
            key={v.key}
            view={v}
            count={counts[v.key] ?? 0}
            active={statusView === v.key}
            // Tapping the active tile again goes back to everyone, so you can
            // never get stuck looking at an empty list with no obvious way out.
            onClick={() => setStatusView(statusView === v.key ? 'all' : v.key)}
          />
        ))}
      </div>

      {/* The one thing this data can say that no other screen can: which areas and
          mandals have nobody actively assigned to them. Invisible before, because a
          list of volunteers cannot show an area that has none. */}
      {(exportStats.uncoveredAreas.length > 0 || exportStats.stranded > 0) && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 sm:px-4">
          {exportStats.uncoveredAreas.length > 0 && (
            <p>
              <span className="font-semibold">
                {exportStats.uncoveredAreas.length} area{exportStats.uncoveredAreas.length === 1 ? '' : 's'} with nobody assigned:
              </span>{' '}
              {exportStats.uncoveredAreas.join(', ')}
            </p>
          )}
          {exportStats.stranded > 0 && (
            <p className={exportStats.uncoveredAreas.length > 0 ? 'mt-1' : ''}>
              <span className="font-semibold">{exportStats.stranded} active login{exportStats.stranded === 1 ? '' : 's'} can see nothing</span>
              {' '}— a scoped role with no area or mandal assigned yet.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <div className="md:col-span-1">
        <CreateVolunteerForm roles={roles} />

        {/* Search + filters */}
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or mobile"
              className="pl-8 pr-8"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {/* Bare <select>s before, so they didn't match any other control on the
                screen. Only rendered when there is something to choose. */}
            {areaNames.length > 0 && (
              <Select value={filterArea} onChange={(e) => setFilterArea(e.target.value)}>
                <option value="">All areas</option>
                {areaNames.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            )}
            {mandalNames.length > 0 && (
              <Select value={filterMandal} onChange={(e) => setFilterMandal(e.target.value)}>
                <option value="">All mandals</option>
                {mandalNames.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            )}
          </div>
          {(filterArea || filterMandal || search || statusView !== 'all') && (
            <button
              onClick={() => { setFilterArea(''); setFilterMandal(''); setSearch(''); setStatusView('all'); }}
              className="text-xs font-medium text-orange-600 hover:underline"
            >
              Clear filters · {visibleRows.length} shown
            </button>
          )}
        </div>

        <div className="max-h-[420px] divide-y divide-slate-50 overflow-y-auto rounded-xl border border-slate-100 md:max-h-[60vh]">
          {visibleRows.map((r) => (
            <div
              key={r.id}
              className={cn(
                'flex w-full items-start gap-1 px-2.5 py-2.5 text-sm transition-colors hover:bg-slate-50',
                selectedId === r.id && 'bg-orange-50/50',
                !r.isActive && 'opacity-60',
              )}
            >
              {/* A left rule rather than `border-l-2` on the row: the border used to
                  shift every line of text 2px right when selected. */}
              <span className={cn('-my-2.5 w-0.5 shrink-0 self-stretch rounded-full', selectedId === r.id ? 'bg-orange-500' : 'bg-transparent')} />
              <button onClick={() => selectVolunteer(r.id)} className="flex min-w-0 flex-1 items-center gap-2.5 pl-1.5 text-left">
                <div className="relative shrink-0">
                  <Avatar name={r.name} size="sm" />
                  {r.isLive && (
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-white bg-emerald-500" title="Online now" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-slate-900">{r.name}</span>
                    {!r.isActive && (
                      <span className="shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-medium text-slate-500">Disabled</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-400">{r.mobile || 'no number'} · {r.roleLabel}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {/* The access SHAPE, which nothing on this list showed before —
                        so "why can't she see her mandal" needed opening the editor.
                        A Santo gets its own amber chip: "None" read like a
                        misconfiguration when it is the correct answer for a
                        city-wide account. */}
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      r.isSanto ? 'bg-amber-50 text-amber-700'
                        : r.scopeEmpty ? 'bg-rose-50 text-rose-600'
                          : 'bg-slate-100 text-slate-500',
                    )}>
                      {r.isSanto ? 'Santo · city-wide' : r.scopeEmpty ? 'No territory' : r.accessShort}
                    </span>
                    {r.isLive ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Online
                      </span>
                    ) : r.lastLogin ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title={r.lastLoginExact}>
                        <Clock className="h-3 w-3" /> {r.lastLoginLabel}
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-rose-400">Never signed in</span>
                    )}
                  </div>
                </div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
                className="shrink-0 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                aria-label={`Remove ${r.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {visibleRows.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-slate-400">
              No volunteers match this filter.
            </div>
          )}
        </div>
      </div>

      <div className="md:col-span-2" id="volunteer-editor">
        {!draft ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 p-12 text-sm text-slate-400">
            Select a volunteer to edit their access.
          </div>
        ) : (
          <div className="space-y-5 rounded-xl border border-slate-100 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={draft.name || selectedVolunteer?.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-900">{selectedVolunteer?.name || 'Volunteer'}</div>
                {selectedVolunteer?.lastLoginAt ? (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600">
                    <Clock className="h-3 w-3" /> Last login {formatLastLogin(selectedVolunteer.lastLoginAt)}
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-slate-300">Never logged in</div>
                )}
              </div>
              {/* basis-full on a phone: side by side these two wrapped to two lines
                  each and the destructive one ended up under the thumb. */}
              <div className="flex basis-full gap-2 sm:basis-auto">
                <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={() => setResetTarget(selectedVolunteer)}>
                  <KeyRound className="h-3.5 w-3.5" /> Reset password
                </Button>
                <Button variant="danger" size="sm" className="flex-1 sm:flex-none" onClick={() => setDeleteTarget(selectedVolunteer)}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </div>

            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

            <div className="grid gap-4 sm:grid-cols-2">
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
              <Label>Report email</Label>
              <Input
                type="email"
                value={draft.reportEmail}
                onChange={(e) => setDraft({ ...draft, reportEmail: e.target.value })}
                placeholder="name@example.com"
                inputMode="email"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-slate-400">
                Optional. Where the automated daily, post-sabha and birthday reports are sent. This is
                <strong> not</strong> the login — volunteers still sign in with their mobile number. Leave it blank
                and this volunteer simply receives no report emails.
              </p>
            </div>

            <div>
              <Label>Program</Label>
              <Select
                value={draft.program || 'Yuvak'}
                onChange={(e) => setDraft({ ...draft, program: e.target.value })}
              >
                <option value="Yuvak">Yuvak (Youth)</option>
                <option value="Bal Mandal">Bal Mandal (Children)</option>
              </Select>
              <p className="mt-1 text-xs text-slate-400">
                Which program this volunteer works with. Determines which contacts and events they can see.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3 bg-slate-50/50">
              <div>
                <p className="text-sm font-semibold text-slate-800">Login Access</p>
                <p className="text-xs text-slate-400">If disabled, the volunteer will be logged out and cannot sign in.</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-orange-500 peer-checked:after:translate-x-full peer-checked:after:border-white focus:outline-none" />
              </label>
            </div>

            <RolePicker
              roles={roles}
              values={draft.roleRefs}
              onChange={(v) => setDraft({ ...draft, roleRefs: v })}
            />

            <div>
              <Label>Program</Label>
              <Select
                value={draft.program || 'Yuvak'}
                onChange={(e) => setDraft({ ...draft, program: e.target.value })}
              >
                <option value="Yuvak">Yuvak Mandal</option>
                <option value="Bal Mandal">Bal Mandal</option>
              </Select>
              <p className="mt-1 text-xs text-slate-400">
                Determines which program this volunteer manages.
              </p>
            </div>

            {/* A Santo is city-wide, like an Admin — the two pickers below are not
                just unnecessary for them, they are actively harmful: an area left
                on a Santo's record makes them the apparent karyakarta for it, so
                the coverage report calls that area staffed when nobody is working
                it. Replaced with a statement of fact rather than disabled controls,
                which only invite "why can't I set this". */}
            {draftIsSanto ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                  <ShieldAlert className="h-3 w-3" />
                  City-wide — no area or mandal
                </p>
                <p className="mt-1 text-[13px] font-medium text-amber-900">
                  Santo accounts serve the whole of Jaipur, so they are never assigned to an
                  area or a mandal. They are left out of the karyakarta roster and the area
                  and mandal coverage reports.
                </p>
                {santoStaleAssignments.length > 0 && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-amber-800">
                    Saving will clear the {santoStaleAssignments.length} assignment
                    {santoStaleAssignments.length === 1 ? '' : 's'} still on this record
                    ({santoStaleAssignments.join(', ')}) — left in place they would count as
                    coverage for territory nobody is actually working.
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* Was a freeform text TagInput before — typing "Vaishali Nagar" here
                    but the household's Area dropdown having saved "Vaishali nagar"
                    (different case) or a trailing space meant `data.area in c.areas`
                    in firestore.rules would never match, silently hiding every
                    contact in that area with no error shown anywhere. These pick only
                    from the actual saved Areas/Mandals list (same source as every
                    other dropdown in the app), so what's assigned here can only ever
                    be an exact match. */}
                <div>
                  <Label>Assigned areas <span className="font-normal text-slate-400">— from the household address</span></Label>
                  <ChipMultiSelect
                    options={areas.map((a) => a.name)}
                    value={draft.assignedAreas}
                    onChange={(v) => setDraft({ ...draft, assignedAreas: v })}
                    allLabel="areas"
                    emptyLabel="No areas defined yet — add them on the Areas & Mandals tab"
                  />
                </div>

                <div>
                  <Label>Assigned mandals <span className="font-normal text-slate-400">— from the individual</span></Label>
                  <ChipMultiSelect
                    options={mandals.map((m) => m.name)}
                    value={draft.assignedMandals}
                    onChange={(v) => setDraft({ ...draft, assignedMandals: v })}
                    allLabel="mandals"
                    emptyLabel="No mandals defined yet — add them on the Areas & Mandals tab"
                  />
                </div>
              </>
            )}

            <ScopePreview
              selectedRoles={selectedRoleDocs}
              assignedAreas={draft.assignedAreas}
              assignedMandals={draft.assignedMandals}
            />

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
