// src/services/roundService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 27 — the calling round, and the post-sabha review it makes possible.
//
// THE PROBLEM THIS SOLVES. A karyakarta rings their 40 assigned contacts before
// Sunday's sabha. Twenty-four say they will come. Eighteen actually turn up.
// Nobody ever finds out which six broke the promise, and nobody ever calls them
// to ask why — which is the single highest-value call in the whole week, because
// those six *intended* to come and something stopped them.
//
// Everything needed to answer that was already in the database and unjoinable:
//
//   • who was called      → batches.individualIds where assignedVolunteerId == me
//   • who turned up       → attendance/{eventId}_{individualId}
//   • what they said      → individuals.status
//
// Two things were missing, and both are added here rather than inferred:
//
//   1. NO LINK FROM A BATCH TO ITS SABHA. `batches` carried area and mandal but
//      not the event it was ringing about, so "the contacts I called for that
//      sabha" was not expressible. batchService now writes eventId/eventDate;
//      this file consumes them, and falls back to the most recent past event in
//      the batch's own mandal for the batches that predate the field.
//
//   2. `status` IS A SINGLE MUTABLE FIELD WITH NO ROUND MARKER. It is what the
//      contact says *now*, so the moment the post-sabha follow-up call is logged
//      — or the moment "Start a new round" blanks it — the evidence that they
//      once promised to come is gone. A review computed off live status is
//      therefore correct for a few days and then quietly wrong forever, and the
//      admin conversion numbers would move every time a volunteer tapped a chip.
//
// So closeRound() freezes it. Once attendance for a sabha is marked, one admin
// action copies each called contact's outcome AND their attendance into
// `individuals.lastRound`, then blanks `status` so the follow-up half of the week
// starts from a clean sheet. After that the review reads an immutable snapshot
// and the follow-up call is free to overwrite `status` with next week's answer.
//
// WHY ONE ROUND DEEP, NOT A `rounds` COLLECTION. Week-over-week attendance
// history already exists in `attendance` (that is what Season stats reads), and
// every individual status change is already appended to `activity`. A rounds
// collection would be a third copy of data the database holds twice, and it
// would need its own security rules. `lastRound` answers the only question the
// screens actually ask — "what happened at the sabha just gone" — for one write
// per contact and no new collection.
//
// READS. classifyRound() is pure and takes rows the caller already has in hand;
// the only new read on the volunteer's screen is one attendance query for its
// own event (~150 docs), which replaces nothing and adds nothing per contact.
// ─────────────────────────────────────────────────────────────────────────────
import { collection, doc, serverTimestamp } from 'firebase/firestore';
// PHASE 24 — metered drop-ins. Closing a round is one write per called contact
// plus one audit row each, so it is a burst worth seeing on the usage dashboard.
import { writeBatch } from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { chunk } from '../lib/firestoreHelpers';
import { intentOf as intentOfStatus, UNREACHED_INTENT } from '../lib/callingStatuses';

// Same cap and the same reason as batchService: Firestore stops a WriteBatch at
// 500 operations, and this writes two per contact.
const WRITE_BATCH_LIMIT = 450;

/**
 * The five buckets of the post-sabha review.
 *
 * Mutually exclusive and exhaustive over (intent × attended), which matters: a
 * karyakarta reading "38 called" and five numbers underneath must be able to add
 * them up to 38, or they stop trusting the panel. `test` is the classifier, and
 * the first match wins, so the order of this array IS the precedence.
 *
 * They are also listed in the order they deserve attention, not in the order the
 * matrix produces them, because that ordering is the whole point of the feature:
 *
 *   1. brokePromise — said yes, seat empty. Nobody has asked them why.
 *   2. cameAnyway   — said no or never answered, and turned up regardless. Your
 *                     record of this person is wrong; fix it while it is obvious.
 *   3. unreached    — never got through, and they did not come. Straight retry.
 *   4. stillDeciding— said maybe or no, did not come. Expected; low priority.
 *   5. kept         — said yes and came. Thank them, invite them again.
 *
 * `queue` marks the groups the calling screen offers as a work list. "Came as
 * promised" is deliberately not one: eighteen thank-you calls would eat the
 * evening that should go to the six who did not come.
 */
