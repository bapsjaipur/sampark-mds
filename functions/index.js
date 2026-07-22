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
const archiver = require('archiver');
const unzipper = require('unzipper');
const { Readable } = require('stream');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function createZipArchive(options) {
  if (typeof archiver === 'function') {
    return archiver('zip', options);
  } else if (archiver && archiver.ZipArchive) {
    return new archiver.ZipArchive(options);
  } else {
    throw new Error('Unsupported archiver module structure');
  }
}

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
  // Same guard as createVolunteerAccount.js: doc(undefined) throws a raw
  // (non-HttpsError) error when the caller has no roleRef, which Functions
  // then reports to the client as an opaque "internal" error.
  const roleDoc = roleId ? await db.collection('roles').doc(roleId).get() : null;
  const permissions = (roleDoc?.exists && roleDoc.data().permissions) || [];
  if (!permissions.includes('run_gas_sync')) {
    throw new HttpsError('permission-denied', 'Missing run_gas_sync permission.');
  }
  return runSync();
});

exports.scheduledFirestoreToGASSync = onSchedule('0 3 * * *', async () => {
  await runSync();
});

exports.createVolunteerAccount = require('./createVolunteerAccount').createVolunteerAccount;

exports.backupDatabase = onCall({ region: 'us-central1', maxInstances: 1, timeoutSeconds: 540 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const volDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!volDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const roleDoc = volDoc.data().roleRef ? await db.collection('roles').doc(volDoc.data().roleRef).get() : null;
  const permissions = (roleDoc?.exists && roleDoc.data().permissions) || [];
  if (!permissions.includes('manage_users')) {
    throw new HttpsError('permission-denied', 'Missing manage_users permission.');
  }

  const { includePhotos } = request.data || {};

  // 1. Get all collections
  console.log('Fetching collections...');
  const collections = await db.listCollections();
  const data = {};
  for (const collection of collections) {
    const snap = await collection.get();
    data[collection.id] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  console.log(`Fetched ${Object.keys(data).length} collections.`);

  const bucket = admin.storage().bucket();
  const fileName = `backups/backup-${Date.now()}${includePhotos ? '-full' : ''}.zip`;
  const file = bucket.file(fileName);
  console.log(`Creating backup: ${fileName}`);

  // 2. Create ZIP stream
  await new Promise((resolve, reject) => {
    const writeStream = file.createWriteStream({ contentType: 'application/zip' });
    const archive = createZipArchive({ zlib: { level: 9 } });

    writeStream.on('close', resolve);
    archive.on('error', reject);
    archive.on('warning', err => console.warn(err));

    archive.pipe(writeStream);

    // Add firestore.json
    archive.append(JSON.stringify(data, null, 2), { name: 'firestore.json' });

    // 3. Add Storage Files (if requested)
    if (includePhotos) {
      bucket.getFiles().then(([files]) => {
        for (const f of files) {
          // Skip backup directory itself to prevent recursive blooming backups
          if (f.name.startsWith('backups/')) continue;
          // Pipe each file into the archive
          archive.append(f.createReadStream(), { name: `storage/${f.name}` });
        }
        archive.finalize();
      }).catch(reject);
    } else {
      archive.finalize();
    }
  });

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60, // 1 hour
  });

  return { downloadUrl: url };
});

exports.restoreDatabase = onCall({ region: 'us-central1', maxInstances: 1, timeoutSeconds: 540 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const volDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!volDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const roleDoc = volDoc.data().roleRef ? await db.collection('roles').doc(volDoc.data().roleRef).get() : null;
  const permissions = (roleDoc?.exists && roleDoc.data().permissions) || [];
  if (!permissions.includes('manage_users')) {
    throw new HttpsError('permission-denied', 'Missing manage_users permission.');
  }

  const { filePath } = request.data || {};
  if (!filePath) throw new HttpsError('invalid-argument', 'filePath is required.');

  const bucket = admin.storage().bucket();
  const file = bucket.file(filePath);
  const exists = await file.exists();
  if (!exists[0]) throw new HttpsError('not-found', 'Backup file not found.');

  // Parse ZIP using unzipper.Open.buffer
  const [zipBuffer] = await file.download();
  const directory = await unzipper.Open.buffer(zipBuffer);
  let firestoreData = null;
  const storageFilesToRestore = [];

  for (const entry of directory.files) {
    const name = entry.path;
    if (name === 'firestore.json') {
      const contentBuffer = await entry.buffer();
      firestoreData = JSON.parse(contentBuffer.toString('utf8'));
    } else if (name.startsWith('storage/')) {
      const storagePath = name.substring('storage/'.length);
      if (storagePath && !storagePath.endsWith('/')) {
        const contentBuffer = await entry.buffer();
        storageFilesToRestore.push({ path: storagePath, buffer: contentBuffer });
      }
    }
  }

  if (!firestoreData) {
    throw new HttpsError('invalid-argument', 'Invalid backup: missing firestore.json');
  }

  // Clear existing collections
  const collections = await db.listCollections();
  for (const col of collections) {
    let finished = false;
    while (!finished) {
      const snap = await col.limit(200).get();
      if (snap.size === 0) {
        finished = true;
        break;
      }
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  // Restore collections
  for (const [colName, docs] of Object.entries(firestoreData)) {
    const colRef = db.collection(colName);
    const CHUNK = 200;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const chunk = docs.slice(i, i + CHUNK);
      const batch = db.batch();
      chunk.forEach(d => {
        const { id, ...rest } = d;
        const docPayload = {};
        for (const [k, v] of Object.entries(rest)) {
          if (v && typeof v === 'object' && v._seconds !== undefined && v._nanoseconds !== undefined) {
            docPayload[k] = new admin.firestore.Timestamp(v._seconds, v._nanoseconds);
          } else {
            docPayload[k] = v;
          }
        }
        batch.set(colRef.doc(id), docPayload);
      });
      await batch.commit();
    }
  }

  // Clean Storage first if restore contained photos (skip archives)
  if (storageFilesToRestore.length > 0) {
    const [allStorageFiles] = await bucket.getFiles();
    for (const f of allStorageFiles) {
      if (f.name.startsWith('backups/')) continue;
      await f.delete();
    }
    // Restore Storage files
    for (const item of storageFilesToRestore) {
      const targetFile = bucket.file(item.path);
      await targetFile.save(item.buffer);
    }
  }

  // Remove temp restore file
  await file.delete().catch(() => {});

  return { success: true };
});
