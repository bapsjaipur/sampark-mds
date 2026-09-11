/**
 * functions/lib/scheduleConfig.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 34 — the cron strings for the five scheduled jobs, in ONE place so the
 * admin panel can edit them instead of them being buried three files deep.
 *
 * WHY A FILE AND NOT A FIRESTORE READ. A Cloud Functions v2 schedule is baked in
 * at DEPLOY time — `onSchedule({ schedule })` registers a Cloud Scheduler job
 * with that exact cron, and nothing reads Firestore when the job fires to decide
 * whether "now" is the right time. So a schedule cannot be changed at runtime
 * from a settings document; it can only be changed by deploying again. That is
 * the whole reason the admin panel's Schedule editor says "applies after the next
 * deploy" rather than taking effect immediately.
 *
 * HOW THE PANEL REACHES THIS. The panel writes the desired cron strings to
 * settings/email (scheduleDailyCron, …). To apply them, the values have to land
 * here before `firebase deploy`. Two supported ways, in order of convenience:
 *
 *   1. `cd functions && npm run schedules:pull` — reads settings/email and writes
 *      schedules.local.json (needs Application Default Credentials once:
 *      `gcloud auth application-default login`). See functions/pull-schedules.js.
 *   2. By hand — create functions/schedules.local.json with any of the five keys
 *      below. The panel shows the exact JSON to paste.
 *
 * schedules.local.json is git-ignored (it is per-deployer, like .env) but IS
 * uploaded with the functions source, so its values are present both when the
 * CLI analyses the schedule at deploy and when the function cold-starts. A
 * missing or malformed file simply falls back to DEFAULT_SCHEDULES, so a fresh
 * checkout deploys with today's times and nothing breaks.
 *
 * KEEP DEFAULT_SCHEDULES IN SYNC with the cron defaults in
 * src/services/settingsService.js and functions/lib/mailer.js — those three are
 * the same five strings written for three different consumers (the panel, the
 * mailer's settings merge, and this deploy-time source).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

/** The shipped defaults — identical to the cron strings these jobs have always
 *  used. Off the hour on purpose: Cloud Scheduler stampedes at :00 and Firestore
 *  reads queue behind each other, so a report at 22:05 beats a report at 22:00. */
const DEFAULT_SCHEDULES = {
  daily: '5 22 * * *',        // scheduledDailyReport — 22:05 IST
  postSabha: '*/15 * * * *',  // scheduledPostSabhaReports — every 15 minutes
  birthday: '10 6 * * *',     // scheduledBirthdaySummary — 06:10 IST
  sabhaDigest: '12 7 * * 1',  // scheduledSabhaDigest — Monday 07:12 IST
  sabhaGeneration: '7 4 * * 0', // scheduledSabhaGeneration — Sunday 04:07 IST
  // PHASE 35 — rebuild the birthday/anniversary calendar dataset (Cloud Storage)
  // that the per-volunteer ICS feed serves. 03:40 IST, before the 06:10 birthday
  // email, so the feed is fresh for the day. See functions/calendarSync.js.
  calendarRebuild: '40 3 * * *', // rebuildCalendarCache — 03:40 IST
};

/** A cron string this project would ever set: exactly five whitespace-separated
 *  fields. Deliberately loose — Cloud Scheduler is the real validator. Its only
 *  job is to stop a corrupt override (an empty string, a stray object) from
 *  being handed to onSchedule, which would fail the whole deploy. */
function looksLikeCron(value) {
  return typeof value === 'string' && value.trim().split(/\s+/).length === 5;
}

function loadOverrides() {
  const file = path.join(__dirname, '..', 'schedules.local.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {}; // no override file — the common case, use defaults
  }
  try {
    const parsed = JSON.parse(raw);
    const clean = {};
    for (const key of Object.keys(DEFAULT_SCHEDULES)) {
      if (looksLikeCron(parsed[key])) clean[key] = parsed[key].trim();
      else if (parsed[key] != null) {
        console.warn(`[scheduleConfig] ignoring invalid cron for "${key}": ${JSON.stringify(parsed[key])}`);
      }
    }
    return clean;
  } catch (err) {
    console.warn(`[scheduleConfig] schedules.local.json is not valid JSON, using defaults: ${err.message}`);
    return {};
  }
}

const schedules = { ...DEFAULT_SCHEDULES, ...loadOverrides() };

module.exports = { schedules, DEFAULT_SCHEDULES };
