/**
 * functions/lib/reportData.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 20 — the numbers behind the automated reports, read from Firestore.
 *
 * Replaces three Apps Script functions that read the Contacts / Attendance /
 * Sabha sheets directly:
 *   buildDailyVolunteerStats_()  → buildDailyStats()
 *   sendPostSabhaReport()'s body → buildPostSabhaReport()
 *   the birthday trigger's body  → buildBirthdayData()
 *
 * TIMEZONE. Cloud Functions run in UTC; the temple runs in IST. Every "today"
 * in this file means "today in Asia/Kolkata", computed by shifting the instant
 * by +05:30 and reading UTC fields off the result. Doing it by string
 * formatting instead (toLocaleString with a timeZone) is tempting but gives you
 * a string you then have to re-parse, and the round trip is where off-by-one-day
 * bugs live — a 22:00 IST job is 16:30 UTC, i.e. still "yesterday" in UTC for
 * half the year's worth of naive comparisons.
 *
 * WHY ACTIVITY, NOT INDIVIDUALS. Daily counts come from the append-only
 * activity log, not from the individuals' current status. A contact whose status
 * was set to "Call Back Later" this morning and "Interested" this evening is one
 * contact in the daily report but two status events, and the report shows the
 * work done that day rather than a snapshot that later edits would rewrite.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');
const { buildWhatsAppUrl, DEFAULT_BIRTHDAY_TEMPLATE, DEFAULT_ANNIVERSARY_TEMPLATE } = require('./wa');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Actions in the activity log that represent "a call was placed". */
const CALL_ACTIONS = new Set(['call_logged', 'call_initiated', 'call']);
/** Statuses that mean the contact still needs another touch. */
const FOLLOW_UP_STATUSES = new Set(['Call Back Later', 'No Answer', 'Follow Up']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n) => String(n).padStart(2, '0');

/** UTC fields of `instant` shifted into IST — read them as IST wall-clock. */
function istParts(instant) {
  const d = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

/** The UTC instant of 00:00 IST on the given IST calendar date. */
function istMidnight(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

/** The UTC instant of an IST wall-clock date + 'HH:MM' time. */
function istInstant(dateStr, timeStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  const [hh, mm] = String(timeStr || '00:00').split(':').map((x) => Number(x) || 0);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm) - IST_OFFSET_MS);
}

function istDayBounds(instant) {
  const p = istParts(instant);
  const start = istMidnight(p.year, p.month, p.day);
  return {
    start,
    end: new Date(start.getTime() + DAY_MS),
    dateKey: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    monthDay: `${pad(p.month)}-${pad(p.day)}`,
    label: `${WEEKDAYS[p.weekday]}, ${p.day} ${MONTHS[p.month - 1]} ${p.year}`,
  };
}

function istDateKey(instant) {
  const p = istParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function prettyDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return String(dateStr || '');
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetch many documents by id. getAll() takes a variadic list of refs and has no
 * 30-item ceiling like `where(documentId(), 'in', ...)`, but it does have a
 * practical request-size limit, hence the chunking.
 */
async function getDocsByIds(collectionName, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = {};
  for (const slice of chunk(unique, 300)) {
    const refs = slice.map((id) => db.collection(collectionName).doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s) => { if (s.exists) map[s.id] = { id: s.id, ...s.data() }; });
  }
  return map;
}

/**
 * The status an activity row recorded.
 *
 * Prefers the explicit `value` field written by src/services/contactService.js.
 * Rows created before that field existed only carry `details: "Status set to X"`,
 * so the string is parsed as a fallback — without it, every historical row would
 * land in the "Unknown" bucket and the first month of reports would look broken.
 */
function statusFromActivity(row) {
  if (row.value !== undefined && row.value !== null && String(row.value).trim()) {
    return String(row.value).trim();
  }
  const m = /^Status set to (.+)$/.exec(String(row.details || '').trim());
  return m ? m[1].trim() : 'Unknown';
}

async function loadVolunteerNames() {
  const snap = await db.collection('volunteers').get();
  const map = {};
  snap.forEach((d) => { map[d.id] = d.data().name || 'Volunteer'; });
  return map;
}

// ── Daily calling report ────────────────────────────────────────────────────

/**
 * buildDailyStats({ now })
 *
 * @returns {Promise<{
 *   dateKey: string, dateLabel: string,
 *   totals: { contacts: number, calls: number, statusCounts: Object },
 *   perVolunteer: Array<{volunteerId, name, contacts, calls, followUps, statusCounts}>,
 *   pending: { total: number, unassignedBatches: number, assignedBatches: number }
 * }>}
 */
