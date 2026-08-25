# Phase 20 (PLAN ONLY) — Merging "BAPS YM Sampark Sevak Call" into MDS

> Status: **plan document. No code has been changed.**
> Source project read for this plan: `C:\Users\PRAPTI\Downloads\BAPS YM Sampark Sevak Call\`
> (`Code.gs` 4867 lines, `Registration.gs` 738, `BigQuery.gs` 117,
> `firebase_addon_Code.gs` 251, `index (2).html` 11489).

---

## Context — the single most important finding

**MDS is already a port of Sevak Call.** Not a similar app — an actual port of an
*older* version of it. The evidence is in your own code comments:

- `src/lib/callingStatuses.js` — "ported from `index__1_.html`'s chip buttons"
- `src/lib/attendanceWindow.js` — "Ported from the legacy `checkAttendanceWindow()`"
- `src/hooks/useMyBatchQueue.js` — "Ports `loadVolunteerContacts()`'s core idea"
- `src/services/statsService.js` — "mirroring `getAdminStats()`'s output shape from `CodeGSV5.gs`"
- `src/services/eventService.js` — "instead of the legacy's per-event Sheet column"

The attached project is the **newer, much larger** Sevak Call
(`Code.gs`, not `CodeGSV5.gs`), which grew six automation families and a public
registration module after that port was made.

So this is **not** "merge two apps". It is:

1. **Finish the port** — build the ~8 feature areas added to Sevak Call after the
   original port (all the automation, WhatsApp templates, batch generation,
   registration).
2. **Migrate the live Sheet data** into Firestore.
3. **Decommission the GAS backend** (and rotate a leaked secret — see Security).

Roughly **60% of Sevak Call already exists in MDS**, usually in a better form.
The plan below is a ledger of what exists, what's missing, and the build order.

---

## 1. Ledger — already ported, no work needed

| Sevak Call | MDS equivalent | Notes |
|---|---|---|
| `login(email,password)` + 3 hardcoded roles | Firebase Auth + `roles`/`volunteers` docs, `src/constants/permissions.js`, `src/hooks/usePermissions.jsx` | **Better.** Permission matrix, not 3 fixed roles |
| Volunteer calling screen (`screenCalling`) | `src/pages/CallingFlowPage.jsx` + `src/hooks/useMyBatchQueue.js` | Status vocabulary already matches exactly |
| Status chips | `src/lib/callingStatuses.js`, `src/components/calling/StatusChips.jsx` | 7 chips, identical value strings |
| Follow-up modes (Call Back / No Answer) | `FOLLOW_UP_STATUS_GROUPS` + `enterFollowUpMode()` | Done |
| `getAdminStats`, admin Overview | `src/services/statsService.js`, `src/pages/AdminDashboardPage.jsx` | Done |
| `screenModerator` (a whole parallel `modTab*` UI) | Phase 9: same screens, scoped by `assignedAreas` | **Better.** Sevak maintains two near-identical dashboards; MDS has one |
| Sabha events + attendance | `events` + `attendance` collections, `src/services/eventService.js`, `src/components/events/AttendanceMarking.jsx` | **Much better** — see §6.4 |
| 30-min attendance window | `src/lib/attendanceWindow.js` | Ported verbatim |
| Areas / Mandals admin | `src/admin/AreasMandalsManager.jsx`, `src/admin/AreaTable.jsx` | Plus sub-areas + Add Area (this week's work), which Sevak doesn't have |
| Activity sheet | `activity` collection, `src/lib/activityLog.js`, `src/components/admin-tools/AuditTrailTab.jsx` | Done |
| Contact ID `<Serial>-<Area>-<Mandal>-<Last4>` | `buildLegacyStyleCode()` in `src/lib/areaMandalCodes.js` | Done |
| Area/Mandal CSV + PDF export | `src/components/import-export/ExportButtons.jsx`, `src/lib/pdfExports.js`, `src/lib/householdExport.js` | vCard export is the only missing format |
| Deactivated-volunteer lockout | `usePermissions.jsx` — `isActive === false` → immediate `signOut` | Plus 12h inactivity logout, which Sevak lacks |
| Firebase "doorbell" + 5 sync channels (`_startSyncListeners`) | `onSnapshot` throughout | **Obsolete — do not port.** See §6.1 |
| `CacheService` 5-min caches, `LockService` locks | — | **Obsolete.** No 6-min quota, no row-lock problem |
| Offline queue (`syncQueue()`, `mode:'no-cors'`) | Firestore `persistentLocalCache` (Phase 6/10) | **Obsolete** |
| `getDataRange().getValues()` on every request | Indexed Firestore queries | **Obsolete** |

---

## 2. Ledger — what has to be built (8 workstreams)

### W1 — Batch engine parity  🔴 highest operational value

Sevak has a full batch system; MDS has manual checkbox selection only.

| Sevak function | Behaviour | MDS today |
|---|---|---|
| `generateBatch(area, size)` | Auto-split an area's uncalled contacts into numbered batches of N | ❌ missing |
| `assignBatch` / `unassignBatch` | Assign a whole numbered batch to a volunteer | partial (`createBatch` only) |
| `clearBatches` | Wipe all batches | ❌ |
| `Batches` sheet | `Batch_Number, Area, Contact_Count, Assigned_To, Assigned_At, Created_At` | `batches` doc lacks `batchNumber`, `contactCount`, `assignedAt` |
| `renderBatchVolStats`, `exportBatchCSV` | Per-volunteer batch progress + export | ❌ |
| `reassignContacts` | Move every contact from volunteer A to B | ❌ |

**Files:** `src/services/batchService.js` (extend), `src/components/sampark/BatchAssignment.jsx`,
`src/pages/BatchesPage.jsx`. Reuse `getIndividualsByArea()` and `chunk()` from
`src/lib/firestoreHelpers.js` — both already exist.

**Do not port one behaviour:** Sevak's `assignBatch` **silently clears Status and
Reference** on reassign, destroying call history. Port it as an explicit
"Reset call status for these contacts" checkbox, default off.

### W2 — WhatsApp message template + broadcast

Sevak: `getMessageTemplate` / `saveMessageTemplate`, the Message tab's WA sub-tab,
and `encodeWA_()` — a hand-rolled encoder that keeps emoji raw and encodes only
ASCII specials (real fix for a real WhatsApp bug; worth copying exactly).

MDS today: `CallingFlowPage.jsx:154` opens `https://wa.me/91…` with **no message body**.

