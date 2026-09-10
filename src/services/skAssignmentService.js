// src/services/skAssignmentService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Round-robin SK assignment for Bal Mandal contacts.
//
// PHASE 31 — THE ROLEKEY BUG.
//
// findLeastLoadedSK() used to run:
//
//     where('program','==','Bal Mandal')
//     where('roleKey','==','sk')          ← this field does not exist
//     where('isActive','==',true)
//     where('assignedAreas','array-contains', areaName)
//
// No save path in this app has ever written `roleKey` to a volunteer document —
// roles are held in `roleRefs` and identified by their permissions (see
// lib/roleView.js). So the query matched nothing, every call returned null, and
// batch generation silently assigned nobody. It failed quietly because the
// caller treats null as "no SK available yet", which is a legitimate outcome.
//
// It also cost one query per SK just to count their contacts. Both problems go
// away by making the ranking PURE: the caller already holds the roster (one
// shared listener) and the area's contacts (one query it had to run anyway), so
// rankSKsByLoad() does the same job for zero extra reads.
// ─────────────────────────────────────────────────────────────────────────────

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Which volunteers can carry a Bal Mandal batch in this area?
 *
 * Without `roleKey` there is no field that says "this person is an SK", so the
 * test is the one the data actually supports: an active volunteer in the Bal
 * Mandal programme who is assigned to this area. In practice that IS the SK
 * pool — heads are assigned by mandal, not by area — but because the inference
 * is not airtight the caller shows the chosen names in the preview before
 * anything is written, so a wrong pick is visible rather than silent.
 */
export function balMandalSKCandidates(volunteers, areaName) {
  if (!areaName) return [];
  return (volunteers || []).filter((v) => (
    v?.program === 'Bal Mandal'
    && v?.isActive !== false
    && Array.isArray(v?.assignedAreas)
    && v.assignedAreas.includes(areaName)
  ));
}

/**
 * Candidates ordered lightest-load-first, counted against the contacts already
 * in hand rather than by querying Firestore per candidate.
 *
 * The count is "contacts in THIS area and mandal already naming them as SK",
 * which is the right denominator for balancing this generation — a Vaishali
 * Nagar SK's Mansarovar load is somebody else's problem.
 */
export function rankSKsByLoad(candidates, contacts) {
  const load = new Map();
  for (const c of contacts || []) {
    const name = c?.samparkKaryakartaName;
    if (name) load.set(name, (load.get(name) || 0) + 1);
  }
  return (candidates || [])
    .map((v) => ({
      id: v.id,
      name: v.name || '',
      mobile: v.mobile || '',
      contactCount: load.get(v.name) || 0,
    }))
    .sort((a, b) => a.contactCount - b.contactCount || a.name.localeCompare(b.name));
}

/**
 * Manually assign or reassign an SK to a contact.
 *
 * @param {string} contactId - Individual document ID
 * @param {string} skVolunteerId - Volunteer ID of the SK to assign
 * @returns {Promise<boolean>}
 */
export async function assignSKToContact(contactId, skVolunteerId) {
  if (!contactId || !skVolunteerId) return false;

  try {
    const skRef = doc(db, 'volunteers', skVolunteerId);
    const skSnap = await getDoc(skRef);

    if (!skSnap.exists()) {
      console.error('SK volunteer not found:', skVolunteerId);
      return false;
    }

    const sk = skSnap.data();
    const contactRef = doc(db, 'individuals', contactId);

    await updateDoc(contactRef, {
      samparkKaryakartaName: sk.name || '',
      samparkKaryakartaNumber: sk.mobile || '',
    });

    return true;
  } catch (err) {
    console.error('Failed to assign SK to contact:', err);
    return false;
  }
}