export const ROUND_GROUPS = [
  {
    key: 'brokePromise',
    label: 'Said yes, didn’t come',
    short: 'Said yes, absent',
    hint: 'They meant to come and something stopped them. Ask what — this is the call that changes next week.',
    emoji: '🔴',
    tone: 'rose',
    queue: true,
    test: (intent, attended) => intent === 'coming' && !attended,
  },
  {
    key: 'cameAnyway',
    label: 'Came anyway',
    short: 'Came anyway',
    hint: 'They didn’t say yes — or nobody reached them — and they turned up. Worth updating what you know about them.',
    emoji: '🎉',
    tone: 'violet',
    queue: true,
    test: (intent, attended) => intent !== 'coming' && attended,
  },
  {
    key: 'unreached',
    label: 'Couldn’t reach, didn’t come',
    short: 'Not reached',
    hint: 'The call never connected. Try a different time of day.',
    emoji: '🟡',
    tone: 'amber',
    queue: true,
    test: (intent, attended) => intent === UNREACHED_INTENT && !attended,
  },
  {
    key: 'stillDeciding',
    label: 'Said no or still deciding',
    short: 'Said no / maybe',
    hint: 'They told you they probably wouldn’t come, and they didn’t. No surprise and no urgency.',
    emoji: '⚪',
    tone: 'slate',
    queue: false,
    test: (intent, attended) => !attended,   // whatever is left over, absent
  },
  {
    key: 'kept',
    label: 'Came as promised',
    short: 'Came as promised',
    hint: 'Your call worked. A short thank-you and next week’s invite is all this needs.',
    emoji: '🟢',
    tone: 'emerald',
    queue: false,
    test: () => true,                        // coming + attended, and the catch-all
  },
];

export const ROUND_GROUP_MAP = Object.fromEntries(ROUND_GROUPS.map((g) => [g.key, g]));

/** Only the groups the calling screen turns into a walkable queue. */
export const ROUND_QUEUE_GROUPS = ROUND_GROUPS.filter((g) => g.queue);

/** Border/background/text classes per tone. Written out in full so Tailwind's
 *  content scanner keeps them — the same constraint COLOR_TOKENS documents. */
export const ROUND_TONE_CLASSES = {
  rose:    { chip: 'border-rose-300 bg-rose-50 text-rose-800',          dot: 'bg-rose-500',    active: 'border-rose-400 bg-rose-100 text-rose-900' },
  violet:  { chip: 'border-violet-300 bg-violet-50 text-violet-800',    dot: 'bg-violet-500',  active: 'border-violet-400 bg-violet-100 text-violet-900' },
  amber:   { chip: 'border-amber-300 bg-amber-50 text-amber-800',       dot: 'bg-amber-500',   active: 'border-amber-400 bg-amber-100 text-amber-900' },
  slate:   { chip: 'border-slate-200 bg-slate-50 text-slate-600',       dot: 'bg-slate-400',   active: 'border-slate-300 bg-slate-100 text-slate-800' },
  emerald: { chip: 'border-emerald-300 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', active: 'border-emerald-400 bg-emerald-100 text-emerald-900' },
};

/** `2026-08-25` → `25 Aug`. Local, and year-less: the review only ever shows the
 *  sabha just gone, so the year is noise. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortEventDate(date) {
  const [, m, d] = String(date || '').split('-').map(Number);
  if (!m || !d || m < 1 || m > 12) return '';
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Which sabha a batch was ringing about.
 *
 * Explicit when the batch carries an eventId — generated from Phase 27 onward.
 * Otherwise the best available guess: the most recent event on or before today
 * whose mandal matches the batch (an event with no mandal is an all-mandal
 * sabha and matches everything). That fallback exists so the review works on
 * the batches already sitting in the database rather than only on ones cut after
 * this shipped, and it is only ever a fallback — a wrong guess shows the wrong
 * sabha's name, which the panel prints in full so it is visible, not silent.
 */
