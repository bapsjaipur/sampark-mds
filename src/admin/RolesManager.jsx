// src/admin/RolesManager.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 21 — rebuilt around the question an admin is actually asking.
//
// The previous version was an 18-column checkbox matrix. It could express any
// role, and it explained none of them: the columns were abbreviations, there was
// no indication which boxes were dangerous, and nothing anywhere said what a
// role could SEE — only what it could DO. Since Phase 21 makes "what can this
// role see" a first-class setting (area / mandal / both / everything), the
// matrix had to go.
//
// What replaced it:
//   • A hierarchy strip at the top — the ladder, in rank order, at a glance.
//   • Master-detail: pick a role, get one screen for that role only. Identical
//     structure on phone and desktop, so there is one thing to learn.
//   • Scope picker with the grid explained in words, not jargon.
//   • Every permission carries its consequence (PERMISSION_HELP) and the three
//     that hand over the whole system are flagged in red (DANGEROUS_PERMISSIONS).
//
// SEMANTICS worth knowing before editing a role here: granting edit_contacts
// WITHOUT a read permission produces a volunteer whose calling queue silently
// reads as empty — firestore.rules denies the individual reads and Firestore
// surfaces that as "no documents", not as an error. See PHASE7-NOTES.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { collection, addDoc, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import {
  Sparkles, Trash2, AlertTriangle, ShieldAlert, Check, Pencil, X,
  ChevronRight, Users, Eye, GitMerge, ArrowRight, Loader2, Info, RefreshCw,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { RequirePermission } from '../components/RequirePermission';
import { usePermissions } from '../hooks/usePermissions';
import { useVolunteers } from '../hooks/useVolunteers';
import {
  ALL_PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS, PERMISSION_HELP,
  DANGEROUS_PERMISSIONS, PERMISSIONS, isLegacyRole, expandLegacyPermissions,
} from '../constants/permissions';
import {
  ROLE_PRESETS, detectRoleKey, ROLE_LABELS, ROLE_BADGE_CLASSES, getPreset, DEFAULT_ROLE_RANK,
} from '../constants/roleTemplates';
import { SCOPE_KINDS, SCOPE_KIND_META, ALL_SCOPE_KINDS, statedScopeKind, inferScopeKind, roleStatedScopeKind } from '../lib/scope';
import { Input, Select, Label } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { confirmDialog } from '../components/ui/ConfirmHost';
import { cn } from '../lib/cn';

function RoleKeyBadge({ permissions }) {
  const key = detectRoleKey(permissions);
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', ROLE_BADGE_CLASSES[key] || ROLE_BADGE_CLASSES.custom)}>
      {ROLE_LABELS[key]}
    </span>
  );
}

function roleRank(role) {
  return Number.isFinite(role?.rank) ? role.rank : DEFAULT_ROLE_RANK;
}

/**
 * The shape this role actually STATES, or null when nobody has ever picked one.
 *
 * PHASE 23 — null is a real answer and has to survive. This used to substitute
 * UNION, which was the old runtime fallback; now an unset scopeKind means "let
 * each volunteer's own assignment decide" (inferScopeKind in src/lib/scope.js:
 * an area and a mandal together mean the cell where they cross). Substituting a
 * concrete value here did two bad things — it selected the UNION radio on a
 * choice nobody made, and it got written straight back by every save on this
 * screen, permanently pinning the widest shape there is onto roles nobody meant
 * to widen.
 *
 * Straight through to lib/scope.js so this screen and the runtime cannot drift:
 * that is also where a stored-but-accidental UNION is discounted, which is why
 * some roles will show nothing selected below despite having a scopeKind field.
 */
const statedRoleScopeKind = roleStatedScopeKind;

/** Prose for a shape that may not be set. */
function scopeLabel(kind) {
  return kind ? SCOPE_KIND_META[kind].label : 'Not set — each volunteer’s own assignment decides';
}

/** Badge-length version of the same. */
function scopeShort(kind) {
  return kind ? SCOPE_KIND_META[kind].short : 'Scope not set';
}

/**
 * The extra field to write whenever a save states — or clears — a scope shape.
 *
 * PHASE 23b. `scopeKind: 'union'` is the one value that cannot be trusted on its
 * own, because every build before Phase 23 wrote it onto roles nobody had scoped
 * (see roleStatedScopeKind in lib/scope.js). `scopeKindChosen` is the marker that
 * separates the two: it is written ONLY by a save that carries an actual shape
 * decision — the Scope picker in RoleEditor, a preset being applied, or a merge
 * resolving the two roles' shapes. A write that sets scopeKind back to null
 * clears it, so "unset" stays unset.
 *
 * Pass the patch/payload; returns {} when it says nothing about the shape, so it
 * can be spread unconditionally.
 */
function scopeChoiceFields(patch) {
  if (!patch || !('scopeKind' in patch)) return {};
  return { scopeKindChosen: Boolean(patch.scopeKind) };
}

// Permissions that DO something to contacts/households/batches/events but grant
// no read of their own. Verified against firestore.rules: canReadHousehold,
// canReadBatches and canReadEvents all require view_all_contacts or
// view_assigned_contacts before anything else, so a role holding only these gets
// empty screens rather than an error.
//
// view_padhramani is deliberately NOT here — canReadPadhramani accepts it on its
// own, so the Santo role (view_padhramani and nothing else) works exactly as
// intended and must not be flagged.
const NEEDS_A_READ_PERMISSION = [
  PERMISSIONS.EDIT_CONTACTS,
  PERMISSIONS.DELETE_CONTACTS,
  PERMISSIONS.IMPORT_DATA,
  PERMISSIONS.EXPORT_DATA,
  PERMISSIONS.VIEW_HOUSEHOLDS,
  PERMISSIONS.ASSIGN_BATCHES,
  PERMISSIONS.GENERATE_BATCHES,
  PERMISSIONS.MANAGE_EVENTS,
  PERMISSIONS.MANAGE_ATTENDANCE,
];

// The three narrow shapes. GLOBAL and NONE are excluded because they don't
// conflict with view_all_contacts in a way worth a warning, and UNION because it
// is the one shape that only ever appears when an admin picked it on purpose —
// so a role sitting on it has already been reviewed.
const NARROW_SCOPE_KINDS = [SCOPE_KINDS.AREA, SCOPE_KINDS.MANDAL, SCOPE_KINDS.INTERSECT];

/**
 * Real, silent misconfigurations — surfaced where the role is created rather
 * than left for the volunteer to discover as a blank screen. Ordered by how
 * badly the role is broken, and only the worst one is shown: three stacked
 * warnings on one card get read as decoration.
 *
 * EVERY message here must name a remedy that is SAFE to follow blindly, because
 * it will be. The previous version told the admin to remove "View All Contacts"
 * from a role whose scope it had itself invented (an unset scopeKind was
 * reported as UNION); on a role whose holders have no assignedAreas filled in,
 * following that advice turns the whole app blank — resolveScope() loses its
 * view_all_contacts short-circuit, scope.empty becomes true, and
 * firestore.rules stops returning any contact or household at all. Warnings now
 * offer both directions out, and never fire on a scope nobody chose.
 */
