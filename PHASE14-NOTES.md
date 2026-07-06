# Phase 14 — Admin Tools (Data Integrity, Audit Trail, Sync Dashboard)

All three grouped under one `/admin/tools` page with tabs, rather than
three more top-level nav items — the nav bar was already getting long.

## Data Integrity tab

- **Duplicate phone detection** — groups every individual sharing the same
  valid 10-digit mobile number, shown side by side (name, Mandal, status,
  household-or-standalone) with a "Delete this one" per record. Deliberately
  **not** an automatic merge — picking which of two records to keep, and
  whether to preserve any data from the one you delete, needs a human
  decision. This surfaces the duplicates and gets out of the way.
- **Missing info** — anyone without a valid phone number, and anyone
  without a Mandal assigned, each with a "Fix" link straight to their
  record.

## Audit Trail tab

Read-only timeline over the `activity` collection — that data has existed
since Phase 3, this is just the viewer. Filterable by action type and by
volunteer, shows the last 300 entries.

## Sync Dashboard tab

UI for the `syncFirestoreToGAS` Cloud Function (Phase 5) — the function and
its `syncLogs` collection already existed; this adds the "Trigger Export
Now" button and a visual history of past runs (inserted/skipped/error
counts per run).

## Permission note

`AdminToolsPage` is gated by `anyOf: ['view_all_contacts', 'manage_users',
'run_gas_sync']` — broader than any single tab needs, since someone with
just `run_gas_sync` (but not `view_all_contacts`) should still reach the
Sync tab. Each tab doesn't further self-gate beyond that; if you want
per-tab permission boundaries (e.g. hide the Sync tab from someone who only
has `view_all_contacts`), let me know and I'll tighten it.

## Next up

Point 2 (Attio-style visual redesign) and point 3 (Zod validation + App
Check) — in small parts, as agreed. Let me know which piece of either to
start with.
