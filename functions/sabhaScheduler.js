/**
 * functions/sabhaScheduler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 33 — the weekly job that keeps the calendar filled in by itself.
 *
 * "every sabha happen on almost same day of week and it is recurring and when i
 *  automate then it will no need to each time to create event."
 *
 * The button on the All Area Sabhas screen does the same work on demand; this is
 * the half that means nobody has to press it. Both write events with the SAME
 * derived id — `sch_{scheduleId}_{YYYY-MM-DD}` — so whichever runs first wins and
 * the other finds the document already there and writes nothing. That is the
 * entire concurrency story: no locks, no claim transaction, no duplicates.
 *
 * READS. One pass over `sabhaSchedules` (tens of documents) and one range query
 * over `events` for the generation window (a few dozen). Once a week. Against a
 * 50k/day budget this is a rounding error, which is why it can afford to look at
 * the real calendar rather than trusting a cursor.
 *
 * NO COMPOSITE INDEX. The events query filters on `date` alone — a single-field
 * range, which Firestore serves from the automatic index. Adding `scheduleId` or
 * `mandal` alongside the range would force a composite; the extra rows are
 * filtered in memory instead.
 *
 * The date arithmetic lives in lib/sabhaDates.js — a deliberate transcription of
 * src/lib/sabhaSchedule.js, because that module is ESM inside the Vite bundle
 * and this is CommonJS in the Functions package. If the recurrence rules change,
 * BOTH copies must change; the derived id is what keeps them honest, because a
 * disagreement shows up as a duplicate sabha on a nearby date rather than
 * silently. The weekly digest (sabhaDigest.js) requires the same file, so the
 * job that CREATES sabhas and the job that REPORTS on missing ones can never
 * disagree about which Sundays exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const {
  toDateStr, occurrenceKeys, scheduledEventId, occurrencesBetween, eventFieldsFromSchedule,
} = require('./lib/sabhaDates');
// PHASE 34 — editable cron, see lib/scheduleConfig.js.
const { schedules } = require('./lib/scheduleConfig');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const TZ = 'Asia/Kolkata';
const SCHEDULE_OPTS = { region: REGION, timeZone: TZ, timeoutSeconds: 300, memory: '256MiB' };

// Sunday 04:07 IST by default — before anybody is awake, and off the hour for
// the same reason as the email jobs (Cloud Scheduler stampedes at :00). Editable
// from the admin panel via lib/scheduleConfig.js.
const GENERATE_SCHEDULE = schedules.sabhaGeneration;

/** How far ahead each run materialises. Mirrors DEFAULT_WEEKS_AHEAD. */
const WEEKS_AHEAD = 4;

/** Refuse to write more than this in one run — a corrupt schedule shouldn't be
 *  able to turn a cron job into thousands of writes. */
const MAX_WRITES = 300;

/**
 * The core, exported so it can be called from a test or a manual invocation.
 * @returns {Promise<{created: number, schedules: number, from: string, to: string}>}
 */
async function generateUpcomingSabhas({ now = new Date(), weeksAhead = WEEKS_AHEAD } = {}) {
  const fromStr = toDateStr(now);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + weeksAhead * 7);
  const toStr = toDateStr(horizon);

  const scheduleSnap = await db.collection('sabhaSchedules').get();
  const schedules = scheduleSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.active !== false);

  if (!schedules.length) {
    console.log('[sabhaScheduler] no active schedules; nothing to do');
    return { created: 0, schedules: 0, from: fromStr, to: toStr };
  }

  // Single-field range — no composite index. Everything in the window, so a
  // sabha somebody created BY HAND on a scheduled date is found too and adopted
  // rather than duplicated.
  const eventSnap = await db.collection('events')
    .where('date', '>=', fromStr)
    .where('date', '<=', toStr)
    .get();

  const ids = new Set(eventSnap.docs.map((d) => d.id));
  const keys = new Set();
  for (const d of eventSnap.docs) {
    const e = d.data();
    // A joint sabha registers under EACH of its areas and a city-wide one under
    // the empty key, so a hand-made sabha in any listed area is found below.
    for (const key of occurrenceKeys(e, e.mandal, e.date)) keys.add(key);
  }

  const due = [];
  for (const schedule of schedules) {
    for (const date of occurrencesBetween(schedule, fromStr, toStr)) {
      if (ids.has(scheduledEventId(schedule.id, date))) continue;
      // Somebody already created this sabha by hand in ANY of the areas a joint
      // schedule lists — adopt theirs rather than adding a second that evening.
      if (occurrenceKeys(schedule, schedule.mandal, date).some((key) => keys.has(key))) continue;
      due.push({ schedule, date });
    }
  }

  if (!due.length) {
    console.log(`[sabhaScheduler] ${schedules.length} schedules, calendar already full to ${toStr}`);
    return { created: 0, schedules: schedules.length, from: fromStr, to: toStr };
  }

  const batchList = due.slice(0, MAX_WRITES);
  if (due.length > MAX_WRITES) {
    console.warn(`[sabhaScheduler] ${due.length} due, capped at ${MAX_WRITES}`);
  }

  // Chunked at 400 — the batch limit is 500 and each write here is one document.
  const nowTs = admin.firestore.FieldValue.serverTimestamp();
  for (let i = 0; i < batchList.length; i += 400) {
    const batch = db.batch();
    for (const { schedule, date } of batchList.slice(i, i + 400)) {
      batch.set(db.collection('events').doc(scheduledEventId(schedule.id, date)), {
        ...eventFieldsFromSchedule(schedule, date),
        createdAt: nowTs,
        updatedAt: nowTs,
      });
    }
    await batch.commit();
  }

  console.log(`[sabhaScheduler] created ${batchList.length} sabhas from ${schedules.length} schedules (${fromStr} → ${toStr})`);
  return { created: batchList.length, schedules: schedules.length, from: fromStr, to: toStr };
}

exports.generateUpcomingSabhas = generateUpcomingSabhas;

exports.scheduledSabhaGeneration = onSchedule(
  { ...SCHEDULE_OPTS, schedule: GENERATE_SCHEDULE },
  async () => {
    // A throw here gets retried by Cloud Scheduler, and a retry is harmless —
    // the derived ids make a second pass a no-op. So nothing is swallowed.
    await generateUpcomingSabhas({ now: new Date() });
  },
);
