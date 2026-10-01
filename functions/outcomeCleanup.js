/**
 * functions/outcomeCleanup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 46 — auto-clear call outcomes a configurable interval after a sabha, so
 * the next calling round starts from a clean slate without anyone pressing
 * "reset" by hand.
 *
 * WHAT IT DOES. Some hours after a sabha ends (settings/app.clearOutcomesAfterHours),
 * the call outcome — `status` and the reference note — on every contact who sat
 * in one of that sabha's calling batches is cleared, exactly as the manual "reset
 * call statuses" on the calling screen does (src/services/batchService.js →
 * resetCallStatuses). The contact reappears in the queue as un-called for the next
 * round; the permanent history in `activity` is untouched, so nothing is lost.
 *
 * OFF BY DEFAULT. This is the only automatic *destructive* write in the app — it
 * edits contact documents unattended — so autoClearOutcomesEnabled defaults false
 * and an admin turns it on from Admin Tools → General settings once they want it.
 *
 * SCOPED TO ONE SABHA'S ROUND, NOT THE WHOLE ROSTER. The contacts come from
 * batches.where('eventId','==',event.id) → individualIds[] (Phase 27 linked each
 * batch to the sabha it was cut for). A contact called for a different mandal's
 * sabha, or never batched for this one, is never touched.
 *
 * EXACTLY ONCE. Like the post-sabha email, the event is claimed in a transaction
 * (its OWN field, `outcomesClearedAt`) with a bounded attempt counter, so two
 * overlapping ticks cannot double-clear and a persistent failure gives up rather
 * than looping forever.
 *
 * READS STAY LOW. The event scan reuses findEventsToReport (one range query per
 * tick); the members come straight off the batch documents (no per-contact read
 * to LIST them), and the contacts are read once only to skip the ones that have
 * nothing to clear — so a write is spent only where there is an outcome to remove.
 * With the feature off, a tick costs a single settings read and stops.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { findEventsToReport } = require('./lib/reportData');
const { schedules } = require('./lib/scheduleConfig');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const TZ = 'Asia/Kolkata';
const SCHEDULE_OPTS = { region: REGION, timeZone: TZ, timeoutSeconds: 300, memory: '512MiB' };

const OUTCOME_CLEANUP_SCHEDULE = schedules.outcomeCleanup;

/**
 * Mirror of the auto-clear knobs in DEFAULT_APP_SETTINGS
 * (src/services/settingsService.js). functions/ and src/ are separate packages
 * with no shared build, so the defaults are duplicated — KEEP THE TWO IN SYNC.
 * Only the two fields this job reads are mirrored here; settings/app carries more.
 */
const DEFAULT_APP_SETTINGS = {
  autoClearOutcomesEnabled: false,
  clearOutcomesAfterHours: 12,
};

/** Bounds on the admin-set delay: at least an hour (never mid-sabha), at most 30
 *  days (a runaway value would only widen the event scan for no purpose). */
const MIN_DELAY_HOURS = 1;
const MAX_DELAY_HOURS = 720;
const MAX_CLEAR_ATTEMPTS = 3;

// Each contact is a single update op (the audit is ONE summary row per event, not
// one per contact — see clearEventOutcomes), so a batch can fill to the limit.
const WRITE_BATCH_LIMIT = 450;
// getAll fan-in for the "does this contact still carry an outcome" read.
const READ_CHUNK = 300;

