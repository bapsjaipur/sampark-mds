// src/lib/eventAnalytics.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 25 — "Events tab should be more advance and stats because every week that
// will use for each mandal. and advance stats."
//
// EventDashboard already answers everything about ONE sabha. What was missing is
// the question a sanchalak actually asks about a weekly rhythm: not "how many
// came on Saturday" but "is my mandal growing or quietly shrinking, and WHO
// stopped coming". That needs the sabhas seen as a series.
//
// COSTS NOTHING. subscribeToAllAttendance already streams every attendance row
// for every event through one listener (EventsPage keeps it open for the present
// counts on the cards), and useAllContacts already has the people. So every
// number below is derived in memory from data the page is holding anyway — no
// extra Firestore reads, which matters on the free plan.
//
// THE DEFINITIONS ARE THE HARD PART, so they are stated once, here, and every
// screen reads them from this file rather than inventing its own:
//
//   window        The last N sabhas that have a date in the past, oldest first.
//                 Weekly-by-mandal means "the last 12" is roughly a quarter.
//   eligible      People matching the current mandal/area filter. This is the
//                 denominator for turnout, and it is deliberately the roster and
//                 not "everybody who has ever attended" — a mandal of 60 with 20
//                 coming is a different story from a mandal of 22 with 20 coming.
//   rate          attended / sabhas-in-window, per person.
//   regular       rate >= 0.7      — the core who turn up
//   occasional    0.3 <= rate < 0.7
//   rare          0 < rate < 0.3
//   dormant       rate == 0 in this window (may still have attended long ago)
//   lapsed        attended at least once in the window, then missed the last
//                 LAPSE_MISSES sabhas in a row. THE FOLLOW-UP LIST: someone who
//                 used to come and has stopped is the highest-value phone call
//                 on this page.
//   new face      their FIRST EVER attendance (across every sabha on record, not
//                 just this window) falls inside the window.
//   retention     of the people at sabha i, the share who also came to i+1.
//
// A person is counted at most once per sabha: attendance IDs are
// `${eventId}_${individualId}` so the collection cannot hold two, but the maths
// below de-duplicates anyway rather than trusting that.
// ─────────────────────────────────────────────────────────────────────────────

/** Missing this many sabhas in a row, after having attended, counts as lapsed. */
export const LAPSE_MISSES = 3;

export const RATE_BANDS = [
  { key: 'regular', label: 'Regular', min: 0.7, tone: 'emerald', blurb: 'At 7 in 10 sabhas or more' },
  { key: 'occasional', label: 'Occasional', min: 0.3, tone: 'sky', blurb: 'Between 3 and 7 in 10' },
  { key: 'rare', label: 'Rare', min: 0.0001, tone: 'amber', blurb: 'Fewer than 3 in 10' },
  { key: 'dormant', label: 'Not seen', min: 0, tone: 'slate', blurb: 'No sabha in this window' },
];

export function bandFor(rate) {
  return RATE_BANDS.find((b) => rate >= b.min) || RATE_BANDS[RATE_BANDS.length - 1];
}

/**
 * Has this sabha already happened? Same rule as EventsPage's own isPast, kept
 * here so the analytics window and the list's Upcoming/Past split cannot drift.
 */
export function isEventPast(event, now = Date.now()) {
  if (!event?.date) return false;
  const end = new Date(`${event.date}T${event.time || '23:59'}`);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() + (Number(event.durationMinutes) || 120) * 60000 < now;
}

function pct(n, d) {
  if (!(d > 0) || !n) return 0;
  const raw = (n / d) * 100;
  // A real but tiny share must not render as a flat 0 — on a 3,000-contact
  // roster that reads as "broken" rather than as "small". Keep one decimal until
  // the figure rounds to at least 1.
  return raw < 1 ? Math.max(Math.round(raw * 10) / 10, 0.1) : Math.round(raw);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday of a YYYY-MM-DD string, parsed as local time (not UTC). */
function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getDay();
}

/**
 * buildSabhaAnalytics — everything the cross-event view shows.
 *
 * @param {object}   p
 * @param {object[]} p.events       every event on the calendar
 * @param {object}   p.byEvent      { eventId: [attendanceRow] } from subscribeToAllAttendance
 * @param {object[]} p.individuals  the contacts in scope (already scoped by useAllContacts)
 * @param {string}   [p.mandal]     '' for all
 * @param {string}   [p.area]       '' for all
 * @param {number}   [p.windowSize] how many past sabhas to look at
 * @param {number}   [p.now]        injectable clock, for tests
 */
