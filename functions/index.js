/**
 * functions/index.js
 * ─────────────────────────────────────────────────────────────────
 * Cloud Functions entry point: volunteer account management, the
 * backup/restore pair, and the Phase 20 email jobs.
 *
 * The Google Sheets mirror (runSync / syncFirestoreToGAS /
 * scheduledFirestoreToGASSync, plus the GAS_WEBAPP_URL env var and the
 * node-fetch dependency) was removed — backup/restore covers the same need
 * without a second copy of the data living outside Firestore.
 *
 * DELETING THE SOURCE IS NOT ENOUGH. A deployed function keeps running until it
 * is torn down in the project, so `scheduledFirestoreToGASSync` carries on
 * firing its Cloud Scheduler job at 03:00 IST every night, failing against a URL
 * that no longer exists. Tear it down explicitly — a plain
 * `firebase deploy --only functions` prompts before deleting and is easy to skip:
 *   firebase functions:delete scheduledFirestoreToGASSync syncFirestoreToGAS runSync --region us-central1 --force
 * Functions that were never deployed are reported as not found, which is fine.
 * ─────────────────────────────────────────────────────────────────
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { Readable } = require('stream');
const { permissionsForVolunteer } = require('./lib/callerAccess');

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

exports.createVolunteerAccount = require('./createVolunteerAccount').createVolunteerAccount;
exports.updateVolunteerAccount = require('./updateVolunteerAccount').updateVolunteerAccount;
exports.deleteVolunteerAccount = require('./deleteVolunteerAccount').deleteVolunteerAccount;
// PHASE 22 — two callables, one file. resetVolunteerPassword is admin-only and is
// the ONLY thing that can change a password; requestPasswordReset is the
// unauthenticated "I'm locked out" endpoint and changes nothing. The old
// self-service reset-to-your-own-phone-number behaviour is gone — see the header
// of resetVolunteerPassword.js for why it was an account-takeover hole.
exports.resetVolunteerPassword = require('./resetVolunteerPassword').resetVolunteerPassword;
exports.requestPasswordReset = require('./resetVolunteerPassword').requestPasswordReset;

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 20 — email automation, ported from Sevak Call's Apps Script triggers.
// Three scheduled reports plus two callables for the admin screen. Mail is
// delivered by the Firebase "Trigger Email from Firestore" extension, which
// must be installed and pointed at the `mail` collection — see
// functions/lib/mailer.js. Until it is, sends are recorded in emailLogs and
// nothing leaves the building.
// ─────────────────────────────────────────────────────────────────────────────
const emailJobs = require('./emailJobs');
exports.scheduledDailyReport = emailJobs.scheduledDailyReport;
exports.scheduledPostSabhaReports = emailJobs.scheduledPostSabhaReports;
exports.scheduledBirthdaySummary = emailJobs.scheduledBirthdaySummary;
exports.sendManualEmail = emailJobs.sendManualEmail;
exports.previewEmailRecipients = emailJobs.previewEmailRecipients;

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 33 — recurring sabhas. Sunday 04:07 IST, materialises the next four
// weeks of every active sabhaSchedules rule as ordinary events/{id} documents.
// The All Area Sabhas screen has a button that does the same thing on demand;
// both write the SAME derived id, so neither can duplicate the other's work.
//
// The digest is the other half: Monday 07:12 IST it reports on the weeks that
// have finished — which area's sabha happened, which didn't, and who has now
// missed two in a row. Generating the calendar is only useful if somebody is
// told when the calendar and reality stop agreeing.
// ─────────────────────────────────────────────────────────────────────────────
exports.scheduledSabhaGeneration = require('./sabhaScheduler').scheduledSabhaGeneration;
exports.scheduledSabhaDigest = require('./sabhaDigest').scheduledSabhaDigest;

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 35 — birthday & anniversary reminders as a subscribable calendar feed.
// Each volunteer pastes one private URL into Google/Apple Calendar and every
// contact THEY are responsible for appears as a yearly all-day event. The dataset
// is precomputed to Cloud Storage once a day (rebuildCalendarCache) so serving a
// feed costs a handful of reads, not a full scan — see functions/calendarSync.js.
// ─────────────────────────────────────────────────────────────────────────────
const calendarSync = require('./calendarSync');
exports.rebuildCalendarCache = calendarSync.rebuildCalendarCache;
exports.calendarFeed = calendarSync.calendarFeed;
exports.getMyCalendarFeed = calendarSync.getMyCalendarFeed;
exports.rebuildCalendarCacheNow = calendarSync.rebuildCalendarCacheNow;

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 36 — WhatsApp Cloud API sender (Meta Graph API). The wa.me links in the
// app need a human to press send; these callables post through Meta with no human
// in the loop, configured entirely from the admin panel. The access token lives
// in the server-only whatsappConfig/cloud doc, never in a browser or in source —
// see functions/whatsappCloud.js.
// ─────────────────────────────────────────────────────────────────────────────
const whatsappCloud = require('./whatsappCloud');
exports.getWhatsAppCloudStatus = whatsappCloud.getWhatsAppCloudStatus;
exports.saveWhatsAppCloudConfig = whatsappCloud.saveWhatsAppCloudConfig;
exports.sendWhatsAppCloudMessage = whatsappCloud.sendWhatsAppCloudMessage;

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 37 — per-user Google Calendar push (OAuth 2.0). The instant, editable
// upgrade over the read-only ICS feed: each volunteer connects their own Google
// account once and presses "Sync now" to write their in-scope birthdays straight
// into their calendar, updated in place (never duplicated). The OAuth client
// secret and each volunteer's refresh token live in server-only collections —
// see functions/googleCalendar.js. googleOAuthCallback is a public HTTP endpoint
// (Google redirects the browser to it); the rest are callables.
// ─────────────────────────────────────────────────────────────────────────────
const googleCalendar = require('./googleCalendar');
exports.getGoogleCalendarStatus = googleCalendar.getGoogleCalendarStatus;
exports.saveGoogleCalendarConfig = googleCalendar.saveGoogleCalendarConfig;
exports.startGoogleCalendarAuth = googleCalendar.startGoogleCalendarAuth;
exports.googleOAuthCallback = googleCalendar.googleOAuthCallback;
exports.syncMyGoogleCalendar = googleCalendar.syncMyGoogleCalendar;
exports.disconnectGoogleCalendar = googleCalendar.disconnectGoogleCalendar;

exports.backupDatabase = onCall({ region: 'us-central1', maxInstances: 1, timeoutSeconds: 540 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const volDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!volDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  // PHASE 21 — union across every role the caller holds (roleRefs[]), not just
  // the legacy single roleRef. See lib/callerAccess.js.
  const permissions = await permissionsForVolunteer(db, volDoc.data());
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
  // PHASE 21 — union across every role the caller holds (roleRefs[]), not just
  // the legacy single roleRef. See lib/callerAccess.js.
  const permissions = await permissionsForVolunteer(db, volDoc.data());
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
