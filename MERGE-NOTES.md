# MDS — Merge Notes (Phases 1–5 reconciled)

This is the merged, consistent codebase built from all 5 phase drops. Every
decision flagged during the phase-by-phase review has been resolved here.
What follows is a changelog, not a tutorial — read the individual phase
READMEs (kept in your uploads) for usage docs on any given piece.

## Decisions made at merge

1. **Auth/permissions — one hook.** `src/hooks/usePermissions.jsx` is now
   canonical: Phase 2's context-provider pattern (one shared listener) +
   Phase 4's live `onSnapshot` updates (permissions change immediately if an
   admin edits a role, not just on next login). Both `usePermissions()` and
   `useAuth()` are exported as aliases of the same hook/context, and
   `AuthProvider`/`PermissionsProvider` are aliases of the same provider —
   nothing else needed renaming.

2. **`firestore.rules` — one file.** Built on Phase 2's scoping logic (which
   was the more correct of the two). Fixed: Phase 4's version left
   `individuals` create/update ungated by area/mandal for scoped-only
   volunteers — closed by applying the same scoping used for `read`.
   Rewritten to use `let`-bindings only inside named `function`s ending in
   `return` (the only place Firestore Rules v2 permits `let` — an earlier
   draft of this merge used `let` inline inside `allow` conditions, which is
   invalid syntax and would have failed to deploy). Added Phase 4's
   `batches` collection and a new `syncLogs` collection for Phase 5.

3. **`permissions.js` — one file**, at `src/constants/permissions.js`.
   Unions Phase 2's `PERMISSION_LABELS`/`ALL_PERMISSIONS` (used by
   `RolesManager`'s checkbox matrix) with Phase 4's `hasPermission()`/
   `hasAnyPermission()`/`hasAllPermissions()` helpers (used by
   `ContactCard`/`BatchAssignment`). Added `RUN_GAS_SYNC` — the Phase 5
   Cloud Function checked for `run_gas_sync` but it was never in the
   registry until now.

4. **`firebase.js` — one location**, `src/lib/firebase.js` (Phase 3's path
   — it had the most dependents). Phase 2's admin screens' imports were
   updated from `'../firebase'` to `'../lib/firebase'`.

5. **Schema updated** (`01-firestore-schema-v2.md`): added `status`/
   `reference`/`callCount` to `individuals`, added `batches` and `syncLogs`
   collections, added two composite indexes Phase 1 didn't anticipate
   (`individuals`: `householdId`+`dobMonthDay`, `householdId`+
   `anniversaryMonthDay` — needed by the area-scoped Reminders query path).

6. **Dropped Phase 3's per-CRUD GAS mirror.** `src/lib/activityLog.js` no
   longer POSTs to the GAS webhook on every create/update/delete — that call
   used action names (`create_individual`, etc.) that don't exist in
   `CodeGSV5.gs`'s `doPost` router, and because it used `mode: "no-cors"`,
   GAS's `{error: 'Unknown action'}` response was silently unreadable in the
   browser. The `activity` collection write (the real audit trail) is kept.
   The actual Sheets backup path is Phase 5's `syncFirestoreToGAS`, which
   uses the real `importContacts` action on a schedule.

7. **Component API — internal hook calls, not props.** `ContactCard`,
   `BatchAssignment`, and `RemindersDashboard` (all Phase 4) were refactored
   to call `useAuth()` internally instead of receiving `permissions`/
   `volunteerId`/`volunteer` as props, matching every Phase 3 component's
   pattern. Callers of these three components no longer need to thread
   volunteer/permission data down manually.

8. **`RequirePermission` — one component**, at
   `src/components/RequirePermission.jsx`, using Phase 2's richer API
   (`anyOf`/`allOf`/`disableOnly`/`loadingFallback`). Exports both a named
   and a default export so it satisfies both Phase 2's admin screens
   (`import { RequirePermission }`) and Phase 3's pages
   (`import RequirePermission from ...`) without editing either call style.
   Also accepts `any` as an alias of `anyOf` for the same reason, though no
   shipped component actually used it.

## Post-merge fixes (found after you actually ran the app)

9. **Missing Vite scaffold.** `index.html`, `vite.config.js`,
   `tailwind.config.js`, `postcss.config.js`, `src/main.jsx`, `src/index.css`
   didn't exist anywhere in the 5 phase drops — Phase 1's chat produced only
   the schema doc and migration script, never the actual scaffold, and this
   gap wasn't caught during the merge review. Added after `npm run dev`
   failed with "Could not auto-determine entry point."

10. **No login page, no sign-in method.** All 5 phases assumed a signed-in
    Firebase user already exists (`usePermissions.jsx` just listens for
    `onAuthStateChanged`), but nothing ever called a `signInWith...()`
    method or rendered a login form. Added: `src/lib/authHelpers.js`
    (phone → synthetic email conversion, since Firebase Auth has no native
    "phone + password" provider — its phone option is OTP-only),
    `src/pages/LoginPage.jsx`, `src/components/AppLayout.jsx` (nav + sign
    out + a `RequireAuth` route guard), and
    `functions/createVolunteerAccount.js` (admin-only Cloud Function that
    creates both the Firebase Auth user and the matching
    `volunteers/{uid}` doc — previously `VolunteerEditor.jsx` could only
    edit existing volunteer docs, never provision a new login). Wired the
    new form into `VolunteerEditor.jsx` and added `/login` + route guards
    to `App.jsx`.

    **Setup requirement this adds:** in the Firebase Console →
    Authentication → Sign-in method, enable **Email/Password** (yes, even
    though users type a phone number — the synthetic email is what
    actually hits Firebase Auth under the hood).

## Known trade-offs carried forward (not fixed, by design)

- **GAS sync is insert-only** — edits to already-synced people don't
  propagate to the Sheets backup. Flagged in `functions/index.js` and the
  schema doc; fixing it means editing `CodeGSV5.gs`'s `importContacts` to
  upsert instead of skip, which is out of scope for this app-side merge.
- **Two "Call now" buttons behave slightly differently** —
  `ContactCard`'s increments `callCount` (atomic batch write); the Reminders
  Dashboard's only logs activity. Left as-is since a reminder call and a
  Sampark follow-up call are arguably different actions; revisit if that
  turns out to be confusing in practice.
- **Global search loads the full `individuals` collection client-side**,
  lazily on first keystroke. Fine at karyekar-org scale; swap for
  Algolia/Typesense behind a Cloud Function if the dataset grows into the
  tens of thousands.

## What to do next

1. `npm install` (see `package.json` — you'll need `react-easy-crop`,
   `react-router-dom`, `firebase`).
2. Fill in `.env` with your `VITE_FIREBASE_*` values and
   `VITE_GAS_WEBHOOK_URL` (see `05-vercel-deployment.md` from Phase 5).
3. `firebase deploy --only firestore:rules,firestore:indexes`.
4. Run `02-migrate-to-firestore.js --dry-run` against your real `Book1.xlsx`
   if you haven't already, review the output, then run it for real.
5. Manually create your first `roles` doc with `manage_users` +
   `manage_roles` + `run_gas_sync` permissions, and one `volunteers` doc
   (keyed by a real Firebase Auth uid) pointing to it, so you have an
   initial admin login — the app has no bootstrap/signup flow by design
   (access is admin-provisioned).
6. `firebase deploy --only functions` for the GAS sync Cloud Function.
7. Deploy the React app to Vercel per `05-vercel-deployment.md`.
8. Work through `05-e2e-test-checklist.md`.
