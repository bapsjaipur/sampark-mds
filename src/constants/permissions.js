// MERGED: Phase 2's labels/registry + Phase 4's helper functions, unioned.
// Single source of truth for permission strings. The Roles admin screen
// renders its checkbox matrix from ALL_PERMISSIONS — adding a new capability
// to the app is: add it here, add it to firestore.rules where relevant, and
// start gating UI/functions with it.

export const PERMISSIONS = {
  VIEW_ALL_CONTACTS: 'view_all_contacts',
  VIEW_ASSIGNED_CONTACTS: 'view_assigned_contacts',
  EDIT_CONTACTS: 'edit_contacts',
  // Phase B — a NARROW slice of edit_contacts: record a call result (status,
  // reference, call count) and nothing else. For a role like SK-YM that must save
  // outcomes from its calling queue but must NOT rename, re-number or re-scope
  // contacts. firestore.rules enforces the field limit (isCallOutcomeUpdate) and,
  // BECAUSE of that limit, deliberately does NOT scope-check this path — so the
  // caller can record a result on any contact in a batch assigned to them,
  // including one from another area (covering for an absent volunteer). It still
  // cannot edit a profile or move a contact between territories. edit_contacts is
  // the strict superset, so any role holding it ignores this. Kept out of every
  // preset — an admin ticks it per role (see PRESET_EXCLUDED_PERMISSIONS, which
  // also stops it enlarging the Admin preset and breaking detectRoleKey's exact
  // match).
  SAVE_CALL_OUTCOMES: 'save_call_outcomes',
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
  // Phase 42 — edit the Niyam Dharma Agna list (the daily-observance checkboxes
  // on the contact form) from the Areas & Mandals screen: add a niyam, re-spell
  // one, or retire one. Kept separate from manage_templates so the person who
  // curates observances need not also hold the email/template power.
  MANAGE_NIYAM_DHARMA: 'manage_niyam_dharma',
  // Phase 45 — edit the Areas & Mandals screen (areas, mandals, levels and
  // programmes) WITHOUT the global manage_users power. manage_users still opens
  // the tab, so an Admin keeps it; this is the narrow grant for a role that
  // should curate the taxonomy only. Kept OUT of the Admin preset
  // (PRESET_EXCLUDED_PERMISSIONS) so it can't enlarge the preset set and break
  // detectRoleKey's exact match — Admin reaches the tab via manage_users.
  MANAGE_AREAS_MANDALS: 'manage_areas_mandals',
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
  // Phase 49 — widen the ATTENDANCE roster to every contact, in any area or
  // mandal. By default the attendance screen shows only the marker's own scoped
  // contacts; tick this and they can mark anyone present at any sabha. It widens
  // the roster ONLY — it does not change which contacts they may edit, and grants
  // no admin access (unlike view_all_contacts). Pair with manage_attendance. This
  // is the core of the Attendance Mantri role, but it can be ticked onto ANY role
  // that must take attendance city-wide. Honoured by EventsPage (the roster read)
  // and accepted by canReadIndividual in firestore.rules.
  ATTENDANCE_ALL_CONTACTS: 'attendance_all_contacts',
  // Bulk import of contacts / historical attendance. Distinct from
  // EDIT_CONTACTS: one bad CSV touches thousands of rows at once.
  IMPORT_DATA: 'import_data',
  // Edit the volunteers inside your own area/mandal scope — reassign their
  // batches, fix their details — without the global MANAGE_USERS power to
  // create accounts or change roles. This is the Moderator's day-to-day need.
  MANAGE_SCOPED_VOLUNTEERS: 'manage_scoped_volunteers',
  // Phase 48 — send in-app bulk notifications (the bell inbox) to a Mandal, an
  // Area, one or more Roles, specific volunteers, or everyone ("gather at this
  // place at this time"). This is the right to SEND; RECEIVING a bell is
  // universal and auto-scoped, so there is no receive gate. Enforced in the
  // sendBulkNotification callable (functions/notifications.js). Admin auto-holds
  // it (NOT in PRESET_EXCLUDED_PERMISSIONS) — grant it to Moderator / Super
  // Moderator etc. from the Roles tab as needed.
  SEND_NOTIFICATIONS: 'send_notifications',
  // ── Report subscriptions (Phase 52) ─────────────────────────────────────────
  // Who RECEIVES each automated report, and — because delivery is scoped by the
  // recipient's Programmes (the mandals ticked on their volunteer record) — WHICH
  // mandal's data they see. A role holding one of these gets that report filtered
  // to its own mandal(s); an UNRESTRICTED role (Admin / view_all_contacts) gets
  // the full city-wide copy. Replaces the old "everyone with send_emails gets the
  // whole-city copy" so a Yuvak head never receives Sanyukt's figures. send_emails
  // now means only "can run / preview reports", not "receives them". A scoped
  // recipient with no Programmes set receives nothing (there is no mandal to scope
  // to) — the one case to watch. Resolved server-side in resolveReportAudience
  // (functions/lib/mailer.js). Admin auto-holds all four (NOT excluded).
  RECEIVE_DAILY_REPORT: 'receive_daily_report',
  RECEIVE_BIRTHDAY_REPORT: 'receive_birthday_report',
  RECEIVE_POSTSABHA_REPORT: 'receive_postsabha_report',
  RECEIVE_SABHA_COVERAGE: 'receive_sabha_coverage',
  // ── Tab-visibility flags (Phase B) ──────────────────────────────────────────
  // These are the ONLY permissions that SUBTRACT access instead of granting it:
  // ticking one HIDES a tab for the role. They exist because those tabs cannot be
  // gated on a positive read permission without breaking existing roles — every
  // scoped role already holds view_assigned_contacts, so "show All Contacts to
  // everyone EXCEPT this one role" is impossible to express positively. Default
  // off = today's behaviour, so adding them changes nothing until an admin ticks
  // one. Deliberately kept OUT of the Admin preset (VISIBILITY_HIDE_PERMISSIONS)
  // so an Admin can never hide its own tabs. Presentation only — read/write is
  // still decided by the permissions above and by firestore.rules.
  //
  // HIDE_ALL_CONTACTS — hide the "All Contacts" tab (e.g. an SK-YM meant to work
  //   only from their calling queue, not browse the whole scoped roster).
  HIDE_ALL_CONTACTS: 'hide_all_contacts',
  // HIDE_PAST_SABHAS — in Events, show only the upcoming sabha for attendance
  //   marking and hide the "Past" list, so a caller cannot reopen a closed sabha.
  HIDE_PAST_SABHAS: 'hide_past_sabhas',
};