async function buildDailyStats({ now = new Date() } = {}) {
  const day = istDayBounds(now);

  const [activitySnap, names] = await Promise.all([
    db.collection('activity')
      .where('timestamp', '>=', day.start)
      .where('timestamp', '<', day.end)
      .get(),
    loadVolunteerNames(),
  ]);

  const per = new Map(); // volunteerId -> accumulator
  const totalStatusCounts = {};
  const totalContacts = new Set();
  let totalCalls = 0;

  function bucket(volunteerId) {
    const key = volunteerId || '__unknown__';
    if (!per.has(key)) {
      per.set(key, {
        volunteerId: key,
        name: names[key] || (volunteerId ? 'Removed volunteer' : 'Unattributed'),
        contactSet: new Set(),
        calls: 0,
        followUps: 0,
        statusCounts: {},
      });
    }
    return per.get(key);
  }

  activitySnap.forEach((d) => {
    const row = d.data();
    const acc = bucket(row.volunteerId);

    if (row.action === 'status_changed') {
      const status = statusFromActivity(row);
      acc.contactSet.add(row.individualId);
      totalContacts.add(row.individualId);
      acc.statusCounts[status] = (acc.statusCounts[status] || 0) + 1;
      totalStatusCounts[status] = (totalStatusCounts[status] || 0) + 1;
      if (FOLLOW_UP_STATUSES.has(status)) acc.followUps += 1;
    } else if (CALL_ACTIONS.has(row.action)) {
      acc.calls += 1;
      totalCalls += 1;
    }
  });

  const perVolunteer = [...per.values()]
    .map((v) => ({
      volunteerId: v.volunteerId,
      name: v.name,
      contacts: v.contactSet.size,
      calls: v.calls,
      followUps: v.followUps,
      statusCounts: v.statusCounts,
    }))
    // Nobody wants a leaderboard row for a volunteer who only opened the app.
    .filter((v) => v.contacts > 0 || v.calls > 0)
    .sort((a, b) => b.contacts - a.contacts || b.calls - a.calls || a.name.localeCompare(b.name));

  return {
    dateKey: day.dateKey,
    dateLabel: day.label,
    totals: { contacts: totalContacts.size, calls: totalCalls, statusCounts: totalStatusCounts },
    perVolunteer,
    pending: await countPendingInBatches(),
  };
}

/**
 * How much assigned work is still untouched. Deliberately capped: this exists to
 * add one line to an email, and reading 6000 individual documents every night to
 * produce it is not a trade worth making. When the cap bites, `capped` is set and
 * the template can say "at least N".
 */
async function countPendingInBatches({ maxIds = 3000 } = {}) {
  const snap = await db.collection('batches').get();
  const ids = [];
  let assignedBatches = 0;
  let unassignedBatches = 0;

  snap.forEach((d) => {
    const b = d.data();
    if (b.assignedVolunteerId) {
      assignedBatches += 1;
      (b.individualIds || []).forEach((id) => ids.push(id));
    } else {
      unassignedBatches += 1;
    }
  });

  const unique = [...new Set(ids)];
  const capped = unique.length > maxIds;
  const docs = await getDocsByIds('individuals', unique.slice(0, maxIds));
  const total = Object.values(docs).filter((i) => !String(i.status || '').trim()).length;

  return { total, capped, assignedBatches, unassignedBatches };
}

// ── Post-sabha attendance report ────────────────────────────────────────────

/**
 * findEventsToReport({ now, lookbackHours, graceMinutes, claimField })
 *
 * Events that finished recently and have not been reported yet. Replaces the
 * legacy "AutoEmailed" sheet column with an `emailedAt` field on the event.
 *
 * graceMinutes exists because attendance is marked ON the phone DURING the
 * sabha and the last few names land minutes after it ends; mailing at the exact
 * end time reliably under-counts. lookbackHours bounds the catch-up window so a
 * function that was broken for a week doesn't suddenly mail seven old reports.
 *
 * PHASE 38 — claimField. There are now TWO independent fan-outs off the same
 * 15-minute tick: the sanchalak's whole-sabha report (`emailedAt`) and the
 * per-karyakarta batch follow-up (`skReportsSentAt`, see lib/skReport.js). They
 * must not share a claim — the karyakarta job legitimately declines to send
 * while the attendance register is still empty and retries on the next tick, and
 * if that shared `emailedAt` it would either block the sanchalak's report or,
 * worse, be permanently consumed by it. One field each, same finder.
 */
