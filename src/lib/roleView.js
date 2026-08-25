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
  PhoneCall, PhoneForwarded,
} from 'lucide-react';
import { classifyRole, ROLE_LABELS, ROLE_BADGE_CLASSES } from '../constants/roleTemplates';

const has = (perms, p) => Array.isArray(perms) && perms.includes(p);
const hasAny = (perms, list) => list.some((p) => has(perms, p));

// ── The full catalogue of navigable destinations ──────────────────────────────
// `anyOf: null` means "no permission gate" (every signed-in user).
// Ordering inside this object is irrelevant; each role picks its own order below.
const NAV = {
  calling: {
    to: '/calling', label: 'My Calling', icon: PhoneForwarded,
    // A volunteer needs edit_contacts to save a status; a read-only role would
    // reach the screen and fail on every save, so gate on the write permission.
    anyOf: ['edit_contacts'],
  },
  myContacts: {
    to: '/my-contacts', label: 'My Contacts', icon: PhoneCall,
    anyOf: ['view_assigned_contacts', 'edit_contacts', 'view_all_contacts'],
  },
  contacts: {
    to: '/contacts', label: 'All Contacts', icon: Users,
    anyOf: ['view_all_contacts', 'view_assigned_contacts', 'edit_contacts'],
  },
  households: {
    to: '/households', label: 'Households', icon: Home,
    // Historically ungated. Kept deliberately broad so no existing role loses
    // the link, but narrow enough to exclude a Santo (who holds none of these).
    anyOf: ['view_households', 'view_all_contacts', 'view_assigned_contacts', 'edit_contacts'],
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
    anyOf: ['manage_users'],
  },
  areas: {
    to: '/admin/areas-mandals', label: 'Areas & Mandals', icon: MapPin,
    anyOf: ['manage_users'],
  },
  tools: {
    to: '/admin/tools', label: 'Admin Tools', icon: Wrench,
    anyOf: ['view_all_contacts', 'manage_users', 'send_emails', 'manage_templates'],
  },
};

// ── Per-role layouts ─────────────────────────────────────────────────────────
// `main`   → the primary section (no header label)
// `admin`  → rendered under an "Admin" section label, omitted entirely if empty
// `tabs`   → mobile bottom-bar order; AppLayout takes the first 4 that pass the
//            permission gate and appends a "Menu" button as the 5th slot.
const LAYOUTS = {
  admin: {
    main: ['contacts', 'households', 'events', 'padhramani', 'reminders', 'myContacts', 'calling'],
    admin: ['dashboard', 'batches', 'volunteers', 'roles', 'areas', 'tools'],
    tabs: ['dashboard', 'contacts', 'households', 'batches'],
  },
  moderator: {
    main: ['contacts', 'households', 'events', 'padhramani', 'reminders', 'myContacts', 'calling'],
    admin: ['dashboard', 'batches', 'tools'],
    tabs: ['contacts', 'dashboard', 'batches', 'events'],
  },
  volunteer: {
    // A volunteer's job is the calling queue — it leads, and it is the landing page.
    main: ['calling', 'myContacts', 'households', 'events', 'reminders', 'contacts'],
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

function allowed(item, permissions) {
  if (!item) return false;
  if (!item.anyOf) return true;
  return hasAny(permissions, item.anyOf);
}

function pick(keys, permissions) {
  return keys.map((k) => NAV[k]).filter((item) => allowed(item, permissions));
}

/**
 * getRoleView(permissions)
 *
 * @returns {{
 *   key: string, label: string, badgeClass: string, homePath: string,
 *   sections: Array<{label: string|null, items: Array<object>}>,
 *   mobileTabs: Array<object>,
 *   allItems: Array<object>
 * }}
 */
export function getRoleView(permissions) {
  const key = classifyRole(permissions);
  const layout = LAYOUTS[key] || LAYOUTS.none;

  const mainItems = pick(layout.main, permissions);
  const adminItems = pick(layout.admin, permissions);

  // The Santo link is additive: any role that somehow holds view_padhramani
  // without being classified as a Santo (e.g. Admin, who holds everything)
  // still gets the link, but at the end rather than as their headline item.
  const extras = [];
  if (key !== 'santo' && allowed(NAV.santoSchedule, permissions)
      && !mainItems.includes(NAV.santoSchedule)) {
    extras.push(NAV.santoSchedule);
  }

  const sections = [
    { label: null, items: [...mainItems, ...extras] },
  ];
  if (adminItems.length) sections.push({ label: 'Admin', items: adminItems });

  // Bottom bar: first 4 permitted tabs, de-duplicated, never empty.
  let mobileTabs = pick(layout.tabs, permissions).slice(0, 4);
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
