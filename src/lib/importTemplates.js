// src/lib/importTemplates.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 25 — "when import then there should be guide and sample template it will
// help for importing data".
//
// One file holds the column contract for both importers, and both the on-screen
// guide and the downloadable .xlsx are generated FROM IT. That is the whole
// point: a hand-written help panel drifts from the mapper the first time a field
// is added, and the person following it then produces a file the app silently
// ignores. Here, adding a row to CONTACT_COLUMNS updates the guide, the template
// header, the example rows and the auto-mapper's alias list together.
//
// TWO TEMPLATES, because the two importers want genuinely different shapes:
//
//   1. Contacts (tall)  — one row per person, no attendance. Households page /
//      All Contacts page → Import.
//
//   2. Sabha history (WIDE) — one row per person, one COLUMN per sabha, plus a
//      second `Events` sheet naming those columns. Admin Tools → Import History.
//      This deliberately mirrors the BAPS Sevak Call export byte-for-byte
//      (`Sabha_YYYY-MM-DD_Title`, the mark `Present`, an `Events` sheet with a
//      `ColumnName` join key) so an untouched download from the old sheet drops
//      straight in. If that legacy shape ever changes, change it here.
//
// WHY THE `Events` SHEET MATTERS. A sabha column header can only carry about
// five characters of title before it gets unreadable, so the legacy export
// truncates: `Sabha_2026-01-03_Going`. On its own that imports as a sabha called
// "Going". Joined to the Events sheet on `ColumnName` it imports as "Going
// Beyond Resolution", 7:00 pm, 120 minutes, Pu. Aanandswarup Swami Ji — the
// difference between a date in a list and a record somebody can read.
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';

/**
 * The contact columns, in the order they appear in the template.
 *
 * `aliases` are matched case-insensitively by the importers' auto-mapper, so a
 * sheet that says "Mobile" or "WhatsApp No" still lands on Phone without the
 * admin touching the dropdowns.
 */
