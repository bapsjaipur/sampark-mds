# BAPS Jaipur MDS — Firestore Schema (v2, post-merge)

Supersedes `01-firestore-schema.md` from Phase 1. Changes are additions only —
nothing from v1 was removed or renamed.

## Collections

### `households/{householdId}`
```
{
  address: string,
  area: string,
  level: string,
  totalFamilyMembers: number,
  samparkKaryakartaName: string,   // LEGACY — no longer asked on the household
  samparkKaryakartaNumber: string, // form as of Phase 17.1; see individuals.samparkKaryakartaName
  remark: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  legacyId: string
}
```

### `individuals/{individualId}`
```
{
  householdId: string,
  name: string,
  mobile: string,
  dob: string | null,
  dobMonthDay: string | null,
  anniversary: string | null,
  anniversaryMonthDay: string | null,
  mandal: string,
  relation: "head" | "spouse" | "member",
  isPrimary: boolean,
  profilePhotoURL: string | null,
  createdAt: Timestamp,
  updatedAt: Timestamp,

  // Added in Phase 4 (Sampark follow-ups):
  status: "not_contacted" | "contacted" | "follow_up" | "not_interested" | "converted",
  reference: string,       // free text, e.g. "referred by ..."
  callCount: number

  // Added in Phase 17 — optional, shown/hidden per-Mandal (see `mandals`):
  study: string,
  profession: string,
  skill: string,

  // Added in Phase 17.1 — Sampark Karyakarta moved from household to the
  // individual level, also shown/hidden per-Mandal. The household's
  // effective Sampark is derived at display time from whichever member has
  // isPrimary === true; a non-primary member can still carry their own,
  // separate Sampark Karyakarta.
  samparkKaryakartaName: string,
  samparkKaryakartaNumber: string
}
```

### `roles/{roleId}`
```
{ name: string, permissions: string[] }
```
Permission strings (see `src/constants/permissions.js`): `view_all_contacts`,
`view_assigned_contacts`, `edit_contacts`, `assign_batches`, `manage_users`,
`manage_roles`, `run_gas_sync` (the last added at the Phase 5 merge).

### `volunteers/{volunteerId}`
```
{ name: string, mobile: string, roleRef: string, assignedAreas: string[], assignedMandals: string[] }
```
Doc ID **must equal the Firebase Auth uid** — see `src/hooks/usePermissions.jsx`.

### `activity/{activityId}`
```
{ timestamp: Timestamp, volunteerId: string, individualId: string|null, action: string, details: string|object }
```
Append-only — `firestore.rules` blocks all client-side update/delete.

### `batches/{batchId}` — NEW, added in Phase 4
```
{
  name: string,
  area: string,
  individualIds: string[],
  assignedVolunteerId: string,
  createdBy: string,
  createdAt: Timestamp
}
```

### `syncLogs/{logId}` — NEW, added in Phase 5
```
{
  ranAt: Timestamp,
  totalMandals: number,
  totalRows: number,
  inserted: number,
  skipped: number,
  errors: string[]
}
```
Written only by the `syncFirestoreToGAS` Cloud Function via the Admin SDK
(bypasses `firestore.rules` entirely). Client reads are gated by
`run_gas_sync` or `manage_users`.

## Composite indexes (see `firestore.indexes.json`)

| Collection | Fields | Used by |
|---|---|---|
| `individuals` | `mandal` ASC, `dobMonthDay` ASC | Reminders (mandal-scoped) |
| `individuals` | `mandal` ASC, `anniversaryMonthDay` ASC | Reminders (mandal-scoped) |
| `individuals` | `householdId` ASC, `dobMonthDay` ASC | Reminders (area-scoped, via household lookup) |
| `individuals` | `householdId` ASC, `anniversaryMonthDay` ASC | Reminders (area-scoped) |
| `individuals` | `householdId` ASC, `isPrimary` DESC | Household detail page member list |
| `individuals` | `name` ASC | Global search (lazy full-collection load) |
| `households` | `area` ASC | Batch assignment candidate lookup |
| `households` | `updatedAt` DESC | Households list, default sort |

The last two `individuals` composite indexes (`householdId` + month-day) were
missing from the v1 schema doc — v1 only anticipated mandal-scoped reminder
queries, but `reminderService.js`'s area-scoped path (via
`getHouseholdIdsForAreas`) needs them too. Added at merge time.

## Known limitations, carried forward from earlier phases

- **GAS backup sync is insert-only.** `syncFirestoreToGAS` calls the legacy
  `importContacts` GAS action, which skips any row whose phone number already
  exists in that Mandal's Sheet. Edits to already-synced people don't
  propagate to the Sheet backup.
- **`Study`/`Profession`/`Skill`** were legacy fields not collected anywhere
  in earlier phases. As of Phase 17 they're optional `individuals` fields,
  toggled on per-Mandal (like Photo, DOB, etc. — see `fields` on the
  `mandals` doc and `MEMBER_FIELD_DEFS` in `src/lib/areaMandalCodes.js`).
  They arrive blank in the GAS Sheet backup for anyone added before that
  Mandal had the field turned on.