export const PERMISSION_LABELS = {
  [PERMISSIONS.VIEW_ALL_CONTACTS]: 'View All Contacts',
  [PERMISSIONS.VIEW_ASSIGNED_CONTACTS]: 'View Assigned Contacts (area/mandal only)',
  [PERMISSIONS.EDIT_CONTACTS]: 'Edit Contacts',
  [PERMISSIONS.SAVE_CALL_OUTCOMES]: 'Save Call Outcomes (status/notes, not full edit)',
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
  [PERMISSIONS.MANAGE_NIYAM_DHARMA]: 'Manage Niyam Dharma List',
  [PERMISSIONS.MANAGE_AREAS_MANDALS]: 'Manage Areas & Mandals',
  [PERMISSIONS.GENERATE_BATCHES]: 'Generate Batches (cut new batches)',
  [PERMISSIONS.MANAGE_ATTENDANCE]: 'Mark Sabha Attendance',
  [PERMISSIONS.ATTENDANCE_ALL_CONTACTS]: 'Attendance: All Areas & Mandals',
  [PERMISSIONS.IMPORT_DATA]: 'Import Contacts & History (CSV)',
  [PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS]: 'Manage Volunteers In My Area/Mandal',
  [PERMISSIONS.SEND_NOTIFICATIONS]: 'Send Bulk Notifications',
  [PERMISSIONS.RECEIVE_DAILY_REPORT]: 'Receive Daily Calling Report (their mandal)',
  [PERMISSIONS.RECEIVE_BIRTHDAY_REPORT]: 'Receive Birthday & Anniversary Summary (their mandal)',
  [PERMISSIONS.RECEIVE_POSTSABHA_REPORT]: 'Receive Post-Sabha Report (their mandal)',
  [PERMISSIONS.RECEIVE_SABHA_COVERAGE]: 'Receive Weekly Sabha Coverage (their mandal)',
  [PERMISSIONS.HIDE_ALL_CONTACTS]: 'Hide the All Contacts tab',
  [PERMISSIONS.HIDE_PAST_SABHAS]: 'Hide Past Sabhas (upcoming only)',
};

