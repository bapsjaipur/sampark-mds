/**
 * functions/lib/sabhaCoverage.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 33 — the track record, server side.
 *
 * "automatically sabha creation will help in seeing track record which area and
 *  which day sabha not happen. so easy to fallow up there Volunteer."
 *
 * The All Area Sabhas screen answers that for whoever opens it. This module
 * answers it for the weekly email, which is the half that reaches the people who
 * never open the screen. The shape mirrors buildSabhaCoverage() in
 * src/lib/sabhaSchedule.js — same statuses, same miss-streak rule, same
 * treatment of a paused schedule — so the email and the grid cannot tell
 * different stories about the same Sunday.
 *
 * WHAT IT COSTS. Once a week:
 *   • one read of `sabhaSchedules` (tens of documents)
 *   • one range query on `events.date` — a single-field range, served by the
 *     automatic index, so no composite is needed
 *   • one COUNT AGGREGATION per event in the window
 *
 * That last one is the interesting choice. The client learns present-counts from
 * a live listener over the whole `attendance` collection, which is right for a
 * screen and wrong for a cron job — it would pull every attendance row for six
 * weeks, thousands of documents, to derive a hundred numbers. `count()` bills
 * roughly one read per aggregation instead of one per row, so the same answer
 * costs about a hundred reads. Exact, not sampled.
 *
 * ONLY COMPLETED WEEKS. The window ends on the Sunday before the run. A report
 * that included the current week would count sabhas that simply have not
 * happened yet as "not held", and the first thing anyone would learn is to
 * distrust the red numbers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');
const {
  toDateStr, parseDateStr, addDays, startOfWeek, formatDayMonth,
  occurrenceKey, scheduledEventId, occurrencesBetween, describeSchedule,
} = require('./sabhaDates');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Completed weeks of history in the digest. Six is two months of Sundays —
 *  long enough for a streak to mean something, short enough to read. */
const DEFAULT_WEEKS_BACK = 6;

/** How far ahead to look for "next sabha". Two weeks covers a fortnightly rule. */
const NEXT_HORIZON_DAYS = 14;

/** Aggregation queries run in parallel, in slices this size. */
const COUNT_CONCURRENCY = 25;

/**
 * A corrupt or runaway schedule collection should not turn a weekly email into
 * thousands of aggregation queries. Past this many events in the window the
 * attendance counts are skipped entirely and the report says so, rather than
 * quietly reporting every sabha as unmarked — which would read as a citywide
 * collapse that never happened.
 */
const MAX_COUNT_QUERIES = 800;

/** Present-count for each event id, via one count() aggregation per event. */
async function presentCounts(eventIds) {
  const counts = {};
  for (let i = 0; i < eventIds.length; i += COUNT_CONCURRENCY) {
    const slice = eventIds.slice(i, i + COUNT_CONCURRENCY);
    /* eslint-disable no-await-in-loop */
    const snaps = await Promise.all(slice.map((id) => db.collection('attendance')
      .where('eventId', '==', id)
      .count()
      .get()));
    /* eslint-enable no-await-in-loop */
    slice.forEach((id, n) => { counts[id] = snaps[n].data().count || 0; });
  }
  return counts;
}

/**
 * loadSabhaCoverage({ now, weeksBack })
 *
 * @returns {Promise<{
 *   from: string, to: string, weeksBack: number, weeks: Array,
 *   rows: Array, totals: object, attendanceKnown: boolean,
 *   generatedAt: string, periodLabel: string,
 * }>}
 */
