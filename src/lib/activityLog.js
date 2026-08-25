// src/lib/activityLog.js
// CANONICAL activity logger — the only writer to the `activity` collection,
// which firestore.rules keeps append-only (create allowed, update/delete
// denied) so the audit trail cannot be edited after the fact.
//
// Read back by src/components/admin-tools/AuditTrailTab.jsx. That screen
// renders a friendly label per `action` from its own ACTIONS list, so a new
// action string added here should be added there too — otherwise the audit
// trail shows the raw key.

import { collection, serverTimestamp } from 'firebase/firestore';
// PHASE 24 — metered drop-in (src/lib/fsMetered.js): same signature, it counts.
// Every call, WhatsApp tap and edit writes one of these, so on a busy calling
// evening the audit trail is a real slice of the daily write quota.
import { addDoc } from './fsMetered';
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
