// src/services/reminderService.js
// ─────────────────────────────────────────────────────────────────────────────
// Upcoming birthday / anniversary reminders, scoped to what the signed-in
// volunteer is actually responsible for.
//
// PHASE 21 — this file used to hardcode ONE scope shape: the union of
// (households in assignedAreas) ∪ (individuals in assignedMandals). That is
// right for an Area head and for a Mandal head, and wrong for everybody else:
// a karyakarta assigned to Yuvak Mandal in Vaishali Nagar got reminders for
// every Yuvak in the city AND every family in Vaishali, which is not their
// list. It now takes the resolved `scope` from useAuth() and honours
// scopeKind, so INTERSECT means AND rather than OR. src/lib/scope.js is the
// single definition; this file only decides which QUERIES can serve it.
//
// Why the shape matters at query level: Firestore cannot AND two `in` filters
// on different fields together with a range filter, so INTERSECT is served by
// querying the narrower axis (mandal) and filtering the area in memory. The
// result is identical to matchesScope(), which is asserted by reusing it.
// ─────────────────────────────────────────────────────────────────────────────
import { collection, documentId, query, where } from 'firebase/firestore';
// PHASE 24 — metered drop-in (src/lib/fsMetered.js): same signature, it counts.
import { getDocs } from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { getMonthDayWindow, isMonthDayInWindows } from '../lib/dateRanges';
import { chunk } from '../lib/firestoreHelpers';
import { PERMISSIONS, hasPermission } from '../constants/permissions';
import { SCOPE_KINDS, resolveScope, matchesScope, individualScopeArea } from '../lib/scope';

export async function getHouseholdIdsForAreas(areas) {
  if (!areas?.length) return [];
  const ids = new Set();
  for (const c of chunk(areas)) {
    const snap = await getDocs(query(collection(db, 'households'), where('area', 'in', c)));
    snap.forEach((d) => ids.add(d.id));
  }
  return [...ids];
}

/** Which households sit in which area — needed to check an area-scoped rule
 *  against an individual, who carries no area of their own. */
async function loadHouseholdAreas(areas) {
  const byId = {};
  if (!areas?.length) return byId;
  for (const c of chunk(areas)) {
    const snap = await getDocs(query(collection(db, 'households'), where('area', 'in', c)));
    snap.forEach((d) => { byId[d.id] = { id: d.id, ...d.data() }; });
  }
  return byId;
}

// A range filter on dobMonthDay combined with `where('area','in', …)` needs a
// composite index that the union-only version never required. Standalone
// contacts (householdId === null, own `area` field) are only reachable that
// way, so it is attempted — and a missing index degrades to "those contacts
// don't appear" with a console hint, instead of throwing the page away.
//
// The four indexes this needs (area/mandal × dob/anniversary, plus the
// householdId pair) are declared in firestore.indexes.json. If a standalone
// contact's birthday is missing from an area-scoped volunteer's board, the
// indexes have not been deployed yet: firebase deploy --only firestore:indexes
let warnedMissingAreaIndex = false;
async function tryQuery(q) {
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (err?.code === 'failed-precondition') {
      if (!warnedMissingAreaIndex) {
        warnedMissingAreaIndex = true;
        console.warn(
          '[reminders] Standalone contacts were skipped — Firestore needs a composite index. '
          + 'Open the link in the error below to create it, then reload.',
          err.message,
        );
      }
      return [];
    }
    throw err;
  }
}

/**
 * Runs the minimum set of queries that can cover `scope` for one date field,
 * then narrows the result with matchesScope() so the answer is exactly the
 * same predicate the rest of the app uses.
 */
async function queryByField(field, windows, scope, householdsById) {
  const results = new Map();

  for (const w of windows) {
    const range = [where(field, '>=', w.start), where(field, '<=', w.end)];
    const base = collection(db, 'individuals');

    if (scope.unrestricted) {
      (await tryQuery(query(base, ...range))).forEach((r) => results.set(r.id, r));
      continue;
    }

    const { kind, areas, mandals } = scope;

    // Query the axis (or axes) that can serve this shape. INTERSECT
    // deliberately queries ONLY the mandal axis: it is the narrower of the two
    // and the area half is then applied in memory, which avoids both a second
    // round of `in` filters and a needless composite index.
    const wantMandalAxis = kind === SCOPE_KINDS.MANDAL
      || kind === SCOPE_KINDS.INTERSECT
      || kind === SCOPE_KINDS.UNION;
    const wantAreaAxis = kind === SCOPE_KINDS.AREA || kind === SCOPE_KINDS.UNION;

    if (wantMandalAxis) {
      for (const c of chunk(mandals)) {
        (await tryQuery(query(base, ...range, where('mandal', 'in', c)))).forEach((r) => results.set(r.id, r));
      }
    }
    if (wantAreaAxis) {
      const householdIds = Object.keys(householdsById);
      for (const c of chunk(householdIds)) {
        (await tryQuery(query(base, ...range, where('householdId', 'in', c)))).forEach((r) => results.set(r.id, r));
      }
      // Standalone contacts carry their own area and belong to no household.
      for (const c of chunk(areas)) {
        (await tryQuery(query(base, ...range, where('area', 'in', c)))).forEach((r) => results.set(r.id, r));
      }
    }
  }

  // The queries above are a superset for UNION and for AREA (a household in an
  // assigned area can hold members of any mandal — correct for AREA, but the
  // same query also feeds INTERSECT's in-memory half). One predicate decides.
  return [...results.values()].filter((ind) => matchesScope(scope, {
    area: ind.area || householdsById[ind.householdId]?.area || null,
    mandal: ind.mandal || null,
  }));
}

