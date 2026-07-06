# Phase 5 — End-to-End Test Checklist

## Auth
- [ ] Login with a volunteer account succeeds and loads their `volunteers` doc
- [ ] Login with an unrecognized account is rejected with a clear error
- [ ] Logout clears local state (no stale data visible after re-login as a different user)

## Permission Gating (Phase 2 tie-in)
- [ ] A role WITHOUT `edit_contacts` cannot see Add/Edit/Delete buttons in the UI
- [ ] The same role, attempting a direct Firestore write via browser devtools, is rejected by security rules (not just hidden in UI)
- [ ] A role WITHOUT `view_all_contacts` only sees households/individuals in their `assignedAreas`/`assignedMandals`
- [ ] `run_gas_sync` permission gates the sync button; non-admins don't see it, and the callable function rejects them server-side even if called directly

## Optimistic UI Rollback (Phase 3 tie-in)
- [ ] Editing a contact while offline shows the change immediately, then rolls back with a toast when the write ultimately fails
- [ ] Rapid double-save on the same record doesn't create duplicate Firestore docs

## GAS Sync (Phase 5)
- [ ] Manual sync button triggers `syncFirestoreToGAS` and returns a summary (inserted/skipped/errors)
- [ ] A brand-new individual (phone number not yet in any Mandal sheet) appears in the correct `Backup_<Mandal>`-adjacent Contacts sheet after sync
- [ ] An individual whose phone ALREADY exists in the Sheet is correctly skipped, not duplicated — confirm this matches your expectations, since it means edits don't propagate (see caveat in `05-firestore-to-gas-sync.js`)
- [ ] `syncLogs` collection in Firestore shows a new entry after each run with accurate counts
- [ ] Scheduled 3 AM run appears in Firebase Functions logs the following morning
