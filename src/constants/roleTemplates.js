// src/constants/roleTemplates.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 (Sevak Call merge).
//
// The legacy Sevak Call app had exactly three roles, hardcoded as strings in
// column D of the Volunteers sheet: 'volunteer' | 'moderator' | 'admin'. Every
// capability check in Code.gs was a string compare against those, e.g.
//   if (role !== 'admin' && role !== 'moderator') return {error:'Unauthorized'}
//
// MDS uses a permission matrix instead (roles/{id}.permissions[]), which is
// strictly more expressive — but it left admins with a blank 15-checkbox grid
// and no guidance about which combination reproduces "moderator". These presets
// are that guidance: they are the legacy three roles expressed as permission
// sets, plus MDS's own Santo role.
//
// Presets are a STARTING POINT, not a constraint. An admin can apply a preset
// and then tick/untick individual permissions; detectRoleKey() will then report
// the role as 'custom'. Nothing in the app branches on the preset key for
// authorization — authorization is always the permission array. The key is used
// only for display (badge text) and for shaping navigation (see lib/roleView.js).
// ─────────────────────────────────────────────────────────────────────────────

import { PERMISSIONS, ALL_PERMISSIONS, PRESET_EXCLUDED_PERMISSIONS } from './permissions';
import { SCOPE_KINDS } from '../lib/scope';

const P = PERMISSIONS;

