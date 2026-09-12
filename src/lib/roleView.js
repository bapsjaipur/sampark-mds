// src/lib/roleView.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 — "different UI according to Role".
//
// Before this file, AppLayout rendered ONE navigation list for everybody and
// wrapped each item in <RequirePermission>. That is correct but not *shaped*:
// a volunteer saw the same ordering as an admin (Households first, their own
// calling queue not linked at all), and an admin saw admin tools buried below
// six volunteer-facing links.
//
// getRoleView() centralises the decision "what does this person's app look
// like" in one place, and returns an already-filtered nav tree. AppLayout is
// then dumb rendering — no permission logic in the component.
//
// IMPORTANT: this is presentation only. Hiding a nav item is not security;
// firestore.rules is the boundary. Every route remains reachable by URL and is
// independently gated by <RequirePermission> inside the page component.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Home, Users, CalendarDays, Bell, ListChecks, LayoutDashboard,
  ShieldCheck, UserCog, MapPin, Wrench, HeartHandshake, CalendarCheck,
  PhoneCall, PhoneForwarded, GraduationCap,
} from 'lucide-react';
import { classifyRole, ROLE_LABELS, ROLE_BADGE_CLASSES } from '../constants/roleTemplates';

const has = (perms, p) => Array.isArray(perms) && perms.includes(p);
const hasAny = (perms, list) => list.some((p) => has(perms, p));

/**
 * Bal Mandal is a programme assignment, not a legacy role-key assignment.
 *
 * Roles created in Admin are identified by their permissions and can be named
 * freely, so checking a volunteer's old `roleKey` here would reject a valid
 * custom Admin (or a renamed Bal Mandal role). Administrators and Bal Mandal
 * volunteers both need at least one contact/event capability that makes the
 * dashboard useful and permits its Firestore reads.
 */
export function canAccessBalMandal(permissions, volunteer) {
  const isAdministrator = hasAny(permissions, ['manage_users', 'manage_roles']);
  const isBalMandalVolunteer = volunteer?.program === 'Bal Mandal';
  const canWorkWithProgramme = hasAny(permissions, [
    'view_all_contacts',
    'view_assigned_contacts',
    'edit_contacts',
    'manage_events',
    'manage_attendance',
  ]);
  return canWorkWithProgramme && (isAdministrator || isBalMandalVolunteer);
}

/**
 * Standard promotion moves an entire year group up a standard, and moves 8th
 * standard children out of Bal Mandal into Yuvak Mandal altogether. It is the
 * single most destructive routine bulk write in the app, so it is deliberately
 * narrower than the rest of the Bal Mandal dashboard.
 *
 * The original gate was `['nirdeshak','admin'].includes(volunteer?.roleKey)` —
 * a field no save path has ever written, so the page and its execute button
 * were dead for everyone including the Admin they were meant for. This restates
 * the same intent in permissions, which is what roles are actually identified by:
 *
 *   edit_contacts               — the promotion rewrites every child's standard
 *   manage_users | import_data  — the "programme-wide authority" discriminator
 *
 * That admits Admin (via manage_users) and Nirdeshak / Super Moderator (via
 * import_data, which both templates hold), and keeps out Sanchalak, Nirikshak
 * and SK — who hold edit_contacts but neither of the second pair. Matching the
 * old intent matters more than being generous here: an accidental promotion is
 * not undoable from the UI.
 */
export function canRunStandardPromotion(permissions, volunteer) {
  return canAccessBalMandal(permissions, volunteer)
    && has(permissions, 'edit_contacts')
    && hasAny(permissions, ['manage_users', 'import_data']);
}

/**
 * An "observer" is whoever marks a child present at a sabha — a Nirikshak or a
 * visiting sant. Both were previously found with
 * `where('roleKey','in',['nirikshak','sant'])`, which matched nothing: role
 * identity lives on the ROLE document (`presetKey`), not the volunteer, and the
 * sant preset's key is 'santo', not 'sant'.
 *
 * `roleDocs` is the roles collection; `roleIds` the ids this volunteer holds.
 */
export const OBSERVER_PRESET_KEYS = ['nirikshak', 'santo'];

export function isObserverRole(role) {
  if (!role) return false;
  if (OBSERVER_PRESET_KEYS.includes(role.presetKey)) return true;
  // Hand-built roles never get a presetKey, so fall back to the permission
  // signature an observer has: they mark attendance but do not edit contacts.
  const perms = Array.isArray(role.permissions) ? role.permissions : [];
  return perms.includes('manage_attendance') && !perms.includes('edit_contacts');
}

