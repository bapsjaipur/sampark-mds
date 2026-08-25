// src/services/historyImportService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 21 — importing the Yuvak Mandal Google Sheet, including EVERY sabha
// column in it ("with their everything from all time present to now").
//
// The sheet is in wide format: one row per person, one COLUMN per sabha, and a
// mark in the cell where they attended.
//
//     Name      | Mobile     | Mandal | 09/06/24 | 16/06/24 | 23/06/24
//     Rahul     | 98290xxxxx | Yuvak  | P        |          | P
//
// MDS stores attendance in long format instead — one attendance/{eventId}_{
// individualId} document per person per sabha (see PHASE6-NOTES.md). So the
// import has to pivot: every date column becomes an events/{id} document, and
// every present-mark becomes an attendance document pointing at it.
//
// THREE THINGS THIS DELIBERATELY DOES NOT GUESS
//   1. Which columns are sabha dates. It proposes them by parsing the header,
//      and the admin confirms — a stray "Total P" column would otherwise become
//      a sabha held on an imaginary date.
//   2. Which cell values mean present. `P` is obvious, `X` is not: in some
//      sheets it means attended and in others it means absent, and guessing
//      wrong silently inverts years of history. The caller passes the token
//      list, and countCellValues() shows every distinct mark in the file so the
//      admin can see what they are accepting.
//   3. Day-first vs month-first dates. 09/06/24 is ambiguous; this reads it as
//      9 June (Indian convention, which is what the sheet uses). Unambiguous
//      formats — ISO, or any month NAME — are parsed exactly.
//
// SAFE TO RE-RUN. Events are matched on their date, contacts on their mobile
// number, and the attendance doc ID is derived from both, so importing the same
// sheet twice converges instead of duplicating. That matters: a first pass will
// usually be followed by a corrected second pass.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection, doc, orderBy, query, serverTimestamp, where,
} from 'firebase/firestore';
// PHASE 24 — metered drop-ins (src/lib/fsMetered.js): same signatures, they count.
// A history import reads every contact and every event, then writes one
// attendance row per mark — thousands of operations from a single click.
import {
  getCountFromServer, getDocs, setDoc, updateDoc, writeBatch,
} from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { chunk } from '../lib/firestoreHelpers';
import { toMonthDay } from '../lib/dateHelpers';

// Firestore caps a WriteBatch at 500 operations. 450 leaves headroom for the
// events created in the same batch as the first rows.
const WRITE_BATCH_LIMIT = 450;

// Firestore caps an `in` filter at 30 values.
const IN_LIMIT = 30;

/** The marks that mean "attended", unless the admin edits them. */
export const DEFAULT_PRESENT_TOKENS = ['p', 'y', '1', 'yes', 'true', 'present', '✓', '✔', 'hajar'];

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad(n) { return String(n).padStart(2, '0'); }

/** Two-digit years: 70–99 → 19xx, 00–69 → 20xx. A sabha in 1975 is not in this
 *  sheet, but a birth year might be, and the same helper is used for both. */
function expandYear(y) {
  const n = Number(y);
  if (n >= 1000) return n;
  return n >= 70 ? 1900 + n : 2000 + n;
}

function iso(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * parseSheetDate(value) → 'YYYY-MM-DD' | null
 *
 * Accepts every shape a Google Sheet export realistically produces: ISO, an
 * Excel serial number, a JS Date, day/month/year with any separator, and
 * anything with a spelled-out month.
 */
export function parseSheetDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  // Excel/Sheets serial day number. The epoch is 1899-12-30 (Lotus 1-2-3's
  // leap-year bug, which Excel kept and Sheets copied). The window rules out
  // ordinary counts like "12" or a year like "2024" being read as a date.
  if (typeof value === 'number' && value > 20000 && value < 60000) {
    const ms = Math.round((value - 25569) * 86400000);
    const d = new Date(ms);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO, with or without a time part — what XLSX hands back for a real date cell.
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  // 9 Jun 24 · 9-June-2024 · Jun 9, 2024 — a month NAME removes all ambiguity.
  const named = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.]+(\d{2,4})$/);
  if (named && MONTHS[named[2].toLowerCase()]) {
    return iso(expandYear(named[3]), MONTHS[named[2].toLowerCase()], Number(named[1]));
  }
  const namedFirst = s.match(/^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2})[,\s\-/.]+(\d{2,4})$/);
  if (namedFirst && MONTHS[namedFirst[1].toLowerCase()]) {
    return iso(expandYear(namedFirst[3]), MONTHS[namedFirst[1].toLowerCase()], Number(namedFirst[2]));
  }

  // 09/06/24 · 9-6-2024 — DAY FIRST. See the header note: the sheet is Indian.
  // A first part above 12 can only be a day, which is why 13/06 and 09/06 land
  // on the same reading rather than one silently flipping to September.
  const numeric = s.match(/^(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = expandYear(numeric[3]);
    // If the SECOND part can't be a month, the sheet is month-first after all.
    return b > 12 ? iso(year, a, b) : iso(year, b, a);
  }

  return null;
}

