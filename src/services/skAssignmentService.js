// src/services/skAssignmentService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Round-robin SK assignment for Bal Mandal contacts.
//
// Finds the SK (Sampark Karyakarta) with the lowest contact count in a given
// area and returns their volunteer record for assignment. Used during batch
// generation and manual SK assignment.
// ─────────────────────────────────────────────────────────────────────────────

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Find the SK with the lowest contact count in the given area.
 * Returns null if no active SK volunteers are found.
 *
 * @param {string} areaName - Area name to search within
 * @returns {Promise<{id: string, name: string, mobile: string, contactCount: number} | null>}
 */
export async function findLeastLoadedSK(areaName) {
  if (!areaName) return null;

  try {
    // Find all active SK volunteers in this area
    const volunteersRef = collection(db, 'volunteers');
    const q = query(
      volunteersRef,
      where('program', '==', 'Bal Mandal'),
      where('roleKey', '==', 'sk'),
      where('isActive', '==', true),
      where('assignedAreas', 'array-contains', areaName)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      console.warn(`No active SK volunteers found for area: ${areaName}`);
      return null;
    }

    const sks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Count contacts assigned to each SK
    const individualsRef = collection(db, 'individuals');
    const contactCounts = await Promise.all(
      sks.map(async sk => {
        const contactQuery = query(
          individualsRef,
          where('samparkKaryakartaName', '==', sk.name),
          where('area', '==', areaName)
        );
        const contactSnap = await getDocs(contactQuery);
        return {
          id: sk.id,
          name: sk.name,
          mobile: sk.mobile || '',
          contactCount: contactSnap.size,
        };
      })
    );

    // Return SK with lowest contact count
    contactCounts.sort((a, b) => a.contactCount - b.contactCount);
    return contactCounts[0];
  } catch (err) {
    console.error('Failed to find least loaded SK:', err);
    return null;
  }
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
    const { doc, getDoc, updateDoc } = await import('firebase/firestore');

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