export const CONTACT_COLUMNS = [
  {
    name: 'Name',
    required: true,
    aliases: ['name', 'full name', 'fullname', 'contact name'],
    what: 'Full name. The only column that is truly required — a row with no name is skipped.',
    examples: ['Aashish Shukla', 'Rahul Patel', 'Jignesh Bhai Shah'],
  },
  {
    name: 'Phone',
    required: false,
    aliases: ['phone', 'mobile', 'mobile no', 'contact', 'number', 'whatsapp', 'whatsapp no'],
    what: '10 digits. This is how a row is matched to a contact you already have, so filling it in '
      + 'is what stops the same person being created twice. +91, spaces and dashes are all fine.',
    examples: ['9680314755', '+91 98290 12345', '9829-011223'],
  },
  {
    name: 'Mandal',
    required: false,
    aliases: ['mandal', 'group', 'mandal name'],
    what: 'Yuvak Mandal, Yuvati Mandal, Bal Mandal… Spelling must match Areas & Mandals exactly, '
      + 'or the contact will not appear in that mandal’s lists.',
    examples: ['Yuvak Mandal', 'Yuvati Mandal', 'Bal Mandal'],
  },
  {
    name: 'Area',
    required: false,
    aliases: ['area', 'locality', 'vistar', 'area name'],
    what: 'Must match an area on Admin → Areas & Mandals. An area that does not exist there still '
      + 'imports, but nobody scoped to an area will be able to see the contact.',
    examples: ['Jhotwara', 'Vaishali Nagar', 'Mansarovar'],
  },
  {
    name: 'Sub Area',
    required: false,
    aliases: ['sub area', 'subarea', 'sub-area', 'sector', 'colony'],
    what: 'Optional finer split inside an area — a sector, a colony, a lane.',
    examples: ['Sector 9', 'Plot No. 89', 'Near Swaminarayan Mandir'],
  },
  {
    name: 'DOB',
    required: false,
    aliases: ['dob', 'birthday', 'birth date', 'date of birth', 'janm'],
    what: 'Date of birth. A real Excel date cell is safest. As text use YYYY-MM-DD or DD/MM/YYYY — '
      + 'DD/MM is read DAY first, Indian style. Drives the Reminders tab.',
    examples: ['1990-11-24', '24/11/1990', '24-Nov-1990'],
  },
  {
    name: 'Anniversary',
    required: false,
    aliases: ['anniversary', 'marriage date', 'wedding date'],
    what: 'Wedding anniversary, read exactly like DOB. Also drives Reminders.',
    examples: ['2016-02-08', '08/02/2016', ''],
  },
  {
    name: 'Study',
    required: false,
    aliases: ['study', 'education', 'qualification', 'course'],
    what: 'What they are studying or studied.',
    examples: ['B.Tech CSE', 'MBA', '12th Science'],
  },
  {
    name: 'Profession',
    required: false,
    aliases: ['profession', 'occupation', 'job', 'work'],
    what: 'Job or business.',
    examples: ['Software Engineer', 'Family business', 'CA'],
  },
  {
    name: 'Skill',
    required: false,
    aliases: ['skill', 'skills', 'talent'],
    what: 'Anything they can help with — kirtan, tabla, video editing, decoration.',
    examples: ['Tabla', 'Video editing', 'Kirtan'],
  },
  {
    name: 'Complete_Address',
    required: false,
    aliases: ['complete_address', 'address', 'full address', 'complete address'],
    what: 'Full postal address. On the Households importer this becomes the household address.',
    examples: ['89 Plot No. Maharana Pratap Nagar, Jhotwara, Jaipur', '', ''],
  },
  {
    name: 'Note',
    required: false,
    aliases: ['note', 'notes', 'remark', 'remarks', 'source'],
    what: 'Free text. Often the campaign or list they came from — “Yuvak Sammelan”, '
      + '“Attendance Sheet”.',
    examples: ['Yuvak Sammelan', 'Yuva Seminar April 2026', 'Chaturmas Padrawni'],
  },
  {
    name: 'Status',
    required: false,
    aliases: ['status', 'call status', 'sampark status', 'outcome'],
    what: 'The calling outcome, if the sheet already has one. Must match a chip on '
      + 'Admin Tools → Call Outcomes, otherwise it is stored as-is and no chip shows.',
    examples: ['Interested', 'No Answer', 'Call Back Later'],
  },
  {
    name: 'Reference',
    required: false,
    aliases: ['reference', 'call note', 'call remark', 'feedback'],
    what: 'What was said on the call. Free text, any language.',
    examples: ['Sabha me aate hai', 'Busy — call after 8pm', ''],
  },
];

/** Header row for the contacts template / the tall importer. */
export const CONTACT_HEADERS = CONTACT_COLUMNS.map((c) => c.name);

/** The mark the wide sabha columns carry. Anything else in them counts as absent. */
export const PRESENT_MARK = 'Present';

/**
 * The Events sheet, which turns a truncated column header back into a real sabha.
 * `ColumnName` is the join key — it must equal the Contacts-sheet header exactly.
 */
export const EVENT_COLUMNS = [
  {
    name: 'Title',
    required: true,
    what: 'The sabha’s real name, as long as you like. This is what shows on the Events tab.',
    examples: ['Going Beyond Resolution', 'Yuva Parayan Day-3', 'Weekly Sabha'],
  },
  {
    name: 'Date',
    required: true,
    what: 'The day it was held. A real date cell, or YYYY-MM-DD.',
    examples: ['2026-01-03', '2026-08-23', '2026-08-30'],
  },
  {
    name: 'Time',
    required: false,
    what: 'Start time, 24-hour. An Excel time cell works too.',
    examples: ['19:00', '17:30', '19:00'],
  },
  {
    name: 'Duration',
    required: false,
    what: 'Minutes. Defaults to 120 when blank.',
    examples: [120, 135, 90],
  },
  {
    name: 'Speaker',
    required: false,
    what: 'Who took the sabha. Devanagari is stored fine; PDF exports transliterate it.',
    examples: ['Pu. Aanandswarup Swami Ji', 'TBA', 'Pu. Adhyatmamanan Swami'],
  },
  {
    name: 'ColumnName',
    required: true,
    what: 'THE JOIN KEY. Must be character-for-character the same as the sabha column header on '
      + 'the Contacts sheet. Get this wrong and the sabha imports with no attendance.',
    examples: ['Sabha_2026-01-03_Going', 'Sabha_2026-08-23_YuvaP', 'Sabha_2026-08-30_Weekl'],
  },
];

