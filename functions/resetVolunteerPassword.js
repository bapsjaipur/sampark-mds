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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 41 — THE VOLUNTEER CHOOSES THE PASSWORD; THEIR HEAD ONLY APPROVES IT.
 *
 * Phase 22 got the authorisation right and the ergonomics backwards. The admin
 * typed the new password, which means it then has to travel to the volunteer by
 * voice or WhatsApp, the volunteer has to remember a string somebody else
 * invented, and the admin knows it. Two people know a password that protects one
 * person's account, and the one who has to type it every week is not the one who
 * chose it.
 *
 * So the direction is reversed:
 *
 *   submitPasswordChoice({ phone, newPassword })   unauthenticated. The locked-out
 *       volunteer types the password THEY want. Nothing about the account changes.
 *       The choice is encrypted and parked on passwordResets/{phone} with
 *       status 'pending'.
 *
 *   listPasswordRequests()                          authenticated. Returns only
 *       the requests this caller is allowed to act on — never the password.
 *
 *   approvePasswordRequest({ requestId })           authenticated. Decrypts the
 *       choice, sets it on the Auth account, wipes the ciphertext. This is the
 *       only new path to Auth, and it can only ever apply a password the
 *       VOLUNTEER chose — the approver cannot substitute one.
 *
 *   denyPasswordRequest({ requestId, reason })      authenticated. Wipes it.
 *
 * WHO MAY APPROVE — "admin or someone who is upper to there role wise".
 * Either manage_users (unchanged: the admin), or a STRICTLY higher `rank` on the
 * role ladder plus shared territory. The second half matters: "upper level Head"
 * means the requester's own head, not any senior person in the city, so a
 * Vaishali Nagar sanchalak does not get to approve a Mansarovar karyakarta. Both
 * halves are computed in this file from documents the caller cannot write.
 * Nobody may approve their own request, whatever they hold.
 *
 * HOW THE CHOSEN PASSWORD IS STORED, AND THE LIMIT OF IT.
 * admin.auth().updateUser() takes a plaintext password — there is no API to
 * stage a hash — so between "submitted" and "approved" the choice has to be
 * recoverable, which rules out hashing it. It is therefore encrypted with
 * AES-256-GCM under a 32-byte key generated on first use and kept in
 * appSecrets/passwordVault. firestore.rules denies every client read and write to
 * BOTH collections, so neither is reachable from the app at all; splitting them
 * means a dump of the request list on its own decrypts to nothing.
 *
 * Be clear about what this does NOT protect against: anyone with project-level
 * IAM can read both collections and combine them. That is not a new capability —
 * the same access can call admin.auth().updateUser() directly — so the honest
 * claim is "not readable by any app user, and not readable from the request row
 * alone", not "zero-knowledge". The window is also kept short: a choice expires
 * after CHOICE_TTL_MS and the ciphertext is deleted the instant it is used,
 * denied, or found expired.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { permissionsForVolunteer, rankForVolunteer } = require('./lib/callerAccess');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REQUESTS = 'passwordResets';

/** Repeat presses of "Forgot?" inside this window don't rewrite the row. */
const COOLDOWN_MS = 2 * 60 * 1000;

/** A chosen password nobody approved within a day is not approved later. */
const CHOICE_TTL_MS = 24 * 60 * 60 * 1000;

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
        // PHASE 41 — if the row was a `choice`, the admin has just overridden it
        // with a password of their own, so the encrypted one is dead weight.
        // Delete it here too: the ciphertext must not outlive the request in ANY
        // path that closes it. A no-op on Phase 22 rows, which have no `secret`.
        secret: admin.firestore.FieldValue.delete(),
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

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 41 — the volunteer chooses, the head approves. See the file header.
// ═════════════════════════════════════════════════════════════════════════════

const FieldValue = admin.firestore.FieldValue;
const VAULT = 'appSecrets';
const VAULT_DOC = 'passwordVault';

