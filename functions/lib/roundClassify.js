/**
 * functions/lib/roundClassify.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 38 — the post-sabha round classifier, server side.
 *
 * A TRANSCRIPTION, NOT A SECOND DESIGN. This is src/services/roundService.js's
 * classifyRound() plus src/lib/callingStatuses.js's intentOf(), rewritten in
 * CommonJS because functions/ and src/ are separate npm packages with separate
 * module systems and no shared build step. The pattern is already established
 * here — lib/volunteerScope.js is the same kind of twin of src/lib/scope.js.
 *
 * KEEP IN SYNC with those two files. If the five ROUND_GROUPS or their
 * precedence ever change, a karyakarta's PDF and the same karyakarta's calling
 * screen start disagreeing about who broke a promise, and the PDF is the copy
 * they cannot argue with.
 *
 * WHY THE VOCABULARY IS READ FROM FIRESTORE. Which outcomes mean "said they will
 * come" is admin-editable (settings/callOutcomes), so a hardcoded list of
 * strings would silently reclassify everybody the moment somebody renamed
 * "Interested" to "Aayenge" — every contact would land in "could not reach" and
 * the PDF would report a week in which nobody promised anything. One settings
 * read per job run buys correctness.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** The intent assumed for a contact with no outcome, or an outcome an admin has
 *  since deleted. Mirrors UNREACHED_INTENT in src/lib/callingStatuses.js: a
 *  never-called contact and one nobody could get hold of need the same action. */
const UNREACHED_INTENT = 'unreached';

const VALID_INTENTS = new Set(['coming', 'maybe', 'notComing', 'unreached']);

/**
 * The seeded vocabulary, value → intent. Mirrors DEFAULT_STATUS_CHIPS.
 * Used when settings/callOutcomes does not exist, and — per outcome — when a
 * settings document written before `intent` existed has no such key.
 */
const SEEDED_INTENT = new Map([
  ['Interested', 'coming'],
  ['Not Interested', 'notComing'],
  ['Call Back Later', 'maybe'],
  ['No Answer', 'unreached'],
  ['Already Volunteer', 'coming'],
  ['Donated', null], // a donation is not an RSVP
  ['Follow Up', 'maybe'],
]);

/**
 * settings/callOutcomes → Map<statusValue, intent|null>.
 *
 * Falls back to the seed on any failure. A report that misclassifies is worse
 * than one that uses last-known-good defaults, but a report that throws because
 * a settings document is malformed is worse than both.
 */
async function loadOutcomeIntents() {
  try {
    const snap = await db.collection('settings').doc('callOutcomes').get();
    const raw = snap.exists ? snap.data().outcomes : null;
    if (!Array.isArray(raw) || raw.length === 0) return new Map(SEEDED_INTENT);

    const map = new Map();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const value = String(item.value ?? '').trim();
      if (!value || map.has(value)) continue;
      // An ABSENT intent key inherits the seed; an explicitly cleared one (null,
      // which is what the editor writes for "None") is respected. Same rule as
      // normalizeOutcomes() in src/lib/callingStatuses.js, and for the same
      // reason — see the PHASE 27 migration note there.
      const intent = 'intent' in item
        ? (VALID_INTENTS.has(item.intent) ? item.intent : null)
        : (SEEDED_INTENT.get(value) || null);
      map.set(value, intent);
    }
    return map.size ? map : new Map(SEEDED_INTENT);
  } catch (err) {
    console.error('[roundClassify] could not read settings/callOutcomes, using the seeded vocabulary:', err.message);
    return new Map(SEEDED_INTENT);
  }
}

/** The attendance intent behind a stored status string. */
function intentOf(value, intentMap) {
  const v = String(value || '').trim();
  if (!v) return UNREACHED_INTENT;
  if (!intentMap.has(v)) return UNREACHED_INTENT;
  return intentMap.get(v) || null;
}

/**
 * The five buckets, in the order they deserve attention. First match wins, so
 * the order of this array IS the precedence. Mirrors ROUND_GROUPS in
 * src/services/roundService.js — same keys, same tests, plainer wording because
 * these strings end up in a PDF rendered in Helvetica (see lib/pdfReport.js).
 *
 * `chase` marks the groups that are a task rather than a tally. Those are the
 * ones the PDF puts first and counts in the subject line.
 */