// ── The full catalogue of navigable destinations ──────────────────────────────
// `anyOf: null` means "no permission gate" (every signed-in user).
// Ordering inside this object is irrelevant; each role picks its own order below.
const NAV = {
  calling: {
    to: '/calling', label: 'My Calling', icon: PhoneForwarded,
    // Seeing the batch assigned to you is a READ, so any scoped reader qualifies.
    // Gating on edit_contacts alone hid "My Calling" from a role that holds
    // view_assigned_contacts but not edit_contacts (an attendance / observer role
    // such as SK-YM) even when a batch had been handed to them — the "missing My
    // Calling tab" report. edit_contacts still qualifies on its own (a write-only
    // calling role); a role missing the matching read/write simply gets the empty
    // state or a save toast, not a blank tab. Pairs with canReadBatches() in
    // firestore.rules, which now also accepts edit_contacts.
    anyOf: ['edit_contacts', 'view_assigned_contacts', 'view_all_contacts'],
  },
  myContacts: {
    to: '/my-contacts', label: 'My Contacts', icon: PhoneCall,
    anyOf: ['view_assigned_contacts', 'edit_contacts', 'view_all_contacts'],
  },
  contacts: {
    to: '/contacts', label: 'All Contacts', icon: Users,
    anyOf: ['view_all_contacts', 'view_assigned_contacts', 'edit_contacts'],
    // Opt-out: a role with hide_all_contacts (e.g. SK-YM) loses this tab even
    // though its read permission would otherwise show it. Roles → "Hide the All
    // Contacts tab". Their calling queue / My Contacts are unaffected.
    hideIf: 'hide_all_contacts',
  },
  households: {
    to: '/households', label: 'Households', icon: Home,
    // view_households is the single authoritative control for this tab, so an
    // admin can hide Households from a role just by unticking it. Every preset
    // (admin → volunteer, and the Bal Mandal set) carries view_households, so no
    // standard role loses the link; only a hand-built role that doesn't hold it
    // drops off — which is exactly the per-role control asked for. A Santo holds
    // none of these and is excluded as before.
    anyOf: ['view_households'],
  },
  events: {
    to: '/events', label: 'Events', icon: CalendarDays,
    anyOf: ['manage_events', 'view_all_contacts', 'view_assigned_contacts', 'edit_contacts'],
  },
  padhramani: {
    to: '/padhramani', label: 'Padhramani', icon: HeartHandshake,
    anyOf: ['edit_contacts', 'view_all_contacts', 'manage_users'],
  },
  santoSchedule: {
    to: '/santo-schedule', label: 'My Schedule', icon: CalendarCheck,
    anyOf: ['view_padhramani'],
  },
  reminders: {
    to: '/reminders', label: 'Reminders', icon: Bell,
    anyOf: ['view_all_contacts', 'view_assigned_contacts', 'edit_contacts'],
  },
  batches: {
    to: '/admin/batches', label: 'Batches', icon: ListChecks,
    // Both permissions, because BatchesPage opens for either one: generate_batches
    // alone gets the Generate tab. Gating the LINK on assign_batches only meant a
    // role that could cut batches had no way to reach the screen that cuts them.
    anyOf: ['assign_batches', 'generate_batches'],
  },
  dashboard: {
    to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard,
    anyOf: ['view_all_contacts', 'view_assigned_contacts'],
  },
  roles: {
    to: '/admin/roles', label: 'Roles', icon: ShieldCheck,
    anyOf: ['manage_roles'],
  },
  volunteers: {
    to: '/admin/volunteers', label: 'Volunteers', icon: UserCog,
    anyOf: ['manage_users', 'manage_scoped_volunteers'],
  },
  areas: {
    to: '/admin/areas-mandals', label: 'Areas & Mandals', icon: MapPin,
    anyOf: ['manage_users'],
  },
  tools: {
    to: '/admin/tools', label: 'Admin Tools', icon: Wrench,
    anyOf: ['view_all_contacts', 'manage_users', 'send_emails', 'manage_templates'],
  },
  balMandal: {
    to: '/bal-mandal', label: 'Bal Mandal', icon: GraduationCap,
    access: 'balMandal',
  },
};

