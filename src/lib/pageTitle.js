// src/lib/pageTitle.js
// PHASE 44 — per-route document.title. Every screen previously showed the tab
// title "BAPS Jaipur MDS", so browser history, bookmarks, and a wall of open
// tabs were indistinguishable. A single <TitleManager/> in App.jsx watches the
// location and sets the title from this map — one place, no per-page wiring.
const BASE = "BAPS Jaipur MDS";

// Exact paths first; dynamic detail routes are matched by prefix below.
const EXACT = {
  "/login": "Sign in",
  "/privacy": "Privacy Policy",
  "/terms": "Terms",
  "/profile": "Profile",
  "/calling": "Calling",
  "/households": "Households",
  "/contacts": "Contacts",
  "/padhramani": "Padhramani",
  "/santo-schedule": "Santo Schedule",
  "/my-contacts": "My Contacts",
  "/events": "Events",
  "/bal-mandal": "Bal Mandal",
  "/bal-mandal/promotion": "Standard Promotion",
  "/admin/dashboard": "Dashboard",
  "/admin/batches": "Batches",
  "/reminders": "Reminders",
  "/admin/roles": "Roles",
  "/admin/volunteers": "Volunteers",
  "/admin/areas-mandals": "Areas & Mandals",
  "/admin/tools": "Admin Tools",
};

// Prefix → label for the /:id detail routes, which shouldn't fall through to 404.
const PREFIX = [
  ["/households/", "Household"],
  ["/contacts/", "Contact"],
];

export function titleForPath(pathname) {
  let label = EXACT[pathname];
  if (!label) {
    const hit = PREFIX.find(([p]) => pathname.startsWith(p));
    if (hit) label = hit[1];
  }
  if (!label && pathname !== "/") label = "Page not found";
  return label ? `${label} · ${BASE}` : BASE;
}
