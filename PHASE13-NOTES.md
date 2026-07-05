# Phase 13 — Contacts/Households Decoupling

## What changed

Individuals no longer require a household. `householdId` can be `null`.

- **`useAllContacts.js`** — new hook, subscribes to the whole `individuals`
  collection directly. `createContact()` writes `householdId: null` (not
  omitted, so `where('householdId','==',null)` queries work correctly).
- **`ContactsPage.jsx`** (`/contacts`, "All Contacts" in the nav) — search
  by name/mobile, filter by Mandal and by "in a household" vs "not grouped
  yet", add/edit/delete a contact directly, and a house icon per row to
  attach them to a household whenever you're ready.
- **`AddToHousehold.jsx`** — the reverse of the existing "search & link"
  feature: from a standalone contact, search households by the head's
  name/address/area and attach them there.
- **`firestore.rules`** — `individualScopeOk()` now explicitly checks
  `data.householdId != null` before doing the household lookup, instead of
  relying on `get()` against a possibly-missing document throwing. A
  standalone contact with no Mandal match and no household correctly has no
  scope match — this is now explicit rather than implicit/fragile.

## Both add-contact paths now coexist, per your request

- From a household ("+ Add member" → "Add a new person") — creates the
  person already attached to that household, same as before.
- From `/contacts` ("+ Add contact") — creates a standalone person with no
  household, attach one later whenever convenient.

## Not touched (deliberately)

Your already-migrated ~2028 single-person households were **not**
auto-flattened into standalone contacts. That's a real, somewhat consequential
change to existing production data (deleting ~2000 household docs and
nulling their individuals' `householdId`), so it wasn't done silently.
Say the word if you want a script for that — straightforward to write, just
didn't want to touch existing real records without confirmation first.
