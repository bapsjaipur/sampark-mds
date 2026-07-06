/**
 * migrate-to-firestore.js
 * ─────────────────────────────────────────────────────────────────
 * One-time migration: Book1.xlsx (flat wide sheet) -> Firestore
 * (households + individuals collections)
 *
 * SETUP
 *   npm install firebase-admin xlsx
 *   Download a Service Account key from:
 *     Firebase Console -> Project Settings -> Service Accounts
 *   Save it as ./serviceAccountKey.json (DO NOT commit this file)
 *
 * USAGE
 *   node migrate-to-firestore.js ./Book1.xlsx --dry-run   # inspect only, no writes
 *   node migrate-to-firestore.js ./Book1.xlsx             # actually writes to Firestore
 *
 * IMPORTANT — READ BEFORE RUNNING FOR REAL
 *   The source sheet's column HEADERS from col 18 onward do not match what's
 *   actually stored in those columns (see chat for the discovered mapping).
 *   This script reads by POSITION, not by header text, based on the verified
 *   pattern: repeating 3-column groups of [Mandal, Name, Mobile].
 *   ALWAYS run with --dry-run first and check the printed summary + the
 *   review-needed.json output before writing to your live Firestore project.
 * ─────────────────────────────────────────────────────────────────
 */

const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');

const filePath = process.argv[2];
const isDryRun = process.argv.includes('--dry-run');

if (!filePath) {
  console.error('Usage: node migrate-to-firestore.js <path-to-xlsx> [--dry-run]');
  process.exit(1);
}

// ── Column positions (0-indexed), based on verified data pattern ──────────
const COL = {
  ID: 0,
  MAIN_NAME: 1,
  MAIN_MOBILE: 2,
  MAIN_DOB: 3,
  MAIN_ANNIVERSARY: 4,
  SPOUSE_NAME: 5,
  SPOUSE_MOBILE: 6,
  AREA: 7,
  ADDRESS: 8,
  LEVEL: 9,
  TOTAL_FAMILY_MEMBERS: 10,
  SAMPARK_KARYAKARTA_NAME: 11,
  SAMPARK_KARYAKARTA_NUMBER: 12,
  REMARK: 31,
  PROFILE_PHOTO: 32,
};

// Repeating [Mandal, Name, Mobile, (optional Birth)] groups for extra family members.
// Group 1 includes a birth-date column; groups 2-4 verified to NOT have one;
// group 5 (cols 28-30) mirrors group 1's [Mandal, Name, Mobile] shape.
const MEMBER_GROUPS = [
  { mandal: 13, name: 14, mobile: 15, dob: 16 },
  { mandal: 19, name: 20, mobile: 21, dob: null }, // header said "02 Mandal/Name2" — verified shifted
  { mandal: 22, name: 23, mobile: 24, dob: null }, // header said "03 Mandal/Name3"
  { mandal: 25, name: 26, mobile: 27, dob: null }, // header said "04 Mandal/Name4"
  { mandal: 28, name: 29, mobile: 30, dob: null },
];

const KNOWN_MANDALS = ['Sanyukt', 'Yuvak', 'Yuvati', 'Mahila', 'Bal', 'Balika'];

// ── Helpers ─────────────────────────────────────────────────────────────
function excelDateToISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return null;
}

function toMonthDay(isoDate) {
  if (!isoDate) return null;
  const [, m, d] = isoDate.split('-');
  return `${m}-${d}`;
}

function cleanMobile(val) {
  if (val === null || val === undefined || val === '') return null;
  return String(val).replace(/\D/g, '') || null;
}