**Build:** `settings/messageTemplate` doc + editor in Admin Tools + new
`src/lib/whatsapp.js` exposing `buildWhatsAppUrl(template, contact)` with
`{{name}}`/`{{mandal}}` substitution. Port `encodeWA_` verbatim.
Phase 11 notes already list this as "still not built".

### W3 — Email automation  🔴 largest gap

Four jobs, all currently `GmailApp`/`MailApp`:

| Job | Sevak trigger | Recipients | Content |
|---|---|---|---|
| Daily calling report | `dailyEmailTrigger()` 10 PM | admins + moderators | HTML + PDF attachment; per-volunteer stats |
| Per-volunteer daily report | same trigger | each active volunteer | their own numbers |
| Post-sabha attendance report | `sabhaEmailTrigger()` every 15 min, fires 10–25 min after a sabha ends | volunteers / admins / moderators (3 variants) | attendance %, by-area, by-mandal, volunteer contribution, present list, yearly `X/Y` per member |
| Daily birthday summary | 6 AM | active admins + moderators only (never contacts) | WhatsApp buttons, "Turning Age: X" |

Plus `sendManualEmail(d)`: `dailyReport | sabhaReport` × `allAdmins | allMods | allVols | individual`.

**Port target:** Cloud Functions v2 `onSchedule` — the pattern already exists in
`functions/index.js:111` (`scheduledFirestoreToGASSync '0 3 * * *'`).

Three things must change on the way over:

1. **Transport.** No `GmailApp` outside Apps Script. Recommendation: the
   **Firebase "Trigger Email from Firestore" extension** — write a doc to a `mail`
   collection, extension sends it. Zero SMTP code, retries built in, and the
   queued doc *is* the audit log. (Alternatives: nodemailer + SMTP, or Resend/SendGrid.)
