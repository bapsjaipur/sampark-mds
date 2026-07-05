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
  const callerRoleDoc = await db.collection('roles').doc(callerDoc.data().roleRef).get();
  const callerPerms = (callerRoleDoc.exists && callerRoleDoc.data().permissions) || [];
  if (!callerPerms.includes('manage_users')) {
    throw new HttpsError('permission-denied', 'Missing manage_users permission.');
  }

  const { name, phone, password, roleRef, assignedAreas, assignedMandals } = request.data || {};

  if (!name || !phone || !password) {
    throw new HttpsError('invalid-argument', 'name, phone, and password are required.');
  }
  if (!/^\d{10}$/.test(String(phone).replace(/\D/g, ''))) {
    throw new HttpsError('invalid-argument', 'phone must be a 10-digit number.');
  }
  if (String(password).length < 6) {
    throw new HttpsError('invalid-argument', 'password must be at least 6 characters (Firebase Auth minimum).');
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

  await db.collection('volunteers').doc(userRecord.uid).set({
    name,
    mobile: String(phone).replace(/\D/g, ''),
    roleRef: roleRef || null,
    assignedAreas: Array.isArray(assignedAreas) ? assignedAreas : [],
    assignedMandals: Array.isArray(assignedMandals) ? assignedMandals : [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid };
});