async function getAppSettings() {
  try {
    const snap = await db.collection('settings').doc('app').get();
    const data = snap.exists ? snap.data() : {};
    return { ...DEFAULT_APP_SETTINGS, ...data };
  } catch (err) {
    console.error('[outcome-cleanup] could not read settings/app, using defaults:', err.message);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

/**
 * Claim an event for outcome-clearing. Its OWN field, `outcomesClearedAt`, so it
 * never collides with the post-sabha email claims (`emailedAt`, `skReportsSentAt`)
 * on the same document — this fires hours later and must be independent of them.
 */
async function claimCleanup(eventId, now) {
  const ref = db.collection('events').doc(eventId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const e = snap.data();
    if (e.outcomesClearedAt) return false;
    if ((e.outcomesClearAttempts || 0) >= MAX_CLEAR_ATTEMPTS) {
      console.error(`[outcome-cleanup] giving up on event ${eventId} after ${e.outcomesClearAttempts} failed attempts.`);
      return false;
    }
    tx.update(ref, {
      outcomesClearedAt: now,
      outcomesClearAttempts: (e.outcomesClearAttempts || 0) + 1,
    });
    return true;
  });
}

/** Hand a failed claim back so a later tick retries it (bounded by the counter). */
async function releaseCleanup(eventId, message) {
  await db.collection('events').doc(eventId).update({
    outcomesClearedAt: null,
    outcomesClearError: String(message || '').slice(0, 500),
  }).catch((err) => console.error(`[outcome-cleanup] could not release event ${eventId}:`, err.message));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Clear status + reference on the contacts in one sabha's batches. Mirrors
 * src/services/batchService.js → resetCallStatuses (status:'' , reference:''), but
 * for an automatic bulk sweep:
 *   • reads the contacts first and writes ONLY the ones that still carry an
 *     outcome — a contact never called has nothing to clear, so no write is spent
 *     and the reported count is the true number cleared;
 *   • records ONE summary row in `activity` for the whole sweep rather than one
 *     per contact — an unattended clear should not bury the per-contact trail
 *     under hundreds of identical "status_reset" rows (the choice editBatchContacts
 *     makes for the same reason).
 * @returns {Promise<number>} how many contacts were actually cleared.
 */
async function clearEventOutcomes(event, now) {
  const batchSnap = await db.collection('batches').where('eventId', '==', event.id).get();
  const ids = new Set();
  batchSnap.forEach((d) => {
    (d.data().individualIds || []).forEach((id) => { if (id) ids.add(id); });
  });
  if (ids.size === 0) return 0;

  // Read once to skip contacts with nothing to clear — a read (the looser budget)
  // spent to save a write (the tighter one), and to keep the count honest.
  const toClear = [];
  for (const slice of chunk([...ids], READ_CHUNK)) {
    /* eslint-disable no-await-in-loop */
    const refs = slice.map((id) => db.collection('individuals').doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s) => {
      if (!s.exists) return;
      const v = s.data();
      if ((v.status && v.status !== '') || (v.reference && v.reference !== '')) toClear.push(s.id);
    });
    /* eslint-enable no-await-in-loop */
  }
  if (toClear.length === 0) return 0;

  let cleared = 0;
  for (const slice of chunk(toClear, WRITE_BATCH_LIMIT)) {
    /* eslint-disable no-await-in-loop */
    const wb = db.batch();
    for (const id of slice) {
      // update (not set/merge): a contact deleted between the read and the write
      // must fail the batch and be retried, never be resurrected as a blank doc.
      wb.update(db.collection('individuals').doc(id), {
        status: '',
        reference: '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      cleared += 1;
    }
    await wb.commit();
    /* eslint-enable no-await-in-loop */
  }

  // One audit row for the whole sweep. volunteerId null = "the system did it".
  await db.collection('activity').add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    volunteerId: null,
    action: 'status_reset',
    eventId: event.id,
    details: `Auto-cleared ${cleared} call outcome${cleared === 1 ? '' : 's'} for a new round after “${event.title || 'Sabha'}” (${event.date || ''}).`,
  }).catch((err) => console.error('[outcome-cleanup] could not write the summary activity row:', err.message));

  return cleared;
}

/**
 * runOutcomeCleanup({ now, force, eventId })
 *
 * Finds sabhas that ended at least clearOutcomesAfterHours ago and have not had
 * their outcomes cleared, and clears each one's calling round exactly once.
 * `force`/`eventId` clear one named sabha regardless of the toggle or the claim —
 * there is no caller for that path yet, but it keeps a manual trigger one export
 * away and mirrors runPostSabhaReports.
 */
async function runOutcomeCleanup({ now = new Date(), force = false, eventId = null } = {}) {
  const settings = await getAppSettings();
  if (!force && !settings.autoClearOutcomesEnabled) return { skipped: 'disabled' };

  const delayHours = Math.max(
    MIN_DELAY_HOURS,
    Math.min(MAX_DELAY_HOURS, Number(settings.clearOutcomesAfterHours) || DEFAULT_APP_SETTINGS.clearOutcomesAfterHours),
  );

  let due;
  if (eventId) {
    const snap = await db.collection('events').doc(eventId).get();
    if (!snap.exists) return { cleared: [], checked: 0 };
    due = [{ id: snap.id, ...snap.data() }];
  } else {
    // graceMinutes = the delay (fire only once the sabha is that many hours past);
    // lookbackHours = delay + 48 so there is a two-day window to catch each event
    // even if a tick or two is missed, without ever re-touching ancient sabhas.
    due = await findEventsToReport({
      now,
      claimField: 'outcomesClearedAt',
      graceMinutes: delayHours * 60,
      lookbackHours: delayHours + 48,
    });
    if (due.length === 0) return { cleared: [], checked: 0 };
  }

  const results = [];
  for (const event of due) {
    /* eslint-disable no-await-in-loop */
    if (!force) {
      const owned = await claimCleanup(event.id, now);
      if (!owned) continue;
    }
    try {
      const cleared = await clearEventOutcomes(event, now);
      if (!force) {
        await db.collection('events').doc(event.id).update({
          outcomesClearError: admin.firestore.FieldValue.delete(),
        }).catch(() => {});
      }
      results.push({ eventId: event.id, cleared });
    } catch (err) {
      console.error(`[outcome-cleanup] event ${event.id} failed:`, err.message);
      if (!force) await releaseCleanup(event.id, err.message);
      results.push({ eventId: event.id, error: err.message });
    }
    /* eslint-enable no-await-in-loop */
  }

  return { cleared: results, checked: due.length };
}

// ── Scheduled entry point ────────────────────────────────────────────────────
exports.scheduledOutcomeCleanup = onSchedule(
  { ...SCHEDULE_OPTS, schedule: OUTCOME_CLEANUP_SCHEDULE },
  async () => {
    const res = await runOutcomeCleanup({ now: new Date() });
    if (res.checked) console.log('[outcome-cleanup] done:', JSON.stringify(res));
  },
);

exports.runOutcomeCleanup = runOutcomeCleanup;