// ── Per-role layouts ─────────────────────────────────────────────────────────
// `main`   → the primary section (no header label)
// `admin`  → rendered under an "Admin" section label, omitted entirely if empty
// `tabs`   → mobile bottom-bar order; AppLayout takes the first 4 that pass the
//            permission gate and appends a "Menu" button as the 5th slot.
const LAYOUTS = {
  admin: {
    main: ['contacts', 'households', 'events', 'balMandal', 'padhramani', 'reminders', 'myContacts', 'calling'],
    admin: ['dashboard', 'batches', 'volunteers', 'roles', 'areas', 'tools'],
    tabs: ['dashboard', 'contacts', 'households', 'batches'],
  },
  moderator: {
    main: ['contacts', 'households', 'events', 'balMandal', 'padhramani', 'reminders', 'myContacts', 'calling'],
    admin: ['dashboard', 'batches', 'volunteers', 'tools'],
    tabs: ['contacts', 'dashboard', 'batches', 'events'],
  },
  volunteer: {
    // A volunteer's job is the calling queue — it leads, and it is the landing page.
    main: ['calling', 'myContacts', 'households', 'events', 'balMandal', 'reminders', 'contacts'],
    admin: [],
    tabs: ['calling', 'myContacts', 'households', 'events'],
  },
  santo: {
    main: ['santoSchedule'],
    admin: [],
    tabs: ['santoSchedule'],
  },
  none: {
    main: ['households'],
    admin: [],
    tabs: ['households'],
  },
};

const HOME_PATHS = {
  admin: '/admin/dashboard',
  moderator: '/contacts',
  volunteer: '/calling',
  santo: '/santo-schedule',
  none: '/households',
};

function allowed(item, permissions, volunteer) {
  if (!item) return false;
  // Opt-out gate (Phase B): a role holding this permission has the item HIDDEN
  // even when its read permission would otherwise show it. Checked first so hide
  // always wins over the grant below. See VISIBILITY_HIDE_PERMISSIONS.
  if (item.hideIf && has(permissions, item.hideIf)) return false;
  if (item.access === 'balMandal') return canAccessBalMandal(permissions, volunteer);
  if (!item.anyOf) return true;
  return hasAny(permissions, item.anyOf);
}

function pick(keys, permissions, volunteer) {
  return keys.map((k) => NAV[k]).filter((item) => allowed(item, permissions, volunteer));
}

/**
 * getRoleView(permissions, volunteer)
 *
 * @returns {{
 *   key: string, label: string, badgeClass: string, homePath: string,
 *   sections: Array<{label: string|null, items: Array<object>}>,
 *   mobileTabs: Array<object>,
 *   allItems: Array<object>
 * }}
 */
export function getRoleView(permissions, volunteer = null) {
  const key = classifyRole(permissions);
  const layout = LAYOUTS[key] || LAYOUTS.none;

  const mainItems = pick(layout.main, permissions, volunteer);
  const adminItems = pick(layout.admin, permissions, volunteer);

  // The Santo link is additive: any role that somehow holds view_padhramani
  // without being classified as a Santo (e.g. Admin, who holds everything)
  // still gets the link, but at the end rather than as their headline item.
  const extras = [];
  if (key !== 'santo' && allowed(NAV.santoSchedule, permissions, volunteer)
      && !mainItems.includes(NAV.santoSchedule)) {
    extras.push(NAV.santoSchedule);
  }

  const sections = [
    { label: null, items: [...mainItems, ...extras] },
  ];
  if (adminItems.length) sections.push({ label: 'Admin', items: adminItems });

  // Bottom bar: first 4 permitted tabs, de-duplicated, never empty.
  let mobileTabs = pick(layout.tabs, permissions, volunteer).slice(0, 4);
  if (mobileTabs.length === 0) mobileTabs = [...mainItems, ...extras].slice(0, 4);

  // Landing page must be a destination this role can actually reach, otherwise
  // login bounces into a permission-denied screen.
  let homePath = HOME_PATHS[key] || '/households';
  const reachable = [...mainItems, ...adminItems, ...extras].map((i) => i.to);
  if (!reachable.includes(homePath)) homePath = reachable[0] || '/households';

  return {
    key,
    label: ROLE_LABELS[key] || 'Member',
    badgeClass: ROLE_BADGE_CLASSES[key] || ROLE_BADGE_CLASSES.none,
    homePath,
    sections,
    mobileTabs,
    allItems: [...mainItems, ...adminItems, ...extras],
  };
}

export { NAV as NAV_CATALOGUE };