/**
 * The first three submissions for a number are free, so someone who mistypes
 * their new password can correct it immediately. After that, one every two
 * minutes — which caps a script hammering one number at ~720 writes a day
 * instead of as many as it can send. The cap matters because this endpoint is
 * unauthenticated by necessity and writes are a metered resource here.
 */
const FREE_SUBMITS = 3;

/** Longest a password may be. Firebase has no limit; a bounded field does. */
const MAX_PASSWORD = 64;

// ── The vault ────────────────────────────────────────────────────────────────
// One AES-256 key, generated the first time anybody submits a choice and stored
// in appSecrets/passwordVault. Generating it here rather than configuring a
// Secret Manager entry is a deliberate trade: it means this ships with a plain
// `firebase deploy --only functions` and no console step that, if skipped,
// silently leaves the feature broken on the day someone is locked out.
//
// Memoised per instance — a warm instance decrypts without re-reading the vault,
// so approving ten requests costs one read of it, not ten.

let cachedKey = null;

async function vaultKey() {
  if (cachedKey) return cachedKey;
  const ref = db.collection(VAULT).doc(VAULT_DOC);
  const snap = await ref.get();
  const stored = snap.exists ? snap.data().key : null;
  if (typeof stored === 'string' && stored.length === 64) {
    cachedKey = Buffer.from(stored, 'hex');
    return cachedKey;
  }

  // create() and not set(): if two cold instances race on the very first
  // submission, the loser must adopt the winner's key. Overwriting would strand
  // a ciphertext that nothing can ever decrypt again.
  const fresh = crypto.randomBytes(32);
  try {
    await ref.create({ key: fresh.toString('hex'), createdAt: FieldValue.serverTimestamp() });
    cachedKey = fresh;
  } catch (err) {
    const again = await ref.get();
    const raced = again.exists ? again.data().key : null;
    if (typeof raced !== 'string' || raced.length !== 64) throw err;
    cachedKey = Buffer.from(raced, 'hex');
  }
  return cachedKey;
}

/** → "v1:<iv>:<tag>:<ciphertext>", all base64. The version prefix is there so a
 *  future key rotation can recognise what it is looking at. */
async function sealPassword(plain) {
  const key = await vaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join(':');
}

/** → the plaintext, or null if it is missing, malformed, or has been tampered
 *  with (GCM authenticates, so a doctored ciphertext throws rather than
 *  decrypting to something an attacker chose). */
async function openPassword(sealed) {
  const parts = String(sealed || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const key = await vaultKey();
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    d.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(parts[3], 'base64')), d.final()]).toString('utf8');
  } catch (err) {
    console.error('[password] a stored choice could not be decrypted:', err.message);
    return null;
  }
}

// ── Who is calling, and may they approve this one? ───────────────────────────

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);

/** Mirrors expandMandalGroups() in lib/volunteerScope.js — Bal ⇄ Sishu are one
 *  territory, so a Bal Mandal head is over a Sishu Mandal karyakarta. */
const MANDAL_GROUPS = [['Bal Mandal', 'Sishu Mandal']];
function expandMandals(mandals) {
  const out = new Set(arr(mandals));
  for (const group of MANDAL_GROUPS) {
    if (group.some((m) => out.has(m))) group.forEach((m) => out.add(m));
  }
  return [...out];
}

async function callerContext(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const snap = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const data = snap.data();
  if (data.isActive === false) throw new HttpsError('permission-denied', 'This account is disabled.');
  const [perms, rank] = await Promise.all([
    permissionsForVolunteer(db, data),
    rankForVolunteer(db, data),
  ]);
  return { id: snap.id, ...data, _perms: perms, _rank: rank };
}

/**
 * "Their head", not "a head". manage_users is unrestricted, as it always has
 * been. Otherwise the caller must outrank the requester AND share territory with
 * them, because a Vaishali Nagar sanchalak outranks a Mansarovar karyakarta on
 * paper and has no business holding their account.
 *
 * An empty assignment is NOT read as "everywhere" — resolveScope() treats an
 * unassigned volunteer as seeing nothing, and the same reading here means a
 * volunteer with no territory can only be approved by an admin. That is the
 * conservative direction: too tight shows up as "nobody could approve me", too
 * loose shows up as nothing at all.
 *
 * Returns null when allowed, or the sentence to show when not.
 */