/**
 * parseHeaderDate(header) → 'YYYY-MM-DD' | null
 *
 * Like parseSheetDate, but for a COLUMN HEADER, which in practice is a date with
 * a label welded onto it. The Sevak Call export writes
 *
 *     Sabha_2026-01-03_Going
 *
 * — the sabha's date, then the first five characters of its title, because a
 * spreadsheet column cannot carry more than that and stay readable. parseSheetDate
 * anchors its patterns to the whole string, so it returns null for every one of
 * those and the entire attendance history looks like it isn't there.
 *
 * So: try the strict parse first, and only then hunt for an embedded date.
 *
 * DELIBERATELY NARROW. Only unambiguous forms are recognised inside a longer
 * string: ISO (2026-01-03 / 2026_01_03), or a DD-MM-YYYY with a FOUR-digit year.
 * `Total Present` must not become a sabha, and neither must `Batch_17` or
 * `Call_Count` — a two-digit-year pattern loose enough to find 09/06/24 inside a
 * label would also find nonsense inside half the columns in a real sheet. Those
 * can still be added by hand in the UI, which is the safe direction to fail.
 */
export function parseHeaderDate(header) {
  const exact = parseSheetDate(header);
  if (exact) return exact;

  const s = String(header ?? '').trim();
  if (!s) return null;

  // ISO anywhere in the string: Sabha_2026-01-03_Going, "3 — 2026/01/03", etc.
  const isoish = s.match(/(?<![\d])(\d{4})[-/_.](\d{1,2})[-/_.](\d{1,2})(?![\d])/);
  if (isoish) {
    const hit = iso(Number(isoish[1]), Number(isoish[2]), Number(isoish[3]));
    if (hit) return hit;
  }

  // Day-first with a four-digit year: "Sabha 03-01-2026", "Padhramani 3/1/2026".
  const dayFirst = s.match(/(?<![\d])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?![\d])/);
  if (dayFirst) {
    const a = Number(dayFirst[1]);
    const b = Number(dayFirst[2]);
    const y = Number(dayFirst[3]);
    return b > 12 ? iso(y, a, b) : iso(y, b, a);
  }

  return null;
}

/**
 * The label half of a sabha column header — what is left once the date and the
 * `Sabha` prefix are stripped. `Sabha_2026-01-03_Going` → `Going`.
 *
 * Used only as a fallback title. The Events sheet is the real source (see
 * buildEventMetaIndex); this is what a sheet without one gets.
 */
export function headerLabel(header) {
  return String(header ?? '')
    .replace(/(?<![\d])\d{4}[-/_.]\d{1,2}[-/_.]\d{1,2}(?![\d])/g, ' ')
    .replace(/(?<![\d])\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?![\d])/g, ' ')
    .replace(/\bsabha\b/gi, ' ')
    .replace(/[_\-—–]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * parseSheetTime(value) → 'HH:MM' | null
 *
 * Excel stores a time as a fraction of a day, so 7:00 pm arrives as
 * 0.7916666666666666. Left unconverted that lands in the event's `time` field
 * verbatim and every sabha shows as an invalid time.
 */
export function parseSheetTime(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // A serial datetime (46025.79) carries the time in its fractional part; a
    // bare time cell (0.79) is the fraction on its own. Both work the same way.
    const frac = value - Math.floor(value);
    // Round to the nearest minute: 0.7916666… is 18:59:59.99 in floating point.
    const mins = Math.round(frac * 24 * 60) % (24 * 60);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }

  const s = String(value).trim();
  // 19:00 · 7:00 PM · 7.00 pm
  const m = s.match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i);
  if (m) {
    let h = Number(m[1]);
    const mm = Number(m[2]);
    const suffix = (m[3] || '').toLowerCase();
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    if (h > 23 || mm > 59) return null;
    return `${pad(h)}:${pad(mm)}`;
  }
  return null;
}

