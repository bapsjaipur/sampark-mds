/**
 * 06-import-activity-log.js
 * ─────────────────────────────────────────────────────────────────
 * Imports the legacy Activity sheet (2434 rows) into Firestore's activity
 * collection. Skipped by the main migration script because it's keyed by
 * NAME strings (Volunteer, ContactName), not IDs — this script resolves
 * those names against your already-migrated volunteers/individuals, and
 * writes anything ambiguous or unresolved to a review file instead of
 * guessing.
 *
 * RUN THIS AFTER 04-migrate-real-data.js (and after recreating volunteers
 * from volunteers-to-review.csv) — it needs both collections populated to
 * resolve names.
 *
 * SETUP: npm install firebase-admin xlsx
 * USAGE:
 *   node 06-import-activity-log.js --dry-run BAPS_All_Sampark_Web_Automation_Testing.xlsx
 *   node 06-import-activity-log.js BAPS_All_Sampark_Web_Automation_Testing.xlsx
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const XLSX = require('xlsx');

const isDryRun = process.argv.includes('--dry-run');
const filePath = process.argv.filter((a) => a !== '--dry-run')[2];
if (!filePath) {
  console.error('Usage: node 06-import-activity-log.js [--dry-run] <path-to-xlsx>');
  process.exit(1);
}

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function loadNameMaps() {
  const volSnap = await db.collection('volunteers').get();
  const indSnap = await db.collection('individuals').get();

  const volunteersByName = new Map(); // name -> [ids]
  volSnap.forEach((d) => {
    const name = (d.data().name || '').trim().toLowerCase();
    if (!name) return;
    if (!volunteersByName.has(name)) volunteersByName.set(name, []);
    volunteersByName.get(name).push(d.id);
  });

  const individualsByName = new Map();
  indSnap.forEach((d) => {
    const name = (d.data().name || '').trim().toLowerCase();
    if (!name) return;
    if (!individualsByName.has(name)) individualsByName.set(name, []);
    individualsByName.get(name).push(d.id);
  });

  return { volunteersByName, individualsByName };
}

function resolve(nameMap, rawName) {
  if (!rawName) return { id: null, reason: 'blank' };
  const key = String(rawName).trim().toLowerCase();
  const matches = nameMap.get(key);
  if (!matches) return { id: null, reason: 'not_found' };
  if (matches.length > 1) return { id: null, reason: 'ambiguous', candidates: matches };
  return { id: matches[0], reason: 'ok' };
}

async function run() {
  const { volunteersByName, individualsByName } = await loadNameMaps();

  const wb = XLSX.readFile(filePath);
  if (!wb.Sheets['Activity']) { console.error('No "Activity" sheet found in that file.'); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Activity']);
  console.log(`Loaded ${rows.length} activity rows.`);

  const toWrite = [];
  const reviewNeeded = [];

  rows.forEach((r, idx) => {
    if (r.Volunteer === 'System') return; // skip system/install log lines
    const volResult = resolve(volunteersByName, r.Volunteer);
    const contactResult = resolve(individualsByName, r.ContactName);

    if (volResult.reason !== 'ok' || contactResult.reason !== 'ok') {
      reviewNeeded.push({ row: idx + 2, volunteer: r.Volunteer, volunteerResolution: volResult.reason, contact: r.ContactName, contactResolution: contactResult.reason });
      return;
    }

    toWrite.push({
      volunteerId: volResult.id,
      individualId: contactResult.id,
      action: 'status_changed',
      details: r.Reference ? `Status: ${r.Status} \u2014 ${r.Reference}` : `Status: ${r.Status}`,
      _timestamp: r.Timestamp,
    });
  });

  console.log(`Resolved: ${toWrite.length}, needs review: ${reviewNeeded.length}`);
  if (reviewNeeded.length) {
    fs.writeFileSync('activity-import-review.json', JSON.stringify(reviewNeeded, null, 2));
    console.log('\u26a0\ufe0f  Unresolved/ambiguous rows \u2192 activity-import-review.json (not imported \u2014 fix names and re-run, or ignore if not important)');
  }

  if (isDryRun) {
    fs.writeFileSync('dry-run-activity.json', JSON.stringify(toWrite, null, 2));
    console.log('Dry run only \u2014 review dry-run-activity.json, then re-run without --dry-run.');
    return;
  }

  let batch = db.batch();
  let opCount = 0;
  for (const entry of toWrite) {
    const ref = db.collection('activity').doc();
    const { _timestamp, ...data } = entry;
    batch.set(ref, {
      ...data,
      timestamp: _timestamp instanceof Date ? admin.firestore.Timestamp.fromDate(_timestamp) : admin.firestore.FieldValue.serverTimestamp(),
    });
    opCount++;
    if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; }
  }
  if (opCount > 0) await batch.commit();
  console.log(`\u2705 Wrote ${toWrite.length} activity records.`);
}

run().catch((err) => { console.error('Import failed:', err); process.exit(1); });
