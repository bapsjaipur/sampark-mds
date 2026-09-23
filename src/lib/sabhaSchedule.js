// src/lib/sabhaSchedule.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 33 — RECURRING SABHAS.
//
// "every sabha happen on almost same day of week and it is recurring and when i
//  automate then it will no need to each time to create event … automatically
//  sabha creation will help in seeing track record which area and which day
//  sabha not happen. so easy to fallow up there Volunteer."
//
// THE SHAPE OF THE ANSWER. A schedule is NOT a kind of event, and a generated
// sabha is NOT a special kind of document. `sabhaSchedules/{id}` is a rule
// ("Sanganer Bal Mandal, Sundays, 17:00") and it MANUFACTURES ordinary
// `events/{id}` documents. Everything already built on events — attendance
// marking, the season analytics, the post-sabha report email, the firestore
// rules, the exports — keeps working with no change at all, and editing one
// week's sabha is just editing an event. The alternative (events computed on the
// fly from the schedule) would have meant every one of those screens learning
// about a second, virtual kind of sabha, and there would be nowhere to hang the
// attendance rows.
//
// IDEMPOTENCE IS THE WHOLE TRICK. A generated event's id is
// `sch_{scheduleId}_{YYYY-MM-DD}` — derived, not random. Generating the same
// window twice therefore produces the same ids, so a second run finds the
// documents already there and writes nothing. That is what lets both the button
// on the screen AND the weekly Cloud Function run the same code without ever
// duplicating a sabha or clobbering an edit somebody made to one.
//
// This file is PURE — no Firestore, no React. The service writes, the component
// draws, and both get their arithmetic from here so the grid on screen and the
// documents in the database can never disagree about which Sundays exist.
// ─────────────────────────────────────────────────────────────────────────────

// eventAreas() is the single client definition of "which areas does this span"
// (Phase 34). Imported rather than re-declared so a schedule and the coverage
// grid agree with the rest of the app; its Cloud Function twin (sabhaDates.js)
// hand-mirrors the same two lines, exactly as it already does for occurrenceKey.
import { eventAreas } from './scope';

export const WEEKDAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
];

export const INTERVALS = [
  { value: 1, label: 'Every week' },
  { value: 2, label: 'Every 2 weeks' },
  { value: 3, label: 'Every 3 weeks' },
  { value: 4, label: 'Every 4 weeks' },
];

/** How far ahead a generation run materialises sabhas. */
export const DEFAULT_WEEKS_AHEAD = 4;

/**
 * The five things a scheduled occurrence can be. `unmarked` and `missed` are the
 * two the request is actually about — between them they are the follow-up list.
 */
export const SABHA_STATUS = {
  held: { key: 'held', label: 'Held', tone: 'green', blurb: 'Sabha happened and attendance was marked' },
  unmarked: { key: 'unmarked', label: 'Not marked', tone: 'yellow', blurb: 'The sabha was on the calendar but nobody marked attendance' },
  missed: { key: 'missed', label: 'No sabha', tone: 'red', blurb: 'No sabha exists for that date at all' },
  upcoming: { key: 'upcoming', label: 'Upcoming', tone: 'blue', blurb: 'Created and still to come' },
  pending: { key: 'pending', label: 'Not created yet', tone: 'slate', blurb: 'Due, but no event document generated yet' },
};

// ── date helpers ────────────────────────────────────────────────────────────
// Everything is a local `YYYY-MM-DD` string, the same shape events already use.
// Never `new Date(str)` on a bare date — that parses as UTC and shifts the day
// backwards for everyone east of Greenwich, which is all of India.

