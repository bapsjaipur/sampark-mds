// src/services/contactService.js
// MERGE FIX: import path already matched src/lib/firebase.js.
// PHASE 7 UPDATE: STATUS_OPTIONS replaced — Phase 4 invented a placeholder
// snake_case status set before the legacy app's real vocabulary was known.
// Now sourced from src/lib/callingStatuses.js (STATUS_CHIPS), the actual
// values index__1_.html's karyekars already use day to day.
//
// LATER: the vocabulary became admin-editable (settings/callOutcomes). This
// constant is the *seed* list only and does NOT reflect admin edits, because a
// module-level constant is evaluated once at import. Anything that renders
// outcomes to a volunteer must use the useCallOutcomes() hook instead — the
// last consumer of STATUS_OPTIONS (sampark/ContactCard) was moved over. It
// stays exported for non-React callers that only need a static fallback.
import { doc, collection, serverTimestamp } from 'firebase/firestore';
// PHASE 24 — metered drop-ins (src/lib/fsMetered.js): same signatures, they count.
import { setDoc, updateDoc, writeBatch } from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { DEFAULT_STATUS_CHIPS } from '../lib/callingStatuses';
import { toMonthDay } from '../lib/dateHelpers';
import { logActivity } from '../lib/activityLog';

export const STATUS_OPTIONS = DEFAULT_STATUS_CHIPS.map((c) => ({ value: c.value, label: c.label }));

/**
 * Updates a single field on an individual and writes the corresponding
 * activity log entry atomically (single batch, so a failed write never
 * leaves the log out of sync with the data).
 *
 * PHASE 20: the activity row now also records the value that was written.
 * The nightly report needs to know which status was set, and until now the
 * only trace of it was the human-readable `details` string ("Status set to
 * Interested"), which the report had to parse. `value` makes that exact;
 * functions/lib/reportData.js still falls back to parsing `details` for rows
 * written before this field existed.
 */
export async function updateContactField({ individualId, field, value, volunteerId, action, details }) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'individuals', individualId), { [field]: value, updatedAt: serverTimestamp() });
  batch.set(doc(collection(db, 'activity')), {
    timestamp: serverTimestamp(), volunteerId, individualId, action,
    field: field || null,
    value: value === undefined ? null : value,
    details: details || '',
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

// ── Whole-record writes ─────────────────────────────────────────────────────
// useAllContacts already does optimistic create/update, but it subscribes to
// the entire individuals collection to do it. Screens that only need to write
// one record — the contact profile's Edit button, the walk-in add on the
// attendance screen — use these instead of mounting that listener.
//
// `dobMonthDay` / `anniversaryMonthDay` are derived, not user-entered: the
// birthday reminders query on them. Writing a contact without them makes the
// person invisible to reminders, which is why this lives in one place rather
// than being repeated at each call site.

function withDerivedFields(data) {
  const out = { ...data };
  if (data.dob !== undefined) out.dobMonthDay = toMonthDay(data.dob);
  if (data.anniversary !== undefined) out.anniversaryMonthDay = toMonthDay(data.anniversary);
  return out;
}

/**
 * Updates one individual from a full form payload.
 * @returns {Promise<boolean>} false if the write was rejected (rules, offline).
 */
export async function saveContact({ individualId, data, volunteerId }) {
  // IndividualForm returns the pre-generated doc id under `id` on create; on
  // edit it isn't present, but strip it defensively so it can never be written
  // into the document as a field that shadows the real id.
  const { id: _ignored, ...rest } = data;
  try {
    await updateDoc(doc(db, 'individuals', individualId), {
      ...withDerivedFields(rest),
      updatedAt: serverTimestamp(),
    });
    logActivity({
      volunteerId, individualId, action: 'update_individual',
      details: { fields: Object.keys(rest) },
    });
    return true;
  } catch (err) {
    console.error('saveContact failed', err);
    return false;
  }
}

/**
 * Creates a contact that belongs to no household.
 *
 * householdId is written as an explicit null rather than omitted — the
 * "ungrouped contacts" count queries `where('householdId','==',null)`, and a
 * missing field does not match that.
 *
 * @returns {Promise<string|null>} the new doc id, or null on failure.
 */
export async function createStandaloneContact({ data, volunteerId }) {
  const { id: presetId, ...rest } = data;
  const ref = presetId
    ? doc(db, 'individuals', presetId)
    : doc(collection(db, 'individuals'));
  try {
    await setDoc(ref, {
      ...withDerivedFields(rest),
      householdId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    logActivity({ volunteerId, individualId: ref.id, action: 'create_individual' });
    return ref.id;
  } catch (err) {
    console.error('createStandaloneContact failed', err);
    return null;
  }
}
