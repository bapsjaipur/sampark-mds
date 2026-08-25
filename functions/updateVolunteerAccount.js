const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { permissionsForVolunteer, normalizeRoleRefs } = require('./lib/callerAccess');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const EMAIL_DOMAIN = 'baps-jaipur-mds.local';
function phoneToSyntheticEmail(phone) {
  return `${String(phone).replace(/\D/g, '')}@${EMAIL_DOMAIN}`;
}

exports.updateVolunteerAccount = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

  // Caller must have manage_users. Permissions are the union across every role
  // the caller holds — see lib/callerAccess.js.
  const callerDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!callerDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');

  const callerPerms = await permissionsForVolunteer(db, callerDoc.data());

  const {
    volunteerId, name, mobile, roleRef, roleRefs, scopeKind, assignedAreas, assignedMandals, profilePhotoURL, reportEmail, isActive,
  } = request.data || {};

  if (!volunteerId) throw new HttpsError('invalid-argument', 'volunteerId is required.');

  // PHASE 21 — the resolved scope SHAPE, denormalised onto the volunteer so
  // firestore.rules can honour multiple roles (it can read only one role doc,
  // and cannot loop an array of get()s). Whitelisted here so a malformed value
  // cannot land in a field the rules branch on; see src/lib/scope.js.
  const SCOPE_KINDS = ['global', 'area', 'mandal', 'intersect', 'union', 'none'];
  if (scopeKind !== undefined && scopeKind !== null && !SCOPE_KINDS.includes(scopeKind)) {
    throw new HttpsError('invalid-argument', `scopeKind must be one of: ${SCOPE_KINDS.join(', ')}.`);
  }

  const isSelf = request.auth.uid === volunteerId;
  const hasManageUsers = callerPerms.includes('manage_users');

  if (!hasManageUsers && !isSelf) {
    throw new HttpsError('permission-denied', 'Missing permission to update volunteer account.');
  }

  // Clean the mobile number
  const cleanMobile = mobile ? String(mobile).replace(/\D/g, '') : null;

  if (cleanMobile && cleanMobile.length !== 10) {
    throw new HttpsError('invalid-argument', 'phone must be a 10-digit number.');
  }

  // PHASE 20 — reportEmail is where the automated reports are sent. It is NOT
  // the login: the Auth account uses the synthetic
  // <10-digit-mobile>@baps-jaipur-mds.local address built below, which no mail
  // server will accept. Changing reportEmail therefore cannot lock anyone out,
  // and a volunteer may set their own without manage_users.
  //
  // Validated here rather than inside the update try/catch below, which turns
  // every error it sees into an opaque "internal" and would hide the reason.
  let cleanReportEmail;
  if (reportEmail !== undefined) {
    cleanReportEmail = String(reportEmail || '').trim();
    if (cleanReportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanReportEmail)) {
      throw new HttpsError('invalid-argument', 'reportEmail does not look like a valid email address.');
    }
    if (cleanReportEmail.toLowerCase().endsWith(`@${EMAIL_DOMAIN}`)) {
      throw new HttpsError('invalid-argument', `${EMAIL_DOMAIN} is the internal login domain, not a mailbox. Use a real email address.`);
    }
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
    if (profilePhotoURL !== undefined) updateData.profilePhotoURL = profilePhotoURL;

    if (cleanReportEmail !== undefined) updateData.reportEmail = cleanReportEmail;

    // Only allow updating roles, areas and the active flag if the caller has
    // manage_users.
    //
    // `isActive` was previously accepted by the editor and silently dropped
    // here: src/admin/VolunteerEditor.jsx has always sent it, this function
    // never destructured it, and `update()` ignores keys it is not given. So the
    // Active/Disabled switch reported success and changed nothing. That matters
    // in two places — usePermissions signs out a volunteer whose isActive is
    // false, and lib/mailer.js skips them when building the report recipient
    // list — so "I disabled that karyakar" was simply not true.
    //
    // Deliberately inside the manage_users branch: the self-update path exists
    // so a volunteer can maintain their own name, photo and report email, not so
    // they can reinstate an account an admin has just switched off.
    if (hasManageUsers) {
      // PHASE 21 — roleRefs[] is the real field; roleRef is kept in sync because
      // firestore.rules still reads it (it cannot loop an array of get()s).
      const roles = normalizeRoleRefs({ roleRefs, roleRef });
      if (roles) {
        updateData.roleRefs = roles.roleRefs;
        updateData.roleRef = roles.roleRef;
      }
      if (assignedAreas !== undefined) updateData.assignedAreas = Array.isArray(assignedAreas) ? assignedAreas : [];
      if (assignedMandals !== undefined) updateData.assignedMandals = Array.isArray(assignedMandals) ? assignedMandals : [];
      // Sits in the manage_users branch with roleRefs for the same reason: this
      // field decides how widely the rules read assignedAreas/assignedMandals,
      // so a volunteer must never be able to widen their own.
      //
      // PHASE 23 — null, not 'union'. ctx() in firestore.rules PREFERS this
      // stamped copy over the role document, so writing 'union' when no role
      // states a shape pinned the volunteer to the widest shape there is and the
      // rules' own inference (an area + a mandal → intersect) could never apply.
      // Null lets it fall through to the role and then to that inference.
      if (scopeKind !== undefined) updateData.scopeKind = scopeKind || null;
      if (isActive !== undefined) updateData.isActive = !!isActive;
    }

    await db.collection('volunteers').doc(volunteerId).update(updateData);
  } catch (err) {
    // Don't flatten a deliberate HttpsError (e.g. invalid-argument) into an
    // opaque "internal" — the client shows this message to the admin.
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', `Failed to update volunteer data: ${err.message}`);
  }

  return { success: true };
});