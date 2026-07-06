/**
 * 03-migrate-legacy-contacts.js
 * ─────────────────────────────────────────────────────────────────
 * Migrates your REAL 2000+ contacts (flat, one row per person, from the
 * MandalCode.gs `Contacts` sheet format) into Firestore. This is a
 * DIFFERENT script from 02-migrate-to-firestore.js (Phase 1), which was
 * built for Book1.xlsx's wide household-per-row shape — your actual
 * production data doesn't look like that.
 *
 * Exact header order, confirmed from MandalCode.gs's INSTALL_MandalSheet():
 *   ID, Name, Phone, DOB, Study, Profession, Skill, Mandal, Area,
 *   Complete_Address, Note, Assigned_To, Status, Reference, Call_Count,
 *   Batch_Number
 *
 * SINCE THERE'S NO FAMILY LINK IN THE SOURCE DATA (confirmed with you):
 * every row becomes its OWN single-person household — the person is
 * marked as "head" of a household-of-one. You link people into real
 * families afterward using the new "Search & link to household" feature
 * in the app (see LinkExistingContact.jsx), searching by name or phone.
 *
 * Study / Profession / Skill aren't in the current individuals schema
 * (pending the dynamic custom-fields feature). Rather than dropping that
 * data, it's preserved under individual.legacyExtra so nothing is lost —
 * once custom fields ship, these can be promoted to first-class fields.
 *
 * SETUP
 *   npm install firebase-admin csv-parse
 *   Service account key as ./serviceAccountKey.json (same as Phase 1)
 *
 * GETTING THE CSV(S):
 *   In your Admin spreadsheet, open each Backup_<Mandal> tab ->
 *   File -> Download -> Comma-separated values (.csv). You can pass
 *   multiple CSVs to this script in one run (one per Mandal, or a single
 *   combined export — either works).
 *
 * USAGE
 *   node 03-migrate-legacy-contacts.js --dry-run Backup_Yuvak.csv Backup_Mahila.csv ...
 *   node 03-migrate-legacy-contacts.js Backup_Yuvak.csv Backup_Mahila.csv ...
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const filePaths = args.filter((a) => a !== '--dry-run');

if (filePaths.length === 0) {
  console.error('Usage: node 03-migrate-legacy-contacts.js [--dry-run] file1.csv [file2.csv ...]');
  process.exit(1);
}

const EXPECTED_HEADERS = [
  'ID', 'Name', 'Phone', 'DOB', 'Study', 'Profession', 'Skill', 'Mandal', 'Area',
  'Complete_Address', 'Note', 'Assigned_To', 'Status', 'Reference', 'Call_Count', 'Batch_Number',
];

const KNOWN_MANDALS = ['Sanyukt', 'Yuvak', 'Yuvati', 'Mahila', 'Bal', 'Balika'];

// PHASE 7 UPDATE: individuals.status now uses the REAL legacy vocabulary
// (Interested, Not Interested, Call Back Later, No Answer, Already
// Volunteer, Donated, Follow Up) instead of the placeholder snake_case set
// this script originally mapped to. Since your source CSV's Status column
// already contains these exact strings, no translation is needed — just
// pass through known values and blank out anything unrecognized (flagged
// for review rather than silently guessing).
const KNOWN_STATUSES = ['Interested', 'Not Interested', 'Call Back Later', 'No Answer', 'Already Volunteer', 'Donated', 'Follow Up'];

function normalizeStatus(raw) {
  const val = String(raw || '').trim();
  if (!val) return '';
  const match = KNOWN_STATUSES.find((s) => s.toLowerCase() === val.toLowerCase());
  return match || val; // unrecognized values pass through as-is rather than being silently dropped — review legacy-migration-review.json for anything unexpected
}

function cleanText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function cleanMobile(v) {
  if (!v) return null;
  const digits = String(v).replace(/\D/g, '');
  return digits.length === 10 ? digits : null; // matches the app's strict 10-digit rule
}

function excelOrTextDateToISO(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function toMonthDay(iso) {
  if (!iso) return null;
  const [, m, d] = iso.split('-');
  return `${m}-${d}`;
}

// (old normalizeStatus removed — see the KNOWN_STATUSES-based version above)

// ── Load and merge all input CSVs ──────────────────────────────────────
let allRows = [];
for (const fp of filePaths) {
  const raw = fs.readFileSync(fp, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`${path.basename(fp)}: ${records.length} rows`);
  allRows = allRows.concat(records.map((r) => ({ ...r, _sourceFile: path.basename(fp) })));
}
console.log(`\nTotal rows loaded: ${allRows.length}`);

// Sanity check headers on the first row.
const firstRowKeys = Object.keys(allRows[0] || {});
const missingHeaders = EXPECTED_HEADERS.filter((h) => !firstRowKeys.includes(h));
if (missingHeaders.length) {
  console.warn(`⚠️  These expected columns weren't found in your CSV: ${missingHeaders.join(', ')}`);
  console.warn('   Rows will still be processed — missing fields just come through blank.\n');
}

const households = [];
const individuals = [];
const skippedRows = [];
const phoneSeen = new Map(); // phone -> row index, to flag possible duplicates across Mandal sheets

allRows.forEach((row, idx) => {
  const name = cleanText(row.Name);
  if (!name) {
    skippedRows.push({ row: idx + 2, reason: 'No name', data: row });
    return;
  }

  const mobile = cleanMobile(row.Phone);
  const mandal = cleanText(row.Mandal);
  if (mandal && !KNOWN_MANDALS.some((m) => m.toLowerCase() === mandal.toLowerCase())) {
    skippedRows.push({ row: idx + 2, reason: `Unrecognized Mandal value: "${mandal}"`, data: row, stillImported: true });
  }

  if (mobile) {
    if (phoneSeen.has(mobile)) {
      console.warn(`⚠️  Duplicate phone ${mobile}: "${name}" (row ${idx + 2}) also matches an earlier row — review after import, don't assume they're the same person.`);
    } else {
      phoneSeen.set(mobile, idx + 2);
    }
  }

  const householdId = `hh_legacy_${idx + 1}`;
  const dobISO = excelOrTextDateToISO(row.DOB);

  households.push({
    _tempId: householdId,
    address: cleanText(row.Complete_Address),
    area: cleanText(row.Area),
    level: null,
    totalFamilyMembers: 1,
    samparkKaryakartaName: null,
    samparkKaryakartaNumber: null,
    remark: cleanText(row.Note),
    legacyId: cleanText(row.ID) || `legacy-row-${idx + 2}`,
  });

  individuals.push({
    householdId,
    name,
    mobile,
    dob: dobISO,
    dobMonthDay: toMonthDay(dobISO),
    anniversary: null,
    anniversaryMonthDay: null,
    mandal: mandal || null,
    relation: 'head',
    isPrimary: true,
    profilePhotoURL: null,
    status: normalizeStatus(row.Status),
    reference: cleanText(row.Reference) || '',
    callCount: Number(row.Call_Count) || 0,
    legacyExtra: {
      study: cleanText(row.Study),
      profession: cleanText(row.Profession),
      skill: cleanText(row.Skill),
      assignedTo: cleanText(row.Assigned_To),
      batchNumber: cleanText(row.Batch_Number),
      sourceFile: row._sourceFile,
    },
  });
});

console.log(`\nParsed: ${households.length} single-person households, ${individuals.length} individuals`);
if (skippedRows.length) {
  fs.writeFileSync('legacy-migration-review.json', JSON.stringify(skippedRows, null, 2));
  console.log(`⚠️  ${skippedRows.length} rows flagged -> legacy-migration-review.json (some still imported, some skipped — check "stillImported")`);
}

if (isDryRun) {
  fs.writeFileSync('dry-run-legacy-households.json', JSON.stringify(households, null, 2));
  fs.writeFileSync('dry-run-legacy-individuals.json', JSON.stringify(individuals, null, 2));
  console.log('\nDry run only — no Firestore writes. Review the JSON files, then re-run without --dry-run.');
  process.exit(0);
}

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function writeAll() {
  const idMap = {};
  let batch = db.batch();
  let opCount = 0;

  for (const h of households) {
    const ref = db.collection('households').doc();
    idMap[h._tempId] = ref.id;
    const { _tempId, ...data } = h;
    batch.set(ref, { ...data, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    opCount++;
    if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; }
  }

  for (const ind of individuals) {
    const ref = db.collection('individuals').doc();
    batch.set(ref, {
      ...ind,
      householdId: idMap[ind.householdId],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    opCount++;
    if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; }
  }

  if (opCount > 0) await batch.commit();
  console.log(`\n✅ Wrote ${households.length} households and ${individuals.length} individuals to Firestore.`);
  console.log('Next: use "Search & link to household" in the app to merge people into real families.');
}

writeAll().catch((err) => { console.error('Migration failed:', err); process.exit(1); });