async function loadSabhaCoverage({ now = new Date(), weeksBack = DEFAULT_WEEKS_BACK } = {}) {
  const thisMonday = startOfWeek(now);
  const lastSunday = addDays(thisMonday, -1);
  const firstMonday = addDays(thisMonday, -7 * weeksBack);

  const fromStr = toDateStr(firstMonday);
  const toStr = toDateStr(lastSunday);
  const todayStr = toDateStr(now);

  const weeks = Array.from({ length: weeksBack }, (_, i) => {
    const start = addDays(firstMonday, i * 7);
    return {
      index: i,
      start: toDateStr(start),
      end: toDateStr(addDays(start, 6)),
      label: formatDayMonth(toDateStr(start)),
    };
  });

  const base = {
    from: fromStr,
    to: toStr,
    weeksBack,
    weeks,
    rows: [],
    totals: { schedules: 0, active: 0, paused: 0, held: 0, unmarked: 0, missed: 0, followUp: 0 },
    attendanceKnown: true,
    generatedAt: todayStr,
    periodLabel: `${formatDayMonth(fromStr)} – ${formatDayMonth(toStr)}`,
  };

  const scheduleSnap = await db.collection('sabhaSchedules').get();
  const schedules = scheduleSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!schedules.length) return base;

  // Single-field range — no composite index. Everything in the window, so a
  // sabha somebody created BY HAND on a scheduled date is found too and counted
  // as held rather than reported as a miss.
  const eventSnap = await db.collection('events')
    .where('date', '>=', fromStr)
    .where('date', '<=', toStr)
    .get();

  const eventsById = new Map();
  const eventsByKey = new Map();
  eventSnap.docs.forEach((d) => {
    const e = { id: d.id, ...d.data() };
    if (!e.date) return;
    eventsById.set(e.id, e);
    const key = occurrenceKey(e.area, e.mandal, e.date);
    if (!eventsByKey.has(key)) eventsByKey.set(key, e);
  });

  let counts = {};
  let attendanceKnown = true;
  if (eventSnap.size > MAX_COUNT_QUERIES) {
    attendanceKnown = false;
    console.warn(
      `[sabhaCoverage] ${eventSnap.size} events in ${fromStr}–${toStr} exceeds `
      + `${MAX_COUNT_QUERIES}; skipping attendance counts. The report will say a `
      + 'sabha existed but not whether anyone was marked present.',
    );
  } else {
    counts = await presentCounts([...eventsById.keys()]);
  }

  const weekOf = (dateStr) => {
    const d = parseDateStr(dateStr);
    if (!d) return -1;
    return Math.round((startOfWeek(d) - firstMonday) / (7 * 86400000));
  };

  const nextFrom = todayStr;
  const nextTo = toDateStr(addDays(now, NEXT_HORIZON_DAYS));

  const rows = schedules.map((schedule) => {
    // A PAUSED schedule keeps its history. occurrencesBetween() is honest — an
    // inactive rule fires never — so asking it directly would blank the row and
    // erase a real track record because somebody paused the sabha over a
    // festival break. The window here is entirely in the past, so the rule is
    // read as if active: what already happened cannot be changed by a later
    // pause. Mirrors buildSabhaCoverage() in src/lib/sabhaSchedule.js.
    const paused = schedule.active === false;
    const dates = occurrencesBetween({ ...schedule, active: true }, fromStr, toStr);

    const cells = Array.from({ length: weeksBack }, () => null);
    const tally = { held: 0, unmarked: 0, missed: 0 };
    let lastHeld = null;

    for (const date of dates) {
      const i = weekOf(date);
      if (i < 0 || i >= weeksBack) continue;
      const event = eventsById.get(scheduledEventId(schedule.id, date))
        || eventsByKey.get(occurrenceKey(schedule.area, schedule.mandal, date));

      let status;
      if (!event) status = 'missed';
      else if (!attendanceKnown) status = 'held'; // an event existed; see the guard above
      else status = (counts[event.id] || 0) > 0 ? 'held' : 'unmarked';

      tally[status] += 1;
      if (status === 'held' && (!lastHeld || date > lastHeld)) lastHeld = date;
      cells[i] = {
        date,
        status,
        present: attendanceKnown && event ? (counts[event.id] || 0) : null,
        eventId: event ? event.id : null,
      };
    }

    // "Needs follow-up" is a run of misses at the END of the window, not a
    // count. One skipped week during a festival is not a problem; two or more in
    // a row is a mandal that has quietly stopped meeting, and that is the phone
    // call this whole report exists to prompt.
    const filled = cells.filter(Boolean);
    let missStreak = 0;
    for (let i = filled.length - 1; i >= 0 && filled[i].status !== 'held'; i -= 1) missStreak += 1;

    const upcoming = paused ? [] : occurrencesBetween(schedule, nextFrom, nextTo);

    return {
      scheduleId: schedule.id,
      area: schedule.area || '—',
      mandal: schedule.mandal || '—',
      title: schedule.title || '',
      cadence: describeSchedule(schedule),
      time: schedule.time || '',
      paused,
      cells,
      dates,
      ...tally,
      dueTotal: filled.length,
      lastHeld,
      missStreak,
      nextDate: upcoming.length ? upcoming[0] : null,
      // A paused schedule is never a follow-up. Somebody switched it off on
      // purpose; ringing them to ask why the sabha stopped is the one call this
      // report must not generate.
      needsFollowUp: !paused && missStreak >= 2,
    };
  });

  // Worst first — the report is a to-do list, not a directory. Ties break on
  // mandal then area so the same rows keep the same order week to week.
  rows.sort((a, b) => b.missStreak - a.missStreak
    || (b.missed + b.unmarked) - (a.missed + a.unmarked)
    || String(a.mandal).localeCompare(String(b.mandal))
    || String(a.area).localeCompare(String(b.area)));

  const totals = rows.reduce((acc, r) => {
    acc.held += r.held;
    acc.unmarked += r.unmarked;
    acc.missed += r.missed;
    acc.due += r.dueTotal;
    if (r.needsFollowUp) acc.followUp += 1;
    if (r.paused) acc.paused += 1; else acc.active += 1;
    return acc;
  }, { schedules: rows.length, active: 0, paused: 0, held: 0, unmarked: 0, missed: 0, due: 0, followUp: 0 });

  return { ...base, rows, totals, attendanceKnown };
}

module.exports = { loadSabhaCoverage, DEFAULT_WEEKS_BACK };