export function resolveRoundEvent(batch, events = [], today = null) {
  if (!batch) return null;
  const byId = batch.eventId ? events.find((e) => e.id === batch.eventId) : null;
  if (byId) return byId;
  // A stale eventId (the sabha was deleted) falls through to the guess rather
  // than blanking the panel.
  const cutoff = today || new Date().toISOString().slice(0, 10);
  const mandal = batch.mandal || null;
  return events
    .filter((e) => e.date && e.date <= cutoff)
    .filter((e) => !e.mandal || !mandal || e.mandal === mandal)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

/**
 * Splits the contacts a volunteer called into the five ROUND_GROUPS.
 *
 * Pure — no reads, no writes. The caller supplies rows it already has.
 *
 * @param {object}   opts
 * @param {Array}    opts.contacts     the individual documents that were called
 * @param {Set}      opts.attendedIds  individualIds present at the sabha
 * @param {Function} [opts.intent]     status → intent key; defaults to the seed
 *                                     vocabulary. Pass useCallOutcomes().intent
 *                                     so admin-renamed outcomes still classify.
 * @param {string}   [opts.eventId]    when set, a contact whose snapshot belongs
 *                                     to a DIFFERENT sabha is treated as having
 *                                     no snapshot — see below.
 */
export function classifyRound({ contacts = [], attendedIds = new Set(), intent, eventId = null } = {}) {
  const intentFor = typeof intent === 'function' ? intent : ((s) => intentOfStatus(s));

  const groups = {};
  ROUND_GROUPS.forEach((g) => { groups[g.key] = []; });

  let snapshotted = 0;
  for (const c of contacts) {
    if (!c) continue;

    // The snapshot is only usable if it is about THIS sabha. Without that test a
    // contact carrying last month's lastRound would be classified against this
    // week's attendance — mixing one sabha's promise with another's register,
    // which is worse than having no snapshot at all.
    const snap = c.lastRound && (!eventId || c.lastRound.eventId === eventId) ? c.lastRound : null;
    if (snap) snapshotted += 1;

    // Before the round is closed there is no snapshot and live status is exactly
    // right: nothing has overwritten it yet. After it is closed, live status
    // holds the follow-up answer and the snapshot holds the promise. Preferring
    // the snapshot is what makes the numbers stop moving.
    const said = snap ? snap.status : c.status;
    // Same order of preference for attendance. A snapshot taken at close time is
    // authoritative even if somebody later unmarks a register row.
    const attended = snap && typeof snap.attended === 'boolean'
      ? snap.attended
      : attendedIds.has(c.id);

    const key = intentFor(said);
    const group = ROUND_GROUPS.find((g) => g.test(key, attended));
    groups[group.key].push({
      ...c,
      _intent: key,
      _attended: attended,
      _said: said || '',
      // Whether this row's verdict came from the frozen snapshot. The calling
      // screen needs it per contact, not per round: once the round is closed a
      // group stops self-clearing as outcomes are logged (that is the point of
      // freezing it), so "have I already followed this person up" has to be
      // answered some other way — see pendingRound().
      _frozen: Boolean(snap),
      // The two pieces pendingRound() needs to answer that. `cleared` defaults
      // to true for a snapshot written before the flag existed, which is the
      // recommended path and the only one the confirm dialog pre-selects.
      _snapStatus: snap ? (snap.status || '') : null,
      _snapCleared: snap ? snap.cleared !== false : false,
    });
  }

  return {
    groups,
    counts: Object.fromEntries(ROUND_GROUPS.map((g) => [g.key, groups[g.key].length])),
    called: contacts.filter(Boolean).length,
    // How many rows came from a frozen snapshot rather than live status. The UI
    // uses this to say whether the numbers are final or still moving.
    snapshotted,
    frozen: snapshotted > 0,
  };
}

/**
 * The two numbers worth putting on a dashboard, from a classifyRound() result.
 *
 * `promiseKept` is the honest measure of a calling week: of the people who said
 * they would come, what share came. `turnout` is the blunter one: of everybody
 * called, what share came. Both return null rather than 0 when the denominator
 * is empty, because "0% of nobody" printed as a percentage reads like failure.
 */export function summarizeRound(result) {
  const c = result?.counts || {};
  const promised = (c.kept || 0) + (c.brokePromise || 0);
  const attended = (c.kept || 0) + (c.cameAnyway || 0);
  const called = result?.called || 0;
  return {
    called,
    promised,
    attended,
    absent: called - attended,
    promiseKept: promised ? Math.round(((c.kept || 0) / promised) * 100) : null,
    turnout: called ? Math.round((attended / called) * 100) : null,
  };
}

/**
 * Which rows in each group still need a call — the work list, as opposed to the
 * tally.
 *
 * Before the round is closed this is a no-op, and correctly so: the groups are
 * computed from live status, so logging a follow-up outcome reclassifies the
 * contact and they drop out of the queue on their own.
 *
 * After the round is closed they cannot, because the snapshot is frozen on
 * purpose — that is the only reason the admin numbers hold still. So "already
 * done" has to be read off the live status instead, and how depends on how the
 * round was closed:
 *
 *   • closed WITH clearing (the recommended path) — every status in the round
 *     was blanked, so any status at all means somebody has since spoken to them.
 *   • closed WITHOUT clearing — the invite outcome is still sitting there, so
 *     the test is whether it has CHANGED since the freeze.
 *
 * Either way it needs no extra field on the contact, no extra read, and it
 * survives a page reload, which a "seen" list in component state would not.
 */
export function pendingRound(result) {
  const groups = result?.groups || {};
  const pending = {};
  const counts = {};
  const done = (c) => {
    if (!c._frozen) return false;
    const now = c.status || '';
    return c._snapCleared ? Boolean(now) : now !== (c._snapStatus || '');
  };
  ROUND_GROUPS.forEach((g) => {
    const rows = (groups[g.key] || []).filter((c) => !done(c));
    pending[g.key] = rows;
    counts[g.key] = rows.length;
  });
  return { pending, counts };
}

/**
 * Freezes a sabha's calling round onto the contacts that were called.
 *
 * For each contact: `lastRound = { eventId, eventDate, eventTitle, status,
 * reference, attended, cleared, closedAt }`, and — unless the caller opts out —
 * `status` and `reference` are blanked so the follow-up calls that come next are
 * not confused with the invite calls that came before.
 *
 * Deliberately takes ids the caller has already assembled and shown, exactly as
 * resetCallStatuses does: re-deriving "who was in this round" inside the write
 * would let it touch people the confirm dialog never mentioned.
 *
 * Ordering inside each commit is irrelevant, but the ORDER OF THE FIELDS is not:
 * lastRound is set in the same update that clears status, so there is no instant
 * at which a contact has neither. A crash between chunks leaves earlier contacts
 * closed and later ones untouched, and re-running finishes the job — the second
 * pass simply writes a snapshot whose status is now blank, so it is run once and
 * checked, never blind-retried. closeRound therefore reports how far it got.
 *
 * @param {object}   opts
 * @param {object}   opts.event         the events/{id} document ({ id, date, title })
 * @param {Array}    opts.contacts      the individual docs in the round (needs id, status, reference)
 * @param {Set}      opts.attendedIds   individualIds present at that sabha
 * @param {string}   [opts.closedBy]    volunteer id, for the audit row
 * @param {boolean}  [opts.clearStatuses=true]
 * @param {Function} [opts.onProgress]  ({ done, total })
 */
export async function closeRound({
  event,
  contacts = [],
  attendedIds = new Set(),
  closedBy = null,
  clearStatuses = true,
  onProgress,
} = {}) {
  if (!event?.id) throw new Error('Pick the sabha this round was calling for.');

  // Dedupe defensively: a contact sitting in two batches would otherwise be
  // written twice in one commit, which Firestore rejects for the whole batch.
  const byId = new Map();
  for (const c of contacts) if (c?.id && !byId.has(c.id)) byId.set(c.id, c);
  const rows = [...byId.values()];
  if (!rows.length) return { closed: 0, attended: 0, absent: 0 };

  const eventDate = event.date || null;
  const eventTitle = event.title || '';
  let closed = 0;
  let attended = 0;

  for (const slice of chunk(rows, Math.floor(WRITE_BATCH_LIMIT / 2))) {
    const wb = writeBatch(db);
    for (const c of slice) {
      const wasPresent = attendedIds.has(c.id);
      if (wasPresent) attended += 1;

      const patch = {
        lastRound: {
          eventId: event.id,
          eventDate,
          eventTitle,
          status: c.status || '',
          reference: c.reference || '',
          attended: wasPresent,
          // Recorded rather than inferred: pendingRound() needs to know whether
          // a status sitting on this contact is last week's invite outcome or
          // this week's follow-up, and only the close knows which.
          cleared: Boolean(clearStatuses),
          closedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      };
      if (clearStatuses) { patch.status = ''; patch.reference = ''; }
      wb.update(doc(db, 'individuals', c.id), patch);

      wb.set(doc(collection(db, 'activity')), {
        timestamp: serverTimestamp(),
        volunteerId: closedBy,
        individualId: c.id,
        action: 'round_closed',
        details: `${eventTitle || 'Sabha'}${eventDate ? ` (${eventDate})` : ''} — `
          + `said "${c.status || 'nothing'}", ${wasPresent ? 'came' : 'did not come'}`
          + `${clearStatuses ? '. Outcome cleared for follow-up.' : ''}`,
      });
      closed += 1;
    }
    await wb.commit();
    // After the commit, never before: a chunk that threw must not be counted.
    onProgress?.({ done: closed, total: rows.length });
  }

  return { closed, attended, absent: closed - attended };
}

/** Turns a Firestore error from closeRound into something an admin can act on. */
export function describeRoundError(err) {
  if (err?.code === 'permission-denied') {
    return 'Firestore refused the write — closing a round edits every contact in it, '
      + 'so your role needs Edit Contacts. Contacts already closed stay closed, and re-running finishes the rest.';
  }
  return err?.message || 'Something went wrong closing the round.';
}
