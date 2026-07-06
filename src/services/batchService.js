// src/services/batchService.js — unchanged logic from Phase 4.
// `batches` is a new collection introduced in Phase 4 — added to the Phase 1
// schema doc at merge time. Shape: batches/{id}: name, area, individualIds[],
// assignedVolunteerId, createdBy, createdAt.
import { addDoc, collection, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { chunk } from '../lib/firestoreHelpers';

/**
 * Individuals don't carry `area` directly (only households do), so this
 * resolves matching households first, then fetches their individuals.
 */
export async function getIndividualsByArea(area) {
  const hSnap = await getDocs(query(collection(db, 'households'), where('area', '==', area)));
  const householdIds = hSnap.docs.map((d) => d.id);
  if (!householdIds.length) return [];

  const all = [];
  for (const c of chunk(householdIds, 30)) {
    const iSnap = await getDocs(query(collection(db, 'individuals'), where('householdId', 'in', c)));
    iSnap.forEach((d) => all.push({ id: d.id, ...d.data() }));
  }
  return all;
}

export async function createBatch({ name, area, individualIds, assignedVolunteerId, createdBy }) {
  return addDoc(collection(db, 'batches'), {
    name, area, individualIds, assignedVolunteerId, createdBy, createdAt: serverTimestamp(),
  });
}
