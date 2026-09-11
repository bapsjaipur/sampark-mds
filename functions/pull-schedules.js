#!/usr/bin/env node
/**
 * functions/pull-schedules.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 34 — bridge the admin panel's Schedule editor to the deploy.
 *
 * The panel writes the desired cron strings to settings/email. A Cloud Functions
 * schedule is fixed at deploy time (see lib/scheduleConfig.js), so those strings
 * have to be written to functions/schedules.local.json BEFORE `firebase deploy`.
 * This script does exactly that and nothing else.
 *
 *   cd functions
 *   npm run schedules:pull        # then: firebase deploy --only functions
 *
 * It reads Firestore through the Admin SDK using Application Default Credentials.
 * If you have never set those up on this machine, run once:
 *
 *   gcloud auth application-default login
 *
 * If credentials are missing or the read fails, the script prints how to fix it
 * and exits WITHOUT writing a broken file — the existing schedules.local.json
 * (or the built-in defaults) are left untouched, so a deploy still succeeds with
 * the last-known times. This is a convenience, never a deploy dependency; you can
 * always edit functions/schedules.local.json by hand instead (the panel shows the
 * exact JSON).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { DEFAULT_SCHEDULES } = require('./lib/scheduleConfig');

// settings/email field  →  schedules.local.json key
const FIELD_MAP = {
  scheduleDailyCron: 'daily',
  schedulePostSabhaCron: 'postSabha',
  scheduleBirthdayCron: 'birthday',
  scheduleSabhaDigestCron: 'sabhaDigest',
  scheduleSabhaGenerationCron: 'sabhaGeneration',
  scheduleCalendarRebuildCron: 'calendarRebuild',
};

const OUT_FILE = path.join(__dirname, 'schedules.local.json');

function looksLikeCron(value) {
  return typeof value === 'string' && value.trim().split(/\s+/).length === 5;
}

function resolveProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.firebaserc'), 'utf8'));
    return rc.projects && rc.projects.default;
  } catch {
    return undefined;
  }
}

async function main() {
  const projectId = resolveProjectId();
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });

  const snap = await admin.firestore().collection('settings').doc('email').get();
  const data = snap.exists ? snap.data() : {};

  const out = {};
  const summary = [];
  for (const [field, key] of Object.entries(FIELD_MAP)) {
    const value = data[field];
    if (looksLikeCron(value)) {
      out[key] = value.trim();
      summary.push(`  ${key.padEnd(16)} ${out[key]}`);
    } else {
      out[key] = DEFAULT_SCHEDULES[key];
      summary.push(`  ${key.padEnd(16)} ${out[key]}  (default — not set in settings/email)`);
    }
  }

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`\n✓ Wrote ${path.relative(process.cwd(), OUT_FILE)} from settings/email:\n`);
  console.log(summary.join('\n'));
  console.log('\nNow apply it:  firebase deploy --only functions\n');
}

main().catch((err) => {
  console.error('\n✗ Could not pull schedules from Firestore.\n');
  if (String(err.message || '').match(/credential|default credentials|auth/i)) {
    console.error('  This machine has no Application Default Credentials. Run once:\n');
    console.error('    gcloud auth application-default login\n');
  } else {
    console.error(`  ${err.message}\n`);
  }
  console.error('  Left schedules.local.json untouched — the current times still deploy.');
  console.error('  You can also edit functions/schedules.local.json by hand (the panel shows the JSON).\n');
  process.exit(1);
});
