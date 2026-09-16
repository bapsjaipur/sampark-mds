/**
 * functions/updateVolunteerAccount.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 39 — THE MOBILE NUMBER IS THE LOGIN, SO IT IS NOT SELF-SERVICE.
 *
 * A volunteer's mobile IS their credential: the Auth account's email is the
 * synthetic <10-digit-mobile>@baps-jaipur-mds.local built below, so writing a new
 * mobile rewrites the username they sign in with. The self-update path let them
 * do exactly that, and the two ways it goes wrong are both unrecoverable from the
 * volunteer's side:
 *
 *   • a typo — one wrong digit and the account they are holding still works until
 *     the session expires, then the number they know no longer opens it and the
 *     number that does open it belongs to nobody;
 *   • a collision — Auth refuses a number already in use, so the failure is at
 *     least loud, but only after the Firestore half may already have moved.
 *
 * So `mobile` is now honoured ONLY for a caller holding manage_users. A volunteer
 * asking for a new number writes a REQUEST — `mobileChangeRequest` on their own
 * volunteer document — which changes no credential at all. An admin approves it
 * from Admin → Volunteers, and only then does the Auth email move.
 *
 * WHY A FIELD ON THE VOLUNTEER RATHER THAN A COLLECTION. Every volunteer document
 * is already readable by every signed-in volunteer, and the admin screen is
 * already subscribed to the whole roster — so the pending request needs no new
 * listener, no new collection, and NO firestore.rules CHANGE. The rules currently
 * restrict a self-update to lastLoginAt / lastSeenAt / profilePhotoURL / usage,
 * which is why the request is written HERE with the Admin SDK rather than by the
 * client: the client genuinely cannot write this field, and that is the point.
 *
 * PASSWORDS are the same principle and were already built — see
 * resetVolunteerPassword.js. requestPasswordReset() records the ask and
 * resetVolunteerPassword() is the only path that can change a password. The
 * profile screen calls the first of those; nothing here touches passwords.
 *
 * AND THE NUMBER IS NOT ONLY THE LOGIN. It is also denormalised onto every contact
 * the karyakarta has been given, as `individuals.samparkKaryakartaNumber`, which is
 * the field src/pages/MyContactsPage queries on. Moving the login without moving
 * those copies empties their own contact list — so this function now re-points them
 * in the same call. See repointSamparkNumber below.
 * ─────────────────────────────────────────────────────────────────────────────
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

function tenDigits(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

// PHASE 39 — the mobile is DENORMALISED onto every contact assigned to that
// karyakarta, as `individuals.samparkKaryakartaNumber`, and src/pages/MyContactsPage
// queries on it: where('samparkKaryakartaNumber', '==', volunteer.mobile). So moving
// the number without re-pointing those documents empties the karyakarta's own "My
// Contacts" screen and orphans every contact they were given — a silent, total loss
// of their assignment list, discovered only by the person it happened to.
//
// 450 per commit (the 500-op cap with headroom). The ceiling is a guard against an
// unbounded write, not a real limit: an SK holds tens of contacts, so if this ever
// trips something else is wrong and the log is how anyone finds out.
const REPOINT_CHUNK = 450;
const REPOINT_CEILING = 3000;

async function repointSamparkNumber(fromMobile, toMobile, name) {
  if (!fromMobile || !toMobile || fromMobile === toMobile) return 0;
  const snap = await db.collection('individuals')
    .where('samparkKaryakartaNumber', '==', fromMobile)
    .limit(REPOINT_CEILING)
    .get();
  if (snap.empty) return 0;

  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += REPOINT_CHUNK) {
    const wb = db.batch();
    for (const d of docs.slice(i, i + REPOINT_CHUNK)) {
      const patch = { samparkKaryakartaNumber: toMobile };
      // The name travels with the number so the pair cannot end up describing two
      // different people — a contact card reading "Ramesh (9876543210)" where the
      // number now belongs to Suresh is worse than either field being stale.
      if (name) patch.samparkKaryakartaName = name;
      wb.update(d.ref, patch);
    }
    await wb.commit();
  }
  if (docs.length >= REPOINT_CEILING) {
    console.error(
      `[updateVolunteerAccount] repoint hit the ${REPOINT_CEILING} ceiling for ${fromMobile} → `
      + `${toMobile}; some contacts may still carry the old number.`,
    );
  }
  return docs.length;
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
    // PHASE 39 — the request half. `requestedMobile` is what a volunteer asks
    // for; `resolveMobileRequest` is how an admin answers ('approve' | 'decline').
    requestedMobile, resolveMobileRequest,
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

  // The target's current state. Needed for three separate decisions, so it is one
  // read rather than three: whether the mobile is actually MOVING (an unchanged
  // number must not cost an Auth write on every profile save), what a pending
  // request is asking for, and whether that request is stale. Reused from the
  // caller lookup when they are the same person, which is the common case — a
  // volunteer saving their own profile.
  const targetSnap = isSelf ? callerDoc : await db.collection('volunteers').doc(volunteerId).get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'That volunteer record no longer exists.');
  const target = targetSnap.data() || {};
  const currentMobile = tenDigits(target.mobile);

  // ── PHASE 39 — who may move the login number ───────────────────────────────
  // Only manage_users. A self-caller's `mobile` is IGNORED rather than rejected:
  // an older cached bundle still posts the field on every profile save, and
  // throwing would take the volunteer's name and photo down with it.
  let cleanMobile = null;
  if (mobile !== undefined && mobile !== null && String(mobile).trim() !== '') {
    const digits = tenDigits(mobile);
    if (hasManageUsers) {
      if (digits.length !== 10) {
        throw new HttpsError('invalid-argument', 'phone must be a 10-digit number.');
      }
      // Unchanged is not a change. Skipping it here is what keeps a routine
      // "Save" on the Volunteers screen from touching Auth at all.
      if (digits !== currentMobile) cleanMobile = digits;
    } else if (digits !== currentMobile) {
      console.log(
        `[updateVolunteerAccount] ignored a self-service mobile change for ${volunteerId} `
        + '(needs manage_users; use requestedMobile instead).',
      );
    }
  }

  // ── The request a volunteer CAN make ───────────────────────────────────────
  // Written with the Admin SDK because firestore.rules deliberately does not let
  // a volunteer write this field on their own document. null/'' withdraws it.
  let mobileRequestPatch;
  if (requestedMobile !== undefined) {
    const digits = tenDigits(requestedMobile);
    if (!digits) {
      mobileRequestPatch = null; // withdraw
    } else {
      if (digits.length !== 10) {
        throw new HttpsError('invalid-argument', 'Enter a 10-digit mobile number.');
      }
      if (digits === currentMobile) {
        throw new HttpsError('invalid-argument', 'That is already your login number — nothing to change.');
      }
      // Caught here rather than at approval time, so the volunteer finds out now
      // instead of an admin finding out in a week.
      const clash = await db.collection('volunteers').where('mobile', '==', digits).limit(1).get();
      if (!clash.empty && clash.docs[0].id !== volunteerId) {
        throw new HttpsError('already-exists', 'Another volunteer already signs in with that number.');
      }
      mobileRequestPatch = {
        mobile: digits,
        status: 'pending',
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        requestedBy: request.auth.uid,
        previousMobile: currentMobile || null,
      };
    }
  }

  // ── The answer an admin gives ──────────────────────────────────────────────
  if (resolveMobileRequest !== undefined && resolveMobileRequest !== null) {
    if (!hasManageUsers) {
      throw new HttpsError('permission-denied', 'Only an admin with Manage Users can answer a number-change request.');
    }
    if (!['approve', 'decline'].includes(resolveMobileRequest)) {
      throw new HttpsError('invalid-argument', "resolveMobileRequest must be 'approve' or 'decline'.");
    }
    const pending = target.mobileChangeRequest;
    if (!pending || pending.status !== 'pending' || !tenDigits(pending.mobile)) {
      throw new HttpsError('failed-precondition', 'There is no pending number-change request for this volunteer.');
    }
    if (resolveMobileRequest === 'approve') {
      // Approving IS the mobile change — it goes down the same Auth path below.
      cleanMobile = tenDigits(pending.mobile);
      if (cleanMobile === currentMobile) cleanMobile = null; // already applied
    }
    mobileRequestPatch = null;
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

    // A number that has actually moved settles any outstanding request for it,
    // whether the admin approved the request or simply typed the number in.
    if (mobileRequestPatch !== undefined) {
      updateData.mobileChangeRequest = mobileRequestPatch;
    } else if (cleanMobile) {
      updateData.mobileChangeRequest = null;
    }

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

  // ── Carry the contacts across with the number ───────────────────────────────
  // Last, and deliberately NOT fatal. By this point the login has already moved,
  // so throwing would report failure for a change that has in fact happened and
  // send the admin round the loop again. A count (or a null) goes back instead, so
  // the panel can say "contacts moved too" or "the number moved, the contacts did
  // not — try Save again", which is the recovery: re-running with the same number
  // is a no-op on Auth and a fresh attempt at this.
  let contactsRepointed = 0;
  if (cleanMobile && currentMobile) {
    try {
      contactsRepointed = await repointSamparkNumber(
        currentMobile,
        cleanMobile,
        name !== undefined ? String(name || '').trim() : String(target.name || '').trim(),
      );
    } catch (err) {
      contactsRepointed = null;
      console.error(
        `[updateVolunteerAccount] mobile moved ${currentMobile} → ${cleanMobile} for ${volunteerId} `
        + `but re-pointing their contacts failed: ${err.message}`,
      );
    }
  }

  // Tells the caller what actually happened, so the profile screen can say "an
  // admin has been asked" rather than the flat "Saved" it used to show whether or
  // not the number it posted had been honoured.
  return {
    success: true,
    mobileChanged: Boolean(cleanMobile),
    mobileRequested: Boolean(mobileRequestPatch),
    mobileRequestResolved: resolveMobileRequest || null,
    contactsRepointed,
  };
});