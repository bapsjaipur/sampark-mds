// MERGED: Phase 2's labels/registry + Phase 4's helper functions, unioned.
// Single source of truth for permission strings. The Roles admin screen
// renders its checkbox matrix from ALL_PERMISSIONS — adding a new capability
// to the app is: add it here, add it to firestore.rules where relevant, and
// start gating UI/functions with it.

export const PERMISSIONS = {
  VIEW_ALL_CONTACTS: 'view_all_contacts',
  VIEW_ASSIGNED_CONTACTS: 'view_assigned_contacts',
  EDIT_CONTACTS: 'edit_contacts',
  // Separate delete gate — allows roles like Area Coordinator to edit but not delete
  DELETE_CONTACTS: 'delete_contacts',
  // Bulk delete (checkbox mass-delete) — higher risk, intended for Admin only
  BULK_DELETE_CONTACTS: 'bulk_delete_contacts',
  // 4.2 — granular page-level access
  VIEW_HOUSEHOLDS: 'view_households',
  EXPORT_DATA: 'export_data',
  ASSIGN_BATCHES: 'assign_batches',
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  // Added in Phase 6 (Events/Sabha):
  MANAGE_EVENTS: 'manage_events',
  // Section 8 — grants Santo role access to their personal "My Schedule" page.
  // Does NOT give access to the full Padhramani admin page or contact editing.
  VIEW_PADHRAMANI: 'view_padhramani',
  // Phase 20 (Sevak Call merge) — the legacy app's email automation had no
  // permission model at all: it hardcoded "admins + moderators" inside each
  // trigger. These two gates replace that hardcoding.
  // SEND_EMAILS: run/preview report emails and receive the scheduled ones.
  SEND_EMAILS: 'send_emails',
  // MANAGE_TEMPLATES: edit the WhatsApp message template + email settings
  // (which reports are on, sender name, dry-run mode).
  MANAGE_TEMPLATES: 'manage_templates',
  // Phase 21 (Area/Mandal hierarchy) — ASSIGN_BATCHES used to mean both
  // "create batches" and "hand them out", which made an Area Moderator either
  // powerless or able to re-cut the whole city's roster. Split in two:
  //   GENERATE_BATCHES — cut new batches out of an area/mandal
  //   ASSIGN_BATCHES   — hand an existing batch to a volunteer
  // A Moderator gets assign-only; generating stays with Admin/Super Moderator.
  GENERATE_BATCHES: 'generate_batches',
  // Mark attendance at a sabha without being able to create or delete events.
  // The person on the door is rarely the person who runs the calendar.
  MANAGE_ATTENDANCE: 'manage_attendance',
  // Bulk import of contacts / historical attendance. Distinct from
  // EDIT_CONTACTS: one bad CSV touches thousands of rows at once.
  IMPORT_DATA: 'import_data',
  // Edit the volunteers inside your own area/mandal scope — reassign their
  // batches, fix their details — without the global MANAGE_USERS power to
  // create accounts or change roles. This is the Moderator's day-to-day need.
  MANAGE_SCOPED_VOLUNTEERS: 'manage_scoped_volunteers',
};

export const PERMISSION_LABELS = {
  [PERMISSIONS.VIEW_ALL_CONTACTS]: 'View All Contacts',
  [PERMISSIONS.VIEW_ASSIGNED_CONTACTS]: 'View Assigned Contacts (area/mandal only)',
  [PERMISSIONS.EDIT_CONTACTS]: 'Edit Contacts',
  [PERMISSIONS.DELETE_CONTACTS]: 'Delete Contacts & Households (single)',
  [PERMISSIONS.BULK_DELETE_CONTACTS]: 'Bulk Delete Contacts (checkbox)',
  [PERMISSIONS.VIEW_HOUSEHOLDS]: 'View Households',
  [PERMISSIONS.EXPORT_DATA]: 'Export Data (CSV / PDF)',
  [PERMISSIONS.ASSIGN_BATCHES]: 'Assign Batches',
  [PERMISSIONS.MANAGE_USERS]: 'Manage Users (volunteers)',
  [PERMISSIONS.MANAGE_ROLES]: 'Manage Roles',
  [PERMISSIONS.MANAGE_EVENTS]: 'Create/Edit Events & Sabha',
  [PERMISSIONS.VIEW_PADHRAMANI]: 'View My Padhramani Schedule (Santo only)',
  [PERMISSIONS.SEND_EMAILS]: 'Send & Receive Report Emails',
  [PERMISSIONS.MANAGE_TEMPLATES]: 'Manage Message Templates & Email Settings',
  [PERMISSIONS.GENERATE_BATCHES]: 'Generate Batches (cut new batches)',
  [PERMISSIONS.MANAGE_ATTENDANCE]: 'Mark Sabha Attendance',
  [PERMISSIONS.IMPORT_DATA]: 'Import Contacts & History (CSV)',
  [PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS]: 'Manage Volunteers In My Area/Mandal',
};

