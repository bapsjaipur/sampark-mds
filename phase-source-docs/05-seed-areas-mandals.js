/**
 * 05-seed-areas-mandals.js
 * ─────────────────────────────────────────────────────────────────
 * Seeds the areas/mandals reference collections from the short-code tables
 * ported from your real Areas/Mandal sheets. Run this BEFORE
 * 04-migrate-real-data.js if you want the dropdowns populated from the
 * start (04 also writes these itself if you pass --codes, so this is
 * mainly for a quick standalone seed without running the full migration).
 *
 * SETUP: npm install firebase-admin (serviceAccountKey.json as usual)
 * USAGE: node 05-seed-areas-mandals.js
 * ─────────────────────────────────────────────────────────────────
 */
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const AREAS = [
  { name: 'Sector -9', code: 'C9' }, { name: 'Chitrakoot Mix', code: 'CM' },
  { name: 'Panchyawala', code: 'PW' }, { name: 'Vaishali Nagar', code: 'VN' },
  { name: 'Govind Nagar', code: 'GN' }, { name: 'Sanjay Nagar', code: 'SN' },
  { name: 'Moti Nagar', code: 'MN' }, { name: 'Sanganer', code: 'SG' },
  { name: 'Amer', code: 'AMR' }, { name: 'Jhotwara', code: 'JW' },
  { name: 'Mansarovar', code: 'MS' }, { name: 'Bindayaka', code: 'BND' },
  { name: 'Jagdishpuri', code: 'JPD' }, { name: 'Old City', code: 'OC' },
  { name: 'Girnar Colony + Mahadev nagar', code: 'GM' }, { name: 'Tonk Road', code: 'TR' },
  { name: 'Other', code: 'OTH' },
];

const MANDALS = [
  { name: 'Sanyukt Mandal', code: 'SM' }, { name: 'Yuvak Mandal', code: 'YM' },
  { name: 'Yuvati Mandal', code: 'YTM' }, { name: 'Bal Mandal', code: 'BM' },
  { name: 'Balika Mandal', code: 'BLM' }, { name: 'Haribhakt 1', code: 'HB1' },
  { name: 'Haribhakt 2', code: 'HB2' },
];

async function seed() {
  const batch = db.batch();
  AREAS.forEach((a) => batch.set(db.collection('areas').doc(), a));
  MANDALS.forEach((m) => batch.set(db.collection('mandals').doc(), m));
  await batch.commit();
  console.log(`Seeded ${AREAS.length} areas and ${MANDALS.length} mandals.`);
}

seed().catch((err) => { console.error(err); process.exit(1); });