/** Minutes, from a number or "90 min" / "1.5 hrs". */
export function parseSheetDuration(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Under 1 means it came in as an Excel duration (a day fraction), which is
    // how a cell formatted [h]:mm arrives.
    return Math.round(value < 1 ? value * 24 * 60 : value);
  }
  const s = String(value).trim();
  const hours = s.match(/^([\d.]+)\s*(h|hr|hrs|hour|hours)$/i);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * readImportWorkbook(arrayBuffer) → { sheetNames, rowsOf, headersOf }
 *
 * The importer used to read wb.SheetNames[0] and nothing else. That is fine for a
 * one-sheet CSV and wrong for a real workbook: the Sevak Call export has 19
 * sheets, and the one holding the sabha titles is not the first.
 *
 * `raw: false` is deliberate for the CONTACT sheet — it hands back the displayed
 * text, which is what a name or an address should be. Dates and times are read
 * with `cellDates` so they arrive as Date objects rather than serials wherever
 * Excel actually marked the cell as a date.
 */
export function readImportWorkbook(XLSX, arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  return {
    sheetNames: wb.SheetNames.slice(),
    /** Objects keyed by header, blanks as ''. */
    rowsOf(name) {
      const ws = wb.Sheets[name];
      if (!ws) return [];
      return XLSX.utils.sheet_to_json(ws, { defval: '' });
    },
    /**
     * The header row exactly as written, INCLUDING duplicates and columns that
     * are empty below. sheet_to_json's object keys silently de-duplicate and drop
     * trailing empties, and a sabha nobody attended would vanish from the picker.
     */
    headersOf(name) {
      const ws = wb.Sheets[name];
      if (!ws) return [];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      return (grid[0] || []).map((h) => (h == null ? '' : String(h).trim()));
    },
  };
}

/**
 * buildEventMetaIndex(eventRows) → Map(ColumnName → { title, date, time, ... })
 *
 * The Events sheet is what makes a migrated sabha readable. Its `ColumnName`
 * column is the join key back to the wide Contacts sheet, so
 * `Sabha_2026-01-03_Going` resolves to "Going Beyond Resolution", 19:00, 120
 * minutes, Pu. Aanandswarup Swami Ji.
 *
 * Tolerant about which column is which — a sheet exported from Apps Script may
 * have renamed them — but the key must match exactly, because a fuzzy join here
 * would attach one sabha's speaker to another sabha's date.
 */
export function buildEventMetaIndex(eventRows = []) {
  const pick = (row, names) => {
    for (const n of names) {
      const hit = Object.keys(row).find((k) => k.trim().toLowerCase() === n);
      if (hit && row[hit] !== '' && row[hit] != null) return row[hit];
    }
    return null;
  };

  const index = new Map();
  eventRows.forEach((row) => {
    const key = String(pick(row, ['columnname', 'column name', 'column', 'sabha column']) ?? '').trim();
    if (!key) return;
    const title = String(pick(row, ['title', 'name', 'event', 'sabha', 'event name']) ?? '').trim();
    const date = parseSheetDate(pick(row, ['date', 'sabha date', 'event date']));
    index.set(key, {
      columnName: key,
      title: title || null,
      date,
      time: parseSheetTime(pick(row, ['time', 'start time', 'sabha time'])),
      durationMinutes: parseSheetDuration(pick(row, ['duration', 'duration minutes', 'minutes', 'length'])),
      speaker: String(pick(row, ['speaker', 'santo', 'vakta', 'presenter']) ?? '').trim() || null,
    });
  });
  return index;
}

/**
 * Splits the sheet's headers into "looks like a sabha date" and "everything
 * else", so the mapper can offer sensible defaults. The admin confirms both.
 *
 * `eventMeta` (from buildEventMetaIndex) does two things when supplied: it
 * supplies the real title for each column, and it rescues a column whose header
 * carries NO parseable date at all — if the Events sheet names it and gives it a
 * date, that is better evidence than anything the header could have said.
 */
export function proposeDateColumns(headers = [], eventMeta = null) {
  const dates = [];
  const others = [];
  headers.forEach((h) => {
    if (!h) return;
    const meta = eventMeta?.get(h) || null;
    const date = parseHeaderDate(h) || meta?.date || null;
    if (date) {
      dates.push({
        header: h,
        date,
        title: meta?.title || headerLabel(h) || null,
        // Whether the title came from the Events sheet or was scraped off the
        // header. The UI says which, because "Going" is not a sabha name.
        titleFromEvents: Boolean(meta?.title),
        time: meta?.time || null,
        durationMinutes: meta?.durationMinutes || null,
        speaker: meta?.speaker || null,
      });
    } else {
      others.push(h);
    }
  });
  // Chronological, not sheet order: a sheet with a year per tab often ends up
  // with the columns shuffled, and the preview is read as a timeline.
  dates.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { dates, others };
}

