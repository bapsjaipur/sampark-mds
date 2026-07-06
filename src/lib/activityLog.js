// src/lib/activityLog.js
// CANONICAL activity logger. Merges Phase 3's version (which fired a
// fire-and-forget mirror to the GAS webhook on every CRUD op) with Phase 4's
// simpler version (activity write only).
//
// DROPPED at merge: Phase 3's mirrorToBackup() call. It POSTed action names
// like "create_individual"/"update_household" to the GAS webhook, but those
// are not real doPost actions in CodeGSV5.gs — the real action is
// `importContacts`, called in scheduled batches by Phase 5's
// syncFirestoreToGAS Cloud Function. Because Phase 3's call used
// mode: "no-cors", GAS's `{error: 'Unknown action'}` response was silently
// unreadable — it looked like it worked in the browser but did nothing.
// Removing it here avoids that false signal; the real backup path is
// Phase 5's scheduled sync.

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * @param {Object} params
 * @param {string} params.volunteerId
 * @param {string} [params.individualId]
 * @param {string} params.action - short machine-readable tag, e.g.
 *   'create_household' | 'update_household' | 'delete_household' |
 *   'create_individual' | 'update_individual' | 'delete_individual' |
 *   'upload_photo' | 'status_changed' | 'reference_updated' |
 *   'call_logged' | 'call_initiated'
 * @param {Object|string} [params.details]
 */
export async function logActivity({ volunteerId, individualId = null, action, details = {} }) {
  try {
    await addDoc(collection(db, 'activity'), {
      timestamp: serverTimestamp(),
      volunteerId: volunteerId || null,
      individualId,
      action,
      details: details || '',
    });
  } catch (err) {
    // Audit logging should never block or crash the main flow.
    console.error('Failed to write activity log:', err);
  }
}