2. **Idempotency.** Sevak's post-sabha job guards against double-send with an
   `AutoEmailed` column set to `'yes'`. Replace with `emailedAt` on the event doc
   written **inside a transaction**, so a Functions retry can't double-send.
   The 15-min poll also disappears — use a Cloud Task / `onSchedule` that queries
   `events` where the window just closed.
3. **PDF.** Sevak's `buildPdfBlob_()` writes a temp HTML file to Drive, calls
   `.getAs('application/pdf')`, then trashes it. Not available in Node. Use the
   `jspdf` + `jspdf-autotable` already in `package.json` — they run server-side —
   and factor the table builders out of `src/lib/pdfExports.js` into a shared
   module so email PDFs and in-app exports stay identical.

**Settings:** `EmailSettings` sheet → `settings/email` doc holding the four existing
toggles (`autoAdminEnabled`, `autoVolEnabled`, `autoPostSabhaEnabled`,
`autoSabhaAdminModEnabled`) + a new `dryRun` flag, edited from a new Admin Tools tab.

**New permission:** `send_emails`.

### W4 — Birthday → Google Calendar sync  ⚠️ recommend deferring

Sevak's most complex module: a `SevakCall Birthdays` calendar, all-day yearly
recurring series per contact, a `BirthdaySync` sheet as the id-mapping table, a
50-per-batch worker that **re-triggers itself every 2 seconds** to dodge the
6-minute execution cap, and `parseDOBLocal_()` — a genuine fix for the
Sheets/IST UTC-midnight one-day shift.

Porting means: Calendar API v3 from a Cloud Function (service account with
domain-wide delegation, or a stored OAuth refresh token), `birthdaySync/{individualId}`
docs holding `eventId`, and a paged `onSchedule` worker with a Firestore cursor —
the self-re-triggering trick is unnecessary since Functions allow 9-minute timeouts.

**My recommendation: skip this, or do it last.** MDS already has
`src/components/reminders/RemindersDashboard.jsx` + `reminderService.js` (uses
`dobMonthDay` range queries, scoped by permission), and W3 adds the daily birthday
email. The calendar is the highest-effort, lowest-marginal-value piece of the
whole merge. Listed here for completeness; sequenced last.

### W5 — Public YM event registration

`Registration.gs`: `Annual Events` sheet, one sheet per event, `checkMobile(mobile)`,
`ymRegister`, `ymUpdateMember`, seeded `shivir2026` / `mukhpath2026`, contact IDs
`YM-yyyyMMddHHmmss`, registration IDs `REG-<ts>-<rand4>`.

**Build:** `registrationEvents/{eventId}` + `registrations/{regId}` collections;
a **public route outside `RequireAuth`** in `src/App.jsx` (e.g. `/register/:eventSlug`);
and — critically — all writes through an `onCall` Cloud Function, **not** direct
client writes, so `firestore.rules` can keep these collections closed to
unauthenticated clients. `checkMobile` becomes the same function returning only
"already registered / not" (no PII echo).

**Fix on port:** `ymAppendRegistration_` writes a **fixed positional array** — one
inserted column silently corrupts every future registration. Use named fields.
Also `ymUpdateRegistration` is defined but **never wired into `doPost`** — dead code
today; wire it or drop it deliberately.

**New permission:** `manage_registrations`.

### W6 — Weekly Status/Reference archive → real history

Sevak's `archiveStatusReference()` writes per-week **column pairs**
(`W17_Status_02-May-2026` / `W17_Ref_…`) into a `Status_Reference` sheet every
Sunday 11 PM. That's a snapshot workaround for having no history table.

**Build instead:** append-only `statusHistory` — either written by
`updateContactField()` in `src/services/contactService.js`, or by an
`onDocumentUpdated('individuals/{id}')` trigger. Unlimited granularity, not weekly.

**Check first:** `campaigns` + `src/components/admin-tools/CampaignsTab.jsx` and
`CampaignSummary.jsx` already exist. If "campaign" already means "a calling round",
extend that instead of adding a parallel concept.

