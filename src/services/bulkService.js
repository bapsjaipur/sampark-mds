// src/services/bulkService.js
// Phase 16 — bulk delete, for undoing accidental imports quickly. Both
// functions chunk into batches of 400 (Firestore's per-batch write limit).

import { collection, doc, documentId, query, where, serverTimestamp } from 'firebase/firestore';
// PHASE 24 — metered drop-ins; identical signatures, they just count what they
// spend. See src/lib/fsMetered.js.
import { writeBatch, getDocs } from '../lib/fsMetered';
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
 * members already carrying an area, are left untouched.
 *
 * PHASE 31 — TAKES THE CONTACTS TO FIX. It used to getDocs() the whole
 * `individuals` AND `households` collections and write to every match it found
 * anywhere. On the Data Integrity screen that meant a mandal-scoped Super
 * Moderator saw "Fix missing areas (3)" — counted from their own scoped list —
 * and the button silently repaired all 3,100 contacts in the city, editing
 * mandals they cannot even read. The caller now passes the exact rows the count
 * came from, so the write set and the number on the button are the same set by
 * construction, and only the households those rows belong to are fetched
 * (30 at a time, Firestore's `in` cap) rather than all ~420.
 *
 * Returns { updated, skippedNoHouseholdArea } for a user-facing summary. */
export async function backfillMemberAreas(candidates = []) {
  const targets = (candidates || []).filter((c) => c?.id && c?.householdId);
  if (!targets.length) return { updated: 0, skippedNoHouseholdArea: 0 };

  const householdIds = [...new Set(targets.map((c) => c.householdId))];
  const areaByHousehold = new Map();
  for (const group of chunk(householdIds, 30)) {
    const snap = await getDocs(query(collection(db, 'households'), where(documentId(), 'in', group)));
    snap.forEach((d) => areaByHousehold.set(d.id, (d.data().area || '').trim()));
  }

  const toFix = [];
  let skippedNoHouseholdArea = 0;
  for (const c of targets) {
    // Re-check the blank here rather than trusting the caller: the list may have
    // been on screen a while, and overwriting an area someone has since set is
    // exactly what this promises never to do.
    if (c.area && String(c.area).trim()) continue;
    const householdArea = areaByHousehold.get(c.householdId);
    if (!householdArea) { skippedNoHouseholdArea += 1; continue; } // household has no area to copy
    toFix.push({ id: c.id, area: householdArea });
  }

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
