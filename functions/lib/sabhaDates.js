/**
 * functions/lib/sabhaDates.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 33 — the recurrence arithmetic, CommonJS side.
 *
 * This is a deliberate transcription of src/lib/sabhaSchedule.js. That module is
 * ESM inside the Vite bundle, this package is CommonJS with no build step, and
 * there is nowhere to put one shared copy. So there are exactly TWO copies in
 * the repository, and this is the second — not a third. Both the generator
 * (sabhaScheduler.js) and the weekly digest (sabhaDigest.js) require this file
 * rather than keeping their own, because the moment two server-side jobs
 * disagree about which Sundays exist, one of them starts writing sabhas the
 * other reports as missing.
 *
 * If the recurrence rules change, BOTH copies must change. The derived event id
 * is what keeps them honest: a disagreement surfaces as a duplicate sabha on a
 * nearby date rather than silently.
 *
 * Everything is a local `YYYY-MM-DD` string, the same shape events already use.
 * Never `new Date(str)` on a bare date — that parses as UTC and shifts the day
 * backwards for everyone east of Greenwich, which is all of India.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date → local 'YYYY-MM-DD'. */
function toDateStr(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' → local midnight Date, or null. */
function parseDateStr(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar-day arithmetic, so it stays correct across a DST boundary. */
function addDays(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

/** The Monday on or before `date` — weeks run Monday → Sunday. */
function startOfWeek(date) {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  // getDay(): 0=Sun … 6=Sat. Sunday belongs to the week that started six days ago.
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

/**
 * '2026-09-13' → '13 Sep'. Hand-rolled rather than toLocaleDateString because a
 * Cloud Function's ICU locale is not the reader's, and "Sep 13" in an email
 * written for Jaipur is a small, permanent wrongness.
 */
function formatDayMonth(dateStr) {
  const d = parseDateStr(dateStr);
  return d ? `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}` : '—';
}

/**
 * The areas an event or schedule spans; `[]` means city-wide (every area). The
 * CommonJS mirror of eventAreas() in src/lib/scope.js — hand-copied for the same
 * reason occurrenceKey is (ESM bundle vs CommonJS package, no shared build).
 */
function eventAreas(doc) {
  if (Array.isArray(doc && doc.areas)) return doc.areas.filter(Boolean);
  return doc && doc.area ? [doc.area] : [];
}

/** area|mandal|date — how a hand-made sabha is matched to a schedule slot. */
function occurrenceKey(area, mandal, dateStr) {
  return `${area || ''}|${mandal || ''}|${dateStr || ''}`;
}

/**
 * The occurrenceKey(s) a schedule or event occupies on one date — one per area
 * it spans, or the single empty-area key for a city-wide sabha. A joint sabha
 * across two areas therefore matches a hand-made sabha in EITHER of them, so the
 * generator adopts an existing one rather than putting a second sabha on the same
 * evening. Accepts a doc ({ areas, area }) or a bare areas[] array. Mirrors
 * occurrenceKeys() in src/lib/sabhaSchedule.js.
 */
function occurrenceKeys(areasOrDoc, mandal, dateStr) {
  const areas = Array.isArray(areasOrDoc) ? areasOrDoc.filter(Boolean) : eventAreas(areasOrDoc);
  const list = areas.length ? areas : [''];
  return list.map((a) => occurrenceKey(a, mandal, dateStr));
}

/** Deterministic id of the sabha a schedule produces on one date. */
function scheduledEventId(scheduleId, dateStr) {
  return `sch_${scheduleId}_${dateStr}`;
}

/**
 * Every date this schedule falls on inside [fromStr, toStr], inclusive.
 *
 * The anchor for a multi-week interval is the schedule's own `startDate`, not
 * the start of the window being asked about — otherwise a fortnightly sabha
 * would land on a different fortnight depending on when the caller ran.
 */
function occurrencesBetween(schedule, fromStr, toStr) {
  const day = Number(schedule && schedule.dayOfWeek);
  if (!Number.isInteger(day) || day < 0 || day > 6) return [];
  if (schedule.active === false) return [];

  const from = parseDateStr(fromStr);
  const to = parseDateStr(toStr);
  if (!from || !to || from > to) return [];

  const endLimit = parseDateStr(schedule.endDate);
  const end = endLimit && endLimit < to ? endLimit : to;
  if (from > end) return [];

  const interval = Math.max(1, Math.min(52, Number(schedule.intervalWeeks) || 1));
  // First occurrence ever: the first matching weekday on or after startDate.
  const anchor = parseDateStr(schedule.startDate) || new Date(from);
  anchor.setDate(anchor.getDate() + ((day - anchor.getDay() + 7) % 7));

  const out = [];
  const cursor = new Date(anchor);
  // Bounded: an interval of 1 from a startDate a decade back is ~520 steps, and
  // the guard stops a corrupt document from spinning the job.
  for (let i = 0; i < 5000 && cursor <= end; i += 1) {
    if (cursor >= from) out.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + interval * 7);
  }
  return out;
}

/**
 * The event fields one occurrence of a schedule should produce. Timestamps are
 * the caller's business — the generator adds createdAt/updatedAt.
 */
function eventFieldsFromSchedule(schedule, dateStr) {
  const areas = eventAreas(schedule);
  const areaLabel = areas.length ? areas.join(' + ') : 'All areas';
  return {
    title: schedule.title || `${schedule.mandal || 'Sabha'} — ${areaLabel}`.trim(),
    date: dateStr,
    time: schedule.time || '',
    durationMinutes: Number(schedule.durationMinutes) || 120,
    speaker: schedule.speaker || '',
    mandal: schedule.mandal || null,
    // areas[] is the joint/city-wide list; the scalar `area` stays areas[0] so
    // firestore.rules and pre-Phase-34 readers keep seeing a valid single area.
    areas,
    area: areas[0] || null,
    scheduleId: schedule.id,
    // NOT 'history-import' — firestore.rules lets an import_data holder DELETE
    // anything carrying that marker, and a generated sabha is not an imported one.
    source: 'schedule',
    createdBy: schedule.createdBy || null,
  };
}

/** 'Every Sunday · 17:00' — the one-line recurrence, for report rows. */
function describeSchedule(schedule) {
  const day = WEEKDAY_LABELS[Number(schedule && schedule.dayOfWeek)] || '—';
  const interval = Math.max(1, Number(schedule && schedule.intervalWeeks) || 1);
  const suffix = interval === 2 ? 'nd' : interval === 3 ? 'rd' : 'th';
  const cadence = interval === 1 ? 'Every' : `Every ${interval}${suffix}`;
  return [`${cadence} ${day}`, schedule && schedule.time].filter(Boolean).join(' · ');
}

module.exports = {
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  toDateStr,
  parseDateStr,
  addDays,
  startOfWeek,
  formatDayMonth,
  eventAreas,
  occurrenceKey,
  occurrenceKeys,
  scheduledEventId,
  occurrencesBetween,
  eventFieldsFromSchedule,
  describeSchedule,
};