// Short column headers for the Roles matrix — PERMISSION_LABELS is written for
// prose ("View Assigned Contacts (area/mandal only)") which makes the matrix
// ~14 columns of wrapped text. These are the same permissions, abbreviated.
export const PERMISSION_SHORT_LABELS = {
  [PERMISSIONS.VIEW_ALL_CONTACTS]: 'View All',
  [PERMISSIONS.VIEW_ASSIGNED_CONTACTS]: 'View Assigned',
  [PERMISSIONS.EDIT_CONTACTS]: 'Edit',
  [PERMISSIONS.SAVE_CALL_OUTCOMES]: 'Save Outcomes',
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
  [PERMISSIONS.MANAGE_NIYAM_DHARMA]: 'Niyam Dharma',
  [PERMISSIONS.MANAGE_AREAS_MANDALS]: 'Areas & Mandals',
  [PERMISSIONS.GENERATE_BATCHES]: 'Generate',
  [PERMISSIONS.MANAGE_ATTENDANCE]: 'Attendance',
  [PERMISSIONS.ATTENDANCE_ALL_CONTACTS]: 'Attendance: All',
  [PERMISSIONS.IMPORT_DATA]: 'Import',
  [PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS]: 'Scoped Users',
  [PERMISSIONS.SEND_NOTIFICATIONS]: 'Notify',
  [PERMISSIONS.RECEIVE_DAILY_REPORT]: 'Daily report',
  [PERMISSIONS.RECEIVE_BIRTHDAY_REPORT]: 'Birthday report',
  [PERMISSIONS.RECEIVE_POSTSABHA_REPORT]: 'Post-sabha report',
  [PERMISSIONS.RECEIVE_SABHA_COVERAGE]: 'Coverage report',
  [PERMISSIONS.HIDE_ALL_CONTACTS]: 'Hide All Contacts',
  [PERMISSIONS.HIDE_PAST_SABHAS]: 'Hide Past Sabhas',
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
    PERMISSIONS.SAVE_CALL_OUTCOMES,
    PERMISSIONS.GENERATE_BATCHES, PERMISSIONS.ASSIGN_BATCHES,
    PERMISSIONS.MANAGE_EVENTS, PERMISSIONS.MANAGE_ATTENDANCE, PERMISSIONS.ATTENDANCE_ALL_CONTACTS,
    PERMISSIONS.VIEW_PADHRAMANI,
  ] },
  { label: 'Administration', permissions: [
    PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS, PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.SEND_EMAILS, PERMISSIONS.SEND_NOTIFICATIONS, PERMISSIONS.MANAGE_TEMPLATES,
    PERMISSIONS.MANAGE_NIYAM_DHARMA, PERMISSIONS.MANAGE_AREAS_MANDALS,
  ] },
  // Report subscriptions (Phase 52) — which automated reports this role receives,
  // each delivered scoped to the recipient's own mandal(s). Its own group so it
  // reads as "what lands in my inbox", separate from "what I can do".
  { label: 'Report subscriptions (scoped to their mandal)', permissions: [
    PERMISSIONS.RECEIVE_DAILY_REPORT, PERMISSIONS.RECEIVE_BIRTHDAY_REPORT,
    PERMISSIONS.RECEIVE_POSTSABHA_REPORT, PERMISSIONS.RECEIVE_SABHA_COVERAGE,
  ] },
  // Opt-out toggles — ticking one HIDES a tab for this role (default off). Kept
  // in their own group so it reads differently from the grant-access boxes above.
  { label: 'Tab visibility (ticking HIDES the tab)', permissions: [
    PERMISSIONS.HIDE_ALL_CONTACTS, PERMISSIONS.HIDE_PAST_SABHAS,
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
  [PERMISSIONS.SAVE_CALL_OUTCOMES]: 'Lets a caller save the call result — status, reference and call count — WITHOUT the full Edit Contacts power over names and numbers. Works on any contact in their calling queue, including a batch handed to them from another area (it can only ever touch those three fields, so it can never edit a profile or move a contact between areas). Pair it with a view permission (e.g. View Assigned) so their queue loads. A role that already has Edit Contacts does not need this.',
  [PERMISSIONS.DELETE_CONTACTS]: 'Delete one contact or household at a time.',
  [PERMISSIONS.BULK_DELETE_CONTACTS]: 'Tick-many-then-delete. Highest-risk permission in the app — Admin only.',
  [PERMISSIONS.VIEW_HOUSEHOLDS]: 'Open the Households tab and see family groupings.',
  [PERMISSIONS.EXPORT_DATA]: 'Download contact lists and event reports as CSV/PDF.',
  [PERMISSIONS.IMPORT_DATA]: 'Upload a CSV of contacts or past attendance. One bad file touches thousands of rows.',
  [PERMISSIONS.GENERATE_BATCHES]: 'Cut a new set of batches out of an area/mandal. Re-cutting a live roster disrupts calls already in progress.',
  [PERMISSIONS.ASSIGN_BATCHES]: 'Hand an existing batch to a volunteer, or take it back. Safe day-to-day Moderator work.',
  [PERMISSIONS.MANAGE_EVENTS]: 'Create, edit and delete sabhas in the calendar.',
  [PERMISSIONS.MANAGE_ATTENDANCE]: 'Mark who attended a sabha, without being able to change the calendar itself.',
  [PERMISSIONS.ATTENDANCE_ALL_CONTACTS]: 'Shows EVERY contact on the attendance screen — any area, any mandal — so this role can mark anyone present, not just their own area. Pair it with Mark Sabha Attendance. It widens the attendance roster only: it does not change which contacts they can edit, and grants no admin access. This is what makes an "Attendance Mantri", but you can tick it onto any role that must take attendance city-wide.',
  [PERMISSIONS.VIEW_PADHRAMANI]: 'See their own Padhramani schedule only. Intended for Santo accounts.',
  [PERMISSIONS.MANAGE_USERS]: 'Create volunteer logins and change anyone’s role — including their own. Effectively full control.',
  [PERMISSIONS.MANAGE_SCOPED_VOLUNTEERS]: 'Edit volunteers inside their own area/mandal only. Cannot create logins or change roles.',
  [PERMISSIONS.MANAGE_ROLES]: 'Edit this screen. Anyone with it can grant themselves anything.',
  [PERMISSIONS.SEND_EMAILS]: 'Run report emails on demand and receive the scheduled ones.',
  [PERMISSIONS.SEND_NOTIFICATIONS]: 'Send in-app bell notifications to a Mandal, Area, Role, chosen volunteers or everyone — the one-click “gather here at this time” alert. Everyone receives bells automatically and scoped to them; this is only the power to send to others.',
  [PERMISSIONS.RECEIVE_DAILY_REPORT]: 'Emails this role the daily calling report, showing only the volunteers of their own mandal(s) (set under Programmes on the volunteer). An Admin / view-all role gets the whole city. Needs a report email on the record.',
  [PERMISSIONS.RECEIVE_BIRTHDAY_REPORT]: 'Emails this role the daily birthday & anniversary list for their own mandal(s) only. An Admin / view-all role gets every mandal. Needs a report email on the record.',
  [PERMISSIONS.RECEIVE_POSTSABHA_REPORT]: 'Emails this role the post-sabha attendance report, but only for sabhas of their own mandal(s). An Admin / view-all role gets every sabha. Needs a report email on the record.',
  [PERMISSIONS.RECEIVE_SABHA_COVERAGE]: 'Emails this role the weekly sabha-coverage digest for their own mandal(s) only. An Admin / view-all role gets the whole city. Needs a report email on the record.',
  [PERMISSIONS.MANAGE_TEMPLATES]: 'Edit the WhatsApp message text, the calling outcome buttons and email settings.',
  [PERMISSIONS.MANAGE_NIYAM_DHARMA]: 'Edit the Niyam Dharma Agna list on the Areas & Mandals screen — the daily-observance checkboxes (Tulsi Kanthi, Mala Jaap…) shown on every contact. Lets someone re-spell, add or retire a niyam. Does not grant any contact-editing power on its own.',
  [PERMISSIONS.MANAGE_AREAS_MANDALS]: 'Add, rename and organise Areas, Mandals, Levels and Programmes on the Areas & Mandals screen — without the full Manage Users power. An Admin already has this via Manage Users; grant it to a coordinator who should shape the taxonomy but not create logins or change roles.',
  [PERMISSIONS.HIDE_ALL_CONTACTS]: 'Removes the “All Contacts” tab for this role. Their assigned and calling contacts are untouched — this only takes away the browse-everything list. Leave OFF for most roles; tick it for a caller who should only work their queue.',
  [PERMISSIONS.HIDE_PAST_SABHAS]: 'In Events, shows only the upcoming sabha for attendance marking and hides the list of past sabhas. Tick it for a role that should mark today’s sabha but never reopen an old one.',
};

// Permissions that hand over effective control of the whole system. Flagged in
// the Roles editor so granting one is a decision rather than a stray click.
export const DANGEROUS_PERMISSIONS = [
  PERMISSIONS.MANAGE_ROLES,
  PERMISSIONS.MANAGE_USERS,
  PERMISSIONS.BULK_DELETE_CONTACTS,
];

// The opt-out visibility flags — the only permissions that SUBTRACT access (they
// hide a tab). They must be kept OUT of any "grant everything" list, or a role
// meant to have full access (Admin) would end up hiding its own tabs. The Admin
// preset filters these out with this list; roleView.js reads them via `hideIf`.
export const VISIBILITY_HIDE_PERMISSIONS = [
  PERMISSIONS.HIDE_ALL_CONTACTS,
  PERMISSIONS.HIDE_PAST_SABHAS,
];

// Permissions deliberately kept OUT of the Admin "everything" preset, for three
// different reasons:
//   • the hide flags SUBTRACT access — sweeping them in would make the Admin hide
//     its own tabs (VISIBILITY_HIDE_PERMISSIONS);
//   • save_call_outcomes is a strict SUBSET of edit_contacts, which the Admin
//     already holds, so adding it would be redundant AND would enlarge the Admin
//     preset's permission set. detectRoleKey() matches that set EXACTLY, so every
//     Admin role already saved in Firestore (which predates this string) would
//     suddenly read as "Custom" and the "standard roles missing" banner would
//     offer to create a duplicate Admin. Excluding it holds the preset at its
//     current shape, so stored Admin docs keep matching.
//   • manage_areas_mandals is a NEW capability the Admin already covers via
//     manage_users, so it would enlarge the preset set the same way and trip the
//     same detectRoleKey exact-match. Excluded for that reason; a normal grant
//     everywhere else.
export const PRESET_EXCLUDED_PERMISSIONS = [
  ...VISIBILITY_HIDE_PERMISSIONS,
  PERMISSIONS.SAVE_CALL_OUTCOMES,
  PERMISSIONS.MANAGE_AREAS_MANDALS,
  // attendance_all_contacts is redundant for Admin (view_all_contacts already
  // shows every contact on the attendance screen), so keep it out of the Admin
  // preset for the same reason as the two above — including it would enlarge the
  // preset set and break detectRoleKey's exact match against saved Admin docs.
  PERMISSIONS.ATTENDANCE_ALL_CONTACTS,
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
