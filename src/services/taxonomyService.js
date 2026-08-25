// src/services/taxonomyService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 22 — renaming and merging Areas / Mandals / Levels / Sub-areas.
//
// WHY THIS FILE EXISTS
//
// Areas and Mandals are stored as NAME STRINGS on every record, never as a
// reference to areas/{id} or mandals/{id}. households.area is the literal text
// "Govind Nagar". So the areas/{id} document is not the source of truth for
// anything except the dropdown list — editing `name` there renames the option in
// the dropdown and nothing else. Every existing record keeps the old spelling,
// and from that moment the data is split across two strings that no query can
// bring back together.
//
// The old cascade (AreasMandalsManager's local cascadeRename) covered
// `individuals` + `households` only, and only for Mandals. That left the two
// worst cases untouched:
//
//   1. volunteers.assignedAreas[] / assignedMandals[] — firestore.rules gates
//      reads with `resource.data.area in ctx().areas`, an EXACT string match. A
//      rename that does not rewrite these arrays silently removes every area
//      head's access to their own contacts: no error, no empty-state hint, the
//      lists just come back empty. This is the reason a rename must be atomic
//      across collections and must be refused rather than half-applied.
//   2. batches.area|mandal, events.area|mandal, padhramaniEvents.area — the
//      calling queue, sabha reports and padhramani lists all filter on these,
//      so an un-rewritten batch stops matching its own area.
//
// The tables below are the complete list of places a taxonomy name is persisted,
// derived by grepping every write in src/. If a new collection starts storing an
// area or mandal name, add it here — that is the whole contract.
//
// RENAME AND MERGE ARE THE SAME OPERATION
//
// Both rewrite every occurrence of one string with another. They differ only in
// what happens to the taxonomy document afterwards: a rename updates its `name`,
// a merge deletes it (and, for areas, folds its sub-areas into the target). So
// both go through planTaxonomyChange() → applyTaxonomyChange(), and the caller
// does the one extra write.
//
// ORDERING: records first, taxonomy document last. Same reasoning as mergeRoles
// in RolesManager — if the run dies halfway, every name still resolves to a live
// option in the dropdown. The reverse order would leave records pointing at a
// deleted area, which is exactly the invisible state this file exists to avoid.
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc, query, where,
} from 'firebase/firestore';
// PHASE 24 — metered drop-ins (src/lib/fsMetered.js): same signatures, they count.
// Renaming or merging an area rewrites every household and contact carrying the
// old name, so the dashboard should show what a rename actually cost.
import { getDocs, writeBatch } from '../lib/fsMetered';
import { db } from '../lib/firebase';

// Firestore caps a WriteBatch at 500 operations. 400 leaves room to grow.
const CHUNK = 400;

/**
 * Every field in Firestore that holds a taxonomy name, per kind.
 *
 * `array: true`  → the field is an array of names (volunteers.assignedAreas).
 *                  Rewritten by read-modify-write rather than arrayRemove +
 *                  arrayUnion, because Firestore rejects two field transforms
 *                  on the same field path in one update.
 * `scoped: true` → sub-area names are only unique inside their area, so the
 *                  query must also pin `area == <parent>`. Both filters are
 *                  equality, which Firestore serves from single-field indexes —
 *                  no composite index needed.
 */
export const TAXONOMY_TARGETS = {
  area: [
    { collection: 'households', field: 'area', label: 'household' },
    { collection: 'individuals', field: 'area', label: 'contact' },
    { collection: 'batches', field: 'area', label: 'calling batch', plural: 'calling batches' },
    { collection: 'events', field: 'area', label: 'sabha / event' },
    { collection: 'padhramaniEvents', field: 'area', label: 'padhramani event' },
    { collection: 'volunteers', field: 'assignedAreas', label: 'karyakarta assignment', array: true },
  ],
  mandal: [
    { collection: 'individuals', field: 'mandal', label: 'contact' },
    // Households have no Mandal field on the form, but importers and the
    // household export both read household.mandal, so old rows can carry one.
    { collection: 'households', field: 'mandal', label: 'household' },
    { collection: 'batches', field: 'mandal', label: 'calling batch', plural: 'calling batches' },
    { collection: 'events', field: 'mandal', label: 'sabha / event' },
    { collection: 'volunteers', field: 'assignedMandals', label: 'karyakarta assignment', array: true },
  ],
  level: [
    { collection: 'households', field: 'level', label: 'household' },
  ],
  subArea: [
    { collection: 'households', field: 'subArea', label: 'household', scoped: true },
    { collection: 'individuals', field: 'subArea', label: 'contact', scoped: true },
  ],
};

