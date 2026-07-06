# Phase 7 — Calling Flow (volunteers' daily batch workflow)

## What was built

- `src/lib/callingStatuses.js` — the real status vocabulary (see below).
- `src/hooks/useMyBatchQueue.js` — live-subscribes to every `batches` doc
  assigned to the signed-in volunteer, flattens their `individualIds[]`
  into one deduplicated ordered queue, live-subscribes to each individual.
- `src/components/calling/StatusChips.jsx` — the color-coded status picker.
- `src/pages/CallingFlowPage.jsx` — the main screen: one contact at a time,
  Call/WhatsApp buttons, status chips, reference note, Save & Next, a
  progress bar, follow-up quick-filters (Call Back Later / No Answer), a
  search-to-jump box, and an "All Done" end screen. Now the app's default
  landing route (`/`  →  `/calling`), matching the legacy app's own default
  screen — karyekars open the app to work their batch, not to browse
  households.

## Status vocabulary correction

Phase 4 invented a placeholder status set (`not_contacted`, `contacted`,
`follow_up`, `not_interested`, `converted`) before the legacy app's actual
data was available. The real one, pulled from `index__1_.html`'s chip
buttons (and even admin-configurable per-Mandal there via
`getStatusConfig`): **Interested, Not Interested, Call Back Later, No
Answer, Already Volunteer, Donated, Follow Up**. `contactService.js`'s
`STATUS_OPTIONS` now derives from `callingStatuses.js` instead of the old
placeholder array, and `03-migrate-legacy-contacts.js` (the flat-contacts
migration script from earlier) was fixed to pass these values through
unchanged from your CSV's `Status` column instead of mis-translating them
into the old placeholder set.

**"Wrong Number"** existed in the legacy markup but was commented out /
disabled there — left out here too. Add it back to `STATUS_CHIPS` if you
actually want it active.

If you already migrated contacts using the *old* migration script version
(before this fix), their `status` field will be in the old snake_case
vocabulary and won't match any status chip — they'll just show as
"Not contacted yet" until re-saved. Re-run the migration if that matters,
or leave it — it self-corrects the moment each contact gets a new status
saved through the calling flow.

## Offline behavior

The legacy app hand-rolls an `offlineQueue` array + `localStorage` to queue
saves made while offline. This wasn't reimplemented — Phase 6 already
enabled Firestore's `persistentLocalCache`, so a save made offline queues
locally and flushes automatically on reconnect, no custom code needed.
`handleSaveAndNext`'s catch block still shows a toast and advances to the
next contact either way, matching the legacy UX (never block the volunteer
waiting on a network round-trip).

## Known gap, carried forward

A volunteer needs `edit_contacts` **and** (`view_all_contacts` or
`view_assigned_contacts`) to actually read the individuals in their batch —
`edit_contacts` alone isn't enough, since `firestore.rules`' individuals-read
rule requires a view permission too. This isn't a new gap introduced here;
it's the same scoping rule from Phase 2/the merge, just worth calling out
since it'll surface as "no batch assigned" (empty read) rather than a clear
permission error if a role is missing the view permission.

## Still to come

- Phase 8: Admin stats dashboard
- Phase 9: Moderator screen
