const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const EMAIL_DOMAIN = 'baps-jaipur-mds.local';
function phoneToSyntheticEmail(phone) {
  return `${String(phone).replace(/\D/g, '')}@${EMAIL_DOMAIN}`;
}

exports.updateVolunteerAccount = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

  // Caller must have manage_users.
  const callerDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!callerDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');

  const callerRoleRef = callerDoc.data().roleRef;
  const callerRoleDoc = callerRoleRef ? await db.collection('roles').doc(callerRoleRef).get() : null;
  const callerPerms = (callerRoleDoc?.exists && callerRoleDoc.data().permissions) || [];
  if (!callerPerms.includes('manage_users')) {
    throw new HttpsError('permission-denied', 'Missing manage_users permission.');
  }

  const { volunteerId, name, mobile, roleRef, assignedAreas, assignedMandals } = request.data || {};

  if (!volunteerId) throw new HttpsError('invalid-argument', 'volunteerId is required.');

  // Clean the mobile number
  const cleanMobile = mobile ? String(mobile).replace(/\D/g, '') : null;

  if (cleanMobile && cleanMobile.length !== 10) {
    throw new HttpsError('invalid-argument', 'phone must be a 10-digit number.');
  }

  // If mobile is updated, update the Firebase Auth email as well!
  if (cleanMobile) {
      try {
        const newEmail = phoneToSyntheticEmail(cleanMobile);
        await admin.auth().updateUser(volunteerId, { email: newEmail });
      } catch (err) {
        if (err.code === 'auth/email-already-exists') {
          throw new HttpsError('already-exists', 'Another volunteer is already using this phone number.');
        }
        throw new HttpsError('internal', `Failed to update login credentials: ${err.message}`);
      }
  }

  // Update Firestore record
  try {
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (name !== undefined) updateData.name = name;
    if (cleanMobile !== null) updateData.mobile = cleanMobile;
    if (roleRef !== undefined) updateData.roleRef = roleRef || null;
    if (assignedAreas !== undefined) updateData.assignedAreas = Array.isArray(assignedAreas) ? assignedAreas : [];
    if (assignedMandals !== undefined) updateData.assignedMandals = Array.isArray(assignedMandals) ? assignedMandals : [];

    await db.collection('volunteers').doc(volunteerId).update(updateData);
  } catch (err) {
    throw new HttpsError('internal', `Failed to update volunteer data: ${err.message}`);
  }

  return { success: true };
});