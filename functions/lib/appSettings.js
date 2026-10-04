/**
 * functions/lib/appSettings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 48 — the functions-side mirror of settings/app, in ONE place.
 *
 * Until now the only function that read settings/app (functions/outcomeCleanup.js)
 * carried its own two-field copy of DEFAULT_APP_SETTINGS. The in-app notification
 * jobs add six more knobs to the SAME document, so rather than scatter a second
 * and third partial copy across files, the whole mirror lives here and every
 * function reads it through getAppSettings().
 *
 * settings/app is world-readable (the generic settings read rule) and written
 * from Admin Tools → General settings. KEEP THIS IN SYNC with DEFAULT_APP_SETTINGS
 * in src/services/settingsService.js — same keys, same defaults. functions/ and
 * src/ are separate packages with no shared build, which is why the copy exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const DEFAULT_APP_SETTINGS = {
  // ── calling / attendance knobs ──────────────────────────────────────────────
  // Read on the client (src/); mirrored here only so the two defaults objects stay
  // the same shape and a future function can read them without adding a third copy.
  attendanceWindowEnforced: true,
  defaultBatchSize: 25,

  // ── PHASE 46 — auto-clear call outcomes after a sabha ────────────────────────
  // functions/outcomeCleanup.js. Off by default: the only automatic destructive
  // write in the app, so an admin turns it on deliberately.
  autoClearOutcomesEnabled: false,
  clearOutcomesAfterHours: 12,

  // ── PHASE 48 — in-app notifications ──────────────────────────────────────────
  // functions/notifications.js + the birthday fold-in in functions/emailJobs.js.
  // RECEIVING a bell is universal and auto-scoped, so these do NOT gate who gets a
  // notification — they only switch each auto-trigger's fan-out on or off. All
  // default ON; a bulk alert sent by hand is never gated by a setting (only by the
  // send_notifications permission).
  notifyBatchAssigned: true,
  notifySabhaReminder: true,
  notifyAttendanceMarked: true,
  notifyBirthdays: true,
  // How far before a sabha the reminder fires, in hours. The scheduled sweep runs
  // hourly and claims each event once, so the reminder lands on the first tick
  // after the sabha enters this window.
  sabhaReminderLeadHours: 24,
  // Seen notifications older than this many days are swept nightly
  // (scheduledNotificationCleanup), keeping the per-user unread listener cheap.
  notificationRetentionDays: 30,
};

/**
 * settings/app merged over the defaults. Mirrors outcomeCleanup.js's original
 * reader exactly ({ ...DEFAULT, ...data }) — a stored field wins, a missing one
 * falls back. Never throws: a settings read failure returns pure defaults so a
 * scheduled job degrades to "feature at its default" rather than crashing.
 */
async function getAppSettings() {
  try {
    const snap = await db.collection('settings').doc('app').get();
    const data = snap.exists ? snap.data() : {};
    return { ...DEFAULT_APP_SETTINGS, ...data };
  } catch (err) {
    console.error('[appSettings] could not read settings/app, using defaults:', err.message);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

module.exports = { DEFAULT_APP_SETTINGS, getAppSettings, db };
