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
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Link } from 'react-router-dom';
import { X, KeyRound, Clock, Trash2, Check, Eye, AlertTriangle, ShieldAlert, Search, Users, Wifi, Download, FileText, UserPlus, Smartphone, Link2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { useAllContacts } from '../hooks/useAllContacts';
import { useVolunteers } from '../hooks/useVolunteers';
import { usePresence } from '../hooks/usePresence';
import { useAuth } from '../hooks/usePermissions';
import { isValidPhone } from '../lib/authHelpers';
import { Input, Select, Label } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import ChipMultiSelect from '../components/ui/ChipMultiSelect';
import Modal from '../components/ui/Modal';
import { resolveScope, describeScope, statedScopeKind, roleStatedScopeKind, inferScopeKind, filterVolunteersByScope, SCOPE_KINDS, SCOPE_KIND_META } from '../lib/scope';
import { DEFAULT_ROLE_RANK, isSantoRole } from '../constants/roleTemplates';
import { expandLegacyPermissions, isLegacyRole } from '../constants/permissions';
import { buildVolunteerRows, computeVolunteerStats, exportVolunteerCsv, exportVolunteerPdf } from '../lib/volunteerExports';
import PasswordApprovals, { usePasswordApprovals } from '../components/volunteers/PasswordApprovals';
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
 * PHASE 39 — how many roster rows render at once.
 *
 * HONEST ABOUT WHAT THIS DOES: it does NOT save Firestore reads. useVolunteers()
 * holds ONE shared listener over the whole `volunteers` collection, shared with
 * four other screens, so the documents are already in memory before this list
 * renders — slicing them costs and saves nothing at the quota. (Server-side
 * paging with limit()/startAfter() WOULD, but it would also break the status
 * tiles, the coverage warning and the exports, all of which are computed over
 * everyone, and it re-reads a page every time you go back to it. On ~25
 * documents that trade is firmly the wrong way round.)
 *
 * What it does fix is the screen: every volunteer rendered every keystroke, in a
 * 420px box you scrolled blind, with the editor stranded below it on a phone.
 *
 * 12 rather than 10 or 25: one area's karyakartas almost always fit inside it, so
 * the common filtered view shows no pager at all.
 */
const ROSTER_PAGE_SIZE = 12;

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
function ContactSearchPicker({ onPick, initialQuery = '', placeholder = 'Search by name or mobile…' }) {
  // PHASE 39 — seeded. When this is opened to link an EXISTING volunteer to their
  // own contact record, the answer is nearly always "the contact on the same
  // phone number", so the caller passes that number and the match is already on
  // screen before anything is typed.
  const [q, setQ] = useState(initialQuery);
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
        placeholder={loading ? 'Loading contacts…' : placeholder}
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

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 39 — THE OTHER HALF OF A KARYAKARTA.
//
// Every volunteer is also a contact: a person in a household, in a mandal, with a
// birthday, an attendance history and their own sampark karyakarta. The database
// has always known this — createVolunteerAccount writes `linkedIndividualId` on
// the volunteer and `volunteerId` back on the individual, and
// useVolunteerIdentity() resolves the join in both directions to put the sevak
// badge on contact rows — but this screen never SHOWED it and offered no way to
// make the link after the fact. So a login created "New person" (which is most of
// them) stayed permanently detached from the person it belongs to, and answering
// "which mandal is this karyakarta actually in?" meant going to Contacts and
// searching for the name by hand.
//
// READS. The linked contact is fetched with ONE getDoc, only for the volunteer
// currently open in the editor, and only when a link exists. The full contacts
// listener (useAllContacts, ~2.4k documents) is mounted only if the admin taps
// "Find their contact" — the same on-demand rule the create form follows, so
// opening Admin → Volunteers still costs the volunteer collection and nothing
// else.
//
// WRITES. Two, and deliberately in this order: the volunteer side first (a
// manage_users or manage_scoped_volunteers holder can always write it — see the
// volunteers block in firestore.rules), then the reverse pointer on the
// individual, best-effort. canUpdateIndividual() needs edit_contacts, which a
// narrowly-scoped mandal manager may not hold; when that write is refused the
// link still resolves from the volunteer side, so the feature degrades to "works,
// but only findable from here" instead of failing outright. It says so rather
// than reporting a clean success.
// ─────────────────────────────────────────────────────────────────────────────
function LinkedContactCard({ volunteer, onNotice }) {
  // undefined = still fetching · null = no link · 'missing' = link points nowhere
  const [linked, setLinked] = useState(null);
  const [picking, setPicking] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState(null);
  // Which (volunteer, contact) pair has already been fetched. Without this, the
  // live volunteers listener re-delivers the document the instant we write
  // linkedIndividualId and the effect spends a second read re-fetching a contact
  // we are holding in our hand.
  const fetchedRef = useRef(null);

  const volunteerId = volunteer?.id || null;
  const linkedId = volunteer?.linkedIndividualId || null;

  useEffect(() => {
    setPicking(false);
    setErr(null);
    if (!volunteerId || !linkedId) {
      setLinked(null);
      fetchedRef.current = null;
      return undefined;
    }
    const key = `${volunteerId}:${linkedId}`;
    if (fetchedRef.current === key) return undefined;
    fetchedRef.current = key;
    let alive = true;
    setLinked(undefined);
    getDoc(doc(db, 'individuals', linkedId))
      .then((snap) => {
        if (!alive) return;
        setLinked(snap.exists() ? { id: snap.id, ...snap.data() } : 'missing');
      })
      // A denied read is indistinguishable from a deleted contact from here, and
      // both want the same offer: unlink, or link the right one.
      .catch(() => { if (alive) setLinked('missing'); });
    return () => { alive = false; };
  }, [volunteerId, linkedId]);

  async function applyLink(contact) {
    if (!volunteerId) return;
    setWorking(true); setErr(null);
    try {
      await updateDoc(doc(db, 'volunteers', volunteerId), {
        linkedIndividualId: contact ? contact.id : null,
      });

      let reverseRefused = false;
      const target = contact?.id || linkedId;
      if (target) {
        try {
          await updateDoc(doc(db, 'individuals', target), {
            // Unlinking clears the pointer on whichever contact held it.
            volunteerId: contact ? volunteerId : null,
            updatedAt: serverTimestamp(),
          });
        } catch { reverseRefused = true; }
      }

      fetchedRef.current = contact ? `${volunteerId}:${contact.id}` : null;
      setLinked(contact || null);
      setPicking(false);
      onNotice?.(
        (contact
          ? `Linked ${volunteer.name || 'this volunteer'} to ${contact.name || 'the contact'}’s record.`
          : `Unlinked ${volunteer.name || 'this volunteer'} from their contact record.`)
        + (reverseRefused
          ? ' The contact record itself could not be stamped (that needs Edit contacts), so the link is only visible from this screen.'
          : ''),
      );
    } catch (e) {
      setErr(e?.message || 'Couldn’t save the link.');
    } finally {
      setWorking(false);
    }
  }

  const heading = (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      <Link2 className="h-3 w-3" /> Contact record
    </p>
  );

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5">
      {heading}

      {err && <p className="mt-1.5 text-xs text-rose-600">{err}</p>}

      {linked === undefined && (
        <p className="mt-1.5 text-[13px] text-slate-400">Looking up their contact…</p>
      )}

      {linked === 'missing' && (
        <div className="mt-1.5">
          <p className="text-[13px] font-medium text-amber-800">
            This login points at a contact that no longer exists, or that you cannot read.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={working} onClick={() => setPicking(true)}>
              <Search className="h-3.5 w-3.5" /> Pick the right contact
            </Button>
            <Button variant="ghost" size="sm" disabled={working} onClick={() => applyLink(null)}>
              Clear the link
            </Button>
          </div>
        </div>
      )}

      {linked && linked !== 'missing' && (
        <div className="mt-1.5">
          <div className="flex items-center gap-2.5">
            <Avatar src={linked.profilePhotoURL} name={linked.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-slate-900">{linked.name || 'Unnamed contact'}</div>
              <div className="truncate text-[11px] text-slate-400">
                {[linked.mobile || 'no number', linked.mandal, linked.area].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* The whole point of the ask: from the volunteer's access settings
                straight to their person — household, birthday, attendance,
                calling history — without searching for the name by hand. */}
            <Link
              to={`/contacts/${linked.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-orange-200 hover:text-orange-700"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open full profile
            </Link>
            <Button variant="ghost" size="sm" disabled={working} onClick={() => applyLink(null)}>
              {working ? 'Saving…' : 'Unlink'}
            </Button>
          </div>
        </div>
      )}

      {linked === null && !picking && (
        <div className="mt-1.5">
          <p className="text-[13px] text-slate-500">
            Not linked to a contact record yet — so nothing on the Contacts side marks this
            person as a karyakarta, and their household, mandal and birthday are not reachable
            from here.
          </p>
          <Button variant="secondary" size="sm" className="mt-2" disabled={working} onClick={() => setPicking(true)}>
            <Search className="h-3.5 w-3.5" /> Find their contact
          </Button>
        </div>
      )}

      {picking && (
        <div className="mt-2">
          <ContactSearchPicker
            initialQuery={volunteer?.mobile || ''}
            placeholder="Search their name or mobile…"
            onPick={(c) => applyLink(c)}
          />
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="mt-1.5 text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function CreateVolunteerForm({ roles, onCreated, defaultMandals = [], scopedManager = false }) {
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
        // A mandal head creates volunteers directly inside their own mandal(s),
        // never as an unassigned account that could later be placed elsewhere.
        assignedMandals: defaultMandals,
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
              {roles
                .filter((r) => !scopedManager || !['manage_users', 'manage_roles'].some((p) => (r.permissions || []).includes(p)))
                .map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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

// ─────────────────────────────────────────────────────────────────────────────
// 3.3 — pending password requests
//
// PHASE 41 — this panel used to live here, ~150 lines of it, and it is now the
// shared PasswordApprovals card (src/components/volunteers/PasswordApprovals.jsx).
//
// Two things forced the move. The first is that it opened a raw
// onSnapshot(collection(db, 'passwordResets')), which the rules only allow to
// manage_users — so it had to be hidden behind `canApprove={isGlobalUserManager}`,
// and the scoped Moderators and Sanchalaks this app deliberately admits to the
// Volunteers screen could never see a request from their own karyakarta. The
// second is that approval authority is now "outranks them and shares their
// territory", which is a comparison against roles/{id}.rank that a browser cannot
// be trusted to make. Both are answered by listPasswordRequests(), which returns
// only the rows the caller may act on — so the gate is gone, and a mandal head
// sees their own people here without the rules being widened for everyone.
//
// The Set-password modal above stays: an admin typing a password for someone who
// cannot manage the flow themselves is still the right escape hatch, and it is
// what `onSetManually` reaches when a pre-Phase-41 request with no password
// attached turns up in the list.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 3.4 — pending mobile-number change requests
//
// PHASE 39 — the approval half of the number-change flow.
//
// The mobile number is the login: Auth signs in on <mobile>@baps-jaipur-mds.local,
// so a volunteer editing their own number was editing their own username, with no
// self-service way back from a typo. The profile screen now records a request
// instead (functions/updateVolunteerAccount.js) and this is where it is answered.
//
// COSTS NOTHING TO SHOW. The request lives on the volunteer document as
// `mobileChangeRequest`, and this screen is already subscribed to the whole roster
// through useVolunteers — so unlike PendingResetRequests above there is no second
// listener, no second collection and no rules change. That is the entire reason
// the field was chosen over a collection.
//
// Both buttons go through the callable, because approving means moving the Auth
// email as well as the Firestore field and only the Admin SDK can do that.
// ─────────────────────────────────────────────────────────────────────────────
function PendingMobileRequests({ volunteers, canApprove, onDone }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const requests = useMemo(
    () => (volunteers || [])
      .filter((v) => v?.mobileChangeRequest?.status === 'pending' && v.mobileChangeRequest.mobile)
      .sort((a, b) => toMillis(b.mobileChangeRequest.requestedAt) - toMillis(a.mobileChangeRequest.requestedAt)),
    [volunteers],
  );

  if (!canApprove || (!requests.length && !error)) return null;

  async function resolve(v, decision) {
    setBusyId(v.id);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'updateVolunteerAccount');
      const res = await fn({ volunteerId: v.id, resolveMobileRequest: decision });
      const moved = res?.data?.contactsRepointed;
      // The number is denormalised onto every contact assigned to them
      // (individuals.samparkKaryakartaNumber) and My Contacts queries on it, so the
      // callable re-points those too. `null` means the login moved but that sweep
      // failed — say so plainly, because the fix is to press Approve's equivalent
      // again (type the same number into Mobile and Save) and not to wonder why
      // their contact list is empty.
      onDone?.(decision === 'approve'
        ? `${v.name || 'That volunteer'} now signs in with ${v.mobileChangeRequest.mobile}.`
          + (moved === null
            ? ' Their assigned contacts could NOT be moved to the new number — re-enter it in the Mobile field below and Save to retry.'
            : moved > 0 ? ` ${moved} assigned contact${moved === 1 ? '' : 's'} moved with it.` : '')
        : `Declined — ${v.name || 'that volunteer'} keeps ${v.mobile}.`);
    } catch (err) {
      // A deployed-but-old updateVolunteerAccount does not know the field, so it
      // silently succeeds at nothing rather than failing — but the not-found /
      // opaque-internal case is worth naming, because the fallback is real work.
      setError(isCallableMissing(err)
        ? 'updateVolunteerAccount has not been redeployed with the approval step yet. '
          + 'Until it is, type the new number into the Mobile field below and Save — '
          + 'that path already works. Run: firebase deploy --only functions:updateVolunteerAccount'
        : (err?.message || 'Could not answer the request.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mb-5 rounded-lg border border-sky-200 bg-sky-50/60">
      <div className="flex items-center gap-2 border-b border-sky-200 px-3 py-2 sm:px-4">
        <Smartphone className="h-4 w-4 shrink-0 text-sky-600" />
        <span className="text-[13px] font-semibold text-sky-900">
          Login number change requests
          {requests.length > 0 && (
            <span className="ml-1.5 rounded-full bg-sky-200 px-1.5 py-0.5 text-[11px] font-semibold text-sky-900">
              {requests.length}
            </span>
          )}
        </span>
      </div>

      {error && <div className="border-b border-sky-200 px-3 py-2 text-xs text-rose-700 sm:px-4">{error}</div>}

      {requests.length > 0 && (
        <>
          <p className="px-3 pt-2.5 text-xs text-sky-900 sm:px-4">
            Approving moves the number they sign in with. Check it is really them and that the new
            number is right — a wrong digit locks them out until you fix it here.
          </p>
          <div className="divide-y divide-sky-200/70">
            {requests.map((v) => {
              const req = v.mobileChangeRequest;
              const when = formatLastLogin(req.requestedAt);
              return (
                <div key={v.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{v.name || 'Unnamed volunteer'}</div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      {v.mobile || 'no number'} → <strong className="text-slate-700">{req.mobile}</strong>
                      {when ? ` · asked ${when}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" size="sm" disabled={busyId === v.id} onClick={() => resolve(v, 'approve')}>
                      <Check className="h-3.5 w-3.5" /> {busyId === v.id ? 'Saving…' : 'Approve'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busyId === v.id} onClick={() => resolve(v, 'decline')}>
                      Decline
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
  const { volunteers: rawVolunteers } = useVolunteers();
  // PHASE 25 — the roster's live fields (lastSeenAt / lastLoginAt / usage) now live
  // in the presence collection, not on the volunteer doc. Merge them back on so
  // buildVolunteerRows() and the "online now" dot read exactly what they always
  // did. Opening this listener here (and on the usage tab) is the only place that
  // pays for heartbeat churn now; the other roster screens no longer do. Falls back
  // to any value still on the volunteer doc when presence has not reported yet.
  const { byId: presenceById } = usePresence();
  const allVolunteers = useMemo(() => rawVolunteers.map((v) => {
    const p = presenceById.get(v.id);
    if (!p) return v;
    return {
      ...v,
      lastSeenAt: p.lastSeenAt ?? v.lastSeenAt,
      lastLoginAt: p.lastLoginAt ?? v.lastLoginAt,
      usage: p.usage ?? v.usage,
    };
  }), [rawVolunteers, presenceById]);
  const { permissions, scope } = useAuth();
  const isGlobalUserManager = permissions.includes('manage_users');
  // PHASE 41 — no `canApprove` gate any more. The callable returns only the rows
  // this caller outranks, so a scoped Sanchalak on this screen sees their own
  // karyakartas here instead of the guaranteed permission-denied the old
  // passwordResets listener handed them.
  const passwordApi = usePasswordApprovals();
  // PHASE 31 — WHO IS ON MY ROSTER IS A QUESTION FOR THE SCOPE, NOT THE PERMISSION.
  //
  // Visibility used to hang off `isScopedMandalManager`, which requires the
  // person to NOT hold manage_users. A Super Moderator whose role happens to
  // include manage_users therefore skipped every narrowing below and got the
  // entire city's roster, fully editable — which is exactly the complaint. The
  // two questions are different: `manage_users` says they may edit a volunteer
  // at all, the scope says WHICH volunteers are theirs. Split them.
  const scopeRestricted = !scope?.unrestricted
    && scope?.kind !== SCOPE_KINDS.NONE
    && ((scope?.mandals?.length || 0) > 0 || (scope?.areas?.length || 0) > 0);
  // Kept for the questions that really are about the permission: which ROLES may
  // be handed out, and whether the create form runs in scoped mode.
  const isScopedMandalManager = !isGlobalUserManager
    && permissions.includes('manage_scoped_volunteers')
    && !scope?.unrestricted
    && (scope?.mandals?.length || 0) > 0;
  const volunteers = useMemo(() => (
    scopeRestricted ? filterVolunteersByScope(allVolunteers, scope) : allVolunteers
  ), [allVolunteers, scopeRestricted, scope]);
  const [roles, setRoles] = useState([]);
  const { areas, mandals } = useAreasAndMandals();
  // What a scoped manager is allowed to hand out. Mirrors CreateVolunteerForm and
  // functions/createVolunteerAccount.js: never a role that could manage users or
  // roles, and never territory outside their own — the rules refuse both, and
  // offering them only turns a policy into a raw "insufficient permissions".
  const assignableRoles = useMemo(() => (
    isScopedMandalManager
      ? roles.filter((r) => !['manage_users', 'manage_roles'].some((p) => (r.permissions || []).includes(p)))
      : roles
  ), [roles, isScopedMandalManager]);
  const assignableAreaNames = useMemo(() => {
    const all = areas.map((a) => a.name);
    if (!scopeRestricted || !scope?.areas?.length) return all;
    return all.filter((a) => scope.areas.includes(a));
  }, [areas, scopeRestricted, scope]);
  const assignableMandalNames = useMemo(() => {
    const all = mandals.map((m) => m.name);
    if (!scopeRestricted || !scope?.mandals?.length) return all;
    return all.filter((m) => scope.mandals.includes(m));
  }, [mandals, scopeRestricted, scope]);
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
  // PHASE 39 — roster paging. See the note on ROSTER_PAGE_SIZE for why this is a
  // screen fix and not a quota fix.
  const [page, setPage] = useState(1);
  const rosterRef = useRef(null);

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

  /**
   * PHASE 39 — the page actually shown.
   *
   * `safePage` is CLAMPED rather than stored: typing another letter into the
   * search, tapping a status tile or removing a volunteer can all shrink the list
   * under the page you are standing on, and a stored-only page would leave you
   * looking at an empty roster with no obvious way back. Everything downstream —
   * the tiles, the coverage warning, the CSV and the PDF — still reads
   * `visibleRows`, so paging changes what you scroll, never what you export.
   */
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / ROSTER_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = useMemo(
    () => visibleRows.slice((safePage - 1) * ROSTER_PAGE_SIZE, safePage * ROSTER_PAGE_SIZE),
    [visibleRows, safePage],
  );

  // Any change to what is being filtered starts again at the top. Without this,
  // searching while on page 3 lands on page 3 of two results — which looks
  // exactly like "no matches".
  useEffect(() => { setPage(1); }, [search, filterArea, filterMandal, statusView]);

  /**
   * PHASE 39 — arriving from a contact profile: /admin/volunteers?v=<volunteerId>
   *
   * The other direction of the link LinkedContactCard opens. Read once, after the
   * roster has actually arrived (the parameter names a volunteer, and matching it
   * against an empty list would silently drop the request).
   */
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || volunteers.length === 0) return;
    deepLinkedRef.current = true;
    const wanted = new URLSearchParams(window.location.search).get('v');
    if (wanted && volunteers.some((v) => v.id === wanted)) setSelectedId(wanted);
  }, [volunteers]);

  /**
   * Keep the SELECTED volunteer on the page you are looking at — otherwise a deep
   * link, or picking someone before narrowing the filter, leaves the editor
   * showing one person and the roster showing twelve others.
   *
   * Keyed on a ref rather than running on every `visibleRows` change: the live
   * volunteers listener re-delivers on every lastSeenAt heartbeat, and without the
   * guard that would yank an admin back to page 1 mid-browse, roughly once a
   * minute, for as long as anyone is online.
   */
  const pagedForRef = useRef(null);
  useEffect(() => {
    if (!selectedId || pagedForRef.current === selectedId) return;
    const idx = visibleRows.findIndex((r) => r.id === selectedId);
    if (idx < 0) return; // filtered out — leave the roster where the admin put it
    pagedForRef.current = selectedId;
    setPage(Math.floor(idx / ROSTER_PAGE_SIZE) + 1);
  }, [selectedId, visibleRows]);

  function goToPage(n) {
    setPage(Math.min(Math.max(1, n), pageCount));
    // The list is its own scroll box; without this, Next leaves you halfway down
    // the new page.
    rosterRef.current?.scrollTo({ top: 0 });
  }

  // The roster filters offer only what the roster can actually contain — a scoped
  // manager picking a mandal they don't oversee would just empty the list.
  const areaNames = assignableAreaNames;
  const mandalNames = assignableMandalNames;

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
    setSaving(true); setError(null); setNotice(null);

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
      const res = await updateVolunteerAccount({
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

      // PHASE 39 — a moved login number is the one edit on this form with a
      // consequence beyond this document: it rewrites the Auth email AND the
      // `samparkKaryakartaNumber` copy on every contact assigned to them, which is
      // the field My Contacts queries on. Saving used to report nothing at all, so
      // say what happened — silence after a change this wide is what leaves an admin
      // unsure whether to do it again.
      const moved = res?.data?.contactsRepointed;
      if (res?.data?.mobileChanged) {
        setNotice(`Login number updated to ${draft.mobile.trim()}.`
          + (moved === null
            ? ' Their assigned contacts could NOT be moved to it — press Save again to retry.'
            : moved > 0 ? ` ${moved} assigned contact${moved === 1 ? '' : 's'} moved with it.` : ''));
      }

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

      <PasswordApprovals
        api={passwordApi}
        volunteers={volunteers}
        showErrors
        onSetManually={(req) => {
          const v = volunteers.find((x) => x.id === req.volunteerId);
          if (v) { setNotice(null); setResetTarget(v); }
        }}
      />

      {/* PHASE 39 — number-change requests. Reads the roster already in memory, so
          this renders for free and disappears when the queue is empty. */}
      <PendingMobileRequests
        volunteers={volunteers}
        canApprove={isGlobalUserManager}
        onDone={(message) => setNotice(message)}
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
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {/* Exports take the FILTERED list on purpose — the useful document is
              usually "the karyakartas of one area", and the filter is printed on
              both files so the reader knows which list they are holding.
              PHASE 39 — that has always been true and nothing on screen said so,
              so the count now rides on the buttons: with "Area: Vaishali Nagar"
              set they read "PDF · 6", and what you are about to download is no
              longer a guess. */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!visibleRows.length}
              title={`Download the ${visibleRows.length} volunteer${visibleRows.length === 1 ? '' : 's'} shown${filterLabel ? ` — ${filterLabel}` : ''}`}
              onClick={() => exportVolunteerCsv({ rows: visibleRows, stats: exportStats, filterLabel })}
            >
              <Download className="h-3.5 w-3.5" /> CSV · {visibleRows.length}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!visibleRows.length}
              title={`Download the ${visibleRows.length} volunteer${visibleRows.length === 1 ? '' : 's'} shown${filterLabel ? ` — ${filterLabel}` : ''}`}
              onClick={() => exportVolunteerPdf({ rows: visibleRows, stats: exportStats, filterLabel })}
            >
              <FileText className="h-3.5 w-3.5" /> PDF · {visibleRows.length}
            </Button>
          </div>
          {filterLabel && (
            <p className="max-w-[18rem] text-[11px] leading-snug text-slate-400 sm:text-right">
              Exports only these {visibleRows.length} · {filterLabel}
            </p>
          )}
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
        <CreateVolunteerForm
          roles={roles}
          defaultMandals={scopeRestricted ? (scope.mandals || []) : []}
          scopedManager={isScopedMandalManager}
        />

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

        <div ref={rosterRef} className="max-h-[70vh] divide-y divide-slate-50 overflow-y-auto rounded-xl border border-slate-100">
          {pagedRows.map((r) => (
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

        {/* Only when there is more than one page — a filtered view of six
            karyakartas should not grow a pager it never needs. */}
        {pageCount > 1 && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] tabular-nums text-slate-400">
              {(safePage - 1) * ROSTER_PAGE_SIZE + 1}–{Math.min(safePage * ROSTER_PAGE_SIZE, visibleRows.length)}
              {' of '}{visibleRows.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage <= 1}
                aria-label="Previous page"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:border-orange-200 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-500"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[3.5rem] text-center text-[11px] font-medium tabular-nums text-slate-500">
                {safePage} / {pageCount}
              </span>
              <button
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage >= pageCount}
                aria-label="Next page"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:border-orange-200 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-500"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
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

            {/* Directly under the identity, because "who is this person" and "what
                can they see" are two different questions and this is the answer to
                the first one. */}
            <LinkedContactCard volunteer={selectedVolunteer} onNotice={setNotice} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full name" />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} placeholder="10-digit mobile" inputMode="numeric" />
                {/* PHASE 39 — this field is now the ONLY way the number moves. The
                    profile screen went read-only because the number IS the login
                    (Auth signs in on <mobile>@baps-jaipur-mds.local), so a typo
                    there locked the volunteer out with no way back. Saying it here
                    stops an admin assuming the volunteer can fix it themselves. */}
                <p className="mt-1 text-[11px] leading-snug text-slate-400">
                  This is their login ID. Volunteers can no longer change it themselves — they
                  send a request, and it appears at the top of this page for approval.
                  {selectedVolunteer?.mobileChangeRequest?.status === 'pending'
                    && ` They have asked for ${selectedVolunteer.mobileChangeRequest.mobile}.`}
                </p>
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
              {/* PHASE 39 — there were TWO of these, both bound to draft.program,
                  one here and one under the role picker, labelled differently
                  ("Yuvak (Youth)" vs "Yuvak Mandal"). Two controls for one field
                  read as two settings that could disagree. The lower copy is gone.

                  The LABEL is "Yuvak Mandal" — "Youth" was a second name for the
                  same mandal and reading both made it look like two programs. The
                  stored VALUE stays 'Yuvak': it is written on every volunteer
                  document and matched by src/lib/scope.js and the batch/event
                  filters, so renaming it would orphan the whole roster. Display
                  name here, data underneath — they are allowed to differ. */}
              <Select
                value={draft.program || 'Yuvak'}
                onChange={(e) => setDraft({ ...draft, program: e.target.value })}
              >
                <option value="Yuvak">Yuvak Mandal</option>
                <option value="Bal Mandal">Bal Mandal</option>
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
              roles={assignableRoles}
              values={draft.roleRefs}
              onChange={(v) => setDraft({ ...draft, roleRefs: v })}
            />

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
                    options={assignableAreaNames}
                    value={draft.assignedAreas}
                    onChange={(v) => setDraft({ ...draft, assignedAreas: v })}
                    allLabel="areas"
                    emptyLabel="No areas defined yet — add them on the Areas & Mandals tab"
                  />
                </div>

                <div>
                  <Label>Assigned mandals <span className="font-normal text-slate-400">— from the individual</span></Label>
                  <ChipMultiSelect
                    options={assignableMandalNames}
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
        // Closing refreshes the approvals card: resetVolunteerPassword closes any
        // pending row for that volunteer server-side, so without this the row the
        // admin just acted on would sit there until the page reloads and invite a
        // second reset. One callable, only when an admin actually opened this.
        <ResetPasswordModal
          volunteer={resetTarget}
          onClose={() => { setResetTarget(null); passwordApi.refresh(); }}
        />
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
    <RequirePermission anyOf={["manage_users", "manage_scoped_volunteers"]} fallback={<div className="p-6 text-sm text-slate-500">You don't have permission to manage volunteers.</div>}>
      <VolunteerEditorInner />
    </RequirePermission>
  );
}

export default VolunteerEditor;
