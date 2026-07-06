# Phase 18 — Feature-backlog build (Household tab)

Working through `mds-feature-backlog.md`, Section 1 (Household Tab), one item
at a time. This note is appended to as each item lands.

## 1.1 — Auto-default Area for members + backfill  ✅

**The bug:** In `IndividualForm`, Area is only shown when *not* inside a
household (`showArea = !withinHousehold && fieldsConfig.area`), and the submit
payload did `area: showArea ? form.area : ""`. So every member added *inside*
a household saved `area: ""` — blank — instead of the household's Area.

**Phase-17 caveat (why Area only, not Mandal):** the original backlog prompt
says "auto-set `area` **and** `mandal` from the parent household." But Phase 17
moved Mandal onto the individual (it's the member's first question and drives
which other fields show) and removed Mandal from the household form entirely —
households no longer store a Mandal. Forcing a household Mandal would break the
per-member Mandal design, so **only Area is inherited**; Mandal stays the
member's own choice.

**Going-forward fix:**
- `IndividualForm.jsx` — new `householdArea` prop. Payload now does
  `area: withinHousehold ? householdArea : (showArea ? form.area : "")`, so a
  member added inside a household inherits that household's Area even though
  the Area field stays hidden.
- `HouseholdDetailPage.jsx` — passes `householdArea={household.area || ""}`
  into the member `IndividualForm`.

**One-time backfill for existing data:**
- `services/bulkService.js` → `backfillMemberAreas()`. Self-fetches
  `households` + `individuals` (same one-pass style as
  `bulkDeleteHouseholdsCascade`), finds every individual with a `householdId`
  but blank `area`, and batch-updates it to the parent household's `area`
  (chunked at 400/batch). **Only fills blanks — never overwrites** an area
  already set. Members whose household itself has no area are skipped and
  counted separately. Returns `{ updated, skippedNoHouseholdArea }`.
- `services/integrityService.js` → `findMissingAreaInHousehold(individuals)`
  drives the count/list (standalone contacts excluded — nothing to inherit
  from).
- `components/admin-tools/DataIntegrityTab.jsx` — new **"Missing area"** sub-tab
  (Admin Tools → Data Integrity) listing affected members with a one-click
  **"Fix missing areas (N)"** button + confirm dialog and a toast summary.

**How to run it:** Admin Tools → Data Integrity → *Missing area* → *Fix missing
areas*. Safe to run repeatedly (idempotent — once filled, a member no longer
matches the blank-area query).

Build verified with `npm run build` (clean; the >500 kB chunk warning is
pre-existing and unrelated).

## 1.4 — Pagination for Households + Contacts  ✅

**Root cause it fixes:** `useHouseholds` and `useAllContacts` each did an
unbounded `onSnapshot` over the whole collection — the real reason list loads
were slow and Firestore reads were high.

**Design constraint (why not the literal backlog prompt):** both hooks are
used in *two* ways — as the list views (Households/Contacts pages) **and** as
"give me the whole collection" sources for other features. A blind rework
would have broken:
- `HouseholdDetailPage` — `households.find(h => h.id === …)` on a deep link
  past page 1 → "not found".
- `BatchesPage` / `EventsPage` — derive their full Area dropdown from all
  households.
- `DataIntegrityTab` — scans the entire `individuals` collection.
- `GlobalSearchBar` — matches households from the passed-in list.

**Approach — opt-in, backward-compatible pagination:**
- Both hooks now take an optional `{ pageSize }`. **No arg → identical old
  behavior** (full load), so every non-list consumer above is untouched. With
  a pageSize, a single real-time `onSnapshot` uses `limit(limitCount)` and
  `loadMore()` grows `limitCount` by one page. Kept the live listener (not
  `getDocs`) so optimistic create/update and real-time still work. Both now
  also return `{ hasMore, loadMore }` (`hasMore` = last snapshot filled the
  limit exactly).
- `HouseholdsPage.jsx` / `ContactsPage.jsx` call the hooks with
  `{ pageSize: 20 }` and render a **"Load more"** button when `hasMore`.
  Existing client-side area/mandal/search filters still apply to loaded pages
  (per the backlog note); a hint under the button tells the user filters only
  cover loaded rows. Header counts now read "N+ loaded" instead of implying a
  total.
- **Regression guards:**
  - `HouseholdsPage` Area filter dropdown was built from
    `households.map(h => h.area)` — that would shrink under pagination. Now
    sourced from `useAreasAndMandals` (complete reference list), matching how
    `ContactsPage` already did it.
  - `useGlobalSearch` relied on the caller's household list for area
    enrichment + household matches. It now lazily loads the **entire**
    households collection itself on first search (same pattern it already used
    for individuals), so global search stays global regardless of list page.
    The passed household list is now just an immediate `householdsHint`
    fallback for the first frame.

Build verified with `npm run build` (clean).