/** Sabha column headers used in the wide template's example. */
const SAMPLE_SABHA_HEADERS = [
  'Sabha_2026-01-03_Going',
  'Sabha_2026-08-23_YuvaP',
  'Sabha_2026-08-30_Weekl',
];

// ── Guide text ───────────────────────────────────────────────────────────────

/**
 * The numbered steps shown on screen and written into the template's Guide
 * sheet. Kept as data so the two can never disagree.
 */
export const CONTACT_GUIDE_STEPS = [
  'Download the sample template below and open it in Excel or Google Sheets.',
  'Replace the three example rows with your own. Keep the header row exactly as it is — '
    + 'the importer matches on those names.',
  'Delete any column you have nothing for. Only Name is required; everything else can be blank '
    + 'or missing entirely.',
  'Save as .xlsx or .csv, then drop it in below. You will get a preview and a count before '
    + 'anything is written.',
];

export const HISTORY_GUIDE_STEPS = [
  'Download the sabha-history template. It has two sheets: Contacts (people, and one column per '
    + 'sabha) and Events (the real name of each of those columns).',
  'On Contacts, add one column per sabha named Sabha_YYYY-MM-DD_ShortTitle, and put '
    + `${PRESENT_MARK} in the cell for everyone who attended. Leave it blank for everyone else — `
    + 'there is no “Absent” mark.',
  'On Events, add one row per sabha column. ColumnName must match the Contacts header character '
    + 'for character; that is how the full title, time, duration and speaker get attached.',
  'Drop the file in below. You choose which sheet is which, confirm the sabha columns and which '
    + 'marks mean present, then get a dry run with the exact write count before anything saves.',
];

/** Things that quietly ruin an import. Shown as a checklist, worth reading once. */
export const IMPORT_GOTCHAS = [
  {
    title: 'Phone numbers are the anti-duplicate key',
    body: 'A row with no phone number cannot be matched to an existing contact, so it is created '
      + 'fresh every time you import. Fill Phone in wherever you have it.',
  },
  {
    title: 'Area and Mandal spelling has to match',
    body: 'The importer stores whatever text is in the cell. “Jhotwara ” with a trailing space, or '
      + '“Vaishali nagar” in lower case, becomes a second area that nobody is scoped to.',
  },
  {
    title: 'Dates: DD/MM, never MM/DD',
    body: '09/06/2026 imports as 9 June. If your sheet is American, convert the column to real '
      + 'date cells first — those are unambiguous.',
  },
  {
    title: 'Totals columns are not sabhas',
    body: 'A “Total Present” column sitting among the sabha columns would import as a sabha held on '
      + 'no date. The importer proposes only columns whose header contains a date, and you can '
      + 'untick anything it got wrong.',
  },
  {
    title: 'Re-running is safe',
    body: 'The history importer matches contacts on phone and sabhas on date, and derives each '
      + 'attendance record’s ID from both. Import the same file twice and it converges instead of '
      + 'duplicating — so a corrected second pass is fine.',
  },
];

// ── Workbook generation ──────────────────────────────────────────────────────