async function findEventsToReport({
  now = new Date(), lookbackHours = 24, graceMinutes = 10, claimField = 'emailedAt',
} = {}) {
  const fromKey = istDateKey(new Date(now.getTime() - (lookbackHours + 48) * 60 * 60 * 1000));
  const toKey = istDateKey(now);

  const snap = await db.collection('events')
    .where('date', '>=', fromKey)
    .where('date', '<=', toKey)
    .get();

  const due = [];
  snap.forEach((d) => {
    const e = { id: d.id, ...d.data() };
    if (e[claimField]) return;
    const start = istInstant(e.date, e.time);
    if (!start) return;
    const end = new Date(start.getTime() + (Number(e.durationMinutes) || 120) * 60000);
    const ready = new Date(end.getTime() + graceMinutes * 60000);
    if (ready > now) return;
    if (now.getTime() - end.getTime() > lookbackHours * 60 * 60 * 1000) return;
    due.push({ ...e, _end: end });
  });

  return due.sort((a, b) => a._end - b._end);
}

/**
 * buildPostSabhaReport({ eventId, now })
 *
 * The X/Y column is the legacy 12-month attendance ratio: sabhas attended out of
 * sabhas held. "Held" is scoped to the event's own mandal when it has one —
 * counting a Malviya Nagar regular against Vaishali Nagar's sabhas would make
 * every ratio meaningless.
 */
async function buildPostSabhaReport({ eventId, now = new Date() }) {
  const eventSnap = await db.collection('events').doc(eventId).get();
  if (!eventSnap.exists) throw new Error(`Event ${eventId} not found.`);
  const event = { id: eventSnap.id, ...eventSnap.data() };

  // ── this event's attendance
  const attSnap = await db.collection('attendance').where('eventId', '==', eventId).get();
  const presentIds = [];
  const markedBy = new Set();
  attSnap.forEach((d) => {
    const a = d.data();
    presentIds.push(a.individualId);
    if (a.markedBy) markedBy.add(a.markedBy);
  });

  // ── the comparable sabhas of the last 12 months
  const fromKey = istDateKey(new Date(now.getTime() - 365 * DAY_MS));
  const histSnap = await db.collection('events')
    .where('date', '>=', fromKey)
    .where('date', '<=', event.date)
    .get();

  const history = [];
  histSnap.forEach((d) => {
    const e = { id: d.id, ...d.data() };
    if (e.id === event.id) return;
    if (event.mandal && e.mandal && e.mandal !== event.mandal) return;
    if (event.mandal && !e.mandal) return;
    history.push(e);
  });

  // individualId -> number of past sabhas attended
  const attendedCount = new Map();
  const historyIds = history.map((e) => e.id);
  for (const slice of chunk(historyIds, 30)) {
    const s = await db.collection('attendance').where('eventId', 'in', slice).get();
    s.forEach((d) => {
      const id = d.data().individualId;
      attendedCount.set(id, (attendedCount.get(id) || 0) + 1);
    });
  }

  const held = history.length + 1; // + this one
  const regularThreshold = Math.ceil(history.length / 2);

  // Regulars who didn't come: enough past attendance, absent today.
  const presentSet = new Set(presentIds);
  const regularAbsentIds = [...attendedCount.entries()]
    .filter(([id, n]) => n >= regularThreshold && regularThreshold > 0 && !presentSet.has(id))
    .map(([id]) => id);

  const individuals = await getDocsByIds('individuals', [...presentIds, ...regularAbsentIds]);
  const volunteerNames = await loadVolunteerNames();

  const row = (id, extraAttendedToday) => {
    const ind = individuals[id] || {};
    const past = attendedCount.get(id) || 0;
    return {
      id,
      name: ind.name || 'Unknown contact',
      mandal: ind.mandal || '',
      mobile: ind.mobile || '',
      attended: past + (extraAttendedToday ? 1 : 0),
      held,
      isFirstTimer: past === 0,
    };
  };

  const present = presentIds
    .map((id) => row(id, true))
    .sort((a, b) => a.name.localeCompare(b.name));

  const regularsAbsent = regularAbsentIds
    .map((id) => row(id, false))
    .sort((a, b) => b.attended - a.attended || a.name.localeCompare(b.name));

  // Expected headcount. With a mandal, that's the mandal's roll. Without one it
  // falls back to the active pool (anyone who came to any comparable sabha in
  // the last year) — a made-up denominator is worse than a conservative one.
  let expected;
  if (event.mandal) {
    const mSnap = await db.collection('individuals').where('mandal', '==', event.mandal).get();
    expected = mSnap.size;
  } else {
    expected = new Set([...attendedCount.keys(), ...presentIds]).size;
  }
  if (expected < present.length) expected = present.length;

  return {
    event: {
      id: event.id,
      title: event.title || 'Sabha',
      date: event.date || '',
      dateLabel: prettyDate(event.date),
      time: event.time || '',
      mandal: event.mandal || '',
      area: event.area || '',
      speaker: event.speaker || '',
    },
    present,
    regularsAbsent,
    firstTimers: present.filter((p) => p.isFirstTimer),
    expected,
    turnoutPct: expected ? Math.round((present.length / expected) * 100) : 0,
    held,
    comparableSabhas: history.length,
    markedByIds: [...markedBy],
    markedByNames: [...markedBy].map((id) => volunteerNames[id] || 'Unknown'),
  };
}

