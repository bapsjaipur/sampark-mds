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
// and no guidance about which combination reproduces a real post. These presets
// are that guidance: the BAPS Jaipur hierarchy expressed as permission sets.
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
// THE BAPS JAIPUR HIERARCHY
//
// `rank` orders the ladder. It is display + guard-rail only — authorization is
// always the permission array, never the rank. Its one functional use is
// stopping someone from editing a role above their own (see canManageRole).
//
//   100  Admin             everything, everywhere (system administration)
//    90  Nirdeshak         head of the whole city — GLOBAL oversight + follow-up
//    70  Nirekshak         head of 2–3 areas — controls the Mandal Sanchalaks
//    55  Mandal Sanchalak  head of ONE area
//    50  Attendance Mantri takes attendance for all persons, and nothing else
//    30  Sampark Karyakar  calls / follows up the contacts in their batch
//    10  Santo             their own Padhramani schedule only
//
// AREA vs AREA. Nirekshak and Mandal Sanchalak are the SAME scope shape (AREA —
// every mandal within the assigned areas). The only difference is how many areas
// are assigned on the volunteer (several vs one) and the rank; a Nirekshak also
// cuts batches and deletes, a Sanchalak does not. That is exactly how the real
// posts differ, so the engine needs no new scope kind for them.
//
// ATTENDANCE MANTRI is the one role that needs more than a scope + permissions:
// to mark EVERY person it must hold view_all_contacts (that is what fills the
// attendance roster — see EventsPage/useAllContacts), but view_all_contacts also
// unlocks the Dashboard and Admin Tools nav. So classifyRole() gives it its own
// 'attendance' shape, which lib/roleView.js confines to Events + Notifications —
// and because RequireRoute gates URLs by that same nav list, the admin screens
// are refused by URL too. No firestore.rules change; it is read-only everywhere
// except the attendance it writes.
//
// SANTO is not part of the karyakar chain — it is kept for Sant accounts that
// only open their own Padhramani schedule.
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
    // until someone remembers to tick a box. The exceptions are filtered out
    // (PRESET_EXCLUDED_PERMISSIONS in permissions.js): the opt-out visibility
    // flags, which would make the Admin hide its own tabs, and save_call_outcomes
    // / manage_areas_mandals, which the Admin already covers and which would
    // enlarge this preset and break detectRoleKey's exact match against Admin
    // docs already saved in Firestore.
    permissions: ALL_PERMISSIONS.filter((p) => !PRESET_EXCLUDED_PERMISSIONS.includes(p)),
  },
  {
    key: 'nirdeshak',
    name: 'Nirdeshak (City Head)',
    rank: 90,
    scopeKind: SCOPE_KINDS.GLOBAL,
    description:
      'Head of the whole of Jaipur. Sees every contact in every area and mandal, oversees and follows up the Nirekshaks under him, runs sabhas, hands out batches, gets every report and sends bulk alerts. Oversight, NOT system administration: cannot create logins, change roles, edit email/system settings or mass-delete — those stay with Admin.',
    permissions: [
      P.VIEW_ALL_CONTACTS,
      P.EDIT_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.EXPORT_DATA,
      P.GENERATE_BATCHES,
      P.ASSIGN_BATCHES,
      P.MANAGE_EVENTS,
      P.MANAGE_ATTENDANCE,
      P.MANAGE_SCOPED_VOLUNTEERS,
      P.SEND_EMAILS,
      P.SEND_NOTIFICATIONS,
    ],
  },
  {
    key: 'nirekshak',
    name: 'Nirekshak (Multi-Area Head)',
    rank: 70,
    scopeKind: SCOPE_KINDS.AREA,
    description:
      'Head of several areas combined — assign 2–3 areas on the volunteer. Sees every contact in those areas across all mandals, controls the Mandal Sanchalaks under him, cuts and hands out batches, runs sabhas, marks attendance and gets his areas’ reports. Same scope shape as a Mandal Sanchalak; the difference is the number of areas assigned and the rank.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.DELETE_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.EXPORT_DATA,
      P.GENERATE_BATCHES,
      P.ASSIGN_BATCHES,
      P.MANAGE_EVENTS,
      P.MANAGE_ATTENDANCE,
      P.MANAGE_SCOPED_VOLUNTEERS,
      P.SEND_EMAILS,
      P.SEND_NOTIFICATIONS,
    ],
  },
  {
    key: 'mandal_sanchalak',
    name: 'Mandal Sanchalak (Area Head)',
    rank: 55,
    scopeKind: SCOPE_KINDS.AREA,
    description:
      'Head of one single area — assign one area on the volunteer. Sees and edits every contact in that area across all mandals, hands out batches to the Sampark Karyakars there, runs the area’s sabhas, marks attendance and gets the area report. More junior than a Nirekshak: cannot cut new batches or delete contacts.',
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.EDIT_CONTACTS,
      P.VIEW_HOUSEHOLDS,
      P.EXPORT_DATA,
      P.ASSIGN_BATCHES,
      P.MANAGE_EVENTS,
      P.MANAGE_ATTENDANCE,
      P.MANAGE_SCOPED_VOLUNTEERS,
      P.SEND_EMAILS,
      P.SEND_NOTIFICATIONS,
    ],
  },
  {
    key: 'attendance_mantri',
    name: 'Attendance Mantri (Attendance only)',
    rank: 50,
    scopeKind: SCOPE_KINDS.GLOBAL,
    description:
      'Takes attendance for every sabha, for all persons city-wide — and can add a walk-in contact on the spot. Sees the full roster of every area and mandal (Attendance: All Areas & Mandals) and can create contacts to mark them, but the screens are confined to Events and Notifications: no batches, no reports, no dashboard or admin tools. The confinement is automatic (classifyRole’s “attendance” shape). Global scope so a walk-in can be added in any area or mandal.',
    permissions: [
      P.EDIT_CONTACTS,
      P.MANAGE_ATTENDANCE,
      P.ATTENDANCE_ALL_CONTACTS,
      P.HIDE_ALL_CONTACTS,
    ],
  },
  {
    key: 'sampark_karyakar',
    name: 'Sampark Karyakar (Caller)',
    rank: 30,
    scopeKind: SCOPE_KINDS.UNION,
    description:
      'Follows up the contacts in their own assigned batch — calls them, records the outcome (status + reference) and spreads information. Works from the calling queue. Can save a call result but cannot rename, re-number or move a contact, and cannot assign batches or export. (Switch Save Call Outcomes to Edit Contacts if a caller should also fix contact details.)',
    // SAVE_CALL_OUTCOMES, not EDIT_CONTACTS: a caller records status/reference/
    // callCount on any contact in their queue (firestore.rules isCallOutcomeUpdate)
    // but can never edit a profile or move a contact between areas. Paired with
    // VIEW_ASSIGNED_CONTACTS so the queue actually loads.
    permissions: [
      P.VIEW_ASSIGNED_CONTACTS,
      P.SAVE_CALL_OUTCOMES,
      P.VIEW_HOUSEHOLDS,
    ],
  },
  {
    key: 'santo',
    name: 'Santo',
    rank: 10,
    scopeKind: SCOPE_KINDS.NONE,
    description:
      'Sees only their own Padhramani schedule. No contact, household or admin access. Not part of the karyakar hierarchy — kept for Sant accounts.',
    permissions: [P.VIEW_PADHRAMANI],
  },
];

