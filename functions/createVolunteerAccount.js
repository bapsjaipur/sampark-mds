/**
 * functions/createVolunteerAccount.js
 * ─────────────────────────────────────────────────────────────────
 * Admin-only callable that creates BOTH the Firebase Auth account (email/
 * password, using the same phone->synthetic-email scheme as the client's
 * src/lib/authHelpers.js) AND the matching volunteers/{uid} doc in one call.
 *
 * This didn't exist anywhere in the original 5 phases — VolunteerEditor.jsx
 * only ever edited EXISTING volunteers/{id} docs (roleRef, assignedAreas,
 * assignedMandals). Nothing created the underlying login. Added once phone+
 * password auth was chosen, since the admin needs a way to provision new
 * karyekar logins.
 *
 * Uses the Admin SDK, so it bypasses firestore.rules for the volunteers
 * write — permission is instead checked explicitly below.
 * ─────────────────────────────────────────────────────────────────
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { permissionsForVolunteer, normalizeRoleRefs } = require('./lib/callerAccess');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const EMAIL_DOMAIN = 'baps-jaipur-mds.local';
function phoneToSyntheticEmail(phone) {
  return `${String(phone).replace(/\D/g, '')}@${EMAIL_DOMAIN}`;
}

exports.createVolunteerAccount = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

  // Caller must have manage_users.
  const callerDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!callerDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  // Resolved across ALL the caller's roles (PHASE 21 multi-role) — and tolerant
  // of a caller with no role at all, which used to throw a raw
  // `doc(undefined)` error that Functions reported as an opaque "internal".
  const callerPerms = await permissionsForVolunteer(db, callerDoc.data());
  if (!callerPerms.includes('manage_users')) {
    throw new HttpsError('permission-denied', 'Missing manage_users permission.');
  }

  const { name, phone, password, roleRef, roleRefs, scopeKind, assignedAreas, assignedMandals, reportEmail, linkedIndividualId } = request.data || {};

  if (!name || !phone || !password) {
    throw new HttpsError('invalid-argument', 'name, phone, and password are required.');
  }
  if (!/^\d{10}$/.test(String(phone).replace(/\D/g, ''))) {
    throw new HttpsError('invalid-argument', 'phone must be a 10-digit number.');
  }
  if (String(password).length < 6) {
    throw new HttpsError('invalid-argument', 'password must be at least 6 characters (Firebase Auth minimum).');
  }

  // PHASE 21 — the resolved scope SHAPE (see src/lib/scope.js), denormalised
  // onto the volunteer because firestore.rules can read only one role document
  // and a volunteer may hold several. Whitelisted so a malformed value cannot
  // reach a field the rules branch on; null/absent means "nobody has stated a
  // shape", which the rules resolve from the assignment (PHASE 23).
  const SCOPE_KINDS = ['global', 'area', 'mandal', 'intersect', 'union', 'none'];
  if (scopeKind !== undefined && scopeKind !== null && !SCOPE_KINDS.includes(scopeKind)) {
    throw new HttpsError('invalid-argument', `scopeKind must be one of: ${SCOPE_KINDS.join(', ')}.`);
  }

  // PHASE 20 — optional. Where automated reports get sent; distinct from the
  // synthetic login address built below, which is not a real mailbox.
  const cleanReportEmail = String(reportEmail || '').trim();
  if (cleanReportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanReportEmail)) {
    throw new HttpsError('invalid-argument', 'reportEmail does not look like a valid email address.');
  }

  const email = phoneToSyntheticEmail(phone);

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: name });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'A volunteer with this phone number already has a login.');
    }
    throw new HttpsError('internal', err.message);
  }

  try {
    const roles = normalizeRoleRefs({ roleRefs, roleRef }) || { roleRefs: [], roleRef: null };
    await db.collection('volunteers').doc(userRecord.uid).set({
      name,
      mobile: String(phone).replace(/\D/g, ''),
      reportEmail: cleanReportEmail,
      // Both fields: roleRefs[] is authoritative, roleRef is what firestore.rules
      // reads (it cannot iterate an array of get()s). See lib/callerAccess.js.
      roleRefs: roles.roleRefs,
      roleRef: roles.roleRef,
      // PHASE 23 — null, not 'union'. This field is a DENORMALISED copy of the
      // role's scope shape that firestore.rules reads because it cannot iterate
      // roleRefs[]. Writing 'union' when the role states no shape pinned every
      // new volunteer to the widest shape there is: `v.scopeKind` wins over the
      // role in ctx(), so the rules' own inference (area + mandal → intersect)
      // could never apply, and the server stayed wide open while the client
      // filtered narrowly. Left null, ctx() falls through to the role and then to
      // the inference — and Admin → Volunteers stamps a real value on first save.
      scopeKind: scopeKind || null,
      isActive: true,
      // PHASE 21 — the "From contact" mode in VolunteerEditor has always SENT
      // this and it was never stored, so linking a login to the karyakarta's own
      // contact record silently did nothing. It is what lets the app mark that
      // contact as a volunteer everywhere it appears, so it now persists on both
      // sides of the link.
      linkedIndividualId: linkedIndividualId || null,
      assignedAreas: Array.isArray(assignedAreas) ? assignedAreas : [],
      assignedMandals: Array.isArray(assignedMandals) ? assignedMandals : [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // The reverse pointer. Written best-effort and AFTER the volunteer doc: if the
    // individual has since been deleted, a failure here must not roll back a login
    // that was created correctly. Phone matching covers the un-stamped case.
    if (linkedIndividualId) {
      await db.collection('individuals').doc(linkedIndividualId).update({
        volunteerId: userRecord.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
  } catch (err) {
    // Don't leave an orphaned Auth account with no matching volunteers/{uid}
    // doc — that's a login that can sign in but has no permissions and
    // won't show up anywhere in the admin UI to fix or delete.
    await admin.auth().deleteUser(userRecord.uid).catch(() => {});
    throw new HttpsError('internal', `Login was created but the volunteer record failed to save: ${err.message}`);
  }

  return { uid: userRecord.uid };
});