/**
 * Guesses which column holds which contact field.
 *
 * PHASE 25 — widened from five fields to twelve. The Sevak Call export carries
 * Sub Area, Anniversary, Study, Profession, Skill, Status and Reference, and
 * every one of those that is not mapped here is data the admin has to wire up by
 * hand or, more likely, quietly loses. The field names match the ones
 * runHistoryImport() reads, and the human-facing column contract in
 * src/lib/importTemplates.js.
 *
 * Order matters inside each list: the exact-match pattern comes first so a sheet
 * with both `Area` and `Sub Area` does not put `Sub Area` in `Area` (the loose
 * /area/i pattern would match both, and `headers.find` takes the first hit).
 */
export const MAPPABLE_FIELDS = [
  'Name', 'Phone', 'Area', 'SubArea', 'Mandal', 'DOB', 'Anniversary',
  'Study', 'Profession', 'Skill', 'Address', 'Note', 'Status', 'Reference',
];

export function proposeFieldMapping(headers = []) {
  const want = {
    Name: [/^name$/i, /^full.?name$/i, /^contact.?name$/i, /नाम/],
    Phone: [/^(phone|mobile|contact|number|no\.?)$/i, /^mobile.?no/i, /^whats.?app/i, /mobile/i, /phone/i],
    // Sub Area before Area, so the loose /area/i below cannot claim it.
    SubArea: [/^sub.?area$/i, /^sector$/i, /^colony$/i, /sub.?area/i],
    Area: [/^area$/i, /^area.?name$/i, /^locality$/i, /^vistar$/i, /area/i],
    Mandal: [/^mandal$/i, /^mandal.?name$/i, /^group$/i, /mandal/i],
    DOB: [/^dob$/i, /^birth.?day$/i, /^date.?of.?birth$/i, /birth/i, /janm/i],
    Anniversary: [/^anniversary$/i, /^marriage.?date$/i, /^wedding.?date$/i, /anniversary/i],
    Study: [/^study$/i, /^education$/i, /^qualification$/i, /^course$/i, /stud/i],
    Profession: [/^profession$/i, /^occupation$/i, /^job$/i, /^work$/i, /profession/i],
    Skill: [/^skills?$/i, /^talent$/i, /skill/i],
    Address: [/^complete.?address$/i, /^address$/i, /address/i],
    Note: [/^(note|notes|remark|remarks)$/i, /^source$/i, /note/i],
    Status: [/^status$/i, /^call.?status$/i, /^sampark.?status$/i, /^outcome$/i],
    Reference: [/^reference$/i, /^call.?(note|remark)s?$/i, /^feedback$/i, /reference/i],
  };
  const out = {};
  const taken = new Set();
  MAPPABLE_FIELDS.forEach((field) => {
    const patterns = want[field] || [];
    // Two fields must never land on the same column: mapping `Area` twice would
    // silently blank whichever of the pair lost, and the admin would have no way
    // to tell from the dropdowns that anything was wrong.
    for (const p of patterns) {
      const hit = headers.find((h) => !taken.has(h) && p.test(String(h).trim()));
      if (hit) { out[field] = hit; taken.add(hit); return; }
    }
  });
  return out;
}

/**
 * Every distinct value that appears in the chosen date columns, with a count.
 * This is what makes the present/absent decision reviewable instead of assumed.
 */
