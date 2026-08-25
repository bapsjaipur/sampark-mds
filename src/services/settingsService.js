// src/services/settingsService.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 — app-level settings, replacing Sevak Call's "EmailSettings" sheet.
//
// The legacy app kept automation config in a sheet tab that a moderator could
// break by typing in the wrong cell, and the trigger functions read it on every
// run with no defaults — a blank cell meant "off" in some places and "on" in
// others. Here each settings document has an explicit DEFAULT_* object that is
// merged over the stored data, so a missing field always resolves the same way
// and a brand-new install works with no writes at all.
//
// Three documents:
//   settings/email           → which scheduled reports run, and how
//   settings/messageTemplate → the WhatsApp body used by the calling screen
//   settings/callOutcomes    → the outcome buttons on the calling screen
//
// Cloud Functions read the same documents (functions/emailJobs.js), so the
// defaults below are duplicated in functions/lib/mailer.js. Keep them in sync.
// ─────────────────────────────────────────────────────────────────────────────

import { doc, onSnapshot, serverTimestamp } from 'firebase/firestore';
// PHASE 24 — metered drop-ins (src/lib/fsMetered.js): same signatures, they count.
// Single settings documents, so the amounts are tiny — but they are read on
// nearly every screen, and "tiny × everywhere" is how a quota goes missing.
import { getDoc, setDoc } from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { DEFAULT_WA_TEMPLATE, DEFAULT_BIRTHDAY_TEMPLATE, DEFAULT_ANNIVERSARY_TEMPLATE } from '../lib/whatsapp';
import { DEFAULT_STATUS_CHIPS } from '../lib/callingStatuses';

export const SETTINGS_COLLECTION = 'settings';

export const DEFAULT_EMAIL_SETTINGS = {
  // Daily calling report to everyone holding send_emails — Sevak Call's
  // dailyEmailTrigger, which fired at 22:00 IST.
  autoDailyAdminEnabled: true,
  // Per-volunteer version of the same report, sent only to volunteers who
  // actually logged a call that day. Sevak Call sent this to everyone, which
  // meant most volunteers got a nightly email saying "0 calls".
  autoDailyVolunteerEnabled: false,
  // Post-sabha attendance report. Legacy ran a 15-minute poll and used an
  // "AutoEmailed" sheet column as the idempotency guard.
  autoPostSabhaAdminEnabled: true,
  autoPostSabhaVolunteerEnabled: false,
  // Birthday + anniversary digest at 06:00 IST.
  autoBirthdayEnabled: true,
  senderName: 'BAPS Jaipur MDS',
  // Left blank → the Trigger Email extension's configured default sender is
  // used. Only set this if that sender is verified, or mail will bounce.
  fromAddress: '',
  // dryRun writes to emailLogs but NOT to the mail queue. Intended for the
  // first week after enabling automation, so the recipient list and the numbers
  // can be checked before anything reaches a real inbox.
  dryRun: false,
  // Hard cap on recipients per job — a runaway query that resolved to every
  // volunteer would otherwise burn the extension's quota in one run.
  maxRecipients: 50,
  // Addresses that receive the reports without holding a login. volunteers/{uid}
  // has no real email (auth uses a synthetic <phone>@baps-jaipur-mds.local
  // address), so a volunteer only becomes a recipient once someone fills in
  // their `reportEmail` on the Volunteers screen. This list covers everyone
  // else — a sanchalak, a trustee — who needs the numbers but never signs in.
  extraRecipients: [],
};

export const DEFAULT_MESSAGE_TEMPLATE_SETTINGS = {
  whatsappTemplate: DEFAULT_WA_TEMPLATE,
  birthdayTemplate: DEFAULT_BIRTHDAY_TEMPLATE,
  anniversaryTemplate: DEFAULT_ANNIVERSARY_TEMPLATE,
};

// The outcome buttons on the calling screen. Seeded from the seven values the
// legacy sheet already used, so an install that never opens the editor behaves
// exactly as it did when this list was hardcoded.
export const DEFAULT_CALL_OUTCOME_SETTINGS = {
  outcomes: DEFAULT_STATUS_CHIPS,
};