// Short column headers for the Roles matrix — PERMISSION_LABELS is written for
// prose ("View Assigned Contacts (area/mandal only)") which makes the matrix
// ~14 columns of wrapped text. These are the same permissions, abbreviated.
export const PERMISSION_SHORT_LABELS = {
  [PERMISSIONS.VIEW_ALL_CONTACTS]: 'View All',
  [PERMISSIONS.VIEW_ASSIGNED_CONTACTS]: 'View Assigned',
  [PERMISSIONS.EDIT_CONTACTS]: 'Edit',
  [PERMISSIONS.DELETE_CONTACTS]: 'Delete',
  [PERMISSIONS.BULK_DELETE_CONTACTS]: 'Bulk Delete',
  [PERMISSIONS.VIEW_HOUSEHOLDS]: 'Households',
  [PERMISSIONS.EXPORT_DATA]: 'Export',
  [PERMISSIONS.ASSIGN_BATCHES]: 'Batches',
  [PERMISSIONS.MANAGE_USERS]: 'Users',
  [PERMISSIONS.MANAGE_ROLES]: 'Roles',
  [PERMISSIONS.MANAGE_EVENTS]: 'Events',
  [PERMISSIONS.VIEW_PADHRAMANI]: 'My Schedule',
  [PERMISSIONS.SEND_EMAILS]: 'Emails',
  [PERMISSIONS.MANAGE_TEMPLATES]: 'Templates',
  [PERMISSIONS.GENERATE_BATCHES]: 'Generate',
  [PERMISSIONS.MANAGE_ATTENDANCE]: 'Attendance',
  [PERMISSIONS.IMPORT_DATA]: 'Import',
  [PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS]: 'Scoped Users',
};

// Groups for the mobile/card rendering of the Roles matrix — a 15-column
// table is unusable on a phone, so the card view walks these groups instead.
export const PERMISSION_GROUPS = [
  { label: 'Contacts', permissions: [
    PERMISSIONS.VIEW_ALL_CONTACTS, PERMISSIONS.VIEW_ASSIGNED_CONTACTS,
    PERMISSIONS.EDIT_CONTACTS, PERMISSIONS.DELETE_CONTACTS, PERMISSIONS.BULK_DELETE_CONTACTS,
  ] },
  { label: 'Households & Data', permissions: [
    PERMISSIONS.VIEW_HOUSEHOLDS, PERMISSIONS.EXPORT_DATA, PERMISSIONS.IMPORT_DATA,
  ] },
  { label: 'Calling & Events', permissions: [
    PERMISSIONS.GENERATE_BATCHES, PERMISSIONS.ASSIGN_BATCHES,
    PERMISSIONS.MANAGE_EVENTS, PERMISSIONS.MANAGE_ATTENDANCE, PERMISSIONS.VIEW_PADHRAMANI,
  ] },
  { label: 'Administration', permissions: [
    PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS, PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.SEND_EMAILS, PERMISSIONS.MANAGE_TEMPLATES,
  ] },
];