export const TAXONOMY_LABELS = {
  area: 'Area',
  mandal: 'Mandal',
  level: 'Level',
  subArea: 'Sub-area',
};

function targetsFor(kind) {
  const targets = TAXONOMY_TARGETS[kind];
  if (!targets) throw new Error(`Unknown taxonomy kind "${kind}".`);
  return targets;
}

function buildQuery(target, value, parentArea) {
  const filters = [where(target.field, target.array ? 'array-contains' : '==', value)];
  if (target.scoped) {
    if (!parentArea) throw new Error('A sub-area change needs the area it belongs to.');
    filters.unshift(where('area', '==', parentArea));
  }
  return query(collection(db, target.collection), ...filters);
}

/**
 * planTaxonomyChange(kind, value, { parentArea })
 *
 * Fetches every document that carries `value`, so the preview and the rewrite
 * are built from the same read. The alternative — count() aggregations for the
 * preview — would be cheaper, but Firestore evaluates an aggregation query
 * against the rules without per-document data, and the collections involved here
 * are gated on `resource.data.area`, so a count can be refused where the plain
 * query is allowed. A preview that says "0 records" because of that would be
 * worse than a slightly more expensive one.
 *
 * Throws if a collection cannot be read: if its documents can't be listed they
 * can't be rewritten either, and a half-applied rename is the exact failure this
 * file exists to prevent.
 */
export async function planTaxonomyChange(kind, value, { parentArea = null } = {}) {
  const groups = await Promise.all(targetsFor(kind).map(async (target) => {
    const snap = await getDocs(buildQuery(target, value, parentArea));
    return { ...target, docs: snap.docs, count: snap.size };
  }));
  return {
    kind,
    value,
    parentArea,
    groups: groups.filter((g) => g.docs.length > 0),
    total: groups.reduce((sum, g) => sum + g.docs.length, 0),
  };
}

/**
 * A plan, described for a human: { total, rows, errors, plan }.
 * `rows` carries the per-collection counts; `plan` is passed straight back so
 * the caller can apply what it previewed without reading everything twice.
 */
export function summarizePlan(plan) {
  return {
    total: plan.total,
    rows: plan.groups.map(({ collection: c, field, label, plural, array, count }) => (
      { collection: c, field, label, plural, array, count }
    )),
    errors: [],
    plan,
  };
}

/**
 * countTaxonomyUsage(kind, value, { parentArea })
 *
 * "How much would this change touch?" — plan + summarize in one call, for the
 * confirmation text and the delete dialog.
 */
export async function countTaxonomyUsage(kind, value, { parentArea = null } = {}) {
  return summarizePlan(await planTaxonomyChange(kind, value, { parentArea }));
}

/**
 * Human-readable one-liner for a usage result — "48 households, 210 contacts,
 * 3 karyakarta assignments".
 */
export function describeUsage(usage) {
  const parts = usage.rows
    .filter((r) => r.count > 0)
    .map((r) => `${r.count} ${r.count === 1 ? r.label : (r.plural || `${r.label}s`)}`);
  return parts.length ? parts.join(', ') : 'nothing yet';
}

/**
 * applyTaxonomyChange(plan, newValue, { onProgress })
 *
 * Rewrites every document in the plan. Chunked into 400-operation batches; each
 * batch is atomic, the run as a whole is not, so `onProgress` reports what has
 * actually committed rather than what has been queued.
 *
 * @param {Object} plan       from planTaxonomyChange
 * @param {string} newValue   the replacement name
 * @param {Function} [onProgress] ({ done, total }) after each committed batch
 * @returns {Promise<{total:number, byCollection:Object}>}
 */
