/**
 * functions/resetVolunteerPassword.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 22 — the self-service reset is now an ADMIN-APPROVED REQUEST.
 *
 * WHAT WAS WRONG. `resetVolunteerPassword({ phone })` was callable by anyone,
 * needed no authentication, and set the account's password to the 10-digit
 * mobile number the caller had just typed. So the entire secret protecting a
 * karyakarta's account was their own phone number — which is printed on every
 * contact list in the app. Type it on the login screen, press "Forgot?", then
 * sign in as them. Account takeover with no credential at all.
 *
 * WHAT IT DOES NOW. Two callables, and only ONE of them can change a password:
 *
 *   requestPasswordReset({ phone })   — unauthenticated, as it must be: the
 *       person is locked out. It changes NOTHING about the account. It writes a
 *       row to passwordResets/{phone} saying "somebody asked for a reset" and
 *       returns the same vague answer whether or not the number is registered.
 *
 *   resetVolunteerPassword({ volunteerId, newPassword }) — requires
 *       manage_users, exactly as before. This is the only path that touches
 *       Auth, and a human with manage_users has to type the new password.
 *
 * WHY A DOCUMENT RATHER THAN AN EMAIL/OTP. Volunteers have no real email
 * address (auth uses a synthetic <phone>@baps-jaipur-mds.local), and SMS OTP
 * costs money per message and needs a provider. The admin is already the person
 * who provisioned the login and can recognise the volunteer by name, so
 * approval by the admin is both the cheapest and the strongest check available
 * here. Admin → Volunteers shows the pending list.
 *
 * ANTI-ABUSE on the unauthenticated callable, since it is the one door left
 * open to the internet:
 *   • the document id IS the phone number, so N calls for the same number
 *     overwrite one row instead of creating N rows;
 *   • nothing is written at all unless that number belongs to an ACTIVE
 *     volunteer, so the collection can never grow past the staff list;
 *   • a pending request inside COOLDOWN_MS is left alone, so a loop cannot
 *     burn write quota;
 *   • the reply never distinguishes "found" from "not found", so the endpoint
 *     is not a phone-number oracle for the whole database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { permissionsForVolunteer } = require('./lib/callerAccess');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REQUESTS = 'passwordResets';

/** Repeat presses of "Forgot?" inside this window don't rewrite the row. */
const COOLDOWN_MS = 2 * 60 * 1000;

/** Deliberately identical for every outcome — see the anti-abuse note above. */
const VAGUE_REPLY = {
  submitted: true,
  message: 'If that number belongs to a volunteer, an admin has been asked to reset it. '
    + 'Contact your sanchalak or karyalay if you do not hear back.',
};

async function callerWithManageUsers(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const callerDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!callerDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');

  const callerPerms = await permissionsForVolunteer(db, callerDoc.data());
  if (!callerPerms.includes('manage_users')) {
    throw new HttpsError('permission-denied', 'Missing manage_users permission.');
  }
  return { id: callerDoc.id, ...callerDoc.data() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin path — the ONLY path that can change a password.
// ─────────────────────────────────────────────────────────────────────────────

exports.resetVolunteerPassword = onCall({ region: 'us-central1' }, async (request) => {
  const caller = await callerWithManageUsers(request);
  const { volunteerId, newPassword } = request.data || {};

  if (!volunteerId) {
    // The old `{ phone }` shape used to land here and reset an account. Anything
    // still sending it (a stale cached bundle, a bookmarked call) must fail
    // loudly rather than fall through to something that looks like it worked.
    throw new HttpsError(
      'invalid-argument',
      'volunteerId is required. Self-service password reset has been replaced by an '
      + 'admin-approved request — see Admin → Volunteers.',
    );
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new HttpsError('invalid-argument', 'newPassword must be at least 6 characters.');
  }

  try {
    // volunteers/{id} doc ID === Auth uid — see src/hooks/usePermissions.jsx.
    await admin.auth().updateUser(volunteerId, { password: String(newPassword) });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'No login account exists for this volunteer yet.');
    }
    throw new HttpsError('internal', `Failed to reset password: ${err.message}`);
  }

  // Close any outstanding request for this person. Best-effort and AFTER the
  // password change: failing to tidy the request list must not report a
  // successful reset as a failure, or the admin will reset it a second time.
  let closed = 0;
  try {
    const pending = await db.collection(REQUESTS)
      .where('volunteerId', '==', volunteerId)
      .where('status', '==', 'pending')
      .get();
    if (!pending.empty) {
      const batch = db.batch();
      pending.forEach((d) => batch.update(d.ref, {
        status: 'approved',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: caller.id,
        resolvedByName: caller.name || null,
      }));
      await batch.commit();
      closed = pending.size;
    }
  } catch (err) {
    console.warn('[resetVolunteerPassword] password was changed but the request row could not be closed:', err.message);
  }

  return { success: true, requestsClosed: closed };
});

// ─────────────────────────────────────────────────────────────────────────────
// Locked-out volunteer path — records a request, changes nothing.
// ─────────────────────────────────────────────────────────────────────────────

exports.requestPasswordReset = onCall({ region: 'us-central1' }, async (request) => {
  const { phone } = request.data || {};
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    throw new HttpsError('invalid-argument', 'Enter a valid 10-digit mobile number.');
  }

  const volSnap = await db.collection('volunteers')
    .where('mobile', '==', cleanPhone).limit(1).get();

  // Unknown number, or a disabled account: reply as if it had been recorded.
  // A disabled volunteer must not be able to summon a reset — usePermissions
  // signs those accounts straight back out, so approving one would only produce
  // a working password for a login that bounces.
  if (volSnap.empty || volSnap.docs[0].data().isActive === false) return VAGUE_REPLY;

  const vol = volSnap.docs[0];
  const ref = db.collection(REQUESTS).doc(cleanPhone);

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      const prev = existing.exists ? existing.data() : null;

      if (prev && prev.status === 'pending' && prev.requestedAt?.toMillis) {
        if (Date.now() - prev.requestedAt.toMillis() < COOLDOWN_MS) return; // still fresh
      }

      tx.set(ref, {
        mobile: cleanPhone,
        volunteerId: vol.id,
        volunteerName: vol.data().name || null,
        status: 'pending',
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        requestCount: (prev?.requestCount || 0) + 1,
        // Cleared so a re-request doesn't display last month's outcome.
        resolvedAt: null,
        resolvedBy: null,
        resolvedByName: null,
      }, { merge: true });
    });
  } catch (err) {
    // The volunteer cannot act on a Firestore error, and telling them "failed"
    // when the row may in fact exist causes a second, third, fourth press.
    console.error('[requestPasswordReset] could not record the request:', err.message);
  }

  return VAGUE_REPLY;
});