// One-line explanation of what each permission actually lets someone do, shown
// under the checkbox in the Roles editor. The labels above name the capability;
// these say what goes wrong if you get it wrong, which is the part admins
// were guessing at.
export const PERMISSION_HELP = {
  [PERMISSIONS.VIEW_ALL_CONTACTS]: 'Ignores area/mandal limits entirely — this person sees every contact in Jaipur.',
  [PERMISSIONS.VIEW_ASSIGNED_CONTACTS]: 'Sees only contacts inside their assigned scope. Required for any scoped role; without a read permission the calling queue comes back empty.',
  [PERMISSIONS.EDIT_CONTACTS]: 'Change names, numbers, status and call outcomes. Needs a view permission alongside it.',
  [PERMISSIONS.DELETE_CONTACTS]: 'Delete one contact or household at a time.',
  [PERMISSIONS.BULK_DELETE_CONTACTS]: 'Tick-many-then-delete. Highest-risk permission in the app — Admin only.',
  [PERMISSIONS.VIEW_HOUSEHOLDS]: 'Open the Households tab and see family groupings.',
  [PERMISSIONS.EXPORT_DATA]: 'Download contact lists and event reports as CSV/PDF.',
  [PERMISSIONS.IMPORT_DATA]: 'Upload a CSV of contacts or past attendance. One bad file touches thousands of rows.',
  [PERMISSIONS.GENERATE_BATCHES]: 'Cut a new set of batches out of an area/mandal. Re-cutting a live roster disrupts calls already in progress.',
  [PERMISSIONS.ASSIGN_BATCHES]: 'Hand an existing batch to a volunteer, or take it back. Safe day-to-day Moderator work.',
  [PERMISSIONS.MANAGE_EVENTS]: 'Create, edit and delete sabhas in the calendar.',
  [PERMISSIONS.MANAGE_ATTENDANCE]: 'Mark who attended a sabha, without being able to change the calendar itself.',
  [PERMISSIONS.VIEW_PADHRAMANI]: 'See their own Padhramani schedule only. Intended for Santo accounts.',
  [PERMISSIONS.MANAGE_USERS]: 'Create volunteer logins and change anyone’s role — including their own. Effectively full control.',
  [PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS]: 'Edit volunteers inside their own area/mandal only. Cannot create logins or change roles.',
  [PERMISSIONS.MANAGE_ROLES]: 'Edit this screen. Anyone with it can grant themselves anything.',
  [PERMISSIONS.SEND_EMAILS]: 'Run report emails on demand and receive the scheduled ones.',
  [PERMISSIONS.MANAGE_TEMPLATES]: 'Edit the WhatsApp message text, the calling outcome buttons and email settings.',
};

// Permissions that hand over effective control of the whole system. Flagged in
// the Roles editor so granting one is a decision rather than a stray click.
export const DANGEROUS_PERMISSIONS = [
  PERMISSIONS.MANAGE_ROLES,
  PERMISSIONS.MANAGE_USERS,
  PERMISSIONS.BULK_DELETE_CONTACTS,
];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// ─────────────────────────────────────────────────────────────────────────────
// BACK-COMPAT FOR PRE-PHASE-21 ROLE DOCUMENTS
//
// Phase 21 split two permissions that used to be one, and gated one thing that
// used to be ungated. Role documents already stored in Firestore obviously don't
// contain the new strings — so on the day this ships, an Admin whose role was
// saved last month would lose the Generate tab and the attendance screen, with
// nothing on screen explaining why.
//
// So a legacy role keeps the capabilities its old permission used to include:
//   assign_batches → also meant "create batches" before the split
//   manage_events  → also meant "mark attendance" before the split
//   edit_contacts  → CSV import was not gated at all before, and edit_contacts
//                    was the permission every importer already held
//
// "Legacy" used to be detected by the ABSENCE of `scopeKind` on the role
// document, so that the first save on the Phase 21 Roles editor switched the
// implications off and the checkboxes became the whole truth.
//
// PHASE 23 splits those two signals apart, because they were never the same
// question. An unset `scopeKind` now MEANS something at runtime — "derive the
// shape from each volunteer's own assignment" (src/lib/scope.js) — so the Roles
// editor must be able to save a role without inventing a scope for it. It writes
// `permissionsMaterialized` instead: an explicit "the stored list is complete,
// stop expanding it". Either marker clears the shim, so roles already saved with
// a scopeKind keep working untouched, and no migration is needed.
// ─────────────────────────────────────────────────────────────────────────────
export const IMPLIED_PERMISSIONS = {
  [PERMISSIONS.ASSIGN_BATCHES]: [PERMISSIONS.GENERATE_BATCHES],
  [PERMISSIONS.MANAGE_EVENTS]: [PERMISSIONS.MANAGE_ATTENDANCE],
  [PERMISSIONS.EDIT_CONTACTS]: [PERMISSIONS.IMPORT_DATA],
};

export function expandLegacyPermissions(list) {
  const out = new Set(Array.isArray(list) ? list.filter(Boolean) : []);
  for (const [held, grants] of Object.entries(IMPLIED_PERMISSIONS)) {
    if (out.has(held)) grants.forEach((g) => out.add(g));
  }
  return [...out];
}

export function isLegacyRole(role) {
  if (!role) return false;
  // Either marker means the stored permission list is already complete.
  if (role.permissionsMaterialized) return false;
  return !role.scopeKind;
}

// ── Helper functions (from Phase 4) — used by components/services that
// receive a plain permissions[] array rather than calling usePermissions(). ──
export function hasPermission(permissions, permission) {
  return Array.isArray(permissions) && permissions.includes(permission);
}

export function hasAnyPermission(permissions, requiredList) {
  return Array.isArray(requiredList) && requiredList.some((p) => hasPermission(permissions, p));
}

export function hasAllPermissions(permissions, requiredList) {
  return Array.isArray(requiredList) && requiredList.every((p) => hasPermission(permissions, p));
}
