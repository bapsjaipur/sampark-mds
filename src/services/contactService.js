// src/services/contactService.js
// MERGE FIX: import path already matched src/lib/firebase.js.
// PHASE 7 UPDATE: STATUS_OPTIONS replaced — Phase 4 invented a placeholder
// snake_case status set before the legacy app's real vocabulary was known.
// Now sourced from src/lib/callingStatuses.js (STATUS_CHIPS), the actual
// values index__1_.html's karyekars already use day to day.
import { doc, collection, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { STATUS_CHIPS } from '../lib/callingStatuses';

export const STATUS_OPTIONS = STATUS_CHIPS.map((c) => ({ value: c.value, label: c.label }));

/**
 * Updates a single field on an individual and writes the corresponding
 * activity log entry atomically (single batch, so a failed write never
 * leaves the log out of sync with the data).
 */
export async function updateContactField({ individualId, field, value, volunteerId, action, details }) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'individuals', individualId), { [field]: value, updatedAt: serverTimestamp() });
  batch.set(doc(collection(db, 'activity')), {
    timestamp: serverTimestamp(), volunteerId, individualId, action, details: details || '',
  });
  await batch.commit();
}

export async function incrementCallCount({ individualId, currentCount, volunteerId }) {
  const next = (currentCount || 0) + 1;
  await updateContactField({
    individualId, field: 'callCount', value: next, volunteerId,
    action: 'call_logged', details: `Call count incremented to ${next}`,
  });
  return next;
}
