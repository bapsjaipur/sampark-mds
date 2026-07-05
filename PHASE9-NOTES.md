# Phase 9 — Moderator Screen

Not a separate screen. A "moderator" in the legacy app was just the admin
dashboard pre-filtered to one area (`currentUser.assignedArea`). Here, that
maps directly onto the existing permission model: a volunteer with
`view_assigned_contacts` + `assignedAreas`/`assignedMandals` instead of
`view_all_contacts`.

## Changed

- `statsService.js` — `computeOverviewStats`/`computeVolunteerStats` now
  take an optional `scope` (same `{ mandals, householdIds, unscoped }` shape
  `reminderService.js` already used), filtering individuals/batches before
  computing numbers.
- `AdminDashboardPage.jsx` — resolves the signed-in volunteer's scope via
  `getHouseholdIdsForAreas` (now exported from `reminderService.js`),
  passes it into the stats functions, and its `RequirePermission` gate
  widened from `view_all_contacts` only to `anyOf: ['view_all_contacts',
  'view_assigned_contacts']`. Title/subtitle switch between "Admin
  Dashboard" and "Moderator Dashboard" based on which permission matched.
- **Fixed a gap found while wiring this up**: `BatchAssignment.jsx` (built
  in Phase 4) was never actually mounted to a route anywhere in the app —
  added `BatchesPage.jsx` at `/admin/batches`, gated by `assign_batches`.

## Result

To make someone a "moderator," give their role `view_assigned_contacts` +
`assign_batches` (not `view_all_contacts`), and set their `assignedAreas`
on their volunteer doc. They'll see the same Dashboard/Batches/Events
screens everyone else does, automatically scoped to their area — no
separate code path to maintain.

## All 10 phases from the centralization roadmap are now built

6: Events/Sabha + attendance + offline support
7: Calling flow
8: Admin dashboard
9: Moderator scoping (this phase)
10: Offline support — bundled into Phase 6 (Firestore `persistentLocalCache`)