export const ROLE_LABELS = {
  admin: 'Admin',
  nirdeshak: 'Nirdeshak',
  nirekshak: 'Nirekshak',
  mandal_sanchalak: 'Mandal Sanchalak',
  attendance_mantri: 'Attendance Mantri',
  sampark_karyakar: 'Sampark Karyakar',
  santo: 'Santo',
  // Shaping-only keys returned by classifyRole() for nav layout + the sidebar
  // badge — these are NOT presets. Several presets share a shape (Nirdeshak,
  // Nirekshak and Mandal Sanchalak all classify as 'moderator'), so the badge is
  // a rough indicator; the precise role name comes from detectRoleKey elsewhere.
  attendance: 'Attendance Mantri',
  moderator: 'Coordinator',
  volunteer: 'Karyakar',
  custom: 'Custom',
  none: 'No role',
};

export const DEFAULT_ROLE_RANK = 30;

// ─────────────────────────────────────────────────────────────────────────────
// PER-MANDAL HIERARCHY TEMPLATE
//
// The four management roles are a TEMPLATE that repeats for every Mandal (wing):
// Yuvak, Bal, Sanyukt, Mahila, … each gets its own Nirdeshak → Nirekshak →
// Sanchalak → Sampark Karyakar, renamed with the Mandal's short code so they read
// "Nirdeshak (YM)", "Sampark Karyakar (BM)", and so on. RolesManager's
// "Create a Mandal's hierarchy" action stamps all four out in one go, copying each
// preset's permissions / scope / rank and only changing the name. Admin, Attendance
// Mantri and Santo are deliberately NOT in this template — they are single,
// cross-mandal roles, not per-wing.
// ─────────────────────────────────────────────────────────────────────────────
export const MANDAL_HIERARCHY_PRESET_KEYS = [
  'nirdeshak', 'nirekshak', 'mandal_sanchalak', 'sampark_karyakar',
];

