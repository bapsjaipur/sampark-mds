// src/services/bulkService.js
// Phase 16 — bulk delete, for undoing accidental imports quickly. Both
// functions chunk into batches of 400 (Firestore's per-batch write limit).

import { collection, doc, writeBatch, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

function chunk(arr, size = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