function territoryOverlap(caller, target) {
  if (caller._perms.includes('view_all_contacts')) return true;
  const myAreas = arr(caller.assignedAreas);
  const myMandals = expandMandals(caller.assignedMandals);
  const theirAreas = arr(target.areas);
  const theirMandals = expandMandals(target.mandals);
  return myAreas.some((a) => theirAreas.includes(a))
    || myMandals.some((m) => theirMandals.includes(m));
}

function approvalRefusal(caller, target) {
  if (caller.id === target.id) {
    return 'You can’t approve your own password — ask your head or the karyalay.';
  }
  if (caller._perms.includes('manage_users')) return null;
  if (!(caller._rank > target._rank)) {
    return 'Only someone above them in the role list can approve this.';
  }
  if (!territoryOverlap(caller, target)) {
    return 'This volunteer is outside your area and mandal.';
  }
  return null;
}

// ── 1. The volunteer types the password they want ────────────────────────────

exports.submitPasswordChoice = onCall({ region: 'us-central1' }, async (request) => {
  const { phone, newPassword } = request.data || {};
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const password = String(newPassword || '');

  // Argument shape is validated before the lookup, and these errors are NOT
  // vague: they are about what the caller typed, not about who exists.
  if (cleanPhone.length !== 10) {
    throw new HttpsError('invalid-argument', 'Enter a valid 10-digit mobile number.');
  }
  if (password.length < 6 || password.length > MAX_PASSWORD) {
    throw new HttpsError('invalid-argument', `Choose a password between 6 and ${MAX_PASSWORD} characters.`);
  }
  // The exact Phase 22 hole, closed from the other side: the mobile number is
  // printed on every contact list in the app, so it is a published string and
  // can never be the secret that protects the account it belongs to.
  if (password.replace(/\D/g, '') === cleanPhone) {
    throw new HttpsError('invalid-argument', 'Your password can’t be your own mobile number — everyone can see it in the app.');
  }

  const volSnap = await db.collection('volunteers')
    .where('mobile', '==', cleanPhone).limit(1).get();

  // From here down the reply is identical whatever happened, so this endpoint
  // never answers "is this number registered?" for someone probing it.
  if (volSnap.empty || volSnap.docs[0].data().isActive === false) return VAGUE_REPLY;

  const vol = volSnap.docs[0];
  const volData = vol.data();

  // Sealed BEFORE the transaction: the vault read is not part of it, and a
  // transaction that retries must not regenerate a key.
  const sealed = await sealPassword(password);

  // A snapshot of where the requester sits, so listPasswordRequests() can filter
  // the pending list without reading a volunteer document per row. It is only
  // used for filtering — approvePasswordRequest re-reads the live volunteer and
  // re-checks, so a role changed after submitting is honoured, not cached.
  const targetRank = await rankForVolunteer(db, volData);

  const ref = db.collection(REQUESTS).doc(cleanPhone);
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      const prev = existing.exists ? existing.data() : null;
      const age = prev?.requestedAt ? Date.now() - (ms(prev.requestedAt) ?? 0) : Infinity;

      if (prev && prev.status === 'pending'
        && (prev.requestCount || 0) >= FREE_SUBMITS && age < COOLDOWN_MS) {
        return; // throttled — the earlier choice stands
      }

      tx.set(ref, {
        mobile: cleanPhone,
        volunteerId: vol.id,
        volunteerName: volData.name || null,
        // 'choice' marks a row that carries a password. Phase 22 rows have no
        // secret and approving one could never do anything, so they are told
        // apart here rather than failing confusingly at the Auth call.
        kind: 'choice',
        secret: sealed,
        choiceSetAt: FieldValue.serverTimestamp(),
        targetRank,
        targetAreas: arr(volData.assignedAreas),
        targetMandals: arr(volData.assignedMandals),
        status: 'pending',
        requestedAt: FieldValue.serverTimestamp(),
        requestCount: (prev?.requestCount || 0) + 1,
        resolvedAt: null,
        resolvedBy: null,
        resolvedByName: null,
        deniedReason: null,
      }, { merge: true });
    });
  } catch (err) {
    console.error('[submitPasswordChoice] could not record the choice:', err.message);
  }

  return {
    submitted: true,
    message: 'Your new password is waiting for approval. It will start working once your '
      + 'sanchalak or the karyalay approves it — keep using the old one until then.',
  };
});

