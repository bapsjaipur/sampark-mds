/**
 * functions/index.js
 * ─────────────────────────────────────────────────────────────────
 * Phase 5, unchanged in logic from the original — copied in as the
 * Cloud Functions entry point. See MERGE-NOTES.md for what was reconciled
 * elsewhere; this file needed no changes.
 * ─────────────────────────────────────────────────────────────────
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;
const CHUNK_SIZE = 200;

async function runSync() {
  if (!GAS_WEBAPP_URL) throw new Error('GAS_WEBAPP_URL is not configured.');

  const [householdsSnap, individualsSnap] = await Promise.all([
    db.collection('households').get(),
    db.collection('individuals').get(),
  ]);

  const householdsById = {};
  householdsSnap.forEach(doc => { householdsById[doc.id] = doc.data(); });

  const rowsByMandal = {};

  individualsSnap.forEach(doc => {
    const ind = doc.data();
    const hh = householdsById[ind.householdId] || {};
    const mandal = ind.mandal || 'Unassigned';
    if (!rowsByMandal[mandal]) rowsByMandal[mandal] = [];
    rowsByMandal[mandal].push({
      Name: ind.name || '',
      Phone: ind.mobile || '',
      Area: hh.area || '',
      Mandal: mandal,
      DOB: ind.dob || '',
      Complete_Address: hh.address || '',
      Note: hh.remark || '',
    });
  });

  const summary = { totalMandals: 0, totalRows: 0, inserted: 0, skipped: 0, errors: [] };

  for (const [mandal, rows] of Object.entries(rowsByMandal)) {
    summary.totalMandals++;
    summary.totalRows += rows.length;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      try {
        const res = await fetch(GAS_WEBAPP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'importContacts', mandal, rows: chunk }),
        });
        const json = await res.json();
        if (json.error) {
          summary.errors.push(`${mandal} (chunk ${i / CHUNK_SIZE + 1}): ${json.error}`);
          continue;
        }
        summary.inserted += json.inserted || 0;
        summary.skipped += json.skipped || 0;
        if (json.errors && json.errors.length) summary.errors.push(...json.errors.map(e => `${mandal}: ${e}`));
      } catch (err) {
        summary.errors.push(`${mandal} (chunk ${i / CHUNK_SIZE + 1}): ${err.message}`);
      }
    }
  }

  await db.collection('syncLogs').add({ ranAt: admin.firestore.FieldValue.serverTimestamp(), ...summary });
  return summary;
}

exports.syncFirestoreToGAS = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const volDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!volDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const roleId = volDoc.data().roleRef;
  const roleDoc = await db.collection('roles').doc(roleId).get();
  const permissions = (roleDoc.exists && roleDoc.data().permissions) || [];
  if (!permissions.includes('run_gas_sync')) {
    throw new HttpsError('permission-denied', 'Missing run_gas_sync permission.');
  }
  return runSync();
});

exports.scheduledFirestoreToGASSync = onSchedule('0 3 * * *', async () => {
  await runSync();
});

exports.createVolunteerAccount = require('./createVolunteerAccount').createVolunteerAccount;