function cleanText(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

// Sanity check: does this value look like a Mandal name?
function looksLikeMandal(val) {
  if (!val) return false;
  return KNOWN_MANDALS.some(m => String(val).toLowerCase().includes(m.toLowerCase()));
}

// ── Load workbook ───────────────────────────────────────────────────────
const wb = XLSX.readFile(filePath, { cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

// Row 0 = headers, Row 1 = instructions/example text, Row 2+ = real data
const dataRows = rows.slice(2).filter(r => r && r[COL.MAIN_NAME]);

console.log(`Loaded ${dataRows.length} household rows from ${path.basename(filePath)}`);

const households = [];
const individuals = [];
const reviewNeeded = [];

dataRows.forEach((row, idx) => {
  const householdId = `hh_${idx + 1}`; // deterministic for dry-run inspection; Firestore will assign real IDs on write

  const household = {
    _tempId: householdId,
    legacyId: row[COL.ID] instanceof Date ? row[COL.ID].toISOString() : String(row[COL.ID] || ''),
    address: cleanText(row[COL.ADDRESS]),
    area: cleanText(row[COL.AREA]),
    level: cleanText(row[COL.LEVEL]),
    totalFamilyMembers: row[COL.TOTAL_FAMILY_MEMBERS] || null,
    samparkKaryakartaName: cleanText(row[COL.SAMPARK_KARYAKARTA_NAME]),
    samparkKaryakartaNumber: cleanMobile(row[COL.SAMPARK_KARYAKARTA_NUMBER]),
    remark: cleanText(row[COL.REMARK]),
  };
  households.push(household);

  // Head of household
  if (cleanText(row[COL.MAIN_NAME])) {
    individuals.push(buildIndividual({
      householdId,
      name: row[COL.MAIN_NAME],
      mobile: row[COL.MAIN_MOBILE],
      dob: row[COL.MAIN_DOB],
      anniversary: row[COL.MAIN_ANNIVERSARY],
      mandal: null,
      relation: 'head',
      isPrimary: true,
      profilePhotoRaw: row[COL.PROFILE_PHOTO],
    }));
  }

  // Spouse
  if (cleanText(row[COL.SPOUSE_NAME])) {
    individuals.push(buildIndividual({
      householdId,
      name: row[COL.SPOUSE_NAME],
      mobile: row[COL.SPOUSE_MOBILE],
      dob: null,
      anniversary: row[COL.MAIN_ANNIVERSARY], // shared anniversary field
      mandal: null,
      relation: 'spouse',
      isPrimary: false,
    }));
  }

  // Other family members (repeating groups)
  MEMBER_GROUPS.forEach((g, gIdx) => {
    const name = row[g.name];
    if (!cleanText(name)) return;

    const mandalVal = row[g.mandal];
    const mobileVal = row[g.mobile];

    if (mandalVal !== null && !looksLikeMandal(mandalVal)) {
      reviewNeeded.push({
        householdRow: idx + 3, // +3 = 1-indexed + header + instructions row
        group: gIdx + 1,
        issue: `Mandal slot doesn't look like a known Mandal name`,
        value: mandalVal,
        name,
      });
    }

    individuals.push(buildIndividual({
      householdId,
      name,
      mobile: mobileVal,
      dob: g.dob !== null ? row[g.dob] : null,
      anniversary: null,
      mandal: cleanText(mandalVal),
      relation: 'member',
      isPrimary: false,
    }));
  });
});

function buildIndividual({ householdId, name, mobile, dob, anniversary, mandal, relation, isPrimary, profilePhotoRaw }) {
  const dobISO = excelDateToISO(dob);
  const annivISO = excelDateToISO(anniversary);
  return {
    householdId,
    name: cleanText(name),
    mobile: cleanMobile(mobile),
    dob: dobISO,
    dobMonthDay: toMonthDay(dobISO),
    anniversary: annivISO,
    anniversaryMonthDay: toMonthDay(annivISO),
    mandal: mandal || null,
    relation,
    isPrimary,
    profilePhotoURL: null, // photo upload happens in the React UI (Phase 3), not this migration
    _rawProfilePhotoNote: profilePhotoRaw ? String(profilePhotoRaw) : null,
  };
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\nParsed: ${households.length} households, ${individuals.length} individuals`);
if (reviewNeeded.length) {
  console.log(`⚠️  ${reviewNeeded.length} entries flagged for manual review -> review-needed.json`);
  fs.writeFileSync('review-needed.json', JSON.stringify(reviewNeeded, null, 2));
}

if (isDryRun) {
  fs.writeFileSync('dry-run-households.json', JSON.stringify(households, null, 2));
  fs.writeFileSync('dry-run-individuals.json', JSON.stringify(individuals, null, 2));
  console.log('\nDry run only — wrote dry-run-households.json and dry-run-individuals.json for inspection.');
  console.log('No Firestore writes were made. Review the JSON, fix review-needed.json items if any, then re-run without --dry-run.');
  process.exit(0);
}

// ── Firestore write (only reached without --dry-run) ──────────────────────
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function writeAll() {
  const idMap = {}; // _tempId -> real Firestore householdId
  let batch = db.batch();
  let opCount = 0;

  for (const h of households) {
    const ref = db.collection('households').doc();
    idMap[h._tempId] = ref.id;
    const { _tempId, ...data } = h;
    batch.set(ref, {
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    opCount++;
    if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; }
  }

  for (const ind of individuals) {
    const ref = db.collection('individuals').doc();
    const { _rawProfilePhotoNote, ...data } = ind;
    batch.set(ref, {
      ...data,
      householdId: idMap[ind.householdId],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    opCount++;
    if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; }
  }

  if (opCount > 0) await batch.commit();
  console.log(`\n✅ Wrote ${households.length} households and ${individuals.length} individuals to Firestore.`);
}

writeAll().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