**Drop:** `importExistingWeekData()` — hardcoded `W16 25-Apr-2026` / `W17 02-May-2026`
headers, plus a stray unused `existingSheet` variable.

### W7 — Volunteer management (small gap)

`manageVolunteer` (add/edit/deactivate) and `logLogin` are already covered by
`src/admin/VolunteerEditor.jsx` + `functions/createVolunteerAccount.js`,
`updateVolunteerAccount.js`, `resetVolunteerPassword.js`, and `lastLoginAt` in
`usePermissions.jsx`. Only `reassignContacts` is missing → folds into W1.

### W8 — Utilities: port, guard, or drop

| Sevak | Decision |
|---|---|
| `rebuildIds`, `verifyContactIds`, `manualRebuildContactIds` | **Port** as a Data Integrity check using `buildLegacyStyleCode()` → `src/services/integrityService.js` + `DataIntegrityTab.jsx` |
| `clearStatusColumn`, `clearReferenceColumn`, `clearAssignedToColumn` | **Port as one guarded tool** ("Reset campaign fields") with a typed confirmation. These are unguarded full-column wipes today |
| `getAllContactsFromBQ(filters)` | **Drop.** Interpolates `filters.area/mandal/status/assignedTo` straight into SQL, and selects columns that don't exist |
| `BigQuery.gs` entirely | **Drop.** It reads `Email`, `AreaCode`, `MandalCode`, `AssignedTo`, `BatchNo` — **none of which exist** in the Contacts sheet (real names: `Assigned_To`, `Batch_Number`), so those fields have been syncing as empty strings. And `syncSingleContactToBQ()` doesn't upsert — it schedules a full `WRITE_TRUNCATE` resync 60 s later. Firestore + indexes serve the "fast reads" purpose |
| `findBadNames()` | Fold into `integrityService.js` |
| vCard export (`_exportGroupVCard`) | **Port** — genuinely useful, and MDS has no vCard path |

---

## 3. Security — mandatory, not optional

1. **Plaintext passwords.** Volunteers sheet column C is the password in clear text,
   and `doLogin()` sends it in a **GET query string**
   (`?action=login&email=…&password=…`) — which lands in GAS execution logs and
   browser history. Firebase Auth already solves this in MDS.
   **→ Do not port `login()`. Do not import the Password column.** Provision via
   the existing `resetVolunteerPassword` function.
2. **Leaked Firebase secret.** `firebase_addon_Code.gs:14` hardcodes
   `FIREBASE_SECRET = 'n3bZDT5MmM…'` — a full-access legacy RTDB secret — next to
   the DB URL, in a file that has been copied around.
   **→ Revoke that secret in the Firebase console and delete the
   `sevakcall-doorbell` RTDB.** MDS doesn't need it (§6.1).
3. **Anonymous webapp.** The GAS deployment accepts unauthenticated `doGet`/`doPost`
   from anyone with the URL (the frontend sends no credentials).
   **→ Archive the deployment** once the port lands.
4. **Public registration writes** → `onCall` + basic rate limiting (W5).
5. ~~**Fix before adding rules:** `firestore.rules` has `match /campaigns/{campaignId}`
   **duplicated 4×, with 3 copies nested inside `match /syncLogs/{logId}`** (~lines
   341–376). Every new collection in this plan goes into that same file — clean this
   up first.~~

   **CORRECTION (verified while implementing):** this was wrong. `firestore.rules`
   contains exactly **one** `match /campaigns/{campaignId}` block, it is not nested
   inside `syncLogs`, and the file is well-formed. Nothing needed cleaning up, and
   nothing was changed on this account. The `settings`, `emailLogs` and `mail`
   blocks were appended after `campaigns` as normal.

---

## 4. Bugs in the source project — fix-on-port list