const ROUND_GROUPS = [
  {
    key: 'brokePromise',
    label: 'Said yes, did not come',
    pdfLabel: 'Said yes but did not come',
    hint: 'They meant to come and something stopped them. Ask what - this is the call that changes next week.',
    chase: true,
    test: (intent, attended) => intent === 'coming' && !attended,
  },
  {
    key: 'cameAnyway',
    label: 'Came anyway',
    pdfLabel: 'Came anyway',
    hint: 'They did not say yes - or nobody reached them - and they turned up. Worth updating what you know about them.',
    chase: true,
    test: (intent, attended) => intent !== 'coming' && attended,
  },
  {
    key: 'unreached',
    label: 'Could not reach, did not come',
    pdfLabel: 'Never reached, did not come',
    hint: 'The call never connected. Try a different time of day.',
    chase: true,
    test: (intent, attended) => intent === UNREACHED_INTENT && !attended,
  },
  {
    key: 'stillDeciding',
    label: 'Said no or still deciding',
    pdfLabel: 'Said no or still deciding',
    hint: 'They told you they probably would not come, and they did not. No surprise and no urgency.',
    chase: false,
    test: (intent, attended) => !attended,
  },
  {
    key: 'kept',
    label: 'Came as promised',
    pdfLabel: 'Came as promised',
    hint: 'Your call worked. A short thank-you and next week\'s invite is all this needs.',
    chase: false,
    test: () => true,
  },
];

const ROUND_GROUP_MAP = Object.fromEntries(ROUND_GROUPS.map((g) => [g.key, g]));

/** Only the groups that are a work list. */
const CHASE_GROUPS = ROUND_GROUPS.filter((g) => g.chase);

/**
 * Splits contacts into the five ROUND_GROUPS. Pure — no reads, no writes.
 *
 * @param {object} opts
 * @param {Array}  opts.contacts     individual documents that were called
 * @param {Set}    opts.attendedIds  individualIds present at the sabha
 * @param {Map}    opts.intentMap    from loadOutcomeIntents()
 * @param {string} [opts.eventId]    a contact whose lastRound snapshot belongs to
 *   a DIFFERENT sabha is treated as having no snapshot — otherwise last month's
 *   promise gets crossed against this week's register, which is worse than
 *   having no snapshot at all.
 */
function classifyRound({ contacts = [], attendedIds = new Set(), intentMap = new Map(), eventId = null } = {}) {
  const groups = {};
  ROUND_GROUPS.forEach((g) => { groups[g.key] = []; });

  for (const c of contacts) {
    if (!c) continue;

    const snap = c.lastRound && (!eventId || c.lastRound.eventId === eventId) ? c.lastRound : null;
    // Before the round is closed there is no snapshot and live status is exactly
    // right. After it is closed, live status holds the follow-up answer and the
    // snapshot holds the promise — preferring the snapshot is what stops the
    // numbers moving under the karyakarta after they have read the PDF.
    const said = snap ? snap.status : c.status;
    const attended = snap && typeof snap.attended === 'boolean' ? snap.attended : attendedIds.has(c.id);

    const key = intentOf(said, intentMap);
    const group = ROUND_GROUPS.find((g) => g.test(key, attended));
    groups[group.key].push({
      ...c,
      _group: group.key,
      _intent: key,
      _attended: attended,
      _said: said || '',
    });
  }

  const counts = Object.fromEntries(ROUND_GROUPS.map((g) => [g.key, groups[g.key].length]));
  const called = contacts.filter(Boolean).length;
  const attended = counts.kept + counts.cameAnyway;
  const promised = counts.kept + counts.brokePromise;

  return {
    groups,
    counts,
    called,
    attended,
    absent: called - attended,
    promised,
    // null rather than 0 when the denominator is empty: "0% of nobody" printed as
    // a percentage reads like failure. Same rule as summarizeRound().
    promiseKept: promised ? Math.round((counts.kept / promised) * 100) : null,
    turnout: called ? Math.round((attended / called) * 100) : null,
    chaseCount: CHASE_GROUPS.reduce((n, g) => n + counts[g.key], 0),
  };
}

module.exports = {
  ROUND_GROUPS,
  ROUND_GROUP_MAP,
  CHASE_GROUPS,
  UNREACHED_INTENT,
  SEEDED_INTENT,
  loadOutcomeIntents,
  intentOf,
  classifyRound,
};