const DEFAULTS = {
  email: DEFAULT_EMAIL_SETTINGS,
  messageTemplate: DEFAULT_MESSAGE_TEMPLATE_SETTINGS,
  callOutcomes: DEFAULT_CALL_OUTCOME_SETTINGS,
};

function withDefaults(docId, data) {
  const defaults = DEFAULTS[docId] || {};
  const merged = { ...defaults };
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      // An explicit null/undefined in the document must not defeat the default.
      if (v !== null && v !== undefined) merged[k] = v;
    }
  }
  return merged;
}

/**
 * subscribeToSettings(docId, cb) → unsubscribe
 * cb receives the defaults-merged object. Fires immediately with pure defaults
 * if the document does not exist yet.
 */
export function subscribeToSettings(docId, cb) {
  return onSnapshot(
    doc(db, SETTINGS_COLLECTION, docId),
    (snap) => cb(withDefaults(docId, snap.exists() ? snap.data() : null), null),
    (err) => cb(withDefaults(docId, null), err),
  );
}

export async function getSettings(docId) {
  const snap = await getDoc(doc(db, SETTINGS_COLLECTION, docId));
  return withDefaults(docId, snap.exists() ? snap.data() : null);
}

/**
 * saveSettings(docId, patch, volunteerId)
 *
 * setDoc with merge:true rather than updateDoc — the document legitimately does
 * not exist on a fresh install, and updateDoc would throw not-found.
 */
export async function saveSettings(docId, patch, volunteerId) {
  await setDoc(
    doc(db, SETTINGS_COLLECTION, docId),
    { ...patch, updatedAt: serverTimestamp(), updatedBy: volunteerId || null },
    { merge: true },
  );
}

/**
 * describeSettingsError(err, readDenied)
 *
 * Turns a Firestore write failure into something an admin can act on.
 *
 * There are exactly two ways a settings write gets permission-denied, and they
 * need opposite fixes, so the message must not offer both as a coin flip:
 *
 *   1. The rules aren't deployed. The `settings` collection arrived with
 *      Phase 20, so its `match /settings/{docId}` block is newer than the last
 *      `firebase deploy --only firestore:rules`. Until that deploy runs the live
 *      ruleset has no match for the path, Firestore default-denies, and the SDK
 *      reports the bare "Missing or insufficient permissions." — which reads
 *      like a role problem and sends people to the Roles screen, where
 *      everything already looks correct.
 *   2. The rules are deployed but the role lacks `manage_templates`.
 *
 * `readDenied` separates them for free. Reading a settings doc requires no
 * permission (`allow read: if volunteerExists()`), so if the READ was denied too
 * it can only be case 1. If the read succeeded and only the write failed, it is
 * case 2. Pass `readDenied` from useSettings().
 *
 * PHASE 22 caveat: settings/email is now the one document whose READ is gated
 * (on send_emails / manage_templates / manage_users) because extraRecipients[]
 * holds the private addresses of people who never sign in. That does not break
 * the diagnosis above, because the only screen that reads it — the Report Emails
 * tab — is itself gated on send_emails, which the rule accepts. Anyone who can
 * see the tab can read the document, so a denied read there still means "the
 * rules are not deployed". If a new caller reads settings/email from somewhere
 * less privileged, this function needs to know which docId it is describing.
 */
export function describeSettingsError(err, readDenied = false) {
  if (err?.code === 'permission-denied') {
    if (readDenied) {
      return 'The security rules for the "settings" collection are not deployed yet, '
        + 'so nothing on this tab can be read or saved. Someone with Firebase access '
        + 'needs to run: firebase deploy --only firestore:rules';
    }
    return 'Firestore rejected the save — your role is missing the '
      + '"Manage Message Templates & Email Settings" permission.';
  }
  if (err?.code === 'unavailable') {
    return 'You appear to be offline — the save will not go through until you reconnect.';
  }
  return err?.message || 'Could not save. Please try again.';
}