/**
 * Attach the area each person sits in, so the dashboard can label and filter by
 * it. An individual carries no `area` of its own unless it is a standalone
 * contact (Phase 13/16) — otherwise it comes from the parent household.
 *
 * Only the households actually referenced by the result set are fetched, which
 * is a handful of documents even across a 30-day window, and the ones already
 * loaded for scoping are reused. Failures are swallowed per chunk on purpose:
 * a UNION-scoped volunteer legitimately sees people whose HOUSEHOLD sits outside
 * their areas (they matched on the mandal axis), and firestore.rules will refuse
 * that household read. The area is a label and a filter, never the gate — so a
 * refused read means "area unknown", not a broken page.
 */
async function attachAreas(entries, householdsById) {
  const needed = [...new Set(
    entries
      .map((e) => e.individual.householdId)
      .filter((id) => id && !householdsById[id]),
  )];

  const extra = {};
  for (const c of chunk(needed)) {
    try {
      const snap = await getDocs(query(collection(db, 'households'), where(documentId(), 'in', c)));
      snap.forEach((d) => { extra[d.id] = { id: d.id, ...d.data() }; });
    } catch {
      /* area stays null for this chunk — see the note above */
    }
  }

  const lookup = { ...householdsById, ...extra };
  return entries.map((e) => ({ ...e, area: individualScopeArea(e.individual, lookup) }));
}

/**
 * getReminders({ volunteer, permissions, scope })
 *
 * `scope` comes from useAuth() and every call site in the app passes it. It is
 * optional only so a future caller holding just a volunteer document still
 * works — but that path cannot see the role documents, so it INFERS the shape
 * from the assignment (an area and a mandal → their intersection) instead of
 * honouring a role that states something wider. Pass the scope.
 *
 * Every entry is `{ individual, type: 'dob'|'anniversary', monthDay, area }`.
 *
 * @returns {Promise<{thisWeek: object[], thisMonth: object[], entries: object[], scope: object}>}
 */
export async function getReminders({ volunteer, permissions, scope: passedScope } = {}) {
  const scope = passedScope || resolveScope({ volunteer, permissions });

  // hasPermission is still consulted so a role whose scopeKind was never set
  // but which holds view_all_contacts is treated as global, exactly as before.
  const unrestricted = scope.unrestricted
    || hasPermission(permissions, PERMISSIONS.VIEW_ALL_CONTACTS);
  const effective = unrestricted ? { ...scope, unrestricted: true } : scope;

  const empty = { thisWeek: [], thisMonth: [], entries: [], scope: effective };
  if (!unrestricted) {
    if (effective.kind === SCOPE_KINDS.NONE) return empty;
    // A scoped role with no territory assigned yet matches nothing. Returning
    // early keeps it distinguishable from "nothing due", via scope.empty.
    if (effective.empty) return empty;
  }

  const householdsById = unrestricted ? {} : await loadHouseholdAreas(effective.areas);

  const windows30 = getMonthDayWindow(30);
  const windows7 = getMonthDayWindow(7);

  const [dobResults, annResults] = await Promise.all([
    queryByField('dobMonthDay', windows30, effective, householdsById),
    queryByField('anniversaryMonthDay', windows30, effective, householdsById),
  ]);

  const entries = await attachAreas([
    ...dobResults.map((ind) => ({ individual: ind, type: 'dob', monthDay: ind.dobMonthDay })),
    ...annResults.map((ind) => ({ individual: ind, type: 'anniversary', monthDay: ind.anniversaryMonthDay })),
  ], householdsById);

  const thisWeek = entries.filter((e) => isMonthDayInWindows(e.monthDay, windows7));
  const thisMonth = entries.filter((e) => !isMonthDayInWindows(e.monthDay, windows7));

  const byMonthDay = (a, b) => (a.monthDay < b.monthDay ? -1 : 1);
  thisWeek.sort(byMonthDay);
  thisMonth.sort(byMonthDay);

  // `entries` is the whole 30-day set in one sorted list — the dashboard groups
  // it by day itself, and thisWeek/thisMonth are kept for older callers.
  return { thisWeek, thisMonth, entries: [...entries].sort(byMonthDay), scope: effective };
}