| Bug | Where | Impact |
|---|---|---|
| Two conflicting `updateContact()` definitions | `Code.gs` vs `firebase_addon_Code.gs:76` | Whichever loads last wins. The addon one takes the lock but **never increments `Call_Count`**; the Code.gs one increments but has **no lock**. So today you have either lost writes or a broken call counter — not both fixed |
| `clearStatusColumn` routed twice in `doPost` | `Code.gs` ~80–81 (flagged in the addon's own trailing comment) | dead duplicate |
| Duplicate `case` labels in the registration switch | `Registration.gs` | unreachable branches |
| Sabha time-range IIFE copy-pasted 3× | `Code.gs` | drift risk |
| `computeTurningAge_` has contradictory/unreachable logic | `Code.gs` | superseded by `turningAge_`; delete |
| 3 definitions of `loadBdEmailStatus()` | `index (2).html` (flagged in its own trailing comment, ~10463–10518) | first two are dead |
| `loadVolunteerContacts` retries 5× with 2 s sleeps | `index (2).html:5273` | pure symptom of Sheets write lag — vanishes with `onSnapshot` |

---

## 5. Data migration map

Sevak `Contacts` sheet → MDS collections:

| Contacts column | MDS destination |
|---|---|
| `ID` | `individuals.legacyCode` (keep for reconciliation) |
| `Name` | `individuals.name` |
| `Phone` | `individuals.mobile` |
| `DOB` | `individuals.dob` **+ `dobMonthDay`** (required by `reminderService.js`) |
| `Study`, `Profession`, `Skill` | same-named fields (already in `MEMBER_FIELD_DEFS`) |
| `Mandal` | `individuals.mandal` |
| `Complete_Address` | `households.address` |
| `Note` | `households.remark` |
| `Area` | `households.area` + `individuals.area` (per Phase 18 auto-default) |
| `Assigned_To` (a **name** string) | resolve → `volunteers` doc id → `batches.assignedVolunteerId` |
| `Status`, `Reference` | `individuals.status`, `individuals.reference` |
| `Call_Count` | `individuals.callCount` |
| `Batch_Number` | `batches.batchNumber` |
| `Sabha_<date>_<title>` columns | one `events` doc per column + one `attendance` doc per `Present` cell |
| `Volunteers` sheet | `volunteers` + `roles` — **drop the Password column** |
| `Activity` sheet | `activity` — script `06-import-activity-log.js` already exists |
| `Areas`, `Mandal` sheets | `areas`, `mandals` — already seeded |
| `Batches` sheet | `batches` |
| `Status_Reference` | `statusHistory`, or skip (snapshot-only value) |
| `BirthdaySync` | `birthdaySync` — only if W4 is built |
| `Annual Events` + per-event sheets | `registrationEvents` / `registrations` |

**Role mapping:** seed three `roles` docs so the existing mental model survives —
Admin (all permissions), Moderator (`view_assigned_contacts` + `assign_batches` +
`manage_events`, with `assignedAreas` set), Volunteer (`view_assigned_contacts` +
`edit_contacts`). Note the gap already documented in PHASE7-NOTES: a volunteer needs
`edit_contacts` **and** a view permission, or their batch silently reads as empty.

**New permissions to add** to `src/constants/permissions.js`: `send_emails`,
`manage_registrations`, `manage_templates`.

---

## 6. Upgrade suggestions (your second question)

### 6.1 Delete the entire realtime workaround stack
Sevak's `_startSyncListeners()` is ~220 lines implementing 5 "channels", debounce
timers, a `_localSabhaWrite` writer-guard, a 10-second settle delay, a
`_lastSabhaAttendanceSync` cross-channel guard, and a spinner banner — all to work
around Sheets not being a realtime database. `onSnapshot` gives this for free, and
MDS already uses it. **Net deletion: the doorbell, the RTDB, the 5 channels, the
offline queue, the retry loops, and the leaked secret.**

### 6.2 Push notifications (FCM) instead of a toast
Replace "🔔 Doorbell ping received!" with a real push notification when a batch is
assigned — works when the app is closed, which the toast never did.

### 6.3 Attendance model is already a major win — extend it
Sevak adds a **Sheet column per sabha** (`Sabha_2026-04-18_Yuvak`). That hits the
18,278-column ceiling and slows every single read of the sheet. MDS's long-format
`attendance/{eventId}_{individualId}` has no such limit.
**Extend it:** Sevak computes a per-member yearly `X/Y` attendance ratio inside
`triggerSabhaEmail` — surface that in the UI via `statsService.js`, not only in email.

### 6.4 Server-side attendance window
Both apps enforce the 30-minute window **client-side only** — `attendanceWindow.js`
documents this as a deliberate trade-off. If attendance integrity matters, enforce it
in the Cloud Function that writes attendance (cheap there; expensive in rules).

### 6.5 Household model
Keep MDS's `households` + `individuals` split. Sevak's flat sheet duplicates the
address across every family member. The import must fold `Complete_Address` into one
household per address. (This also unblocks the outstanding
"one row per household + Family Member Count" export request.)

### 6.6 Structured audit trail
`activity.details` is a free-text string today. Change to `{field, from, to}` — cheap
now, and it makes "who changed this status" answerable.

### 6.7 Observability
`syncLogs` exists. Add `emailLogs` (or use the `mail` collection from W3) so a failed
10 PM report is **visible** rather than silently missing. Sevak has no way to know an
email didn't go out.

### 6.8 Already flagged in your own notes, still worth doing
- **Zod validation + Firebase App Check** — PHASE14-NOTES lists both as "next up".
- **Per-tab permission gating** in `AdminToolsPage` — currently `anyOf` of three
  broad permissions.
- **GAS sync is insert-only** (MERGE-NOTES) — becomes irrelevant once GAS is retired.

### 6.9 Cost
`onSchedule` + Firestore + one email provider fits comfortably in free/low tiers.
Dropping BigQuery removes a paid dependency that was writing empty columns anyway.

---

## 7. Recommended build order

| Phase | Scope | Why here |
|---|---|---|
| **20** | W1 batch engine + `reassignContacts` (W7) | Highest daily-ops value; no new infra |
| **21** | W2 WhatsApp template + broadcast | Small, self-contained, visible win |
| **22** | W3 part 1 — email infra (extension/SMTP), `settings/email`, daily calling report, manual send | Infra once, then reuse |
| **23** | W3 part 2 — post-sabha report + birthday summary email | Reuses 22's transport + PDF builder |
| **24** | W6 status history + W8 integrity/guarded tools + vCard export | Cleanup and data safety |
| **25** | W5 public YM registration | Independent; needs its own public-route review |
| **26** | Security hardening: rules cleanup, App Check, Zod, **GAS decommission + secret rotation** | Rotate the RTDB secret *immediately* (§3.2), not in phase 26 |
| **27** *(optional)* | W4 birthday → Google Calendar | Highest effort, lowest marginal value |

---

## 8. Three decisions I need from you before Phase 22

1. **Email transport** — my recommendation: the Firebase *Trigger Email from Firestore*
   extension (no SMTP code, built-in retries, the queue doc doubles as the audit log).
   Alternatives: nodemailer + your Gmail SMTP, or Resend/SendGrid.
2. **Google Calendar birthday sync** — build it (W4/Phase 27), or is the daily
   birthday email + existing Reminders dashboard enough?
3. **Sheets after the cutover** — full decommission, or keep the Sheet as a
   read-only mirror via the existing `scheduledFirestoreToGASSync`? (Keeping it means
   fixing `importContacts` to upsert instead of skip — MERGE-NOTES flags it as
   insert-only today.)

---

## 9. Verification (per phase)

- `npx vite build` — must stay clean (last run: `✓ built in 10.03s`).
- Preview server + login as an admin; walk the affected tab. Note that
  `/admin/areas-mandals` and other admin screens are gated behind `manage_users`,
  so verification needs a role with the right permissions.
- **Cloud Functions:** `firebase emulators:start --only functions,firestore`, then
  invoke scheduled handlers manually via `firebase functions:shell`.
- **Email dry-run:** with `settings/email.dryRun = true`, write the rendered HTML to a
  Firestore doc instead of sending — verify content before any real recipient gets mail.
- **Parity check:** for each ported feature, run the same action in the live Sevak Call
  app and in MDS and diff the numbers (contact counts, status breakdown, attendance
  totals, per-volunteer stats).
- **Migration:** dry-run the importer, review the unresolved/ambiguous report (the
  pattern `06-import-activity-log.js` already uses with
  `activity-import-review.json`), then run for real.
