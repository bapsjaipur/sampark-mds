/**
 * functions/lib/skReport.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 38 — the per-karyakarta post-sabha follow-up list.
 *
 * THE ASK. "if they call there assigned Batches in My Calling tab then i want
 * they receive a pdf after Sabha there called number who came in sabha or who
 * not come in sabha then he again call those numbers who do not come and ask
 * there reason. make sure they receive only pdf only there assigned batched
 * contacts not all."
 *
 * HOW THIS DIFFERS FROM THE REPORT THAT ALREADY EXISTS. lib/reportData.js's
 * buildPostSabhaReport() answers a sanchalak's question — how was the turnout,
 * who is new, which regulars have gone quiet — and mails ONE identical copy to
 * everybody with send_emails. It has no idea batches exist. This answers a
 * Sampark Karyakarta's question instead: of the forty people *I* rang, who came
 * and who did not, and what did each of them tell me. One email per karyakarta,
 * each containing only their own batch. The two run off the same 15-minute tick
 * and are otherwise unrelated.
 *
 * THE BOUNDARY IS THE BATCH, NOT THE SCOPE. A karyakarta's area/mandal scope is
 * what they may BROWSE; a batch is what they were actually handed. Those differ
 * on purpose — a batch can legitimately contain a contact outside its owner's
 * area — so this reads batches.assignedVolunteerId and never consults
 * lib/volunteerScope.js. That is also why the PDF cannot leak: an id has to have
 * been put in somebody's batch to appear in it at all.
 *
 * WHY IT REFUSES TO SEND ON AN EMPTY REGISTER. Attendance is marked on a phone
 * during the sabha, and until somebody marks it, "did not come" is
 * indistinguishable from "nobody has recorded them yet". Mailing then would tell
 * every karyakarta in the city that their entire batch skipped the sabha, and the
 * follow-up calls that produced would be forty apologies. So zero attendance rows
 * means "not ready", not "nobody came" — see registerUnmarked, and the retry it
 * causes in emailJobs.js. Ported from the same guard in src/hooks/useRoundReview.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');
const { getDocsByIds, prettyDate } = require('./reportData');
const { loadOutcomeIntents, classifyRound } = require('./roundClassify');
const { isDeliverable } = require('./mailer');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * How many karyakartas one sabha may mail. A guard against a runaway, not a
 * product limit: BAPS Jaipur runs well under twenty batches per sabha, so
 * hitting this means something generated batches in a loop. The overflow is
 * logged with names rather than silently dropped.
 */
const MAX_SK_EMAILS_PER_EVENT = 40;

/**
 * Contacts per karyakarta PDF. A batch is 40-ish by design; 400 is the runaway
 * guard. Past it the tables are truncated rather than the PDF abandoned, because
 * lib/pdfReport.js drops any attachment over 512KB of base64 and a dropped
 * attachment is a report the karyakarta never sees.
 */
const MAX_ROWS_PER_PDF = 400;

/**
 * A contact's area. Their own field when they have one (that is how standalone
 * contacts carry it), the parent household's otherwise. Same rule as
 * individualScopeArea() in src/lib/scope.js — the area is not stored twice.
 */
function areaOf(individual, householdsById) {
  if (individual.area) return individual.area;
  const h = individual.householdId ? householdsById[individual.householdId] : null;
  return h?.area || '';
}

/**
 * buildSkBatchReports({ eventId, now })
 *
 * @returns {Promise<{
 *   event: {id, title, date, dateLabel, time, mandal, area},
 *   registerUnmarked: boolean,
 *   presentTotal: number,
 *   batchCount: number,
 *   reports: Array<{
 *     volunteerId, volunteerName, email, deliverable,
 *     batchNames: string[], called, attended, absent, promised,
 *     promiseKept, turnout, chaseCount, counts, groups, truncated
 *   }>
 * }>}
 */