export function countCellValues(rows, dateHeaders) {
  const counts = new Map();
  rows.forEach((r) => {
    dateHeaders.forEach((h) => {
      const raw = r[h];
      const key = raw == null ? '' : String(raw).trim();
      if (!key) return; // blank is absent, and there are thousands of them
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

export function normalizeMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function nameKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isPresent(cell, tokens) {
  const v = String(cell ?? '').trim().toLowerCase();
  if (!v) return false;
  return tokens.includes(v);
}

/**
 * The dry run. Resolves every row against the contacts already in Firestore and
 * every date column against the events already there, and reports exactly what
 * a real run would write — nothing is saved.
 *
 * PHASE 25 — THIS USED TO READ TWO WHOLE COLLECTIONS.
 *
 * `getDocs(collection(db,'individuals'))` plus `getDocs(collection(db,'events'))`
 * on every dry run. On the free tier that is 2,400-odd reads per press of
 * "Analyze", against a 50,000/day ceiling, and the natural way to use this screen
 * is to analyze, adjust the token list, analyze again.
 *
 * Now it asks only about the rows in the sheet: chunked `where('mobile','in',…)`
 * for the phone numbers actually present, and `where('date','in',…)` for the
 * dates actually being imported. The user's own workbook — 430 contacts, 35
 * sabhas — costs ~465 reads instead of ~2,400, and the cost now scales with the
 * FILE rather than with the database, so it stays flat as the database grows.
 *
 * This works because `mobile` is stored as a 10-digit string everywhere
 * (IndividualForm normalises with .replace(/\D/g,''), so does this importer), so
 * an equality match on the normalised value is exact. If that ever stops being
 * true, matching silently degrades to "create everything" — hence the
 * `matchedByMobile` figure being on the dry-run screen where someone will notice
 * it reading zero.
 *
 * NAME MATCHING IS NOW OPT-IN AND OFF BY DEFAULT. There is no way to look up
 * "any contact whose name is one of these 430" without either 430 queries or the
 * full scan, so `matchByName: true` restores the old full read of `individuals`
 * and says so in the UI. It only matters for rows with no phone number: the
 * user's workbook has none, so the default costs nothing there.
 *
 * @param {object}   p
 * @param {object[]} p.rows          parsed sheet rows (objects keyed by header)
 * @param {object}   p.mapping       { Name, Phone, Area, Mandal, DOB, ... } → header
 * @param {object[]} p.dateColumns   [{ header, date, title, time, ... }] the admin confirmed
 * @param {string[]} p.presentTokens lower-case marks that mean attended
 * @param {boolean}  [p.matchByName] also match on name — costs a full read of `individuals`
 */
export async function analyzeHistoryImport({
  rows, mapping, dateColumns, presentTokens = DEFAULT_PRESENT_TOKENS, matchByName = false,
}) {
  const tokens = presentTokens.map((t) => String(t).trim().toLowerCase()).filter(Boolean);

  // ── What the sheet actually asks about ────────────────────────────────
  const wantedMobiles = new Set();
  let rowsWithoutPhone = 0;
  rows.forEach((r) => {
    if (!String(r[mapping.Name] ?? '').trim()) return; // no name → skipped anyway
    const m = mapping.Phone ? normalizeMobile(r[mapping.Phone]) : '';
    if (m) wantedMobiles.add(m);
    else rowsWithoutPhone += 1;
  });

  const wantedDates = [...new Set(dateColumns.map((c) => c.date).filter(Boolean))];

  // ── Contacts ─────────────────────────────────────────────────────────
  const byMobile = new Map();
  const byName = new Map();
  let reads = 0;

  const mobileList = [...wantedMobiles];
  const contactQueries = matchByName
    // Name matching needs everybody, so there is nothing to narrow.
    ? [getDocs(collection(db, 'individuals'))]
    : chunk(mobileList, IN_LIMIT).map((slice) => getDocs(
      query(collection(db, 'individuals'), where('mobile', 'in', slice)),
    ));

  const contactSnaps = await Promise.all(contactQueries);
  contactSnaps.forEach((snap) => {
    reads += snap.size;
    snap.docs.forEach((d) => {
      const data = { id: d.id, ...d.data() };
      const m = normalizeMobile(data.mobile);
      // First writer wins, so an earlier-created contact keeps the number. That
      // is deliberate: duplicates in the database should collapse onto the
      // original rather than onto whichever copy Firestore returned last.
      if (m && !byMobile.has(m)) byMobile.set(m, data);
      if (matchByName) {
        const n = nameKey(data.name);
        if (n && !byName.has(n)) byName.set(n, data);
      }
    });
  });

  // ── Events ───────────────────────────────────────────────────────────
  const eventsByDate = new Map();
  const eventSnaps = await Promise.all(
    chunk(wantedDates, IN_LIMIT).map((slice) => getDocs(
      query(collection(db, 'events'), where('date', 'in', slice)),
    )),
  );
  eventSnaps.forEach((snap) => {
    reads += snap.size;
    snap.docs.forEach((d) => {
      const data = { id: d.id, ...d.data() };
      if (data.date && !eventsByDate.has(data.date)) eventsByDate.set(data.date, data);
    });
  });

  const plan = [];
  let matchedByMobile = 0;
  let matchedByName = 0;
  let toCreate = 0;
  let skipped = 0;
  let presentMarks = 0;

  rows.forEach((r, index) => {
    const name = String(r[mapping.Name] ?? '').trim();
    if (!name) { skipped += 1; return; }

    const mobile = mapping.Phone ? normalizeMobile(r[mapping.Phone]) : '';
    let match = mobile ? byMobile.get(mobile) : null;
    if (match) matchedByMobile += 1;
    if (!match && matchByName) {
      match = byName.get(nameKey(name)) || null;
      if (match) matchedByName += 1;
    }
    if (!match) toCreate += 1;

    // Keyed by COLUMN, not by date — two sabhas can share a day. See the
    // claimedEventIds note below.
    const columns = dateColumns
      .filter((c) => isPresent(r[c.header], tokens))
      .map((c) => c.header);
    presentMarks += columns.length;

    plan.push({ index, name, mobile, row: r, existingId: match?.id || null, columns });
  });

  // PHASE 25 — which columns need a NEW event, resolved the same way the real run
  // resolves it: an already-existing sabha satisfies at most ONE column, so a
  // second column on the same date still counts as new.
  //
  // The user's own workbook is exactly this case: 35 sabha columns, 34 distinct
  // dates, because 2026-05-31 carries both `Sabha_2026-05-31_YuvaS` and
  // `Sabha_2026-05-31_2Yuva` — a morning and an evening session of the same Yuva
  // Shibir. Counting by date alone reported 34 events and quietly folded the
  // second sitting into the first, losing its title, speaker and the distinction
  // between who came to which.
  const claimedDates = new Set();
  const newEventColumns = dateColumns.filter((c) => {
    if (eventsByDate.has(c.date) && !claimedDates.has(c.date)) {
      claimedDates.add(c.date);
      return false;
    }
    return true;
  });

  return {
    plan,
    eventsByDate,
    tokens,
    stats: {
      rows: rows.length,
      skipped,
      matchedByMobile,
      matchedByName,
      toCreate,
      rowsWithoutPhone,
      matchByName,
      sabhas: dateColumns.length,
      newEvents: newEventColumns.length,
      reusedEvents: dateColumns.length - newEventColumns.length,
      presentMarks,
      // Documents this dry run actually read. Shown on screen next to the write
      // count, because on the free tier the analysis is not free either.
      reads,
      // What the run will actually cost, so a 30,000-write import announces
      // itself before it starts rather than halfway through.
      writes: toCreate + newEventColumns.length + presentMarks,
    },
  };
}

/**
 * Commits the plan produced by analyzeHistoryImport().
 *
 * PHASE 25 — every document created here carries an `importRunId`, and a
 * matching `importRuns/{id}` row records what the run was and how it ended.
 * That exists because of the specific way this import fails: Firestore rejects a
 * whole 450-operation WriteBatch atomically, so one refused write leaves some
 * sabhas, some contacts and some marks committed and everything after them never
 * attempted — a half import. Reversing that without a run ID means "delete
 * everything ever imported", which also destroys earlier good imports. With one,
 * undoHistoryImport() can take out exactly the run that broke.
 *
 * The run document is written FIRST and updated last, so a crash still leaves
 * something to undo. It is deliberately outside the WriteBatch: inside it, the
 * rollback that loses the data would lose the record of the data too.
 *
 * @param {object}   p
 * @param {object}   p.analysis     the return value of analyzeHistoryImport()
 * @param {object}   p.mapping
 * @param {object[]} p.dateColumns
 * @param {string}   p.volunteerId  stamped as markedBy / createdBy
 * @param {object}   p.defaults     { mandal, area, time } applied to created events
 * @param {string}   [p.fileName]   shown on the undo list so a run is recognisable
 * @param {Function} [p.onProgress] ({ done, total, phase }) → void
 */
export async function runHistoryImport({
  analysis, mapping, dateColumns, volunteerId, defaults = {}, fileName = '', onProgress,
}) {
  const { plan, eventsByDate } = analysis;

  const runRef = doc(collection(db, 'importRuns'));
  const importRunId = runRef.id;
  await setDoc(runRef, {
    kind: 'sabha-history',
    fileName: fileName || '',
    status: 'running',
    startedBy: volunteerId || null,
    startedAt: serverTimestamp(),
    finishedAt: null,
    // Filled in as they happen, not from the estimate, so a failed run reports
    // what actually landed rather than what was hoped for.
    events: 0,
    contacts: 0,
    marks: 0,
    error: null,
  });

  let batch = writeBatch(db);
  let ops = 0;
  let done = 0;
  const total = analysis.stats.writes;

  async function flushIfFull() {
    ops += 1;
    done += 1;
    if (ops >= WRITE_BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
    if (onProgress && done % 25 === 0) onProgress({ done, total });
  }

  // PHASE 25 — keyed by COLUMN HEADER, not by date. Two sabhas on one day are two
  // sabhas: the workbook this was built against has both `Sabha_2026-05-31_YuvaS`
  // and `Sabha_2026-05-31_2Yuva`. Keying by date made the second column write its
  // marks onto the first sabha's event, so one sitting vanished and its
  // attendance was credited to the other.
  const eventIdByColumn = new Map();
  // An existing sabha in the app satisfies at most one column. Without this, both
  // same-date columns would reuse the same event and the collapse would come back
  // by another route.
  const claimedEventIds = new Set();
  const individualIdByRow = new Map();
  let created = 0;
  let marks = 0;

  try {
    // ── 1. One event per date column ────────────────────────────────────
    // Created first and in date order so the Events tab reads as a timeline even
    // if the run is interrupted partway.
    for (const col of dateColumns) {
      const existing = eventsByDate.get(col.date);
      if (existing && !claimedEventIds.has(existing.id)) {
        claimedEventIds.add(existing.id);
        eventIdByColumn.set(col.header, existing.id);
        continue;
      }

      const ref = doc(collection(db, 'events'));
      // TITLE, in order of how much it is worth trusting:
      //   1. col.title from the Events sheet — the real name, joined on ColumnName.
      //   2. the label scraped off the header ("Going"), when there is no Events
      //      sheet. Truncated, but it is often the only record of what the sabha was.
      //   3. `Sabha — 2026-01-03`, when the header carried nothing but a date.
      const label = (col.title || '').trim() || headerLabel(col.header);
      batch.set(ref, {
        title: label || `Sabha — ${col.date}`,
        date: col.date,
        time: col.time || defaults.time || '19:00',
        durationMinutes: col.durationMinutes || 120,
        speaker: col.speaker || '',
        mandal: defaults.mandal || null,
        area: defaults.area || null,
        // Marks the row as migrated rather than organised in the app, and ties it
        // to one run so Undo can find it again.
        source: 'history-import',
        importRunId,
        isHistorical: true,
        createdBy: volunteerId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      eventIdByColumn.set(col.header, ref.id);
      claimedEventIds.add(ref.id);
      await flushIfFull();
    }

    // ── 2. Contacts: reuse the match, or create a standalone individual ─
    // Standalone (householdId null, area on the individual) is the Phase 16 shape.
    // The sheet has no family structure to rebuild, and inventing a household of
    // one per person would bury the real families on the Households page.
    /** Mapped cell → trimmed string, or '' when the column was not mapped. */
    const cell = (r, field) => (mapping[field] ? String(r[mapping[field]] ?? '').trim() : '');
    for (const entry of plan) {
      if (entry.existingId) { individualIdByRow.set(entry.index, entry.existingId); continue; }

      const r = entry.row;
      const dobRaw = mapping.DOB ? r[mapping.DOB] : null;
      const dob = dobRaw ? parseSheetDate(dobRaw) : null;
      const annRaw = mapping.Anniversary ? r[mapping.Anniversary] : null;
      const anniversary = annRaw ? parseSheetDate(annRaw) : null;
      const ref = doc(collection(db, 'individuals'));
      batch.set(ref, {
        householdId: null,
        name: entry.name,
        mobile: entry.mobile || null,
        dob: dob || null,
        dobMonthDay: dob ? toMonthDay(dob) : null,
        anniversary: anniversary || null,
        anniversaryMonthDay: anniversary ? toMonthDay(anniversary) : null,
        mandal: cell(r, 'Mandal') || defaults.mandal || null,
        area: cell(r, 'Area') || defaults.area || null,
        subArea: cell(r, 'SubArea') || null,
        study: cell(r, 'Study') || null,
        profession: cell(r, 'Profession') || null,
        skill: cell(r, 'Skill') || null,
        relation: 'head',
        isPrimary: true,
        profilePhotoURL: null,
        // Carried across when the sheet has them, because a migrated contact with
        // its calling outcome intact does not need calling again. Stored verbatim:
        // a value that matches no chip on Admin Tools → Call Outcomes still shows
        // as text, which is better than dropping what somebody recorded.
        status: cell(r, 'Status'),
        reference: cell(r, 'Reference'),
        callCount: 0,
        source: 'history-import',
        importRunId,
        legacyExtra: {
          address: cell(r, 'Address') || null,
          note: cell(r, 'Note') || null,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      individualIdByRow.set(entry.index, ref.id);
      created += 1;
      await flushIfFull();
    }

    // ── 3. The attendance itself ────────────────────────────────────────
    // Deterministic ID (`${eventId}_${individualId}`, same as markPresent()) so a
    // second run overwrites rather than duplicates, and so a mark made by hand in
    // the app afterwards is the same document.
    for (const entry of plan) {
      const individualId = individualIdByRow.get(entry.index);
      if (!individualId) continue;
      for (const header of entry.columns) {
        const eventId = eventIdByColumn.get(header);
        if (!eventId) continue;
        batch.set(doc(db, 'attendance', `${eventId}_${individualId}`), {
          eventId,
          individualId,
          status: 'present',
          markedBy: volunteerId || null,
          markedAt: serverTimestamp(),
          source: 'history-import',
          importRunId,
        });
        marks += 1;
        await flushIfFull();
      }
    }

    if (ops > 0) await batch.commit();
  } catch (err) {
    // Record what landed before re-throwing, so the Undo list can show this run
    // as failed and say how far it got. A failure to write the marker must not
    // mask the real error, hence the swallowed catch.
    try {
      await updateDoc(runRef, {
        status: 'failed',
        error: err?.code || err?.message || 'unknown',
        events: eventIdByColumn.size,
        contacts: created,
        marks,
        finishedAt: serverTimestamp(),
      });
    } catch { /* the thrown error below is the one worth seeing */ }
    throw err;
  }

  if (onProgress) onProgress({ done: total, total });

  const result = {
    importRunId,
    events: eventIdByColumn.size,
    newEvents: analysis.stats.newEvents,
    contactsCreated: created,
    contactsMatched: plan.length - created,
    marks,
  };

  await updateDoc(runRef, {
    status: 'complete',
    events: analysis.stats.newEvents,
    contacts: created,
    marks,
    finishedAt: serverTimestamp(),
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNDO
//
// What an undo may and may not remove, and why the distinction is the whole
// design: the import CREATES some documents and REUSES others. A contact matched
// on their mobile number, or a sabha matched on its date, existed before the
// import and must survive it — deleting those would turn "undo my import" into
// "delete part of my database". Only documents stamped by the import are
// touched, which is exactly the set it brought into being.
//
// ONE THING AN UNDO CANNOT RESTORE. If a person was marked present by hand in
// the app and the import then wrote over that mark, the undo deletes it: the
// previous version is gone, because a set() replaces a document rather than
// versioning it. So an undo returns those few people to "not marked", not to
// what they were. That is disclosed on the tab rather than hidden here.
// ─────────────────────────────────────────────────────────────────────────────

/** Deletion order matters: marks reference events and contacts, so they go
 *  first. Reversed, an interrupted undo leaves attendance pointing at sabhas
 *  that no longer exist, which is worse than the half import it was fixing. */
const UNDO_ORDER = ['attendance', 'individuals', 'events'];

/** A run's documents, or — for anything imported before Phase 25 added run IDs
 *  — everything the importer has ever created. */
function undoQuery(collectionName, runId) {
  const col = collection(db, collectionName);
  return runId
    ? query(col, where('importRunId', '==', runId))
    : query(col, where('source', '==', 'history-import'));
}

/**
 * The import runs on record, newest first, for the Undo list.
 *
 * Imports made before Phase 25 have no run document at all. The tab handles that
 * by offering the legacy sweep (runId null) alongside this list, so a half
 * import from before the marker existed is still reversible.
 */
export async function listImportRuns(max = 20) {
  const snap = await getDocs(query(
    collection(db, 'importRuns'), orderBy('startedAt', 'desc'),
  ));
  return snap.docs.slice(0, max).map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Counts what an undo would delete, WITHOUT reading the documents themselves —
 * getCountFromServer is one read per collection instead of one per row, which
 * matters when the answer is "3,000 marks" and the admin is only deciding
 * whether to look.
 *
 * @param {string|null} runId  null = every history import ever made
 * @returns {Promise<{events:number, contacts:number, marks:number, total:number}>}
 */
export async function analyzeHistoryImportUndo({ runId = null } = {}) {
  const [marks, contacts, events] = await Promise.all(
    UNDO_ORDER.map((c) => getCountFromServer(undoQuery(c, runId)).then((s) => s.data().count)),
  );
  return { events, contacts, marks, total: events + contacts + marks };
}

/**
 * Deletes everything one import created.
 *
 * Safe to re-run, and safe to interrupt: it deletes by query, so a second pass
 * simply finds fewer documents. The run document is kept and marked `undone`
 * rather than deleted — an admin looking at this tab later needs to be able to
 * tell "that import was reversed" from "that import never happened", especially
 * when the reversal was itself interrupted.
 *
 * @param {object}      p
 * @param {string|null} p.runId       null = every history import ever made
 * @param {Function}    [p.onProgress] ({ done, total, phase }) → void
 */
export async function undoHistoryImport({ runId = null, onProgress } = {}) {
  const counts = { events: 0, contacts: 0, marks: 0 };
  const planned = await analyzeHistoryImportUndo({ runId });
  const total = planned.total;
  let done = 0;

  const keyOf = { attendance: 'marks', individuals: 'contacts', events: 'events' };

  for (const collectionName of UNDO_ORDER) {
    if (onProgress) onProgress({ done, total, phase: collectionName });
    const snap = await getDocs(undoQuery(collectionName, runId));

    let batch = writeBatch(db);
    let ops = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      counts[keyOf[collectionName]] += 1;
      ops += 1;
      done += 1;
      if (ops >= WRITE_BATCH_LIMIT) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
        if (onProgress) onProgress({ done, total, phase: collectionName });
      }
    }
    if (ops > 0) await batch.commit();
  }

  if (runId) {
    try {
      await updateDoc(doc(db, 'importRuns', runId), {
        status: 'undone',
        undoneAt: serverTimestamp(),
      });
    } catch { /* the deletes are what mattered and they are done */ }
  }

  if (onProgress) onProgress({ done: total, total, phase: 'done' });
  return counts;
}
