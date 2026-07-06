# Phase 16 — Sidebar Fix, Bulk Delete, Firebase Storage Setup

## 1. Sidebar bug — actually fixed, not just tweaked

Root cause: the `<aside>` was a normal flex child of a row alongside
`<main>`. On a tall page (1240 households creates a very tall scrollable
main content area), the flex row's default `align-items: stretch`
stretched the sidebar to match main's full height — which pushed the
sign-out button (pinned to the bottom of that now-enormous sidebar) far
below the visible viewport. You had to scroll to the very bottom of the
entire page to find it.

Fixed by making the sidebar `fixed` to the viewport with its own
independent scroll (`md:fixed md:inset-y-0`), so it always matches
viewport height regardless of how tall the page content gets. Also added:

- **Mobile drawer** — below the `md` breakpoint, the sidebar is off-canvas
  by default with a hamburger button in a small top bar; opens as a
  slide-over with a backdrop, closes on nav click or backdrop tap.
- **Desktop collapse toggle** — shrinks the sidebar to icon-only (labels
  hidden, icons + tooltips via `title`), state persisted in
  `localStorage` so it stays collapsed across sessions if you prefer it
  that way.

## 2. Bulk delete + standalone-mode import

- **`bulkService.js`** — `bulkDeleteIndividuals()` (Contacts page — deletes
  only the individual docs, deliberately *not* touching any household they
  might belong to, so bulk-deleting a filtered set never unexpectedly nukes
  a shared household) and `bulkDeleteHouseholdsCascade()` (Households
  page — deletes households AND every member in each, batched).
- Both pages now have checkboxes, a "select all N filtered" shortcut, and a
  bulk-action bar that appears once something's selected.
- **`individuals.area`** — new optional field, denormalized independent of
  any household's area. Needed because standalone contacts (no household)
  had no way to be filtered/bulk-deleted by Area before — now `IndividualForm`
  has an Area dropdown, and `firestore.rules`' scoping checks it directly.
- **`ImportContactsWizard`** now takes a `mode` prop: `'household'`
  (Households page, unchanged — one household-of-one per row) or
  `'standalone'` (Contacts page, new — bare individuals, Area/Mandal stored
  directly on the person, no household created at all).

## 3. Firebase Storage — rules written, camera + gallery added

**`storage.rules` did not exist before this.** Your screenshot showing an
empty bucket with no rules configured was catching a real gap — profile
photo uploads had zero server-side enforcement; only the client-side
permission check in `PhotoUploader.jsx` was gating it, which isn't a
security boundary. Deploy with `firebase deploy --only storage`.

One thing worth knowing about how it's built: **Storage rules can access at
most 2 Firestore documents per rule evaluation** (a hard Firebase limit,
separate from Firestore's own 10-get budget). My first draft accidentally
used 3 (fetching the volunteer doc twice through a helper function) — I
caught this by checking Firebase's actual docs before shipping it, since
getting rules wrong silently breaks every upload rather than erroring
loudly. Fixed to use exactly 2 (`let` bindings, one get each).

**Camera + gallery, both explicit options.** `PhotoUploader.jsx` now has
two separate buttons — "Take photo" (opens the device camera directly via
`capture="environment"`) and "Choose from gallery" (a plain file picker) —
instead of one ambiguous file input.

**Compression standard**, unchanged from earlier phases but now documented
explicitly: every photo is downscaled to 512×512 and re-encoded as JPEG at
85% quality before upload, regardless of source size. A typical phone
camera photo (8–12MB) becomes roughly 30–150KB after this — about a 100x
reduction — which is what keeps Storage usage low across thousands of
contacts. This is automatic; nothing further needed per-upload.

## Setup steps for you

1. `firebase deploy --only storage` (new file, must be deployed).
2. `firebase deploy --only firestore:rules` (the `individuals.area` scoping
   addition needs the updated rules live).
3. No new npm dependencies this round — `npm install` not required unless
   you cleared `node_modules`.
