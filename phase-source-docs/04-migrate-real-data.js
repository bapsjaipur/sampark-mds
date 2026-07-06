/**
 * 04-migrate-real-data.js
 * ─────────────────────────────────────────────────────────────────
 * One-time migration of your REAL data (BAPS_All_Sampark_Web_Automation_
 * Testing.xlsx + YM_Mandal_Test.xlsx) into Firestore. Supersedes
 * 03-migrate-legacy-contacts.js (which assumed CSV exports of the
 * Backup_<Mandal> tabs) — this reads the .xlsx workbooks directly.
 *
 * WHAT GETS IMPORTED
 *   - areas, mandals        <- Areas / Mandal sheets (short codes)
 *   - households/individuals <- Backup_<Mandal> sheets (per-person, same
 *     household-of-one approach as before — no family link in source data)
 *   - events                <- Events sheet (YM_Mandal_Test.xlsx)
 *   - attendance             <- Sabha_<date>_<slug> columns in Backup_<Mandal>
 *     sheets, cross-referenced against Events' Column_Name to find the
 *     matching event
 *
 * WHAT IS DELIBERATELY NOT AUTO-IMPORTED
 *   - Volunteers sheet (985 rows). It's mostly test/placeholder data
 *     ("XYZ", "Test...") with PLAINTEXT passwords in the spreadsheet.
 *     Auto-creating Firebase Auth accounts from that would carry those weak
 *     test passwords into production. Instead, this script writes
 *     volunteers-to-review.csv — a cleaned summary (name, assigned Mandal/
 *     area, role) for you to recreate through the app's real "Create new
 *     volunteer login" form (/admin/volunteers) with fresh passwords.
 *   - Activity sheet (2434 rows, keyed by volunteer/contact NAME strings,
 *     not IDs). Historical audit trail, not needed for the app to function
 *     going forward — flagged here in case you want a separate one-off
 *     import later, but skipped by default to keep this script's scope
 *     manageable.
 *
 * IMPORTANT — Yuvak Mandal has data in TWO places that overlap:
 *   YM_Mandal_Test.xlsx's "Contacts" sheet (1981 rows) appears to be the
 *   more complete/current one; BAPS_All_Sampark...xlsx's "Backup_Yuvak
 *   Mandal" tab (1264 rows) looks like an earlier snapshot. Pass ONLY ONE
 *   of these two for Yuvak to avoid duplicate people — see USAGE. The
 *   script also warns on duplicate phone numbers across whatever you do
 *   pass, as a safety net.
 *
 * SETUP
 *   npm install firebase-admin xlsx
 *   Service account key as ./serviceAccountKey.json
 *
 * USAGE
 *   node 04-migrate-real-data.js --dry-run \
 *     --sanyukt BAPS_All_Sampark_Web_Automation_Testing.xlsx \
 *     --bal BAPS_All_Sampark_Web_Automation_Testing.xlsx \
 *     --yuvak YM_Mandal_Test.xlsx \
 *     --events YM_Mandal_Test.xlsx
 *
 *   (drop --dry-run to actually write once you've reviewed the output)
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const XLSX = require('xlsx');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const isDryRun = process.argv.includes('--dry-run');

const SOURCES = {
  'Sanyukt Mandal': { file: argVal('--sanyukt'), sheet: 'Backup_Sanyukt Mandal' },
  'Bal Mandal': { file: argVal('--bal'), sheet: 'Backup_Bal Mandal' },
  'Yuvak Mandal': { file: argVal('--yuvak'), sheet: null }, // sheet auto-detected below (Contacts or Backup_Yuvak Mandal)
};
const EVENTS_FILE = argVal('--events');
const AREAS_MANDALS_FILE = argVal('--codes') || SOURCES['Sanyukt Mandal'].file; // Areas/Mandal sheets live in the "All Sampark" workbook

const KNOWN_STATUSES = ['Interested', 'Not Interested', 'Call Back Later', 'No Answer', 'Already Volunteer', 'Donated', 'Follow Up'];

function cleanText(v) { if (v === null || v === undefined) return null; const s = String(v).trim(); return s === '' ? null : s; }
function cleanMobile(v) { if (!v) return null; const d = String(v).replace(/\D/g, ''); return d.length === 10 ? d : (d.length > 10 ? d.slice(-10) : null); }
function dateToISO(v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]; }
function toMonthDay(iso) { if (!iso) return null; const [, m, d] = iso.split('-'); return `${m}-${d}`; }
function normalizeStatus(raw) { const v = cleanText(raw); if (!v) return ''; const m = KNOWN_STATUSES.find((s) => s.toLowerCase() === v.toLowerCase()); return m || v; }

// ── Areas / Mandals ─────────────────────────────────────────────────────
const areas = [];
const mandals = [];
if (AREAS_MANDALS_FILE) {
  const wb = XLSX.readFile(AREAS_MANDALS_FILE);
  if (wb.Sheets['Areas']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Areas']);
    rows.forEach((r) => { if (r.Area && r.Code) areas.push({ name: cleanText(r.Area), code: cleanText(r.Code) }); });
  }
  if (wb.Sheets['Mandal']) {
    // Mandal sheet's real layout is two side-by-side [Mandal,Code] column
    // pairs (cols A-B and C-D) — read as arrays, not columns:sheet_to_json.
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Mandal'], { header: 1 });
    raw.slice(1).forEach((row) => {
      if (row[0] && row[1]) mandals.push({ name: cleanText(row[0]), code: cleanText(row[1]) });
      if (row[2] && row[3]) mandals.push({ name: cleanText(row[2]), code: cleanText(row[3]) });
    });
  }
}
console.log(`Areas: ${areas.length}, Mandals: ${mandals.length}`);

// ── Households / Individuals ────────────────────────────────────────────
const households = [];
const individuals = [];
const reviewNeeded = [];
const phoneSeen = new Map();
let seq = 1;

for (const [mandalLabel, src] of Object.entries(SOURCES)) {
  if (!src.file) continue;
  const wb = XLSX.readFile(src.file);
  let sheetName = src.sheet;
  if (!sheetName) {
    sheetName = wb.SheetNames.includes('Contacts') ? 'Contacts' : wb.SheetNames.find((n) => n.startsWith('Backup_'));
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) { console.warn(`\u26a0\ufe0f  Sheet "${sheetName}" not found in ${src.file} for ${mandalLabel} \u2014 skipped.`); continue; }

  // Backup_ sheets have a title row before the real header row; Contacts sheets don't.
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const headerRowIdx = raw.findIndex((r) => r[0] === 'ID' && r[1] === 'Name');
  if (headerRowIdx === -1) { console.warn(`\u26a0\ufe0f  Couldn't find the header row in ${sheetName} \u2014 skipped.`); continue; }
  const headers = raw[headerRowIdx];
  const dataRows = raw.slice(headerRowIdx + 1);

  const col = (name) => headers.indexOf(name);
  const sabhaColumns = headers
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) => typeof h === 'string' && h.startsWith('Sabha_'));

  console.log(`${mandalLabel} (${sheetName} in ${src.file}): ${dataRows.length} rows, ${sabhaColumns.length} Sabha attendance columns`);

  dataRows.forEach((row) => {
    const name = cleanText(row[col('Name')]);
    if (!name) return;

    const mobile = cleanMobile(row[col('Phone')]);
    if (mobile) {
      if (phoneSeen.has(mobile)) {
        reviewNeeded.push({ issue: 'duplicate_phone', mobile, name, mandal: mandalLabel, firstSeenAs: phoneSeen.get(mobile) });
      } else {
        phoneSeen.set(mobile, `${name} (${mandalLabel})`);
      }
    }

    const legacyId = cleanText(row[col('ID')]) || `legacy-${seq}`;
    const householdId = `hh_${seq}`;
    const dobISO = dateToISO(row[col('DOB')]);

    households.push({
      _tempId: householdId,
      address: cleanText(row[col('Complete_Address')]),
      area: cleanText(row[col('Area')]),
      level: null,
      totalFamilyMembers: 1,
      samparkKaryakartaName: cleanText(row[col('Assigned_To')]),
      samparkKaryakartaNumber: null,
      remark: cleanText(row[col('Note')]),
      legacyId,
    });

    const individualTempId = `ind_${seq}`;
    individuals.push({
      _tempId: individualTempId,
      householdId,
      name,
      mobile,
      dob: dobISO,
      dobMonthDay: toMonthDay(dobISO),
      anniversary: null,
      anniversaryMonthDay: null,
      mandal: mandalLabel,
      relation: 'head',
      isPrimary: true,
      profilePhotoURL: null,
      status: normalizeStatus(row[col('Status')]),
      reference: cleanText(row[col('Reference')]) || '',
      callCount: Number(row[col('Call_Count')]) || 0,
      legacyExtra: {
        study: cleanText(row[col('Study')]),
        profession: cleanText(row[col('Profession')]),
        skill: cleanText(row[col('Skill')]),
        assignedTo: cleanText(row[col('Assigned_To')]),
        batchNumber: cleanText(row[col('Batch_Number')]),
        legacyCode: legacyId,
      },
      _attendance: sabhaColumns
        .filter(({ idx }) => row[idx] === 'Present')
        .map(({ h }) => h), // column names, resolved to real events below
    });

    seq++;
  });
}

console.log(`\nParsed: ${households.length} households, ${individuals.length} individuals`);

// ── Events (from the Events sheet, if provided) ─────────────────────────
const events = [];
if (EVENTS_FILE) {
  const wb = XLSX.readFile(EVENTS_FILE);
  if (wb.Sheets['Events']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Events']);
    rows.forEach((r, i) => {
      if (!r.Title) return;
      const dateISO = dateToISO(r.Date);
      let time = '19:00';
      if (r.Time instanceof Date) time = `${String(r.Time.getHours()).padStart(2, '0')}:${String(r.Time.getMinutes()).padStart(2, '0')}`;
      events.push({
        _tempId: `evt_${i + 1}`,
        title: cleanText(r.Title),
        date: dateISO,
        time,
        durationMinutes: Number(r.Duration_Min) || 120,
        speaker: cleanText(r.Speaker) || '',
        mandal: null,
        area: null,
        _columnName: cleanText(r.Column_Name), // links back to the Sabha_* columns above
      });
    });
  }
}
console.log(`Events: ${events.length}`);

// ── Attendance: resolve each individual's Sabha_* columns against events ──
const attendance = [];
const eventByColumn = new Map(events.map((e) => [e._columnName, e]));
individuals.forEach((ind) => {
  (ind._attendance || []).forEach((columnName) => {
    const event = eventByColumn.get(columnName);
    if (event) {
      attendance.push({ _individualTempId: ind._tempId, _eventTempId: event._tempId });
    } else {
      reviewNeeded.push({ issue: 'attendance_column_no_matching_event', columnName, individual: ind.name });
    }
  });
  delete ind._attendance;
});
console.log(`Attendance records resolved: ${attendance.length}`);

// ── Volunteers: NOT auto-created — write a review CSV instead ───────────
if (AREAS_MANDALS_FILE) {
  const wb = XLSX.readFile(AREAS_MANDALS_FILE);
  if (wb.Sheets['Volunteers']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Volunteers']);
    const real = rows.filter((r) => {
      const n = String(r.Name || '').toLowerCase();
      return r.Name && !n.includes('test') && !n.includes('xyz') && r.Status === 'active';
    });
    const csvLines = ['Name,Role,Assigned_Mandals,Assigned_Area'];
    real.forEach((r) => csvLines.push([r.Name, r.Role, r.Assigned_Mandals || '', r.Assigned_Area || ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    fs.writeFileSync('volunteers-to-review.csv', csvLines.join('\n'));
    console.log(`\n\u26a0\ufe0f  ${real.length} non-test volunteers found \u2014 wrote volunteers-to-review.csv.`);
    console.log('   Recreate these through /admin/volunteers with real phone numbers + fresh passwords \u2014 NOT auto-imported (source had plaintext test passwords).');
  }
}

// ── Review file + dry run output ─────────────────────────────────────────
if (reviewNeeded.length) {
  fs.writeFileSync('real-data-migration-review.json', JSON.stringify(reviewNeeded, null, 2));
  console.log(`\n\u26a0\ufe0f  ${reviewNeeded.length} items flagged \u2192 real-data-migration-review.json`);
}

if (isDryRun) {
  fs.writeFileSync('dry-run-areas.json', JSON.stringify(areas, null, 2));
  fs.writeFileSync('dry-run-mandals.json', JSON.stringify(mandals, null, 2));
  fs.writeFileSync('dry-run-households.json', JSON.stringify(households, null, 2));
  fs.writeFileSync('dry-run-individuals.json', JSON.stringify(individuals, null, 2));
  fs.writeFileSync('dry-run-events.json', JSON.stringify(events, null, 2));
  fs.writeFileSync('dry-run-attendance.json', JSON.stringify(attendance, null, 2));
  console.log('\nDry run only \u2014 review the dry-run-*.json files, then re-run without --dry-run.');
  process.exit(0);
}

// ── Firestore write ───────────────────────────────────────────────────
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function writeAll() {
  let batch = db.batch();
  let opCount = 0;
  const commitIfNeeded = async () => { opCount++; if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; } };

  for (const a of areas) { const ref = db.collection('areas').doc(); batch.set(ref, a); await commitIfNeeded(); }
  for (const m of mandals) { const ref = db.collection('mandals').doc(); batch.set(ref, m); await commitIfNeeded(); }

  const householdIdMap = {};
  for (const h of households) {
    const ref = db.collection('households').doc();
    householdIdMap[h._tempId] = ref.id;
    const { _tempId, ...data } = h;
    batch.set(ref, { ...data, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await commitIfNeeded();
  }

  const individualIdMap = {};
  for (const ind of individuals) {
    const ref = db.collection('individuals').doc();
    individualIdMap[ind._tempId] = ref.id;
    const { _tempId, ...data } = ind;
    batch.set(ref, { ...data, householdId: householdIdMap[ind.householdId], createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await commitIfNeeded();
  }

  const eventIdMap = {};
  for (const e of events) {
    const ref = db.collection('events').doc();
    eventIdMap[e._tempId] = ref.id;
    const { _tempId, _columnName, ...data } = e;
    batch.set(ref, { ...data, createdBy: 'migration-script', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await commitIfNeeded();
  }

  for (const att of attendance) {
    const eventId = eventIdMap[att._eventTempId];
    const individualId = individualIdMap[att._individualTempId];
    if (!eventId || !individualId) continue;
    const ref = db.collection('attendance').doc(`${eventId}_${individualId}`);
    batch.set(ref, { eventId, individualId, status: 'present', markedBy: 'migration-script', markedAt: admin.firestore.FieldValue.serverTimestamp() });
    await commitIfNeeded();
  }

  if (opCount > 0) await batch.commit();
  console.log(`\n\u2705 Wrote ${areas.length} areas, ${mandals.length} mandals, ${households.length} households, ${individuals.length} individuals, ${events.length} events, ${attendance.length} attendance records.`);
}

writeAll().catch((err) => { console.error('Migration failed:', err); process.exit(1); });
