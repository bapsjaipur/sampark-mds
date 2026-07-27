const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const EMAIL_DOMAIN = 'baps-jaipur-mds.local';
function phoneToSyntheticEmail(phone) {
  return `${String(phone).replace(/\D/g, '')}@${EMAIL_DOMAIN}`;
}

exports.resetVolunteerPassword = onCall({ region: 'us-central1' }, async (request) => {
  const { phone } = request.data || {};
  if (!phone) throw new HttpsError('invalid-argument', 'phone is required.');

  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length !== 10) throw new HttpsError('invalid-argument', 'phone must be 10 digits.');

  // 1. Find volunteer by mobile
  const volSnap = await db.collection('volunteers').where('mobile', '==', cleanPhone).limit(1).get();
  if (volSnap.empty) throw new HttpsError('not-found', 'Volunteer not found.');

  const volunteerId = volSnap.docs[0].id;
  const email = phoneToSyntheticEmail(cleanPhone);

  // 2. Reset password to phone number
  try {
     await admin.auth().updateUser(volunteerId, { password: cleanPhone });
     return { success: true };
  } catch (err) {
     throw new HttpsError('internal', `Failed to reset password: ${err.message}`);
  }
});