/** 'YYYY-MM-DD' → local midnight Date, or null. */
export function parseDateStr(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date → local 'YYYY-MM-DD'. */
export function toDateStr(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calendar-day arithmetic, so it stays correct across a DST boundary. */
export function addDays(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

/** The Monday on or before `date` — weeks in the grid run Monday → Sunday. */
export function startOfWeek(date) {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  // getDay(): 0=Sun … 6=Sat. Sunday belongs to the week that started six days ago.
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

/** Deterministic id of the sabha a schedule produces on one date. */
export function scheduledEventId(scheduleId, dateStr) {
  return `sch_${scheduleId}_${dateStr}`;
}

/** area|mandal|date — how a hand-made sabha is matched to a schedule slot. */
export function occurrenceKey(area, mandal, dateStr) {
  return `${area || ''}|${mandal || ''}|${dateStr || ''}`;
}

/**
 * The occurrenceKey(s) a schedule or event occupies on one date — one per area
 * it spans, or the single empty-area key for a city-wide sabha. A joint sabha
 * across two areas therefore matches a hand-made sabha in EITHER of them, so the
 * generator adopts an existing one instead of putting a second sabha on the same
 * evening. Accepts a doc ({ areas, area }) or a bare areas[] array.
 */
export function occurrenceKeys(areasOrDoc, mandal, dateStr) {
  const areas = Array.isArray(areasOrDoc) ? areasOrDoc.filter(Boolean) : eventAreas(areasOrDoc);
  const list = areas.length ? areas : [''];
  return list.map((a) => occurrenceKey(a, mandal, dateStr));
}

/**
 * Every date this schedule falls on inside [fromStr, toStr], inclusive.
 *
 * The anchor for a multi-week interval is the schedule's own `startDate`, not
 * the start of the window being asked about — otherwise a fortnightly sabha
 * would land on a different fortnight depending on when you opened the page.
 */
export function occurrencesBetween(schedule, fromStr, toStr) {
  const day = Number(schedule?.dayOfWeek);
  if (!Number.isInteger(day) || day < 0 || day > 6) return [];
  if (schedule?.active === false) return [];

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
  // the guard stops a corrupt document from spinning the render thread.
  for (let i = 0; i < 5000 && cursor <= end; i += 1) {
    if (cursor >= from) out.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + interval * 7);
  }
  return out;
}

/**
 * The event document one occurrence of a schedule should produce.
 *
 * `source: 'schedule'` and `scheduleId` are what tie it back. Note it is NOT
 * `source: 'history-import'` — firestore.rules lets an import_data holder DELETE
 * anything carrying that marker, and a generated sabha is not an imported one.
 */
export function eventFromSchedule(schedule, dateStr, createdBy = null) {
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
    // Phase 43: carry the schedule's sub-area onto every sabha it generates, so a
    // recurring sabha pinned to one sector of an area stays filed there.
    subArea: schedule.subArea || null,
    scheduleId: schedule.id,
    source: 'schedule',
    createdBy: createdBy || schedule.createdBy || null,
  };
}

/** '2026-09-13' → '13 Sep'. Blank-safe, and local — see parseDateStr. */
export function formatOccurrenceDate(dateStr, opts = { day: 'numeric', month: 'short' }) {
  const d = parseDateStr(dateStr);
  return d ? d.toLocaleDateString(undefined, opts) : '—';
}

/** A one-line description of the recurrence, for the schedule cards. */
export function describeSchedule(schedule) {
  const day = WEEKDAYS.find((d) => d.value === Number(schedule?.dayOfWeek));
  const interval = Math.max(1, Number(schedule?.intervalWeeks) || 1);
  const cadence = interval === 1 ? 'Every' : `Every ${interval}${interval === 2 ? 'nd' : interval === 3 ? 'rd' : 'th'}`;
  return [
    `${cadence} ${day ? day.label : '—'}`,
    schedule?.time || null,
  ].filter(Boolean).join(' · ');
}

/**
 * THE TRACK RECORD. Rows are schedules, columns are calendar weeks, cells say
 * what happened.
 *
 * Every input is already in memory on the Events page — the schedules listener
 * is a handful of documents, and `events` / `counts` come from the two
 * subscriptions the page keeps open anyway. So the whole grid costs zero extra
 * Firestore reads, which is the same bargain SabhaAnalytics struck.
 *
 * @param {object}   p
 * @param {object[]} p.schedules   sabhaSchedules documents
 * @param {object[]} p.events      every event in the caller's scope
 * @param {object}   p.counts      { eventId: presentCount }
 * @param {number}   [p.weeksBack]   history shown, in weeks
 * @param {number}   [p.weeksAhead]  future shown, in weeks
 * @param {Date}     [p.today]       injectable clock
 */
export function buildSabhaCoverage({
  schedules = [], events = [], counts = {}, weeksBack = 8, weeksAhead = 3, today = new Date(),
}) {
  const weekCount = weeksBack + weeksAhead + 1;
  const firstMonday = addDays(startOfWeek(today), -7 * weeksBack);
  const fromStr = toDateStr(firstMonday);
  const toStr = toDateStr(addDays(firstMonday, weekCount * 7 - 1));
  const todayStr = toDateStr(today);
  const thisMondayStr = toDateStr(startOfWeek(today));

  const weeks = Array.from({ length: weekCount }, (_, i) => {
    const start = addDays(firstMonday, i * 7);
    const startStr = toDateStr(start);
    return {
      index: i,
      start: startStr,
      end: toDateStr(addDays(start, 6)),
      label: start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      isCurrent: startStr === thisMondayStr,
      isFuture: startStr > thisMondayStr,
    };
  });

  // Two ways in. The id lookup finds sabhas this schedule generated; the
  // area|mandal|date lookup finds one somebody created BY HAND on the same day,
  // which must count as held — otherwise the first weeks of the grid, before
  // anyone had a schedule, read as a wall of red for sabhas that did happen.
  const eventsById = new Map();
  const eventsByKey = new Map();
  for (const e of events) {
    if (!e?.date) continue;
    eventsById.set(e.id, e);
    // A joint sabha registers under each of its areas, so a schedule listing any
    // one of them finds it.
    for (const key of occurrenceKeys(e, e.mandal, e.date)) {
      if (!eventsByKey.has(key)) eventsByKey.set(key, e);
    }
  }

  const weekOf = (dateStr) => {
    const d = parseDateStr(dateStr);
    if (!d) return -1;
    return Math.floor((startOfWeek(d) - firstMonday) / (7 * 86400000) + 0.5);
  };

  const rows = schedules.map((schedule) => {
    // A PAUSED schedule still shows what already happened, but nothing ahead.
    // occurrencesBetween() is honest — an inactive rule fires never — so asking
    // it directly would blank the whole row and erase a real track record just
    // because somebody paused the sabha over a festival break. Instead the rule
    // is read as if active, up to today only: the past is history and cannot be
    // changed by a later pause, while the future is genuinely not scheduled.
    const paused = schedule.active === false;
    const dates = paused
      ? occurrencesBetween({ ...schedule, active: true }, fromStr, todayStr < toStr ? todayStr : toStr)
      : occurrencesBetween(schedule, fromStr, toStr);
    const cells = Array.from({ length: weekCount }, () => null);
    const tally = { held: 0, unmarked: 0, missed: 0, upcoming: 0, pending: 0 };
    let lastHeld = null;

    for (const date of dates) {
      const i = weekOf(date);
      if (i < 0 || i >= weekCount) continue;
      let event = eventsById.get(scheduledEventId(schedule.id, date));
      if (!event) {
        for (const key of occurrenceKeys(schedule, schedule.mandal, date)) {
          event = eventsByKey.get(key);
          if (event) break;
        }
      }
      const present = event ? (counts[event.id] || 0) : 0;
      const future = date > todayStr;

      let status;
      if (!event) status = future ? 'pending' : 'missed';
      else if (future) status = 'upcoming';
      else status = present > 0 ? 'held' : 'unmarked';

      tally[status] += 1;
      if (status === 'held' && (!lastHeld || date > lastHeld)) lastHeld = date;
      cells[i] = { date, status, present, eventId: event?.id || null, generated: Boolean(event?.scheduleId) };
    }

    // "Needs follow-up" is a run of misses at the END of the past, not a count.
    // One skipped week during a festival is not a problem; three in a row is a
    // mandal that has quietly stopped meeting, and that is the phone call.
    const pastCells = cells.filter((c) => c && c.date <= todayStr);
    let missStreak = 0;
    for (let i = pastCells.length - 1; i >= 0 && pastCells[i].status !== 'held'; i -= 1) missStreak += 1;

    return {
      schedule,
      cells,
      dates,
      ...tally,
      pastTotal: pastCells.length,
      lastHeld,
      missStreak,
      // A paused schedule is never a follow-up. Somebody switched it off on
      // purpose; ringing them to ask why the sabha stopped is the one call this
      // list must not generate.
      needsFollowUp: !paused && missStreak >= 2,
    };
  }).sort((a, b) => b.missStreak - a.missStreak
    || String(a.schedule.mandal || '').localeCompare(String(b.schedule.mandal || ''))
    || String(a.schedule.area || '').localeCompare(String(b.schedule.area || '')));

  const totals = rows.reduce((acc, r) => {
    acc.held += r.held; acc.unmarked += r.unmarked; acc.missed += r.missed;
    acc.upcoming += r.upcoming; acc.pending += r.pending;
    if (r.needsFollowUp) acc.followUp += 1;
    return acc;
  }, { held: 0, unmarked: 0, missed: 0, upcoming: 0, pending: 0, followUp: 0 });

  return { weeks, rows, totals, from: fromStr, to: toStr, todayStr };
}

/**
 * Which (schedule, date) pairs have no event document yet, over the generation
 * window. This is exactly what a generation run has to write, and it is computed
 * from events already in memory — so working out what is missing costs nothing.
 *
 * Only FUTURE and today's dates are filled in. Back-filling last month's sabhas
 * would invent a track record of meetings that never happened, which is the
 * opposite of what the grid is for.
 */
export function pendingOccurrences({
  schedules = [], events = [], weeksAhead = DEFAULT_WEEKS_AHEAD, today = new Date(),
}) {
  const fromStr = toDateStr(today);
  const toStr = toDateStr(addDays(today, weeksAhead * 7));
  const ids = new Set(events.map((e) => e.id));
  const keys = new Set();
  for (const e of events) {
    if (!e?.date) continue;
    for (const key of occurrenceKeys(e, e.mandal, e.date)) keys.add(key);
  }

  const out = [];
  for (const schedule of schedules) {
    for (const date of occurrencesBetween(schedule, fromStr, toStr)) {
      if (ids.has(scheduledEventId(schedule.id, date))) continue;
      // Somebody already created this sabha by hand — in ANY of the areas a joint
      // sabha lists — so adopt theirs rather than putting a second one on the
      // same evening.
      if (occurrenceKeys(schedule, schedule.mandal, date).some((key) => keys.has(key))) continue;
      out.push({ schedule, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