// ─────────────────────────────────────────────────────────────────────────────
// THE HIERARCHY (Phase 21)
//
// `rank` orders the ladder. It is display + guard-rail only — authorization is
// always the permission array, never the rank. Its one functional use is
// stopping someone from editing a role above their own (see canManageRole).
//
//   100  Admin            everything, everywhere
//    80  Super Moderator  one MANDAL across every area   (a column of the grid)
//    60  Moderator        one AREA across every mandal   (a row of the grid)
//    40  Karyakarta       one area × one mandal          (a single cell)
//    20  Volunteer        their assigned batch only
//    10  Santo            their own schedule only
//
// Super Moderator outranks Moderator because a mandal head answers for that
// mandal in the whole city, while an area head answers for one locality. They
// overlap on exactly one cell each — the Yuvak Mandal members of Vaishali
// Nagar are seen by both the Yuvak Super Moderator and the Vaishali Moderator,
// which is intended: that is a real reporting overlap, not a bug.
//
// PHASE 30 — Bal Mandal roles mirror the Yuvak hierarchy with program-scoped names:
//    85  Nirdeshak        Bal Mandal city head (equiv. to Super Moderator rank)
//    75  Sanchalak        Bal Mandal area coordinator (equiv. to Moderator rank)
//    65  Nirikshak        Bal Mandal observer (read-only across city, for Sant role)
//    45  SK               Sampark Karyakarta for Bal Mandal children (equiv. to Karyakarta)
// ─────────────────────────────────────────────────────────────────────────────
export const ROLE_PRESETS = [
  {
    key: 'admin',
    name: 'Admin',
    rank: 100,
    scopeKind: SCOPE_KINDS.GLOBAL,
    description:
      'Full access. Manages volunteers, roles, batches, events, exports, backups and email automation. Ignores area/mandal assignment entirely.',
    // Spread rather than listed so a newly added CAPABILITY is granted to Admin
    // automatically — otherwise every new capability silently locks out Admin
    // until someone remembers to tick a box. Two kinds of permission are the
    // exception and are filtered out (PRESET_EXCLUDED_PERMISSIONS in permissions.js):
    // the opt-out visibility flags, which would make the Admin hide its own tabs,
    // and save_call_outcomes, a strict subset of the edit_contacts the Admin
    // already holds — including it would enlarge this preset and break
    // detectRoleKey's exact match against Admin docs already saved in Firestore.
    permissions: ALL_PERMISSIONS.filter((p) => !PRESET_EXCLUDED_PERMISSIONS.includes(p)),
  },
  {
    key: 'super_moderator',
    name: 'Super Moderator (Mandal head)',
    rank: 80,
    scopeKind: SCOPE_KINDS.MANDAL,
    description:
      'Head of a mandal across the whole city. Sees and edits every member of their assigned mandal(s) in every area, cuts and hands out batches for them, runs their sabhas and gets their reports. Assign the mandal(s) on the volunteer, not here.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.DELETE_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.EXPORT_DATA,
      P.IMPORT_DATA,
      P.GENERATE_BATCHES,
      P.ASSIGN_BATCHES,
      P.MANAGE_EVENTS,
      P.MANAGE_ATTENDANCE,
      P.MANAGE_SCOPED_VOLUNTEERS,
      P.SEND_EMAILS,
    ],
  },
  {
    key: 'moderator',
    name: 'Moderator (Area head)',
    rank: 60,
    scopeKind: SCOPE_KINDS.AREA,
    description:
      'Head of an area. Sees and edits every contact in their assigned area(s) across all mandals, hands out batches to the karyakartas there, marks attendance and gets their area reports. Cannot cut new batches or create logins.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.DELETE_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.EXPORT_DATA,
      P.ASSIGN_BATCHES,
      P.MANAGE_ATTENDANCE,
      P.MANAGE_SCOPED_VOLUNTEERS,
      P.SEND_EMAILS,
    ],
  },
  {
    key: 'karyakarta',
    name: 'Karyakarta (Area × Mandal)',
    rank: 40,
    scopeKind: SCOPE_KINDS.INTERSECT,
    description:
      'Sampark karyakarta for one mandal inside one area — e.g. Yuvak Mandal in Vaishali Nagar. The narrowest scope: they see a contact only if BOTH the area and the mandal match their assignment.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.MANAGE_ATTENDANCE,
    ],
  },
  {
    key: 'volunteer',
    name: 'Volunteer',
    rank: 20,
    scopeKind: SCOPE_KINDS.UNION,
    description:
      'Calls the contacts in their own assigned batch and records status + reference. Cannot assign batches or export.',
    // NOTE: EDIT_CONTACTS alone is not enough. firestore.rules requires a READ
    // permission too (canReadIndividual), so a volunteer with only
    // EDIT_CONTACTS gets an empty calling queue — the reads fail silently.
    // See PHASE7-NOTES.md. VIEW_ASSIGNED_CONTACTS is the scoped read.
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.VIEW_HOUSEHOLDS,
    ],
  },
  {
    key: 'santo',
    name: 'Santo',
    rank: 10,
    scopeKind: SCOPE_KINDS.NONE,
    description:
      'Sees only their own Padhramani schedule. No contact, household or admin access. MDS-specific — had no equivalent in Sevak Call.',
    permissions: [P.VIEW_PADHRAMANI],
  },
  // PHASE 30 — Bal Mandal roles
  {
    key: 'nirdeshak',
    name: 'Nirdeshak (Bal Mandal City Head)',
    rank: 85,
    scopeKind: SCOPE_KINDS.MANDAL,
    description:
      'Head of Bal Mandal program across the whole city. Sees all Bal Mandal children in every area, manages events, batches, and volunteers. Assign "Bal Mandal" as their program.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.DELETE_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.EXPORT_DATA,
      P.IMPORT_DATA,
      P.GENERATE_BATCHES,
      P.ASSIGN_BATCHES,
      P.MANAGE_EVENTS,
      P.MANAGE_ATTENDANCE,
      P.MANAGE_SCOPED_VOLUNTEERS,
      P.SEND_EMAILS,
    ],
  },
  {
    key: 'sanchalak',
    name: 'Sanchalak (Bal Mandal Area Coordinator)',
    rank: 75,
    scopeKind: SCOPE_KINDS.AREA,
    description:
      'Coordinator for Bal Mandal in one area. Sees all Bal Mandal children in their assigned area(s), manages events, assigns SKs to batches. Can create Mandir Sabha events.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.DELETE_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.EXPORT_DATA,
      P.ASSIGN_BATCHES,
      P.MANAGE_EVENTS,
      P.MANAGE_ATTENDANCE,
      P.MANAGE_SCOPED_VOLUNTEERS,
      P.SEND_EMAILS,
    ],
  },
  {
    key: 'nirikshak',
    name: 'Nirikshak (Bal Mandal Observer)',
    rank: 65,
    scopeKind: SCOPE_KINDS.MANDAL,
    description:
      'Observer for Bal Mandal program (typically Sant). Read-only access to all Bal Mandal children city-wide. Can mark their own attendance at events as an observer.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.MANAGE_ATTENDANCE,
    ],
  },
  {
    key: 'sk',
    name: 'SK (Bal Mandal Sampark Karyakarta)',
    rank: 45,
    scopeKind: SCOPE_KINDS.INTERSECT,
    description:
      'Sampark Karyakarta for Bal Mandal children in one area. Calls their assigned batch, records attendance and notes. The narrowest Bal Mandal scope.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.MANAGE_ATTENDANCE,
    ],
  },
];

export const ROLE_LABELS = {
  admin: 'Admin',
  super_moderator: 'Super Moderator',
  moderator: 'Moderator',
  karyakarta: 'Karyakarta',
  volunteer: 'Volunteer',
  santo: 'Santo',
  nirdeshak: 'Nirdeshak',
  sanchalak: 'Sanchalak',
  nirikshak: 'Nirikshak',
  sk: 'SK',
  custom: 'Custom',
  none: 'No role',
};

export const DEFAULT_ROLE_RANK = 30;

/**
 * canManageRole(myPermissions, myRank, targetRole)
 *
 * Guard-rail, not a security boundary — firestore.rules only checks
 * manage_roles, so anyone holding it can still edit anything via the SDK. Its
 * job is stopping a Moderator who was handed manage_roles from quietly editing
 * the Admin role in the UI, which is a mistake people make once and regret.
 */
