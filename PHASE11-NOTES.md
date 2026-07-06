# Phase 11 — Real Data Import, Area/Mandal Codes, In-App Import/Export

## What was built

- **`areas`/`mandals` reference collections** + `useAreasAndMandals()` hook
  + `<AreaSelect>`/`<MandalSelect>` shared dropdowns (`src/lib/
  areaMandalCodes.js`, `src/hooks/useAreasAndMandals.js`,
  `src/components/AreaMandalSelect.jsx`). `HouseholdForm`'s Area field and
  `IndividualForm`'s Mandal field were free-text inputs before — both are
  now fixed dropdowns sourced from these collections, seeded with your real
  short codes (e.g. Panchyawala → PW, Yuvak Mandal → YM).
- **Bug fix found while doing this**: `EventForm.jsx` had a hardcoded
  short-name Mandal list (`'Yuvak'`, `'Mahila'`) that never matched real
  `individual.mandal` values (`'Yuvak Mandal'`, `'Mahila Mandal'`) —
  event-to-Mandal scoping was silently broken since Phase 6. Fixed by
  switching to the shared `MandalSelect`.
- **`04-migrate-real-data.js`** (`phase-source-docs/`) — reads your two real
  `.xlsx` files directly (no manual CSV export step), importing
  households/individuals from the `Backup_<Mandal>` sheets, `areas`/
  `mandals` from their code tables, `events` from the Events sheet, and
  `attendance` by cross-referencing each row's `Sabha_<date>_<slug>`
  columns against Events' `Column_Name`.
- **In-app Import Contacts wizard** (`ImportContactsWizard.jsx`) — the
  actual 4-step flow from `index__1_.html` (pick file → map columns →
  preview → confirm), now writing straight to Firestore instead of POSTing
  to GAS. Wired into `/households` behind `edit_contacts`.
- **CSV + PDF export** (`ExportButtons.jsx`, using `jspdf`/`jspdf-autotable`)
  — also wired into `/households`.

## Things that needed a judgment call, flagged rather than guessed

**Volunteers sheet (985 rows) was NOT auto-imported.** It's mostly
test/placeholder rows (`"XYZ"`, `"Test..."`) with **plaintext passwords**
in the spreadsheet itself. Auto-creating Firebase Auth accounts from that
would carry weak test passwords into production, and the identifiers
(`"vols"`, `"mods"`, email-looking strings) don't fit the phone+password
scheme built in an earlier phase anyway. Instead, the migration script
filters out obvious test rows and writes `volunteers-to-review.csv` — use
it as a checklist to recreate real volunteers through `/admin/volunteers`
with actual phone numbers and fresh passwords.

**Activity sheet (2434 rows) was NOT imported.** It's keyed by volunteer/
contact *name strings*, not IDs, so importing it cleanly would need
name-to-ID resolution across possibly-ambiguous names. Skipped to keep this
script's scope contained — the app builds a proper `activity` log going
forward regardless.

**Yuvak Mandal has overlapping data in two places** — `YM_Mandal_Test.xlsx`'s
`Contacts` sheet (1981 rows) looks more complete/current than
`BAPS_All_Sampark...xlsx`'s `Backup_Yuvak Mandal` tab (1264 rows). Pass only
one of these to the migration script for Yuvak (see the script's header
comment) — it also warns on duplicate phone numbers as a safety net if you
accidentally pass both.

## Follow-up (built in the next round)

- **`AreasMandalsManager.jsx`** (`/admin/areas-mandals`, gated by
  `manage_users`) — admin CRUD for the areas/mandals reference collections.
  Previously seed-script-only.
- **`06-import-activity-log.js`** — imports the Activity sheet, resolving
  `Volunteer`/`ContactName` strings against your migrated `volunteers`/
  `individuals` collections by name. Anything ambiguous (duplicate names)
  or unresolved is written to `activity-import-review.json` instead of
  guessed — run this after `04-migrate-real-data.js` and after recreating
  real volunteers from `volunteers-to-review.csv`, since it needs both
  collections populated first.

## Still not built (say the word if you want this next)

- Bulk WhatsApp/SMS messaging (the legacy `Message` sheet + broadcast
  feature) — out of scope until asked for explicitly.