function roleWarning(role) {
  // Effective, not stored — otherwise a legacy role gets warned about a
  // permission it does in fact have. Known-only, so a dead key left over from an
  // older build can't make an empty role look populated. Hoisted, so declaration
  // order is fine.
  const list = knownPermissions(role);
  // null when no scope was ever chosen. Only a chosen scope can be
  // "contradicted" by a permission, so every branch below that mentions the
  // scope is implicitly guarded by this being non-null.
  const kind = statedRoleScopeKind(role);

  if (list.length === 0) return 'No permissions — anyone assigned this role cannot use the app.';

  const acts = NEEDS_A_READ_PERMISSION.filter((p) => list.includes(p));
  if (acts.length > 0
      && !list.includes(PERMISSIONS.VIEW_ALL_CONTACTS)
      && !list.includes(PERMISSIONS.VIEW_ASSIGNED_CONTACTS)) {
    return `Has "${PERMISSION_LABELS[acts[0]]}" but no permission to READ contacts, so Contacts, Households, Batches and Events all come back empty — with no error to explain it. Add "View Assigned Contacts".`;
  }

  // "No contact access" cannot take view_all_contacts away: the wide permission
  // short-circuits scoping in lib/scope.js AND in firestore.rules, so this role
  // sees the entire city despite the scope saying otherwise. Checked before the
  // narrow-scope branch because it is the more surprising of the two.
  if (kind === SCOPE_KINDS.NONE && list.includes(PERMISSIONS.VIEW_ALL_CONTACTS)) {
    return 'Scope says "No contact access" but "View All Contacts" overrides it completely — this role can see every contact in Jaipur. Untick "View All Contacts" to make the scope real, or switch the scope to "Everything" if full access was the intention.';
  }

  // Only a DELIBERATELY narrow scope is worth flagging. An unset scopeKind is
  // resolved per volunteer at runtime, so warning on it accuses the admin of a
  // decision they never made — which is exactly what happened on the Admin role:
  // it showed a scope warning it could not act on safely.
  if (NARROW_SCOPE_KINDS.includes(kind)
      && list.includes(PERMISSIONS.VIEW_ALL_CONTACTS)) {
    return `Scope is "${SCOPE_KIND_META[kind].label}" but "View All Contacts" overrides it — this role sees everything, everywhere. Pick one: switch the scope to "Everything" if that is right, or untick "View All Contacts" — and before you untick it, make sure every volunteer holding this role has their areas/mandals filled in on Admin → Volunteers, or their app will go blank.`;
  }

  if (kind === SCOPE_KINDS.NONE && list.includes(PERMISSIONS.VIEW_ASSIGNED_CONTACTS)) {
    return 'Scope is "No contact access", so "View Assigned Contacts" grants nothing. Pick a scope or drop the permission.';
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

function HierarchyStrip({ roles, selectedId, onSelect }) {
  const ladder = useMemo(
    () => [...roles].sort((a, b) => roleRank(b) - roleRank(a)),
    [roles],
  );
  if (ladder.length === 0) return null;

  return (
    <div className="mb-5 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Hierarchy — widest access first
      </p>
      {/* Scrolls horizontally rather than wrapping: the ladder reads as an order,
          and a wrapped second line reads as a second, unrelated group. The
          scrollbar is hidden, so the fade on the right edge is the only thing
          telling a phone user there are more roles past the cut — without it the
          second card just looks broken. */}
      <div className="relative">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ladder.map((r, i) => (
            <div key={r.id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
              <button
                onClick={() => onSelect(r.id)}
                className={cn(
                  'flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                  selectedId === r.id
                    ? 'border-orange-300 bg-white ring-1 ring-orange-200'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <span className="whitespace-nowrap text-[12px] font-semibold text-slate-800">{r.name}</span>
                <span className="whitespace-nowrap text-[10px] text-slate-400">
                  {scopeShort(statedRoleScopeKind(r))} · rank {roleRank(r)}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-50 to-transparent" />
      </div>
    </div>
  );
}

function ScopePicker({ value, onChange, disabled }) {
  return (
    <div className="space-y-1.5">
      {ALL_SCOPE_KINDS.map((kind) => {
        const meta = SCOPE_KIND_META[kind];
        const on = value === kind;
        return (
          <button
            key={kind}
            type="button"
            disabled={disabled}
            onClick={() => onChange(kind)}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
              on ? 'border-orange-300 bg-orange-50/70' : 'border-slate-200 bg-white hover:bg-slate-50',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <span className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
              on ? 'border-orange-600 bg-orange-600' : 'border-slate-300 bg-white',
            )}>
              {on && <Check className="h-2.5 w-2.5 text-white" />}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-[13px] font-medium', on ? 'text-orange-900' : 'text-slate-800')}>
                {meta.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{meta.help}</span>
              {meta.uses.length > 0 && (
                <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
                  Uses the volunteer's {meta.uses.join(' + ')}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PermissionToggle({ perm, on, disabled, onToggle }) {
  const dangerous = DANGEROUS_PERMISSIONS.includes(perm);
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
        on
          ? dangerous ? 'border-rose-200 bg-rose-50/70' : 'border-orange-200 bg-orange-50/50'
          : 'border-slate-100 bg-white hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={onToggle}
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 disabled:opacity-40',
          dangerous ? 'accent-rose-600' : 'accent-orange-600',
        )}
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium leading-tight text-slate-800">
            {PERMISSION_LABELS[perm] || perm}
          </span>
          {dangerous && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
              <ShieldAlert className="h-2.5 w-2.5" /> Full control
            </span>
          )}
        </span>
        {PERMISSION_HELP[perm] && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{PERMISSION_HELP[perm]}</span>
        )}
      </span>
    </label>
  );
}

/**
 * The permissions this role ACTUALLY grants right now.
 *
 * For a legacy role that is the stored list plus what its old broad permissions
 * used to include (IMPLIED_PERMISSIONS) — because that is what usePermissions is
 * handing every volunteer holding it. Showing the raw list instead made the
 * checkboxes disagree with the app: an Admin saved before Phase 21 had a working
 * Generate tab while "Generate Batches" sat here unticked.
 */
function effectivePermissions(role) {
  const raw = Array.isArray(role?.permissions) ? role.permissions : [];
  return isLegacyRole(role) ? expandLegacyPermissions(raw) : raw;
}

/**
 * The effective permissions MINUS anything this build doesn't recognise.
 *
 * Stored arrays outlive the code. A permission that was renamed or dropped stays
 * in every role document that had it, and because nothing checks against it any
 * more it grants exactly nothing — but it still counts. The visible symptom was a
 * role reading "19 of 18 permissions" with all 18 boxes ticked, and, worse,
 * detectRoleKey() refusing to recognise it as the Admin preset (it is an EXACT
 * set match), so the "standard roles missing" banner offered to create a second
 * Admin. That is how the duplicate this screen now merges got made.
 *
 * Authorization is unaffected either way — usePermissions only ever asks whether
 * a KNOWN key is present. So this is the honest list to display, count, match and
 * save; the unknown keys are surfaced once (see RoleEditor) and dropped on the
 * next save rather than being deleted silently behind the admin's back.
 */
function knownPermissions(role) {
  return effectivePermissions(role).filter((p) => ALL_PERMISSIONS.includes(p));
}

function unknownPermissions(role) {
  return [...new Set(effectivePermissions(role).filter((p) => p && !ALL_PERMISSIONS.includes(p)))];
}

// ─────────────────────────────────────────────────────────────────────────────
// MERGING TWO ROLES
//
// Duplicates happen for a mundane reason: "Create N roles" matched presets on
// display name, so an install that already had a hand-made "Admin User" was
// offered "Admin" as MISSING and cheerfully created a second one. Both then hold
// volunteers, and there is no way to tell from the outside which is real.
//
// A merge is not a delete. Deleting the loser strands its holders on a roleRef
// that no longer resolves, and usePermissions reports `error: 'role-not-found'`
// which nothing in the app renders — the volunteer just gets a blank screen. So
// the holders must be moved FIRST, and the whole thing has to be ordered so that
// every possible partial failure leaves people with MORE access than they had,
// never less. See mergeRoles() for that ordering.
// ─────────────────────────────────────────────────────────────────────────────

function nameWords(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Is this pair PROBABLY the same role twice? A suggestion only — merging always
 * needs an explicit confirm, so a false positive costs a glance, not data.
 *
 * Parentheticals are NOT stripped, on purpose. Strip them and
 * "Moderator (Area head)" becomes "moderator", "Super Moderator (Mandal head)"
 * becomes "super moderator", one is a subset of the other, and the two ends of
 * the intended hierarchy get reported as a mistake.
 */
function looksLikeDuplicate(a, b) {
  // Two DELIBERATE, different scopes mean two different roles however alike the
  // names read — that is the area-head/mandal-head split, not a duplicate.
  // Stated, so the UNION older builds stamped by accident doesn't count as a
  // decision and keep a real duplicate hidden.
  const ka = roleStatedScopeKind(a);
  const kb = roleStatedScopeKind(b);
  if (ka && kb && ka !== kb) return false;

  const wa = nameWords(a?.name);
  const wb = nameWords(b?.name);
  if (wa.length === 0 || wb.length === 0) return false;
  const sa = new Set(wa);
  const sb = new Set(wb);
  // "Admin" ⊂ "Admin User"
  if (wa.every((w) => sb.has(w)) || wb.every((w) => sa.has(w))) return true;

  // Or the same permissions under two unrelated names.
  const pa = knownPermissions(a);
  const pb = knownPermissions(b);
  return pa.length > 0 && pa.length === pb.length && pa.every((p) => pb.includes(p));
}

/** Mirrors VolunteerEditor's primary-role pick: highest rank, ties keep the first. */
function pickPrimary(list) {
  let best = null;
  for (const r of list) if (!best || roleRank(r) > roleRank(best)) best = r;
  return best;
}

function MergePanel({ roles, holdersByRole, holdersLoaded, canManageUsers, busy, onMerge }) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [scopeOverride, setScopeOverride] = useState('');

  const suggestions = useMemo(() => {
    const out = [];
    for (let i = 0; i < roles.length; i += 1) {
      for (let j = i + 1; j < roles.length; j += 1) {
        if (looksLikeDuplicate(roles[i], roles[j])) out.push([roles[i], roles[j]]);
      }
    }
    return out;
  }, [roles]);

  // Auto-open when there is something to fix, so the duplicate isn't hidden
  // behind a closed drawer nobody thinks to click.
  useEffect(() => { if (suggestions.length > 0) setOpen(true); }, [suggestions.length]);

  const source = roles.find((r) => r.id === sourceId) || null;
  const target = roles.find((r) => r.id === targetId) || null;

  const plan = useMemo(() => {
    if (!source || !target || source.id === target.id) return null;
    const sp = knownPermissions(source);
    const tp = knownPermissions(target);
    // The widest shape either role actually STATES — null when neither does, in
    // which case the merged role stays unset and each holder's own assignment
    // decides. widestScopeKind() would have answered UNION for that case and
    // silently widened two roles that had simply never been configured.
    const inherited = statedScopeKind([target, source].map(roleStatedScopeKind));
    return {
      source,
      target,
      // UNION, always. A merge that could take a permission away from someone
      // would be a downgrade disguised as tidying up.
      permissions: [...new Set([...tp, ...sp])],
      gained: sp.filter((p) => !tp.includes(p)),
      inheritedScopeKind: inherited,
      scopeKind: scopeOverride || inherited,
      rank: Math.max(roleRank(target), roleRank(source)),
      movers: holdersByRole[source.id] || [],
    };
  }, [source, target, scopeOverride, holdersByRole]);

  // The widest-wins default can WIDEN the kept role — merging an area head into a
  // mandal head yields "area OR mandal", which is broader than either. Worth
  // saying out loud rather than leaving in the confirm dialog. Only for the
  // inherited value: an explicit override is a decision, not a surprise, and both
  // sides are guaranteed to state a shape whenever this is true (if one of them
  // didn't, the inherited value would equal the other's).
  const widensScope = plan && !scopeOverride && plan.scopeKind
    && plan.scopeKind !== statedRoleScopeKind(plan.target)
    && plan.scopeKind !== statedRoleScopeKind(plan.source);

  async function confirmAndMerge() {
    if (!plan) return;
    const names = plan.movers.slice(0, 6).map((v) => v.name || v.id).join(', ');
    const more = plan.movers.length > 6 ? ` and ${plan.movers.length - 6} more` : '';
    const go = await confirmDialog({
      title: `Merge "${plan.source.name}" into "${plan.target.name}"?`,
      message:
        `"${plan.target.name}" keeps ${plan.permissions.length} permission(s)`
        + `${plan.gained.length > 0 ? ` — gaining ${plan.gained.length} from "${plan.source.name}"` : ''}.\n`
        + `Scope: ${scopeLabel(plan.scopeKind)}\n`
        + `Rank: ${plan.rank}\n`
        + `Volunteers moved: ${plan.movers.length}${plan.movers.length ? ` (${names}${more})` : ''}\n\n`
        + `"${plan.source.name}" is then deleted.\n\n`
        + 'Nobody loses access: the kept role ends up with everything both roles granted.',
      confirmText: 'Merge roles',
      tone: 'danger',
    });
    if (!go) return;
    onMerge(plan).then((ok) => {
      if (ok) { setSourceId(''); setTargetId(''); setScopeOverride(''); }
    });
  }

  return (
    <div className="mb-5 rounded-lg border border-slate-100 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <GitMerge className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-800">Merge duplicate roles</span>
          <span className="block text-[11px] text-slate-500">
            {suggestions.length > 0
              ? `${suggestions.length} possible duplicate${suggestions.length === 1 ? '' : 's'} found`
              : 'Combine two roles into one and move every volunteer across'}
          </span>
        </span>
        {suggestions.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Action needed
          </span>
        )}
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-300 transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          {!canManageUsers && (
            <p className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Merging has to rewrite each volunteer's role, which needs the
                <strong className="font-semibold"> Manage Volunteers</strong> permission — your role only has
                “Manage Roles”. Firestore will refuse the volunteer writes, so ask a full admin to do this.
              </span>
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Possible duplicates</p>
              <div className="mt-2 space-y-1.5">
                {suggestions.map(([a, b]) => {
                  // Default to keeping the more senior / better-equipped side, so
                  // the prefilled direction is the one that loses nothing.
                  const keep = roleRank(b) > roleRank(a)
                    || (roleRank(b) === roleRank(a) && knownPermissions(b).length > knownPermissions(a).length)
                    ? b : a;
                  const drop = keep === a ? b : a;
                  return (
                    <div key={`${a.id}:${b.id}`} className="flex flex-wrap items-center gap-2 text-[12px] text-amber-900">
                      <span className="font-medium">{drop.name}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-amber-500" />
                      <span className="font-medium">{keep.name}</span>
                      <span className="text-amber-600">
                        ({(holdersByRole[drop.id] || []).length} volunteer(s) would move)
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto"
                        onClick={() => { setSourceId(drop.id); setTargetId(keep.id); setScopeOverride(''); }}
                      >
                        Set up
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Remove this role</Label>
              <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={busy}>
                <option value="">Choose the duplicate…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id} disabled={r.id === targetId}>
                    {r.name} — {(holdersByRole[r.id] || []).length} volunteer(s)
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Keep this role</Label>
              <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy}>
                <option value="">Choose the one to keep…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id} disabled={r.id === sourceId}>
                    {r.name} — {(holdersByRole[r.id] || []).length} volunteer(s)
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {plan && (
            <div className="space-y-2.5 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">After the merge</p>
              <p className="text-[13px] text-slate-700">
                <strong className="font-semibold">{plan.target.name}</strong> keeps{' '}
                <strong className="font-semibold">{plan.permissions.length}</strong> of {ALL_PERMISSIONS.length} permissions
                {plan.gained.length > 0 && (
                  <> — gaining {plan.gained.map((p) => PERMISSION_LABELS[p] || p).join(', ')}</>
                )}
                , at rank {plan.rank}.
              </p>
              <p className="text-[12px] text-slate-500">
                {plan.movers.length === 0
                  ? holdersLoaded
                    ? `No volunteer currently holds "${plan.source.name}", so only the role document is removed.`
                    : 'Still counting volunteers…'
                  : `${plan.movers.length} volunteer(s) move to "${plan.target.name}": ${plan.movers.map((v) => v.name || v.id).join(', ')}.`}
              </p>

              <div className="sm:w-72">
                <Label>Scope of the kept role</Label>
                <Select value={scopeOverride} onChange={(e) => setScopeOverride(e.target.value)} disabled={busy}>
                  <option value="">
                    {plan.inheritedScopeKind
                      ? `Widest of the two — ${SCOPE_KIND_META[plan.inheritedScopeKind].label}`
                      : 'Neither role sets one — leave it unset'}
                  </option>
                  {ALL_SCOPE_KINDS.map((k) => (
                    <option key={k} value={k}>{SCOPE_KIND_META[k].label}</option>
                  ))}
                </Select>
                {widensScope && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700">
                    Heads up: “{scopeLabel(statedRoleScopeKind(plan.target))}” and
                    “{scopeLabel(statedRoleScopeKind(plan.source))}” combine to
                    “{scopeLabel(plan.scopeKind)}”, which is <em>wider than either</em>. If these
                    are really two different jobs, don't merge them — pick the scope you want instead.
                  </p>
                )}
              </div>

              <Button
                variant="danger"
                onClick={confirmAndMerge}
                disabled={busy || !canManageUsers}
                // Role names are long ("Super Moderator (Mandal head)") and two of
                // them on one line pushed the whole page into horizontal scroll on
                // a phone. Wrapping is the fix; the direction stays on the button
                // because that is the one thing worth double-checking before the
                // confirm dialog.
                className="w-full whitespace-normal text-left sm:w-auto"
              >
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <GitMerge className="mr-1.5 h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0">Keep “{plan.target.name}”, delete “{plan.source.name}”</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoleEditor({ role, holders = [], busy, savingCell, onToggle, onPatch, onApplyPreset, onDelete }) {
  const [nameDraft, setNameDraft] = useState(null);
  const current = knownPermissions(role);
  const stale = unknownPermissions(role);
  const warning = roleWarning(role);
  const legacy = isLegacyRole(role);
  const kind = statedRoleScopeKind(role);

  // Reset the inline name editor when a different role is selected, otherwise
  // the draft leaks across roles and can be saved onto the wrong one.
  useEffect(() => { setNameDraft(null); }, [role.id]);

  return (
    <div className="space-y-5 rounded-lg border border-slate-100 bg-white p-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {nameDraft === null ? (
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-base font-semibold tracking-tight text-slate-900">{role.name}</h2>
              <button
                onClick={() => setNameDraft(role.name || '')}
                aria-label="Rename role"
                className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameDraft.trim()) { onPatch(role, { name: nameDraft.trim() }); setNameDraft(null); }
                  if (e.key === 'Escape') setNameDraft(null);
                }}
                className="h-8 flex-1"
              />
              <button
                onClick={() => { if (nameDraft.trim()) onPatch(role, { name: nameDraft.trim() }); setNameDraft(null); }}
                aria-label="Save name"
                className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
              >
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => setNameDraft(null)} aria-label="Cancel" className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <RoleKeyBadge permissions={current} />
            <span className="text-[11px] text-slate-400">{current.length} of {ALL_PERMISSIONS.length} permissions</span>
          </div>
          {/* Who is affected by every switch on this screen. Editing a role blind
              to its holders is how "one small change" reaches 14 people. */}
          <p className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed text-slate-500">
            <Users className="mt-0.5 h-3 w-3 shrink-0 text-slate-300" />
            <span>
              {holders.length === 0
                ? 'Nobody holds this role — changes here affect no one yet.'
                : <>Held by <strong className="font-medium text-slate-600">{holders.length}</strong>{' '}
                  {holders.length === 1 ? 'volunteer' : 'volunteers'}: {holders.slice(0, 8).map((v) => v.name || v.id).join(', ')}
                  {holders.length > 8 && ` +${holders.length - 8} more`}. Every change below applies to them immediately.</>}
            </span>
          </p>
        </div>

        <Select
          value=""
          onChange={(e) => { const v = e.target.value; e.target.value = ''; onApplyPreset(role, v); }}
          disabled={busy}
          className="w-full sm:w-56"
        >
          <option value="">Reset to a preset…</option>
          {ROLE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </Select>
      </div>

      {legacy && (
        <p className="flex items-start gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-900">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            This role was saved before area/mandal scoping existed, so three of its permissions are
            still inherited rather than stored: “Assign Batches” also allows generating,
            “Create/Edit Events” also allows marking attendance, and “Edit Contacts” also allows CSV
            import. They are ticked below, and the next save writes them down as real permissions —
            nothing is lost, and after that the checkboxes are the whole truth.
          </span>
        </p>
      )}

      {stale.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            This role also stores {stale.length} permission{stale.length === 1 ? '' : 's'} this version of
            the app no longer has:{' '}
            {stale.map((p, i) => (
              <span key={p}>
                {i > 0 && ', '}
                <code className="rounded bg-slate-200 px-1 font-mono text-[10px]">{p}</code>
              </span>
            ))}.
            {' '}It grants nothing — every check is against the list below — and the next save here tidies
            it away. It is only mentioned because it was making the count read higher than the
            {' '}{ALL_PERMISSIONS.length} permissions that exist.
          </span>
        </p>
      )}

      {warning && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {warning}
        </p>
      )}

      {/* ── What this role can SEE ─────────────────────────────────────────── */}
      <div>
        <Label className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-slate-400" /> What this role can see
        </Label>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          Areas come from the household address; mandals come from the individual. They are two
          separate lists, not a hierarchy — so “Vaishali Nagar” and “Yuvak Mandal” <em>cross</em>,
          and this setting decides which part of that grid the role gets. The actual areas and
          mandals are set per volunteer, so one role can serve every area head.
        </p>
        {/* Nothing is selected below when the role has never had a scope set, and
            this says what happens in the meantime. The picker used to show
            “Their area OR mandal” pre-selected for those roles, which read as a
            decision an admin had made and was the widest shape available — a
            karyakarta with one area and one mandal saw their whole area plus
            their mandal across the whole city. */}
        {!kind && (
          <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              <strong className="font-semibold">Not set yet.</strong> Until one is picked, each
              volunteer's own assignment decides: an area <em>and</em> a mandal means only where the
              two cross (“{SCOPE_KIND_META[SCOPE_KINDS.INTERSECT].label}”), areas alone means
              “{SCOPE_KIND_META[SCOPE_KINDS.AREA].label}”, mandals alone means
              “{SCOPE_KIND_META[SCOPE_KINDS.MANDAL].label}”. That is the narrowest sensible reading,
              so nobody sees contacts that aren't theirs — pick one below to make it explicit and
              the same for every holder.
            </span>
          </p>
        )}
        <ScopePicker
          value={kind}
          disabled={busy}
          onChange={(next) => onPatch(role, { scopeKind: next })}
        />
      </div>

      {/* ── Rank ───────────────────────────────────────────────────────────── */}
      <div className="sm:w-64">
        <Label className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-slate-400" /> Position in the hierarchy
        </Label>
        <p className="mb-1.5 text-[11px] leading-relaxed text-slate-500">
          Higher is more senior. Used for ordering and for the badge a volunteer shows — never for
          access itself, which is always the permissions below.
        </p>
        <Input
          type="number" min={0} max={100} step={10} inputMode="numeric"
          value={roleRank(role)}
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onPatch(role, { rank: Math.max(0, Math.min(100, n)) });
          }}
        />
      </div>

      {/* ── What this role can DO ──────────────────────────────────────────── */}
      <div>
        <Label>What this role can do</Label>
        <div className="mt-1 space-y-4">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</p>
              <div className="space-y-1.5">
                {group.permissions.map((perm) => (
                  <PermissionToggle
                    key={perm}
                    perm={perm}
                    on={current.includes(perm)}
                    disabled={savingCell === `${role.id}:${perm}` || busy}
                    onToggle={() => onToggle(role, perm)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <button onClick={() => onDelete(role)} className="flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:underline">
          <Trash2 className="h-3.5 w-3.5" /> Delete this role
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RolesManagerInner() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePreset, setNewRolePreset] = useState('');
  const [savingCell, setSavingCell] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const { hasPermission } = usePermissions();
  const canManageUsers = hasPermission(PERMISSIONS.MANAGE_USERS);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'roles'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => roleRank(b) - roleRank(a) || (a.name || '').localeCompare(b.name || ''));
      setRoles(rows);
      setLoading(false);
    }, (err) => { setError(err.message); setLoading(false); });
    return () => unsub();
  }, []);

  // Who actually HOLDS each role. Needed for the merge (these are the documents
  // that must be rewritten before the loser can be deleted) and worth showing
  // next to every role regardless: "delete this role" is a very different
  // decision at 0 holders than at 14, and the screen used to show neither.
  //
  // PHASE 24 — shared with the Volunteers editor, the Admin dashboard, Batches and
  // Events, so the roster is billed once per session rather than once per screen.
  // A role without read access to volunteers gets an empty list and the counts
  // stay unknown; the rest of the screen still works.
  const { volunteers, loading: holdersLoading } = useVolunteers();
  const holdersLoaded = !holdersLoading;

  const holdersByRole = useMemo(() => {
    const map = {};
    for (const v of volunteers) {
      const ids = Array.isArray(v.roleRefs) && v.roleRefs.length
        ? v.roleRefs.filter(Boolean)
        : (v.roleRef ? [v.roleRef] : []);
      for (const id of new Set(ids)) (map[id] ||= []).push(v);
    }
    for (const list of Object.values(map)) list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return map;
  }, [volunteers]);

  // Auto-select the first role so the detail pane is never an empty box on load.
  useEffect(() => {
    if (!selectedId && roles.length > 0) setSelectedId(roles[0].id);
    if (selectedId && !roles.some((r) => r.id === selectedId)) setSelectedId(roles[0]?.id || null);
  }, [roles, selectedId]);

  const selected = roles.find((r) => r.id === selectedId) || null;

  // Which presets this install is genuinely missing.
  //
  // This used to compare DISPLAY NAMES, which is how the duplicate that prompted
  // the merge tool got created: an install with a hand-made "Admin User" role has
  // no role literally named "Admin", so the banner reported Admin as missing and
  // made a second one. Identity now comes from what the role IS.
  //
  // The test is "does some role already DO this preset's job": it holds at least
  // the preset's permissions, at the same scope. Superset rather than exact match,
  // because an exact match is far too brittle to hang a create-button on — the
  // role that caused the duplicate here holds all 18 permissions and one dead key
  // from an older build, which is the Admin preset by any sensible reading and is
  // 'custom' to detectRoleKey().
  //
  // scopeKind must agree, and that is what keeps the rule honest: without it,
  // Admin (every permission) is a superset of every preset and the banner would
  // report a fully-configured hierarchy on an install that has only an Admin.
  const existingNames = useMemo(
    () => new Set(roles.map((r) => (r.name || '').trim().toLowerCase())),
    [roles],
  );
  const missingPresets = useMemo(() => ROLE_PRESETS.filter((preset) => !roles.some((r) => {
    if (r.presetKey === preset.key) return true;
    if (existingNames.has(preset.name.toLowerCase())) return true;
    if (statedRoleScopeKind(r) !== preset.scopeKind) return false;
    const held = knownPermissions(r);
    return preset.permissions.every((p) => held.includes(p));
  })), [roles, existingNames]);

  /**
   * The stamp a volunteer SHOULD carry, given the roles as they stand right now.
   *
   * Both restampHolders() and the drift banner read this one function, so what
   * the banner reports and what the button writes can never disagree — the whole
   * class of bug this feature exists to catch.
   */
  function intendedStamp(v, byId) {
    const ids = Array.isArray(v.roleRefs) && v.roleRefs.length
      ? v.roleRefs.filter(Boolean)
      : (v.roleRef ? [v.roleRef] : []);
    const held = ids.map((id) => byId[id]).filter(Boolean);
    return {
      roleRef: pickPrimary(held)?.id || null,
      // statedScopeKind, not "widest of every role's effective shape": the
      // latter read an unset co-role as a UNION, which then won the widest and
      // stamped the server's widest shape onto a volunteer nobody meant to
      // widen. When no role states a shape, the assignment decides — the same
      // inference resolveScope() and firestore.rules use.
      scopeKind: statedScopeKind(held.map(roleStatedScopeKind))
        || inferScopeKind({ areas: v.assignedAreas, mandals: v.assignedMandals }),
      _held: held.length,
    };
  }

  /**
   * Volunteers whose stamp no longer matches their roles.
   *
   * Drift happens whenever a role's scope was edited while nobody had permission
   * to write volunteers, or a save failed halfway, or a role was assigned
   * directly in the console. It is invisible on screen and it is the server that
   * honours the stale value, so it has to be surfaced rather than waited for.
   */
  const driftedHolders = useMemo(() => {
    if (!holdersLoaded || roles.length === 0) return [];
    const byId = Object.fromEntries(roles.map((r) => [r.id, r]));
    return volunteers.filter((v) => {
      const want = intendedStamp(v, byId);
      // Only volunteers holding at least one role that still exists — a stamp on
      // someone whose roles were all deleted is a different problem, and nulling
      // it from here would look like this button revoked their access.
      if (!want._held) return false;
      return (v.roleRef || null) !== want.roleRef
        || (v.scopeKind || null) !== want.scopeKind;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volunteers, roles, holdersLoaded]);

  /** Rewrite every drifted stamp in one pass. Idempotent — safe to press twice. */
  async function resyncStamps() {
    if (!driftedHolders.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const byId = Object.fromEntries(roles.map((r) => [r.id, r]));
      for (let i = 0; i < driftedHolders.length; i += 400) {
        const batch = writeBatch(db);
        for (const v of driftedHolders.slice(i, i + 400)) {
          const { roleRef, scopeKind } = intendedStamp(v, byId);
          batch.update(doc(db, 'volunteers', v.id), { roleRef, scopeKind, updatedAt: serverTimestamp() });
        }
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
      }
      setNotice(
        `Re-stamped ${driftedHolders.length} volunteer(s). The server and this screen now agree on `
        + 'what each of them can see.',
      );
    } catch (err) {
      setError(
        `Could not re-stamp: ${err.message}. This needs the "Manage Volunteers" permission — `
        + 'nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * restampHolders(roleId, changes) — rewrite the DENORMALISED copy of a role's
   * scope shape that lives on every volunteer holding it.
   *
   * `volunteers.scopeKind` exists because firestore.rules cannot loop roleRefs[]
   * (10 get()/exists() per request, no map/reduce), so ctx() reads one stamped
   * field instead — and it PREFERS that field over the role document. src/lib/scope.js,
   * on the client, reads only the role docs. Change a role's scope here and the
   * two disagree until someone re-saves each holder on the Volunteers screen:
   *
   *   • widening  → the client shows records the server then refuses to save,
   *                 reported as a bare "Missing or insufficient permissions".
   *   • narrowing → worse. The server keeps honouring the older, WIDER stamp, so
   *                 the role looks narrowed on screen and is not narrowed at all.
   *
   * Writing volunteers needs manage_users, which this screen does not require, so a
   * failure here is reported as a warning: the role change itself already went
   * through and must not be rolled back.
   *
   * @returns {Promise<number>} holders rewritten (0 if there were none)
   */
  async function restampHolders(roleId, changes) {
    const holders = holdersByRole[roleId] || [];
    if (holders.length === 0) return 0;

    // Post-change view of every role, so pickPrimary/statedScopeKind see the new
    // scope and rank rather than the snapshot's. scopeChoiceFields comes along
    // because the write that calls this one applied it too — without it,
    // roleStatedScopeKind() would discount an admin who just picked UNION on
    // purpose and stamp the inferred shape instead.
    const byId = Object.fromEntries(
      roles.map((r) => [r.id, r.id === roleId
        ? { ...r, ...changes, ...scopeChoiceFields(changes), permissionsMaterialized: true }
        : r]),
    );

    for (let i = 0; i < holders.length; i += 400) {
      const batch = writeBatch(db);
      for (const v of holders.slice(i, i + 400)) {
        const { roleRef, scopeKind } = intendedStamp(v, byId);
        batch.update(doc(db, 'volunteers', v.id), { roleRef, scopeKind, updatedAt: serverTimestamp() });
      }
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
    }
    return holders.length;
  }

  /** The warning shown when the role saved but its holders could not be re-stamped. */
  function restampFailureNotice(role, err) {
    return `“${role.name}” was saved, but the ${(holdersByRole[role.id] || []).length} volunteer(s) `
      + `holding it could not be updated: ${err.message}. Until that happens the server still uses `
      + 'their previous scope. Ask someone with "Manage Volunteers" to open Admin → Volunteers and '
      + 'press Save on each of them.';
  }

  async function patchRole(role, patch) {
    setBusy(true);
    setError(null);
    try {
      // Any save from this screen MATERIALISES the effective permissions, which
      // is what marks the role as no longer legacy (see IMPLIED_PERMISSIONS).
      //
      // Renaming a legacy Admin role used to stamp scopeKind and nothing else:
      // the shim switched off, and generate_batches / manage_attendance /
      // import_data — never in the stored array, only ever implied — vanished.
      // The visible symptom was the Batches page losing its Generate tab after
      // an unrelated edit, with nothing on screen to explain it. Persisting the
      // expansion here makes the checkboxes the whole truth from the first save
      // onwards, which is what they already claim to be.
      //
      // knownPermissions, not effectivePermissions: keys this build no longer
      // recognises are dropped at the same time. They grant nothing, and leaving
      // them in keeps detectRoleKey() from matching the role to its preset.
      //
      // PHASE 23 — permissionsMaterialized, and NO scopeKind unless the patch
      // carries one. The two used to be the same signal, so an unrelated edit
      // (a rename, one checkbox) wrote 'union' onto every role that had never
      // been scoped — the widest shape there is, stamped as though an admin had
      // chosen it, and from then on unfixable by the inference. Left absent, the
      // shape keeps being derived per volunteer until someone picks one here.
      await updateDoc(doc(db, 'roles', role.id), {
        permissions: knownPermissions(role),
        permissionsMaterialized: true,
        rank: roleRank(role),
        ...patch,
        ...scopeChoiceFields(patch),
        updatedAt: serverTimestamp(),
      });

      // Only when the SHAPE changed. A rename touches no volunteer document, and
      // rewriting them all on every keystroke-save would be a lot of writes for
      // nothing.
      const shapeChanged = ('scopeKind' in patch && patch.scopeKind !== statedRoleScopeKind(role))
        || ('rank' in patch && patch.rank !== roleRank(role));
      if (shapeChanged) {
        try {
          await restampHolders(role.id, patch);
        } catch (err) {
          setNotice(null);
          setError(restampFailureNotice(role, err));
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePermission(role, permission) {
    const cellKey = `${role.id}:${permission}`;
    // Toggle against the EFFECTIVE list, not the stored one: on a legacy role,
    // ticking one box would otherwise silently drop every implied permission at
    // the same time. Known-only, so unrecognised leftovers go at the same time.
    const current = knownPermissions(role);
    const next = current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission];

    if (!current.includes(permission) && DANGEROUS_PERMISSIONS.includes(permission)) {
      const ok = await confirmDialog({
        title: `Grant "${PERMISSION_LABELS[permission]}" to ${role.name}?`,
        message: `${PERMISSION_HELP[permission]}\n\nEveryone assigned this role gets it immediately.`,
        confirmText: 'Grant',
        tone: 'danger',
      });
      if (!ok) return;
    }

    setSavingCell(cellKey);
    setError(null);
    try {
      await updateDoc(doc(db, 'roles', role.id), {
        permissions: next,
        // Same as patchRole(): the toggle is what stops the implied-permission
        // shim from re-adding what was just unticked, and it must not invent a
        // scopeKind while doing it.
        permissionsMaterialized: true,
        rank: roleRank(role),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCell(null);
    }
  }

  async function createRole() {
    const name = newRoleName.trim();
    if (!name) return;
    const preset = getPreset(newRolePreset);
    setBusy(true);
    setError(null);
    try {
      const ref = await addDoc(collection(db, 'roles'), {
        name,
        permissions: preset ? [...preset.permissions] : [],
        presetKey: preset ? preset.key : null,
        // null for a hand-made role, not UNION: a brand-new role has no shape
        // yet, and each holder's assignment decides until an admin picks one.
        // permissionsMaterialized keeps it out of the legacy banner — nothing
        // here is inherited, the stored list is already the whole truth.
        scopeKind: preset ? preset.scopeKind : null,
        scopeKindChosen: Boolean(preset?.scopeKind),
        permissionsMaterialized: true,
        rank: preset ? preset.rank : DEFAULT_ROLE_RANK,
        createdAt: serverTimestamp(),
      });
      setNewRoleName('');
      setNewRolePreset('');
      setSelectedId(ref.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Creates every standard role that doesn't already exist, in one batch. This
  // is the "make this install match the intended hierarchy" button — on a fresh
  // database there are no roles at all and the first admin has nothing to assign.
  async function seedMissingPresets() {
    if (missingPresets.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      for (const preset of missingPresets) {
        batch.set(doc(collection(db, 'roles')), {
          name: preset.name,
          permissions: [...preset.permissions],
          presetKey: preset.key,
          scopeKind: preset.scopeKind,
          scopeKindChosen: true,
          permissionsMaterialized: true,
          rank: preset.rank,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyPreset(role, presetKey) {
    const preset = getPreset(presetKey);
    if (!preset) return;
    const ok = await confirmDialog({
      title: `Replace all permissions on "${role.name}" with the ${preset.name} preset?`,
      message:
        `${preset.permissions.length} permission(s) will be set, everything else cleared, and the `
        + `scope set to "${SCOPE_KIND_META[preset.scopeKind].label}".\n\n`
        + 'This takes effect immediately for everyone assigned this role.',
      confirmText: 'Apply preset',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateDoc(doc(db, 'roles', role.id), {
        permissions: [...preset.permissions],
        presetKey: preset.key,
        scopeKind: preset.scopeKind,
        scopeKindChosen: true,
        permissionsMaterialized: true,
        rank: preset.rank,
        updatedAt: serverTimestamp(),
      });

      // A preset can change both the scope shape and the rank, so the holders'
      // stamped copy has to follow — see restampHolders().
      if (preset.scopeKind !== statedRoleScopeKind(role) || preset.rank !== roleRank(role)) {
        try {
          const n = await restampHolders(role.id, { scopeKind: preset.scopeKind, rank: preset.rank });
          if (n) setNotice(`Applied the ${preset.name} preset to “${role.name}” and re-stamped ${n} volunteer(s).`);
        } catch (err) {
          setNotice(null);
          setError(restampFailureNotice(role, err));
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * mergeRoles(plan) — fold `source` into `target`, move every holder, delete
   * `source`. Returns true on success.
   *
   * THE ORDERING IS THE SAFETY PROPERTY. Three writes happen, and any of them can
   * fail on its own (offline, rules, a rank guard). They are sequenced so that
   * every partial outcome leaves people with MORE access than they started with:
   *
   *   1. Widen TARGET first (union of both permission sets).
   *      Fail here → nothing has changed at all.
   *   2. Repoint the holders. Fail here → some volunteers now hold the widened
   *      target, the rest still hold source, and source STILL EXISTS, so both
   *      groups can work. Nobody is stranded.
   *   3. Delete SOURCE last, only once nothing points at it.
   *
   * Doing it the intuitive way round — delete the duplicate, then tidy up — is
   * what strands holders on a roleRef that resolves to nothing, and the app has
   * no screen for that state: usePermissions sets error:'role-not-found' and the
   * volunteer is shown an empty shell.
   *
   * Role ids live in exactly one place, `volunteers.roleRefs[]` / `.roleRef`
   * (storage.rules, firestore.rules and functions/ all dereference at read time;
   * PadhramaniPage and IndividualForm match Santo by NAME, not id). So rewriting
   * volunteers is the complete fan-out — there is no other collection to chase.
   */
  async function mergeRoles(plan) {
    const { source, target, permissions, scopeKind, rank } = plan;
    if (!source || !target || source.id === target.id) return false;

    // Read the holder list at EXECUTION time, not from the plan the admin
    // confirmed against — a volunteer assigned to the duplicate while the dialog
    // was open would otherwise be skipped and then stranded by step 3.
    const movers = holdersByRole[source.id] || [];

    // …and the volunteers who ALREADY hold the keeper have to be rewritten too,
    // which is easy to miss because their roleRefs[] does not change.
    //
    // `volunteers.scopeKind` is a DENORMALISED copy of the role's scope shape, and
    // ctx() in firestore.rules PREFERS it over the role document (the rules cannot
    // loop roleRefs[]), while src/lib/scope.js reads only the role docs. A merge
    // can change the keeper's scopeKind and rank. Leave a target-only holder
    // untouched and the two halves disagree until somebody re-saves that person by
    // hand: a WIDENING merge shows them records the server then refuses to save,
    // and a NARROWING scope override — which this panel offers — leaves them with
    // the older, wider stamp, so the server keeps granting more than the merged
    // role intends. Keyed by id so a volunteer holding both roles is written once.
    const restamp = [...new Map(
      [...movers, ...(holdersByRole[target.id] || [])].map((v) => [v.id, v]),
    ).values()];

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // ── 1. Widen the keeper ────────────────────────────────────────────────
      await updateDoc(doc(db, 'roles', target.id), {
        permissions,
        scopeKind,
        // The merge RESOLVES a shape (the widest of the two, or the admin's
        // override), so it counts as a decision — see scopeChoiceFields.
        scopeKindChosen: Boolean(scopeKind),
        // `permissions` here is the union of both roles' EFFECTIVE lists, so the
        // implied-permission shim has nothing left to add — say so, or the keeper
        // keeps showing the legacy banner and unticking a box would be undone by
        // the shim. May carry a null scopeKind, which is fine: unset stays unset.
        permissionsMaterialized: true,
        rank,
        // The keeper is no longer "the admin preset" once it has absorbed another
        // role's permissions, and a stale presetKey would make missingPresets
        // claim this install still has that preset when it no longer matches.
        presetKey: detectRoleKey(permissions) === target.presetKey ? target.presetKey || null : null,
        updatedAt: serverTimestamp(),
      });

      // ── 2. Move every holder, and re-stamp the keeper's existing holders ───
      // Chunked well under the 500-op WriteBatch limit. A merge touching more
      // than 400 volunteers would be remarkable, but the loop costs nothing.
      const rolesAfter = roles.filter((r) => r.id !== source.id)
        .map((r) => (r.id === target.id
          ? { ...r, permissions, scopeKind, scopeKindChosen: Boolean(scopeKind), rank, permissionsMaterialized: true }
          : r));
      const byId = Object.fromEntries(rolesAfter.map((r) => [r.id, r]));

      for (let i = 0; i < restamp.length; i += 400) {
        const batch = writeBatch(db);
        for (const v of restamp.slice(i, i + 400)) {
          const had = Array.isArray(v.roleRefs) && v.roleRefs.length
            ? v.roleRefs.filter(Boolean)
            : (v.roleRef ? [v.roleRef] : []);
          // source → target, deduped: a volunteer holding BOTH roles must not
          // end up with the same id twice in roleRefs.
          const nextIds = [...new Set(had.map((id) => (id === source.id ? target.id : id)))];
          const nextRoles = nextIds.map((id) => byId[id]).filter(Boolean);
          batch.update(doc(db, 'volunteers', v.id), {
            roleRefs: nextIds,
            // firestore.rules can't iterate roleRefs[], so it reads the single
            // roleRef — kept pointing at the most senior of what remains, the
            // same rule VolunteerEditor applies.
            roleRef: pickPrimary(nextRoles)?.id || null,
            scopeKind: statedScopeKind(nextRoles.map(roleStatedScopeKind))
              || inferScopeKind({ areas: v.assignedAreas, mandals: v.assignedMandals }),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      // ── 3. Retire the duplicate ────────────────────────────────────────────
      // Verified against the server, not against the local snapshot, because the
      // snapshot is the thing that could be stale. Two queries because a holder
      // can be recorded either way: roleRefs[] is authoritative, roleRef is the
      // pre-Phase-21 single-role field and some documents still only have it.
      const stragglers = new Set();
      for (const q of [
        query(collection(db, 'volunteers'), where('roleRefs', 'array-contains', source.id)),
        query(collection(db, 'volunteers'), where('roleRef', '==', source.id)),
      ]) {
        // eslint-disable-next-line no-await-in-loop
        (await getDocs(q)).forEach((d) => stragglers.add(d.id));
      }

      if (stragglers.size > 0) {
        setNotice(null);
        setError(
          `“${target.name}” has been widened and ${movers.length} volunteer(s) moved, but `
          + `${stragglers.size} more turned up still holding “${source.name}” — so it has NOT been `
          + 'deleted. Nobody has lost anything. Run the merge again to pick them up.'
        );
        return false;
      }

      await deleteDoc(doc(db, 'roles', source.id));

      setSelectedId(target.id);
      setNotice(
        `Merged “${source.name}” into “${target.name}”.`
        + (movers.length ? ` ${movers.length} volunteer(s) moved across.` : '')
        + (restamp.length > movers.length
          ? ` ${restamp.length - movers.length} already on “${target.name}” had their scope re-stamped.`
          : '')
        + ' Anyone signed in picks up the change within a few seconds.'
      );
      return true;
    } catch (err) {
      setError(
        `Merge stopped: ${err.message}. `
        + `Nothing is broken — “${source.name}” still exists and everyone assigned to it still has `
        + 'their access. Fix the cause and run the merge again; it is safe to repeat.'
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function deleteRole(role) {
    const holders = holdersByRole[role.id] || [];
    // The old confirm said "volunteers will lose access until reassigned" without
    // saying WHICH, or how many — and the honest answer is worse than "lose
    // access": their roleRef stops resolving and the app renders a blank shell
    // with no explanation, because nothing surfaces error:'role-not-found'.
    if (holders.length > 0) {
      const ok = await confirmDialog({
        title: `Delete "${role.name}", still assigned to ${holders.length} volunteer(s)?`,
        message:
          `${holders.slice(0, 10).map((v) => `• ${v.name || v.id}`).join('\n')}`
          + `${holders.length > 10 ? `\n• …and ${holders.length - 10} more` : ''}\n\n`
          + 'Deleting it now leaves them with a role that no longer exists — they will sign in to a '
          + 'blank app with no error message.\n\n'
          + 'If this role is a duplicate, cancel and use "Merge duplicate roles" instead: that moves '
          + 'everyone across first, then deletes it.',
        confirmText: 'Delete anyway',
        tone: 'danger',
      });
      if (!ok) return;
    } else {
      const ok = await confirmDialog({
        title: `Delete role "${role.name}"?`,
        message: 'No volunteer is assigned to it.',
        confirmText: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setError(null);
    try {
      await deleteDoc(doc(db, 'roles', role.id));
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading roles…</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Roles &amp; Permissions</h1>
      <p className="mb-5 text-sm text-slate-500">
        A role answers two questions: <strong className="font-medium text-slate-700">what can this person see</strong> and{' '}
        <strong className="font-medium text-slate-700">what can they do</strong>. Which areas and mandals
        they see is set on each volunteer; the role decides the shape.
      </p>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-emerald-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Scope-stamp drift. The server reads volunteers.scopeKind, not the role
          doc, so a stale stamp is silently authoritative — narrower on screen
          than it is in reality. Nothing else on the site can tell you this. */}
      {driftedHolders.length > 0 && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {driftedHolders.length} volunteer{driftedHolders.length === 1 ? '' : 's'} carry an out-of-date scope stamp
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
                Firestore decides what they can see from a copy of the role’s scope kept on their own
                record, and {driftedHolders.length === 1 ? 'that copy is' : 'those copies are'} stale.
                Until this is re-synced the server keeps using the old value — a role you narrowed is
                not actually narrowed, and a role you widened will fail saves with
                “Missing or insufficient permissions”.
              </p>
              <p className="mt-1 truncate text-[11px] text-amber-700">
                {driftedHolders.slice(0, 8).map((v) => v.name || v.id).join(', ')}
                {driftedHolders.length > 8 && ` + ${driftedHolders.length - 8} more`}
              </p>
            </div>
            <div className="shrink-0">
              <Button variant="accent" onClick={resyncStamps} disabled={busy || !canManageUsers}>
                <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
                Re-sync scope stamps
              </Button>
              {!canManageUsers && (
                <p className="mt-1 max-w-[13rem] text-[11px] text-amber-700">
                  Needs the “Manage Volunteers” permission.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {missingPresets.length > 0 && (
        <div className="mb-5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-orange-900">
                {roles.length === 0 ? 'No roles exist yet' : 'Standard roles missing'}
              </p>
              <p className="mt-0.5 text-xs text-orange-700">
                Create {missingPresets.map((p) => p.name).join(', ')} with the recommended permissions and scope.
              </p>
            </div>
            <Button variant="accent" onClick={seedMissingPresets} disabled={busy} className="shrink-0">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Create {missingPresets.length} role{missingPresets.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}

      {roles.length > 1 && (
        <MergePanel
          roles={roles}
          holdersByRole={holdersByRole}
          holdersLoaded={holdersLoaded}
          canManageUsers={canManageUsers}
          busy={busy}
          onMerge={mergeRoles}
        />
      )}

      <HierarchyStrip roles={roles} selectedId={selectedId} onSelect={setSelectedId} />

      {/* Create a role */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row">
        <Input
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createRole()}
          placeholder="New role name (e.g. Vaishali Area Head)"
          className="min-w-0 flex-1"
        />
        <Select value={newRolePreset} onChange={(e) => setNewRolePreset(e.target.value)} className="sm:w-56">
          <option value="">Start from scratch</option>
          {ROLE_PRESETS.map((p) => <option key={p.key} value={p.key}>Copy {p.name}</option>)}
        </Select>
        <Button variant="accent" onClick={createRole} disabled={!newRoleName.trim() || busy}>Add role</Button>
      </div>

      {roles.length === 0 ? (
        <div className="rounded-lg border border-slate-100 px-4 py-10 text-center text-sm text-slate-400">
          No roles yet — create the standard set above, or add one by name.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          {/* ── Role list ────────────────────────────────────────────────── */}
          <div className="space-y-1">
            {roles.map((r) => {
              const perms = knownPermissions(r);
              const warn = roleWarning(r);
              const holders = (holdersByRole[r.id] || []).length;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    selectedId === r.id
                      ? 'border-orange-300 bg-orange-50/60'
                      : 'border-slate-100 bg-white hover:bg-slate-50',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-slate-900">{r.name}</span>
                      {warn && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                      {scopeShort(statedRoleScopeKind(r))} · {perms.length} perms
                      {holdersLoaded && (
                        <> · {holders === 0 ? 'nobody' : `${holders} ${holders === 1 ? 'person' : 'people'}`}</>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Detail ───────────────────────────────────────────────────── */}
          {selected && (
            <RoleEditor
              role={selected}
              holders={holdersByRole[selected.id] || []}
              busy={busy}
              savingCell={savingCell}
              onToggle={togglePermission}
              onPatch={patchRole}
              onApplyPreset={applyPreset}
              onDelete={deleteRole}
            />
          )}
        </div>
      )}

      {/* Preset reference */}
      <details className="mt-6 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">What do the standard roles mean?</summary>
        <dl className="mt-3 space-y-3">
          {[...ROLE_PRESETS].sort((a, b) => b.rank - a.rank).map((p) => (
            <div key={p.key}>
              <dt className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-slate-800">
                {p.name}
                <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', ROLE_BADGE_CLASSES[p.key])}>
                  {SCOPE_KIND_META[p.scopeKind].short}
                </span>
                <span className="text-[11px] font-normal text-slate-400">{p.permissions.length} permissions</span>
              </dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-slate-500">{p.description}</dd>
            </div>
          ))}
        </dl>
      </details>
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