// ── 2. What is waiting for me? ───────────────────────────────────────────────

exports.listPasswordRequests = onCall({ region: 'us-central1' }, async (request) => {
  const caller = await callerContext(request);

  // One query, no orderBy: `status` alone is a single-field index that already
  // exists, while adding a sort would need a composite index deployed by hand.
  // Pending rows are counted in ones and twos, so sorting them here is free.
  const snap = await db.collection(REQUESTS).where('status', '==', 'pending').limit(60).get();

  const now = Date.now();
  const requests = [];
  let mine = null;

  snap.forEach((d) => {
    const r = d.data();
    const setAt = ms(r.choiceSetAt) ?? ms(r.requestedAt);
    const expired = r.kind === 'choice' && setAt !== null && (now - setAt) > CHOICE_TTL_MS;

    if (r.volunteerId === caller.id) {
      mine = {
        id: d.id,
        status: 'pending',
        hasChoice: r.kind === 'choice' && Boolean(r.secret),
        expired,
        requestedAt: ms(r.requestedAt),
      };
      return; // never offer someone their own request to approve
    }
    if (expired) return;

    const refusal = approvalRefusal(caller, {
      id: r.volunteerId,
      rank: Number.isFinite(r.targetRank) ? r.targetRank : 0,
      areas: r.targetAreas,
      mandals: r.targetMandals,
    });
    if (refusal) return;

    // Deliberately no `secret`, in any form. The approver confirms WHO asked;
    // they never see, and never need to see, WHAT was chosen.
    requests.push({
      id: d.id,
      volunteerId: r.volunteerId,
      volunteerName: r.volunteerName || null,
      mobile: r.mobile || d.id,
      kind: r.kind || 'legacy',
      hasChoice: r.kind === 'choice' && Boolean(r.secret),
      requestedAt: ms(r.requestedAt),
      expiresAt: setAt === null ? null : setAt + CHOICE_TTL_MS,
      requestCount: r.requestCount || 1,
    });
  });

  requests.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  return { requests, mine, canApproveAll: caller._perms.includes('manage_users') };
});

// ── 3. Approve / deny ────────────────────────────────────────────────────────

/**
 * Shared front half. Re-reads the request AND the live volunteer document rather
 * than trusting the snapshot stored at submit time, so a role or area changed in
 * the meantime decides the outcome — the list is allowed to be slightly stale,
 * the decision is not.
 */