// ── Birthdays & anniversaries ───────────────────────────────────────────────

function yearsSince(dateStr, todayParts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (!year || year < 1900 || year > todayParts.year) return null;
  return todayParts.year - year;
}

/**
 * buildBirthdayData({ now, templates })
 *
 * Queries the denormalised dobMonthDay / anniversaryMonthDay 'MM-DD' fields — an
 * equality match on a single field, so no composite index is needed. The full
 * `dob` is only used to work out the age, and is allowed to be missing: plenty of
 * imported records have a birthday but no birth year.
 */
async function buildBirthdayData({ now = new Date(), templates = {} } = {}) {
  const day = istDayBounds(now);
  const parts = istParts(now);

  const [dobSnap, annSnap] = await Promise.all([
    db.collection('individuals').where('dobMonthDay', '==', day.monthDay).get(),
    db.collection('individuals').where('anniversaryMonthDay', '==', day.monthDay).get(),
  ]);

  const bTemplate = templates.birthdayTemplate || DEFAULT_BIRTHDAY_TEMPLATE;
  const aTemplate = templates.anniversaryTemplate || DEFAULT_ANNIVERSARY_TEMPLATE;

  const birthdays = dobSnap.docs.map((d) => {
    const i = { id: d.id, ...d.data() };
    const age = yearsSince(i.dob, parts);
    return {
      id: i.id,
      name: i.name || 'Unknown contact',
      mobile: i.mobile || '',
      mandal: i.mandal || '',
      age,
      waUrl: buildWhatsAppUrl({ mobile: i.mobile, template: bTemplate, contact: i, extra: { age } }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const anniversaries = annSnap.docs.map((d) => {
    const i = { id: d.id, ...d.data() };
    const years = yearsSince(i.anniversary, parts);
    return {
      id: i.id,
      name: i.name || 'Unknown contact',
      mobile: i.mobile || '',
      mandal: i.mandal || '',
      years,
      waUrl: buildWhatsAppUrl({ mobile: i.mobile, template: aTemplate, contact: i, extra: { years } }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return { dateKey: day.dateKey, dateLabel: day.label, monthDay: day.monthDay, birthdays, anniversaries };
}

/** settings/messageTemplate, defaults applied. */
async function getMessageTemplates() {
  try {
    const snap = await db.collection('settings').doc('messageTemplate').get();
    const data = snap.exists ? snap.data() : {};
    return {
      birthdayTemplate: data.birthdayTemplate || DEFAULT_BIRTHDAY_TEMPLATE,
      anniversaryTemplate: data.anniversaryTemplate || DEFAULT_ANNIVERSARY_TEMPLATE,
    };
  } catch (err) {
    console.error('[reportData] could not read settings/messageTemplate:', err.message);
    return { birthdayTemplate: DEFAULT_BIRTHDAY_TEMPLATE, anniversaryTemplate: DEFAULT_ANNIVERSARY_TEMPLATE };
  }
}

module.exports = {
  buildDailyStats,
  countPendingInBatches,
  findEventsToReport,
  buildPostSabhaReport,
  // PHASE 38 — reused by lib/skReport.js rather than copied a third time.
  getDocsByIds,
  buildBirthdayData,
  getMessageTemplates,
  // exported for the jobs and for testing the timezone arithmetic
  istParts,
  istDayBounds,
  istDateKey,
  istInstant,
  prettyDate,
  statusFromActivity,
};