// The everyday title each cloned role carries before its " (CODE)" suffix — not
// the preset's descriptive name ("Mandal Sanchalak (Area Head)" → "Sanchalak").
export const ROLE_BASE_NAMES = {
  nirdeshak: 'Nirdeshak',
  nirekshak: 'Nirekshak',
  mandal_sanchalak: 'Sanchalak',
  sampark_karyakar: 'Sampark Karyakar',
};

/**
 * A Mandal's short code for the role suffix — its own `code` ("YM"), or the
 * initials of its name as a fallback ("Yuvak Mandal" → "YM") when the taxonomy
 * has none. Accepts a mandal object or a bare name string.
 */
export function mandalShortCode(mandal) {
  const code = (typeof mandal === 'object' ? mandal?.code : '') || '';
  if (String(code).trim()) return String(code).trim().toUpperCase();
  const name = String((typeof mandal === 'object' ? mandal?.name : mandal) || '').trim();
  if (!name) return '';
  return name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4);
}

/** "Nirdeshak (YM)" — the per-Mandal name for one hierarchy role. */
export function mandalRoleName(presetKey, code) {
  const base = ROLE_BASE_NAMES[presetKey] || getPreset(presetKey)?.name || presetKey;
  return code ? `${base} (${code})` : base;
}

/**
 * canManageRole(myPermissions, myRank, targetRole)
 *
 * Guard-rail, not a security boundary — firestore.rules only checks
 * manage_roles, so anyone holding it can still edit anything via the SDK. Its
 * job is stopping a Nirekshak who was handed manage_roles from quietly editing
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
  // Attendance-only role (the Attendance Mantri). It holds attendance_all_contacts
  // so it sees every person to mark them, and may hold edit_contacts to add a
  // walk-in — but it carries NONE of the job permissions that give a role other
  // screens. That exclusion list is what stops this shape from hijacking a role you
  // merely TICK attendance_all_contacts onto: a caller keeps save_call_outcomes, an
  // area head keeps assign_batches / manage_scoped_volunteers, so they stay on their
  // own nav and simply gain a city-wide attendance roster. Confined to Events +
  // Notifications (lib/roleView.js). view_all_contacts is excluded because that is
  // the admin-wide shape, not this one. MUST sit before the moderator check.
  if (
    has(PERMISSIONS.MANAGE_ATTENDANCE)
    && has(PERMISSIONS.ATTENDANCE_ALL_CONTACTS)
    && !has(PERMISSIONS.VIEW_ALL_CONTACTS)
    && !has(PERMISSIONS.SAVE_CALL_OUTCOMES)
    && !has(PERMISSIONS.ASSIGN_BATCHES)
    && !has(PERMISSIONS.GENERATE_BATCHES)
    && !has(PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS)
    && !has(PERMISSIONS.MANAGE_EVENTS)
    && !has(PERMISSIONS.SEND_EMAILS)
    && !has(PERMISSIONS.MANAGE_TEMPLATES)
  ) return 'attendance';
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
 * sampark karyakar?
 *
 * WHY IT MATTERS. Santos live in the `volunteers` collection because that is
 * where logins live, but they are not karyakars: a Santo serves the whole of
 * Jaipur, like an Admin, and is never assigned to an area or a mandal. Treating
 * them as ordinary volunteers produced two wrong answers at once — they appeared
 * in the karyakar roster as people with no territory, and they inflated the
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
  nirdeshak: 'bg-rose-100 text-rose-700 border-rose-200',
  nirekshak: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  mandal_sanchalak: 'bg-sky-100 text-sky-700 border-sky-200',
  attendance_mantri: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  sampark_karyakar: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  santo: 'bg-amber-100 text-amber-700 border-amber-200',
  // Shaping-only keys from classifyRole().
  attendance: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  moderator: 'bg-sky-100 text-sky-700 border-sky-200',
  volunteer: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  custom: 'bg-slate-100 text-slate-600 border-slate-200',
  none: 'bg-slate-100 text-slate-500 border-slate-200',
};