async function loadForDecision(request, requestId) {
  const caller = await callerContext(request);
  const id = String(requestId || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'requestId is required.');

  const ref = db.collection(REQUESTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That request no longer exists.');
  const row = snap.data();
  if (row.status !== 'pending') {
    throw new HttpsError('failed-precondition', `This request was already ${row.status}.`);
  }

  const volSnap = await db.collection('volunteers').doc(row.volunteerId).get();
  if (!volSnap.exists) throw new HttpsError('not-found', 'That volunteer no longer exists.');
  const volData = volSnap.data();

  const refusal = approvalRefusal(caller, {
    id: volSnap.id,
    rank: await rankForVolunteer(db, volData),
    areas: volData.assignedAreas,
    mandals: volData.assignedMandals,
  });
  if (refusal) throw new HttpsError('permission-denied', refusal);

  return { caller, ref, row, volunteer: { id: volSnap.id, ...volData } };
}

/** Best-effort audit row. A trail entry that fails must not turn a completed
 *  password change into a reported failure, or it gets approved twice. */
async function logDecision({ caller, volunteer, action, details }) {
  try {
    await db.collection('activity').add({
      timestamp: FieldValue.serverTimestamp(),
      volunteerId: caller.id,
      targetVolunteerId: volunteer.id,
      action,
      details,
    });
  } catch (err) {
    console.warn(`[${action}] could not write the audit row:`, err.message);
  }
}

exports.approvePasswordRequest = onCall({ region: 'us-central1' }, async (request) => {
  const { requestId } = request.data || {};
  const { caller, ref, row, volunteer } = await loadForDecision(request, requestId);

  if (row.kind !== 'choice' || !row.secret) {
    throw new HttpsError(
      'failed-precondition',
      'This is an older request with no password attached. Ask them to press “Forgot password” '
      + 'again and type the password they want.',
    );
  }
  if (volunteer.isActive === false) {
    throw new HttpsError('failed-precondition', 'This volunteer’s account is disabled.');
  }

  const setAt = ms(row.choiceSetAt) ?? ms(row.requestedAt);
  if (setAt !== null && Date.now() - setAt > CHOICE_TTL_MS) {
    // Clear it rather than leave a permanently un-approvable row sitting in
    // everyone's list, and drop the ciphertext with it.
    await ref.update({
      status: 'expired',
      secret: FieldValue.delete(),
      resolvedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError('failed-precondition', 'That password choice has expired. Ask them to set it again.');
  }

  const password = await openPassword(row.secret);
  if (!password) {
    await ref.update({ status: 'failed', secret: FieldValue.delete(), resolvedAt: FieldValue.serverTimestamp() });
    throw new HttpsError('internal', 'The stored password could not be read. Ask them to set it again.');
  }

  try {
    // volunteers/{id} doc ID === Auth uid — see src/hooks/usePermissions.jsx.
    await admin.auth().updateUser(volunteer.id, { password });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'No login account exists for this volunteer yet.');
    }
    throw new HttpsError('internal', `Failed to set the password: ${err.message}`);
  }

  // The plaintext must not outlive the change by a second longer than it has to.
  // This runs AFTER the Auth call for the same reason Phase 22 tidied up last:
  // if the tidy-up fails, the password is still correctly set, and the row shows
  // pending — which is a second approval that succeeds, not a lost account.
  await ref.update({
    status: 'approved',
    secret: FieldValue.delete(),
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: caller.id,
    resolvedByName: caller.name || null,
  });

  // Other devices signed in as this volunteer are signed out. A password change
  // should end the sessions that were opened with the old one; best-effort,
  // because failing to revoke is not a reason to report the change as failed.
  try {
    await admin.auth().revokeRefreshTokens(volunteer.id);
  } catch (err) {
    console.warn('[approvePasswordRequest] could not revoke old sessions:', err.message);
  }

  await logDecision({
    caller,
    volunteer,
    action: 'password_approved',
    details: `Approved the password ${volunteer.name || volunteer.id} chose for themselves`,
  });

  return { success: true, volunteerName: volunteer.name || null };
});

exports.denyPasswordRequest = onCall({ region: 'us-central1' }, async (request) => {
  const { requestId, reason } = request.data || {};
  const { caller, ref, volunteer } = await loadForDecision(request, requestId);

  await ref.update({
    status: 'denied',
    secret: FieldValue.delete(),
    deniedReason: String(reason || '').slice(0, 200) || null,
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: caller.id,
    resolvedByName: caller.name || null,
  });

  await logDecision({
    caller,
    volunteer,
    action: 'password_denied',
    details: `Denied the password request from ${volunteer.name || volunteer.id}`
      + `${reason ? ` · ${String(reason).slice(0, 200)}` : ''}`,
  });

  return { success: true };
});