export function canManageRole(myRank, targetRole) {
  const mine = Number.isFinite(myRank) ? myRank : 0;
  const theirs = Number.isFinite(targetRole?.rank) ? targetRole.rank : DEFAULT_ROLE_RANK;
  return mine >= theirs;
}

export function getPreset(key) {
  return ROLE_PRESETS.find((r) => r.key === key) || null;
}

function sameSet(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const v of setA) if (!setB.has(v)) return false;
  return true;
}

/**
 * detectRoleKey(permissions)
 *
 * Reverse-maps a permission array back to a preset key for display purposes.
 * Returns 'none' for an empty/absent array, an exact preset key when the sets
 * match exactly, otherwise 'custom'.
 *
 * Deliberately EXACT-match, not subset-match: a role holding
 * [view_all_contacts] is not "an Admin with fewer boxes", it is a custom role,
 * and labelling it "Admin" in the UI would be actively misleading.
 */
export function detectRoleKey(permissions) {
  const list = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  if (list.length === 0) return 'none';
  for (const preset of ROLE_PRESETS) {
    if (sameSet(list, preset.permissions)) return preset.key;
  }
  return 'custom';
}

/**
 * Approximate classification used for UI *shaping* (which nav sections to show,
 * where to land after login). Unlike detectRoleKey this IS subset-based, so a
 * lightly-customised role still gets a sensible layout instead of falling back
 * to the bare volunteer view. Never used for authorization.
 */
export function classifyRole(permissions) {
  const has = (p) => Array.isArray(permissions) && permissions.includes(p);

  if (has(PERMISSIONS.MANAGE_ROLES) || has(PERMISSIONS.MANAGE_USERS)) return 'admin';
  if (
    has(PERMISSIONS.VIEW_ALL_CONTACTS)
    || has(PERMISSIONS.ASSIGN_BATCHES)
    || has(PERMISSIONS.GENERATE_BATCHES)
    || has(PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS)
  ) return 'moderator';
  // Santo check must come after the admin/moderator checks: an admin also holds
  // view_padhramani (Admin gets every permission) and must not be shaped as a Santo.
  if (has(PERMISSIONS.VIEW_PADHRAMANI) && !has(PERMISSIONS.EDIT_CONTACTS)) return 'santo';
  if (has(PERMISSIONS.EDIT_CONTACTS) || has(PERMISSIONS.VIEW_ASSIGNED_CONTACTS)) return 'volunteer';
  return 'none';
}

/**
 * isSantoRole({ scopeKind, permissions }) — is this a Santo account rather than a
 * sampark karyakarta?
 *
 * WHY IT MATTERS. Santos live in the `volunteers` collection because that is
 * where logins live, but they are not karyakartas: a Santo serves the whole of
 * Jaipur, like an Admin, and is never assigned to an area or a mandal. Treating
 * them as ordinary volunteers produced two wrong answers at once — they appeared
 * in the karyakarta roster as people with no territory, and they inflated the
 * "nobody has an area assigned" count in the coverage report, so a correctly
 * configured Santo read as a misconfigured volunteer.
 *
 * TWO SIGNALS, because only the first exists on roles saved since Phase 21.
 * `scopeKind: none` is the definitive statement — SCOPE_KINDS.NONE exists for
 * exactly this role. An older Santo role carries no scopeKind at all, so the
 * fallback is the permission shape: they can open their own schedule and cannot
 * read a contact by any route. The admin check is implicit — an Admin holds
 * view_padhramani too, but also holds view_all_contacts.
 *
 * NOT name-based, deliberately. Role names are free text on the Roles tab, so
 * "Santo", "Santos", "Sant", "Pu. Swami" and a Gujarati spelling would all have
 * to be guessed at, and a rename would silently change who counts as a volunteer.
 */
export function isSantoRole({ scopeKind = null, permissions = [] } = {}) {
  if (scopeKind === SCOPE_KINDS.NONE) return true;
  const has = (p) => Array.isArray(permissions) && permissions.includes(p);
  return has(PERMISSIONS.VIEW_PADHRAMANI)
    && !has(PERMISSIONS.VIEW_ALL_CONTACTS)
    && !has(PERMISSIONS.VIEW_ASSIGNED_CONTACTS)
    && !has(PERMISSIONS.EDIT_CONTACTS);
}

// Written out literally (not built from a colour name) because Tailwind purges
// any class it cannot find as a complete string in the source.
export const ROLE_BADGE_CLASSES = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  super_moderator: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  moderator: 'bg-sky-100 text-sky-700 border-sky-200',
  karyakarta: 'bg-teal-100 text-teal-700 border-teal-200',
  volunteer: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  santo: 'bg-amber-100 text-amber-700 border-amber-200',
  nirdeshak: 'bg-rose-100 text-rose-700 border-rose-200',
  sanchalak: 'bg-pink-100 text-pink-700 border-pink-200',
  nirikshak: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  sk: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  custom: 'bg-slate-100 text-slate-600 border-slate-200',
  none: 'bg-slate-100 text-slate-500 border-slate-200',
};