export function buildSabhaAnalytics({
  events = [], byEvent = {}, individuals = [],
  mandal = '', area = '', windowSize = 12, now = Date.now(),
}) {
  // ── 1. Which sabhas are in the window ───────────────────────────────
  // An event's own mandal/area is only meaningful when it was set — most
  // imported sabhas have neither, and filtering them out would empty the page.
  // So a sabha is in scope if it says nothing, or if it says the filtered value.
  const inScopeEvent = (e) => (!mandal || !e.mandal || e.mandal === mandal)
    && (!area || !e.area || e.area === area);

  const past = events
    .filter((e) => e.date && isEventPast(e, now) && inScopeEvent(e))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const windowEvents = windowSize > 0 ? past.slice(-windowSize) : past;
  const windowIds = new Set(windowEvents.map((e) => e.id));

  // ── 2. Who counts as eligible ───────────────────────────────────────
  const eligible = individuals.filter(
    (i) => (!mandal || i.mandal === mandal) && (!area || i.area === area),
  );
  const eligibleIds = new Set(eligible.map((i) => i.id));

  // ── 3. Attendance, indexed both ways ────────────────────────────────
  // presentByEvent: eventId → Set(individualId), de-duplicated.
  // firstEverDate:  individualId → earliest sabha date they were ever marked at,
  //                 across EVERY event, which is what makes "new face" mean new
  //                 rather than "new to this window".
  const dateOf = new Map(events.map((e) => [e.id, e.date || '']));
  const presentByEvent = new Map();
  const firstEverDate = new Map();
  const lastEverDate = new Map();
  const totalEverById = new Map();

  Object.entries(byEvent).forEach(([eventId, rows]) => {
    const date = dateOf.get(eventId);
    const set = new Set();
    (rows || []).forEach((r) => {
      if (!r.individualId) return;
      set.add(r.individualId);
      if (!date) return;
      const prevFirst = firstEverDate.get(r.individualId);
      if (!prevFirst || date < prevFirst) firstEverDate.set(r.individualId, date);
      const prevLast = lastEverDate.get(r.individualId);
      if (!prevLast || date > prevLast) lastEverDate.set(r.individualId, date);
    });
    set.forEach((id) => totalEverById.set(id, (totalEverById.get(id) || 0) + 1));
    if (windowIds.has(eventId)) presentByEvent.set(eventId, set);
  });

  const windowStart = windowEvents.length ? windowEvents[0].date : null;

  /** How many people in scope were marked at one sabha. */
  const inScopeCount = (eventId) => {
    const set = presentByEvent.get(eventId) || new Set();
    let n = 0;
    set.forEach((id) => { if (eligibleIds.has(id)) n += 1; });
    return n;
  };

  // ── 4. Per-sabha series ─────────────────────────────────────────────
  const sabhas = windowEvents.map((e, i) => {
    const set = presentByEvent.get(e.id) || new Set();
    // Only people in scope are counted, so a mandal filter genuinely narrows the
    // number rather than just relabelling it. `outside` is kept because a
    // non-zero value there is usually a sabha several mandals attended.
    let inScope = 0;
    let outside = 0;
    let newFaces = 0;
    set.forEach((id) => {
      if (eligibleIds.has(id)) inScope += 1; else outside += 1;
      if (firstEverDate.get(id) === e.date) newFaces += 1;
    });
    const prev = i > 0 ? (presentByEvent.get(windowEvents[i - 1].id) || new Set()) : null;
    let returning = 0;
    if (prev) set.forEach((id) => { if (prev.has(id)) returning += 1; });
    return {
      id: e.id,
      title: e.title || `Sabha — ${e.date}`,
      date: e.date,
      time: e.time || '',
      mandal: e.mandal || '',
      area: e.area || '',
      present: inScope,
      outside,
      total: set.size,
      newFaces,
      returning,
      // Turnout against the roster, which is the number that tells you whether
      // the mandal is being reached — a rising count in a mandal that grew twice
      // as fast is not actually good news.
      pct: pct(inScope, eligible.length),
      delta: i > 0 ? inScope - inScopeCount(windowEvents[i - 1].id) : null,
    };
  });

  // ── 5. Per-person view over the window ──────────────────────────────
  const people = eligible.map((person) => {
    // marks: oldest → newest, one boolean per sabha in the window. Drawn as the
    // little dot row in the UI, and re-exported as the wide sheet's Present cells.
    const marks = windowEvents.map(
      (e) => (presentByEvent.get(e.id) || new Set()).has(person.id),
    );
    const attended = marks.filter(Boolean).length;

    // Counting back from the most recent sabha: how many in a row were attended,
    // and how many in a row were missed. Exactly one of these can be non-zero.
    let streak = 0;
    let missStreak = 0;
    for (let i = marks.length - 1; i >= 0 && marks[i]; i -= 1) streak += 1;
    for (let i = marks.length - 1; i >= 0 && !marks[i]; i -= 1) missStreak += 1;

    const rate = windowEvents.length ? attended / windowEvents.length : 0;
    const first = firstEverDate.get(person.id) || null;
    return {
      id: person.id,
      name: person.name || '(no name)',
      mobile: person.mobile || '',
      mandal: person.mandal || '',
      area: person.area || '',
      subArea: person.subArea || '',
      // PHASE 26 — is this person on the follow-up calling list? Carried through
      // so the season view can act on these segments ("take everyone who has
      // never come off the calling list") without a second pass over the roster.
      // ABSENT MEANS ON, deliberately — see services/callingPoolService.js.
      onCallList: person.callingPool !== false,
      attended,
      of: windowEvents.length,
      rate,
      band: bandFor(rate).key,
      marks,
      streak,
      missStreak,
      firstEver: first,
      lastEver: lastEverDate.get(person.id) || null,
      totalEver: totalEverById.get(person.id) || 0,
      // New to the sangh, as far as the records go: their first ever sabha is
      // inside this window.
      isNew: Boolean(first && windowStart && first >= windowStart),
      // Came, then stopped. The reason this page exists.
      isLapsed: attended > 0 && missStreak >= LAPSE_MISSES,
      neverEver: !first,
    };
  });

  const segments = {
    // The four bands partition `eligible` exactly, which is what lets the UI draw
    // them as one stacked bar. Don't narrow them — the extra lists below are cuts
    // ACROSS the bands, not replacements for them.
    regular: people.filter((p) => p.band === 'regular'),
    occasional: people.filter((p) => p.band === 'occasional'),
    rare: people.filter((p) => p.band === 'rare'),
    dormant: people.filter((p) => p.band === 'dormant'),
    lapsed: people.filter((p) => p.isLapsed).sort((a, b) => b.missStreak - a.missStreak
      || (a.lastEver < b.lastEver ? 1 : -1)),
    newFaces: people.filter((p) => p.isNew).sort((a, b) => (a.firstEver < b.firstEver ? 1 : -1)),
    // In the roster, never marked present at any sabha ever. Different from
    // dormant: nobody has ever seen them at one.
    neverEver: people.filter((p) => p.neverEver).sort((a, b) => a.name.localeCompare(b.name)),
    // Came at some point, but not once in this window — the gentler follow-up
    // list. A lapsed person stopped recently; these drifted off earlier. Longest
    // gone last, so the most recently seen are the first ones you ring.
    driftedAway: people.filter((p) => p.band === 'dormant' && !p.neverEver)
      .sort((a, b) => (a.lastEver < b.lastEver ? 1 : -1)),
  };

  // ── 6. Grouped comparison, the "each mandal" of the request ─────────
  function groupBy(key) {
    const groups = new Map();
    eligible.forEach((i) => {
      const name = (i[key] || '').trim() || '—';
      if (!groups.has(name)) groups.set(name, { name, ids: new Set() });
      groups.get(name).ids.add(i.id);
    });
    return [...groups.values()].map((g) => {
      const trend = windowEvents.map((e) => {
        const set = presentByEvent.get(e.id) || new Set();
        let n = 0;
        g.ids.forEach((id) => { if (set.has(id)) n += 1; });
        return n;
      });
      const unique = new Set();
      windowEvents.forEach((e) => {
        const set = presentByEvent.get(e.id) || new Set();
        g.ids.forEach((id) => { if (set.has(id)) unique.add(id); });
      });
      const sum = trend.reduce((a, b) => a + b, 0);
      const avg = trend.length ? sum / trend.length : 0;
      const groupPeople = people.filter((p) => (p[key] || '').trim() === (g.name === '—' ? '' : g.name));
      return {
        name: g.name,
        eligible: g.ids.size,
        unique: unique.size,
        avgPresent: Math.round(avg * 10) / 10,
        avgTurnout: pct(avg, g.ids.size),
        // Reach: the share of the roster who showed up at least once. A mandal
        // with 12 regulars out of 60 and one with 40 rotating people both average
        // 12 a week, and they are not the same mandal.
        reach: pct(unique.size, g.ids.size),
        regulars: groupPeople.filter((p) => p.band === 'regular').length,
        lapsed: groupPeople.filter((p) => p.isLapsed).length,
        trend,
        last: trend.length ? trend[trend.length - 1] : 0,
        prev: trend.length > 1 ? trend[trend.length - 2] : null,
      };
    }).sort((a, b) => b.avgPresent - a.avgPresent || b.eligible - a.eligible);
  }

  // ── 7. Week-on-week retention ───────────────────────────────────────
  const retention = [];
  for (let i = 1; i < windowEvents.length; i += 1) {
    const prev = presentByEvent.get(windowEvents[i - 1].id) || new Set();
    const here = presentByEvent.get(windowEvents[i].id) || new Set();
    let kept = 0;
    prev.forEach((id) => { if (here.has(id)) kept += 1; });
    retention.push({
      from: windowEvents[i - 1].date,
      to: windowEvents[i].date,
      base: prev.size,
      kept,
      lost: prev.size - kept,
      pct: pct(kept, prev.size),
    });
  }

  // ── 8. Which day of the week actually fills the hall ────────────────
  const dayMap = new Map();
  sabhas.forEach((s) => {
    const d = weekdayOf(s.date);
    if (d == null) return;
    if (!dayMap.has(d)) dayMap.set(d, { day: d, label: DAY_LABELS[d], sabhas: 0, sum: 0 });
    const bucket = dayMap.get(d);
    bucket.sabhas += 1;
    bucket.sum += s.present;
  });
  const byWeekday = [...dayMap.values()]
    .map((b) => ({ ...b, avg: Math.round((b.sum / b.sabhas) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg);

  const counts = sabhas.map((s) => s.present);
  const uniqueAttendees = new Set();
  windowEvents.forEach((e) => {
    (presentByEvent.get(e.id) || new Set()).forEach((id) => {
      if (eligibleIds.has(id)) uniqueAttendees.add(id);
    });
  });

  // Trajectory: the second half of the window against the first. One sabha up or
  // down is weather; a whole half being down is a trend, and that is the thing
  // worth putting on the screen.
  const half = Math.floor(counts.length / 2);
  const firstHalf = counts.slice(0, half);
  const lastHalf = counts.slice(counts.length - half);
  const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const momentum = half >= 2
    ? Math.round((avgOf(lastHalf) - avgOf(firstHalf)) * 10) / 10
    : null;

  return {
    sabhas,
    people,
    segments,
    retention,
    byWeekday,
    byMandal: groupBy('mandal'),
    byArea: groupBy('area'),
    window: {
      size: windowEvents.length,
      available: past.length,
      from: windowStart,
      to: windowEvents.length ? windowEvents[windowEvents.length - 1].date : null,
    },
    totals: {
      sabhas: windowEvents.length,
      eligible: eligible.length,
      avgPresent: counts.length ? Math.round(avgOf(counts) * 10) / 10 : 0,
      medianPresent: median(counts),
      bestSabha: sabhas.reduce((best, s) => (!best || s.present > best.present ? s : best), null),
      worstSabha: sabhas.reduce((worst, s) => (!worst || s.present < worst.present ? s : worst), null),
      avgTurnout: pct(avgOf(counts), eligible.length),
      uniqueAttendees: uniqueAttendees.size,
      reach: pct(uniqueAttendees.size, eligible.length),
      newFaces: segments.newFaces.length,
      lapsed: segments.lapsed.length,
      regulars: segments.regular.length,
      neverEver: segments.neverEver.length,
      driftedAway: segments.driftedAway.length,
      // On the follow-up calling list, out of `eligible`. The season view offers
      // to move whole segments on and off it, so the current split has to be
      // visible next to the button that changes it.
      onCallList: people.filter((p) => p.onCallList).length,
      offCallList: people.filter((p) => !p.onCallList).length,
      avgRetention: retention.length
        ? Math.round(retention.reduce((a, r) => a + r.pct, 0) / retention.length)
        : 0,
      momentum,
      // Marks recorded in the window, in scope or not — what the import or the
      // week's marking actually produced.
      marks: sabhas.reduce((a, s) => a + s.total, 0),
    },
  };
}

/**
 * Flattens the analytics into CSV rows: one row per person, one column per sabha.
 * Deliberately the SAME wide shape the importer reads, so a season can be
 * exported, edited in Excel and imported back without reshaping anything.
 */
export function analyticsToCsv(analytics) {
  const head = [
    'Name', 'Phone', 'Mandal', 'Area', 'Sub Area',
    'Attended', 'Of', 'Rate %', 'Band', 'Miss streak', 'First ever', 'Last ever',
    'On call list',
    ...analytics.sabhas.map((s) => `Sabha_${s.date}_${(s.title || '').slice(0, 5)}`),
  ];
  const body = analytics.people
    .slice()
    .sort((a, b) => b.attended - a.attended || a.name.localeCompare(b.name))
    .map((p) => [
      p.name, p.mobile, p.mandal, p.area, p.subArea,
      p.attended, p.of, Math.round(p.rate * 100), p.band, p.missStreak,
      p.firstEver || '', p.lastEver || '',
      p.onCallList ? 'Yes' : 'No',
      ...p.marks.map((m) => (m ? 'Present' : '')),
    ]);
  return [head, ...body]
    .map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n');
}