export async function applyTaxonomyChange(plan, newValue, { onProgress } = {}) {
  const next = String(newValue || '').trim();
  if (!next) throw new Error('The new name cannot be blank.');

  // Flatten first so a single batch can span collections — 300 households and
  // 150 contacts is one commit, not two.
  const writes = [];
  const byCollection = {};
  for (const group of plan.groups) {
    for (const snap of group.docs) {
      const ref = doc(db, group.collection, snap.id);
      if (group.array) {
        const current = snap.data()[group.field];
        if (!Array.isArray(current)) continue;
        // Set, not push: a merge can leave a volunteer holding the target name
        // twice, and a duplicate in assignedAreas breaks the `in` queries that
        // read it (Firestore caps `in` at 30 values).
        const rewritten = [...new Set(current.map((v) => (v === plan.value ? next : v)))];
        writes.push({ ref, data: { [group.field]: rewritten } });
      } else {
        writes.push({ ref, data: { [group.field]: next } });
      }
      byCollection[group.collection] = (byCollection[group.collection] || 0) + 1;
    }
  }

  let done = 0;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const slice = writes.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    slice.forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
    done += slice.length;
    onProgress?.({ done, total: writes.length });
  }

  return { total: writes.length, byCollection };
}

/**
 * renameTaxonomyValue(kind, oldValue, newValue, { parentArea, onProgress })
 *
 * The plan-and-apply pair in one call, for callers that don't need to show a
 * preview between the two halves. Does NOT touch the areas/mandals/levels
 * document itself — the caller owns that write, because a merge deletes it while
 * a rename updates it.
 */
export async function renameTaxonomyValue(kind, oldValue, newValue, opts = {}) {
  const { parentArea = null, onProgress } = opts;
  if (String(oldValue).trim() === String(newValue).trim()) {
    return { total: 0, byCollection: {} };
  }
  const plan = await planTaxonomyChange(kind, oldValue, { parentArea });
  return applyTaxonomyChange(plan, newValue, { onProgress });
}

/**
 * mergeSubAreaLists(targetSubAreas, sourceSubAreas)
 *
 * Merging two areas moves households that carry a `subArea` string. If the
 * target area does not define that sub-area, the moved household ends up with a
 * value that no dropdown offers and the Sub-area select renders blank — so the
 * source's sub-areas have to come along.
 *
 * Matched by NAME, because that is what households store. The target's own entry
 * wins on a clash, so an existing code is never rewritten underneath the records
 * already using it.
 */
export function mergeSubAreaLists(targetSubAreas = [], sourceSubAreas = []) {
  const out = [...targetSubAreas];
  const seen = new Set(out.map((s) => (s?.name || '').toLowerCase()));
  const added = [];
  for (const sub of sourceSubAreas) {
    const key = (sub?.name || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(sub);
    added.push(sub.name);
  }
  return { subAreas: out, added };
}

/**
 * describeTaxonomyError(err, kind)
 *
 * A cascade writes to households, individuals, batches, events,
 * padhramaniEvents and volunteers, and each of those has its own rule:
 * `edit_contacts` for contacts and households, `assign_batches` or
 * `generate_batches` for batches, `manage_events` for events, `manage_users` for
 * karyakarta assignments. This screen only requires `manage_users`, so a rename
 * can be started by someone who cannot finish it — and the raw
 * "Missing or insufficient permissions" gives no hint which collection refused.
 */
export function describeTaxonomyError(err, kind = 'area') {
  const label = (TAXONOMY_LABELS[kind] || 'value').toLowerCase();
  if (err?.code === 'permission-denied') {
    return `Firestore refused part of this ${label} change. It has to rewrite contacts, `
      + 'households, calling batches, events and karyakarta assignments, so it needs '
      + '"Edit Contacts", "Manage Events", a batch permission and "Manage Users" together — '
      + 'in practice, a full Admin role. Some records may already have been updated; '
      + 're-running the same change is safe and finishes the rest.';
  }
  if (err?.code === 'unavailable') {
    return 'You appear to be offline. Nothing further has been changed — re-run the '
      + 'same change once you reconnect and it will finish the remaining records.';
  }
  if (err?.code === 'failed-precondition') {
    return err.message || 'Firestore needs an index for this query. The link in the '
      + 'browser console creates it.';
  }
  return err?.message || `Could not complete the ${label} change.`;
}