function downloadBlob(data, filename, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Column widths, so the template opens readable instead of as a wall of ####. */
function widths(specs) {
  return specs.map((s) => ({ wch: Math.min(Math.max(String(s).length + 2, 12), 46) }));
}

function guideSheet(title, steps, columnSpecs, extraSections = []) {
  const aoa = [
    [title],
    [],
    ['HOW TO USE THIS FILE'],
    ...steps.map((s, i) => [`${i + 1}.`, s]),
    [],
    ['COLUMNS'],
    ['Column', 'Required?', 'What it is'],
    ...columnSpecs.map((c) => [c.name, c.required ? 'Required' : 'Optional', c.what]),
  ];
  extraSections.forEach((section) => {
    aoa.push([], [section.heading]);
    section.rows.forEach((r) => aoa.push(r));
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 96 }];
  return ws;
}

/**
 * Tall contacts template — Contacts sheet + Guide sheet.
 * Three example rows, deliberately uneven: one complete, one minimal, one in
 * between, so it is obvious that blanks are allowed.
 */
export function downloadContactsTemplate() {
  const rows = [CONTACT_HEADERS];
  for (let i = 0; i < 3; i += 1) {
    rows.push(CONTACT_COLUMNS.map((c) => c.examples[i] ?? ''));
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths(CONTACT_HEADERS);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
  XLSX.utils.book_append_sheet(
    wb,
    guideSheet('BAPS Jaipur MDS — contact import template', CONTACT_GUIDE_STEPS, CONTACT_COLUMNS, [
      {
        heading: 'WATCH OUT FOR',
        rows: IMPORT_GOTCHAS.map((g) => [g.title, '', g.body]),
      },
    ]),
    'Guide',
  );

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(out, 'MDS-contacts-template.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/**
 * Wide sabha-history template — Contacts (with sabha columns) + Events + Guide.
 *
 * The example is small on purpose: 3 people × 3 sabhas is enough to show the
 * shape, and a template with 400 rows of fake names invites someone to import it.
 */
export function downloadSabhaHistoryTemplate() {
  // Contacts sheet: the contact columns, then one column per sabha.
  const header = [...CONTACT_HEADERS, ...SAMPLE_SABHA_HEADERS];
  // Deliberately patchy attendance — a full grid of "Present" would not show
  // that a blank is how absence is recorded.
  const marks = [
    [PRESENT_MARK, PRESENT_MARK, PRESENT_MARK],
    ['', PRESENT_MARK, PRESENT_MARK],
    [PRESENT_MARK, '', ''],
  ];
  const rows = [header];
  for (let i = 0; i < 3; i += 1) {
    rows.push([...CONTACT_COLUMNS.map((c) => c.examples[i] ?? ''), ...marks[i]]);
  }
  const contactsWs = XLSX.utils.aoa_to_sheet(rows);
  contactsWs['!cols'] = widths(header);

  const eventsRows = [EVENT_COLUMNS.map((c) => c.name)];
  for (let i = 0; i < 3; i += 1) {
    eventsRows.push(EVENT_COLUMNS.map((c) => c.examples[i] ?? ''));
  }
  const eventsWs = XLSX.utils.aoa_to_sheet(eventsRows);
  eventsWs['!cols'] = widths(EVENT_COLUMNS.map((c) => c.name));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, contactsWs, 'Contacts');
  XLSX.utils.book_append_sheet(wb, eventsWs, 'Events');
  XLSX.utils.book_append_sheet(
    wb,
    guideSheet('BAPS Jaipur MDS — sabha history import template', HISTORY_GUIDE_STEPS,
      CONTACT_COLUMNS, [
        {
          heading: 'THE SABHA COLUMNS (on the Contacts sheet)',
          rows: [
            ['Header format', '', 'Sabha_YYYY-MM-DD_ShortTitle — e.g. Sabha_2026-01-03_Going'],
            ['Cell value', '', `${PRESENT_MARK} if they attended. Blank if they did not.`],
            ['', '', 'Any other mark works too — you confirm which marks mean present before importing.'],
            ['How many', '', 'As many as you like. One column per sabha, in any order.'],
          ],
        },
        {
          heading: 'THE EVENTS SHEET',
          rows: [
            ['Column', 'Required?', 'What it is'],
            ...EVENT_COLUMNS.map((c) => [c.name, c.required ? 'Required' : 'Optional', c.what]),
          ],
        },
        {
          heading: 'WATCH OUT FOR',
          rows: IMPORT_GOTCHAS.map((g) => [g.title, '', g.body]),
        },
      ]),
    'Guide',
  );

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(out, 'MDS-sabha-history-template.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/**
 * CSV version of the tall template, for anyone working in Google Sheets who
 * would rather not deal with a multi-sheet .xlsx. There is no CSV equivalent of
 * the wide template — a single CSV cannot carry the Events sheet, and without it
 * every sabha imports with a truncated title.
 */
export function downloadContactsCsvTemplate() {
  const rows = [CONTACT_HEADERS];
  for (let i = 0; i < 3; i += 1) rows.push(CONTACT_COLUMNS.map((c) => c.examples[i] ?? ''));
  const csv = rows
    .map((r) => r.map((cell) => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n');
  // BOM so Excel opens Devanagari and the curly quotes correctly.
  downloadBlob(`﻿${csv}`, 'MDS-contacts-template.csv', 'text/csv;charset=utf-8;');
}
