/**
 * functions/deleteVolunteerAccount.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 22 — removing a volunteer now removes their LOGIN too.
 *
 * WHAT WAS WRONG. src/admin/VolunteerEditor.jsx called a callable named
 * `deleteVolunteerAccount` that had never been written, caught the resulting
 * "not-found" and quietly fell back to `deleteDoc(volunteers/{id})`. So "Remove
 * volunteer" deleted the record and left the Firebase Auth user intact — a
 * working password on a phone number that no longer appears anywhere in the
 * admin UI. That login can still sign in; it lands with no volunteers/{uid}
 * document, which firestore.rules treats as "no permissions" rather than "not a
 * user", and there is no screen left that can find or delete it.
 *
 * ORDER OF OPERATIONS, and why. The Auth user is deleted FIRST:
 *   • if that fails, nothing else has happened and the volunteer is intact;
 *   • if it succeeds and the Firestore cleanup then fails, the result is a
 *     volunteer record with no login — visible in the list, retryable, and
 *     harmless. The reverse order is what produced the orphan being fixed here.
 *
 * TWO REFUSALS, both about locking people out of their own database:
 *   • you cannot delete yourself — one misclick would end the session that is
 *     the only way to undo it;
 *   • you cannot delete the last active holder of manage_users. Nothing else in
 *     the app can create a volunteer or grant a role, so that delete is
 *     unrecoverable without the Firebase console.
 *
 * FAN-OUT. A volunteer id is referenced in exactly two other places, and both
 * are cleaned rather than left dangling:
 *   individuals.volunteerId       → cleared (the reverse side of the "this
 *                                   contact is a karyakarta" link)
 *   batches.assignedVolunteerId   → cleared, returning those batches to the
 *                                   unassigned pool so the work is re-assignable
 *                                   instead of invisibly owned by a ghost.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { permissionsForVolunteer } = require('./lib/callerAccess');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** roleId -> permissions[], read once so the "last admin" check is one query. */
async function loadRolePermissions() {
  const snap = await db.collection('roles').get();
  const map = {};
  snap.forEach((d) => { map[d.id] = Array.isArray(d.data().permissions) ? d.data().permissions : []; });
  return map;
}

function roleIdsOf(v) {
  const many = Array.isArray(v?.roleRefs) ? v.roleRefs.filter(Boolean) : [];
  if (many.length) return [...new Set(many)];
  return v?.roleRef ? [v.roleRef] : [];
}

/**
 * Would deleting `targetId` leave nobody able to administer the app?
 * Counts ACTIVE volunteers other than the target whose union of roles grants
 * manage_users.
 */
async function otherActiveAdminCount(targetId) {
  const [vSnap, rolePerms] = await Promise.all([
    db.collection('volunteers').get(),
    loadRolePermissions(),
  ]);
  let count = 0;
  vSnap.forEach((d) => {
    if (d.id === targetId) return;
    const v = d.data();
    if (v.isActive === false) return;
    const grants = roleIdsOf(v).some((id) => (rolePerms[id] || []).includes('manage_users'));
    if (grants) count += 1;
  });
  return count;
}

exports.deleteVolunteerAccount = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

  const callerDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!callerDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const callerPerms = await permissionsForVolunteer(db, callerDoc.data());
  if (!callerPerms.includes('manage_users')) {
    throw new HttpsError('permission-denied', 'Missing manage_users permission.');
  }

  const { volunteerId } = request.data || {};
  if (!volunteerId) throw new HttpsError('invalid-argument', 'volunteerId is required.');

  if (volunteerId === request.auth.uid) {
    throw new HttpsError(
      'failed-precondition',
      'You cannot remove your own volunteer record — it would sign you out of the only '
      + 'account that can undo it. Ask another admin to do it.',
    );
  }

  const targetDoc = await db.collection('volunteers').doc(volunteerId).get();
  const target = targetDoc.exists ? targetDoc.data() : null;

  if (target) {
    const rolePerms = await loadRolePermissions();
    const targetIsAdmin = roleIdsOf(target).some((id) => (rolePerms[id] || []).includes('manage_users'));
    if (targetIsAdmin && (await otherActiveAdminCount(volunteerId)) === 0) {
      throw new HttpsError(
        'failed-precondition',
        `“${target.name || volunteerId}” is the last active volunteer who can manage users. `
        + 'Removing them would leave nobody able to create logins or change roles, and no screen '
        + 'in the app could put it right. Give another volunteer a role with "Manage Users" first.',
      );
    }
  }

  // ── 1. The login. Deliberately first — see the header note. ────────────────
  let authDeleted = false;
  try {
    await admin.auth().deleteUser(volunteerId);
    authDeleted = true;
  } catch (err) {
    // Already gone is a success for our purposes: the point is that no working
    // login survives this call.
    if (err.code !== 'auth/user-not-found') {
      throw new HttpsError('internal', `Could not delete the login, so nothing was removed: ${err.message}`);
    }
  }

  // ── 2. Detach the references, then the record itself. ──────────────────────
  let contactsUnlinked = 0;
  let batchesUnassigned = 0;

  try {
    const [linked, batches] = await Promise.all([
      db.collection('individuals').where('volunteerId', '==', volunteerId).get(),
      db.collection('batches').where('assignedVolunteerId', '==', volunteerId).get(),
    ]);

    // One batch per 400 writes — the Firestore limit is 500 operations.
    const ops = [
      ...linked.docs.map((d) => ({
        ref: d.ref,
        data: { volunteerId: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      })),
      ...batches.docs.map((d) => ({
        ref: d.ref,
        data: { assignedVolunteerId: null, assignedAt: null },
      })),
    ];
    contactsUnlinked = linked.size;
    batchesUnassigned = batches.size;

    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach((o) => batch.update(o.ref, o.data));
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
    }

    if (targetDoc.exists) await targetDoc.ref.delete();
  } catch (err) {
    throw new HttpsError(
      'internal',
      `The login was removed, but tidying up failed: ${err.message}. The volunteer can no longer `
      + 'sign in. Press Remove again to finish clearing their record.',
    );
  }

  return { success: true, authDeleted, contactsUnlinked, batchesUnassigned };
});
