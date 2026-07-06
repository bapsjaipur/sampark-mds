// src/services/householdService.js
// Two operations added per request:
//   1. moveIndividualToHousehold — the "search & link" feature: re-parents
//      an existing individual into a different household (updates their
//      householdId + relation), and if their OLD household is now empty,
//      deletes that now-orphaned household automatically.
//   2. deleteHouseholdCascade — deleting a household also deletes every
//      individual still in it, so you never end up with orphaned
//      individual docs pointing at a household that no longer exists.
import { collection, doc, getDocs, query, where, writeBatch, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export async function moveIndividualToHousehold({ individualId, fromHouseholdId, toHouseholdId, makeMember = true }) {
  if (fromHouseholdId === toHouseholdId) return; // no-op, already there

  await updateDoc(doc(db, 'individuals', individualId), {
    householdId: toHouseholdId,
    ...(makeMember ? { relation: 'member', isPrimary: false } : {}),
    updatedAt: serverTimestamp(),
  });

  // Standalone contacts (no household to begin with) have nothing to clean up.
  if (!fromHouseholdId) return;

  // If the old household has no one left, it's just clutter — remove it.
  const remaining = await getDocs(query(collection(db, 'individuals'), where('householdId', '==', fromHouseholdId)));
  if (remaining.empty) {
    await deleteHouseholdCascade(fromHouseholdId); // no individuals left anyway, but reuse the same safe path
  }
}

export async function deleteHouseholdCascade(householdId) {
  const membersSnap = await getDocs(query(collection(db, 'individuals'), where('householdId', '==', householdId)));
  const batch = writeBatch(db);
  membersSnap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'households', householdId));
  await batch.commit();
  return membersSnap.size; // how many individuals were removed along with it
}
