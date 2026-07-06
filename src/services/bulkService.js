// src/services/bulkService.js
// Phase 16 — bulk delete, for undoing accidental imports quickly. Both
// functions chunk into batches of 400 (Firestore's per-batch write limit).

import { collection, doc, writeBatch, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

function chunk(arr, size = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** One-time 1.1 backfill: members added inside a household before the
 * auto-inherit fix saved with a blank `area`. This finds every individual
 * that has a `householdId` but an empty `area`, and copies the parent
 * household's `area` onto it. Households that themselves have no area, and
 * members already carrying an area, are left untouched. Self-fetches both
 * collections (same one-pass approach as bulkDeleteHouseholdsCascade) so it
 * can run from any admin screen without needing them preloaded.
 *
 * Returns { updated, skippedNoHouseholdArea } for a user-facing summary. */
export async function backfillMemberAreas() {
  const [householdsSnap, individualsSnap] = await Promise.all([
    getDocs(collection(db, 'households')),
    getDocs(collection(db, 'individuals')),
  ]);

  const areaByHousehold = new Map();
  householdsSnap.forEach((d) => areaByHousehold.set(d.id, (d.data().area || '').trim()));

  const toFix = [];
  let skippedNoHouseholdArea = 0;
  individualsSnap.forEach((d) => {
    const data = d.data();
    const hasHousehold = Boolean(data.householdId);
    const missingArea = !data.area || !String(data.area).trim();
    if (!hasHousehold || !missingArea) return;
    const householdArea = areaByHousehold.get(data.householdId);
    if (!householdArea) { skippedNoHouseholdArea += 1; return; } // household has no area to copy
    toFix.push({ id: d.id, area: householdArea });
  });

  for (const group of chunk(toFix)) {
    const batch = writeBatch(db);
    group.forEach(({ id, area }) => batch.update(doc(db, 'individuals', id), { area, updatedAt: serverTimestamp() }));
    await batch.commit();
  }

  return { updated: toFix.length, skippedNoHouseholdArea };
}

/** Deletes individual docs only. Deliberately does NOT touch any household
 * they might belong to — bulk-deleting from the Contacts page shouldn't
 * unexpectedly cascade into a shared household that happens to contain one
 * of the selected people. Use bulkDeleteHouseholdsCascade for the
 * Households page's bulk delete instead. */
export async function bulkDeleteIndividuals(individualIds) {
  for (const group of chunk(individualIds)) {
    const batch = writeBatch(db);
    group.forEach((id) => batch.delete(doc(db, 'individuals', id)));
    await batch.commit();
  }
  return individualIds.length;
}

/** Deletes households AND every individual still in each of them —
 * mirrors deleteHouseholdCascade (householdService.js) but batched across
 * many households at once instead of one at a time. */
export async function bulkDeleteHouseholdsCascade(householdIds) {
  let totalIndividualsRemoved = 0;

  // Fetch all individuals once, group by householdId client-side, to avoid
  // one query per household when the list is long.
  const allIndividualsSnap = await getDocs(collection(db, 'individuals'));
  const idsToDeleteSet = new Set(householdIds);
  const individualsByHousehold = new Map();
  allIndividualsSnap.forEach((d) => {
    const hId = d.data().householdId;
    if (idsToDeleteSet.has(hId)) {
      if (!individualsByHousehold.has(hId)) individualsByHousehold.set(hId, []);
      individualsByHousehold.get(hId).push(d.id);
    }
  });

  const allDeleteRefs = [];
  householdIds.forEach((hId) => {
    (individualsByHousehold.get(hId) || []).forEach((indId) => allDeleteRefs.push({ type: 'individual', id: indId }));
    allDeleteRefs.push({ type: 'household', id: hId });
  });

  for (const group of chunk(allDeleteRefs)) {
    const batch = writeBatch(db);
    group.forEach((ref) => batch.delete(doc(db, ref.type === 'individual' ? 'individuals' : 'households', ref.id)));
    await batch.commit();
  }

  totalIndividualsRemoved = [...individualsByHousehold.values()].reduce((sum, arr) => sum + arr.length, 0);
  return { householdsRemoved: householdIds.length, individualsRemoved: totalIndividualsRemoved };
}