async function buildSkBatchReports({ eventId, now = new Date() }) {
  const eventSnap = await db.collection('events').doc(eventId).get();
  if (!eventSnap.exists) throw new Error(`Event ${eventId} not found.`);
  const ev = { id: eventSnap.id, ...eventSnap.data() };

  const event = {
    id: ev.id,
    title: ev.title || 'Sabha',
    date: ev.date || '',
    dateLabel: prettyDate(ev.date),
    time: ev.time || '',
    mandal: ev.mandal || '',
    area: ev.area || '',
  };

  // ── who turned up
  const attSnap = await db.collection('attendance').where('eventId', '==', eventId).get();
  const attendedIds = new Set();
  attSnap.forEach((d) => {
    const id = d.data().individualId;
    if (id) attendedIds.add(id);
  });

  // Nothing marked — not ready. Bail before spending any more reads on it; the
  // caller releases its claim and the next tick tries again.
  if (attendedIds.size === 0) {
    return { event, registerUnmarked: true, presentTotal: 0, batchCount: 0, reports: [] };
  }

  // ── who called whom
  //
  // Batches carry eventId from Phase 27 onward (batchService writes it). This
  // does NOT fall back to resolveRoundEvent()'s "most recent sabha in the same
  // mandal" guess the way the review panel does: that guess is fine on a screen
  // where the sabha's name is printed next to the numbers and a human can see it
  // is wrong, and not fine at all in an email that goes out unsupervised. A batch
  // with no eventId simply does not belong to this sabha as far as this job knows.
  const batchSnap = await db.collection('batches').where('eventId', '==', eventId).get();

  const bySk = new Map(); // volunteerId -> { ids: Set, batchNames: [] }
  batchSnap.forEach((d) => {
    const b = d.data();
    const vid = b.assignedVolunteerId;
    if (!vid) return; // unassigned batch — nobody to mail
    if (!bySk.has(vid)) bySk.set(vid, { ids: new Set(), batchNames: [] });
    const entry = bySk.get(vid);
    entry.batchNames.push(b.name || `Batch ${d.id.slice(0, 5)}`);
    // A Set, so a contact sitting in two of this karyakarta's own batches is one
    // row and not two. Across DIFFERENT karyakartas they deliberately stay in
    // both lists: two people really did ring them, and both are owed the outcome.
    (b.individualIds || []).forEach((id) => { if (id) entry.ids.add(id); });
  });

  if (bySk.size === 0) {
    return { event, registerUnmarked: false, presentTotal: attendedIds.size, batchCount: batchSnap.size, reports: [] };
  }

  // ── the people, and the karyakartas, in two batched reads
  const allIds = [...new Set([...bySk.values()].flatMap((e) => [...e.ids]))];
  const [individuals, volunteers] = await Promise.all([
    getDocsByIds('individuals', allIds),
    getDocsByIds('volunteers', [...bySk.keys()]),
  ]);

  // Household areas, but only for the members that need one. A contact with their
  // own `area` costs nothing here, which is most of them.
  const needHousehold = [...new Set(
    allIds.map((id) => individuals[id]).filter((i) => i && !i.area && i.householdId).map((i) => i.householdId),
  )];
  const households = needHousehold.length ? await getDocsByIds('households', needHousehold) : {};

  const intentMap = await loadOutcomeIntents();

  const reports = [];
  for (const [volunteerId, entry] of bySk.entries()) {
    const v = volunteers[volunteerId] || {};
    const contacts = [...entry.ids].map((id) => individuals[id]).filter(Boolean);
    const result = classifyRound({ contacts, attendedIds, intentMap, eventId });

    // Flatten to printable rows, group by group, in ROUND_GROUPS precedence order
    // (classifyRound already keyed them that way).
    const shape = (c) => ({
      id: c.id,
      name: c.name || 'Unknown contact',
      mobile: c.mobile || '',
      mandal: c.mandal || '',
      area: areaOf(c, households),
      said: c._said,
      attended: c._attended,
      group: c._group,
    });

    const groups = {};
    let kept = 0;
    let truncated = 0;
    for (const key of Object.keys(result.groups)) {
      const rows = result.groups[key]
        .map(shape)
        .sort((a, b) => a.name.localeCompare(b.name));
      // Truncate the tally groups before the task groups: a karyakarta who loses
      // the tail of "came as promised" has lost reference material, and one who
      // loses the tail of "said yes, did not come" has lost the job.
      const room = Math.max(MAX_ROWS_PER_PDF - kept, 0);
      if (rows.length > room) {
        truncated += rows.length - room;
        groups[key] = rows.slice(0, room);
      } else {
        groups[key] = rows;
      }
      kept += groups[key].length;
    }

    reports.push({
      volunteerId,
      volunteerName: v.name || 'Karyakarta',
      email: isDeliverable(v.reportEmail) ? String(v.reportEmail).trim() : null,
      deliverable: isDeliverable(v.reportEmail),
      batchNames: entry.batchNames,
      called: result.called,
      attended: result.attended,
      absent: result.absent,
      promised: result.promised,
      promiseKept: result.promiseKept,
      turnout: result.turnout,
      chaseCount: result.chaseCount,
      counts: result.counts,
      groups,
      truncated,
      event,
    });
  }

  // Most work to do first, so a cap that bites drops the quietest lists.
  reports.sort((a, b) => b.chaseCount - a.chaseCount || b.called - a.called
    || a.volunteerName.localeCompare(b.volunteerName));

  return {
    event,
    registerUnmarked: false,
    presentTotal: attendedIds.size,
    batchCount: batchSnap.size,
    reports,
  };
}

module.exports = { buildSkBatchReports, MAX_SK_EMAILS_PER_EVENT, MAX_ROWS_PER_PDF };
