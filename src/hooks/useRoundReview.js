// src/hooks/useRoundReview.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 27 — "what happened at the sabha I called for", for one volunteer.
//
// Takes the batches and contacts useMyBatchQueue already has in hand, works out
// which sabha those batches were inviting people to, joins the register for it,
// and hands back the five ROUND_GROUPS. The calling screen turns three of them
// into work lists; nothing else changes.
//
// READS. Deliberately frugal, because this runs on every karyekar's phone:
//
//   • the sabha — ONE getDoc when the batch carries eventId (every batch cut
//     from Phase 27 onward). Only batches that predate the field fall back to a
//     10-document query for the most recent past sabhas, and that is a one-time
//     fetch, not a listener: which sabha last Sunday was is not going to change.
//   • the register — one live subscribeToAttendance for that single event
//     (~150 small documents), and only once the sabha is actually over. Live
//     rather than fetched so the follow-up lists appear on the volunteer's phone
//     the moment an admin finishes marking, with no refresh and no instructions.
//
// There is no listener on the events collection anywhere in here, which is the
// difference between ~1 read and ~40 per calling session.
//
// THE GUARD THAT MATTERS. If the register comes back empty the hook reports
// `ready: false` and the screen must not show groups. An unmarked sabha and a
// sabha nobody attended are the same shape of data, and treating the first as
// the second would tell a volunteer that all 38 of their contacts skipped it —
// sending three dozen apology calls to people who were sitting in the hall.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, orderBy, query, where } from 'firebase/firestore';
// PHASE 24 — metered so the calling screen's share of the daily read budget is
// visible on the usage dashboard rather than guessed at.
import { getDoc, getDocs } from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { subscribeToAttendance } from '../services/eventService';
import { classifyRound, pendingRound, resolveRoundEvent, summarizeRound } from '../services/roundService';
import { useCallOutcomes } from './useCallOutcomes';

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * @param {object} opts
 * @param {Array}  opts.batches   the batches assigned to me (needs id, eventId, mandal, individualIds)
 * @param {Array}  opts.contacts  the individual docs behind them
 */
export function useRoundReview({ batches = [], contacts = [] } = {}) {
  // The live vocabulary, so an outcome an admin renamed still classifies. Passed
  // straight into classifyRound as its intent resolver.
  const { intent, loading: outcomesLoading } = useCallOutcomes();

  const [event, setEvent] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);
  // null means "not loaded yet", which is not the same as an empty Set — see the
  // guard note in the header.
  const [attendedIds, setAttendedIds] = useState(null);

  // A stable primitive: `batches` is a fresh array on every snapshot, and the
  // effects below must not re-fetch just because the object identity moved.
  const batchKey = batches
    .map((b) => `${b?.id || ''}:${b?.eventId || ''}:${b?.mandal || ''}`)
    .join('|');

  /**
   * Which sabha this round belongs to.
   *
   * A volunteer usually holds one batch, but when they hold several the honest
   * answer is "the sabha most of my contacts were called for" — weighted by
   * contact count, not batch count, so a stray 3-contact batch from last month
   * cannot outvote 40 contacts called for yesterday.
   */
  const roundEventId = useMemo(() => {
    const weight = new Map();
    for (const b of batches) {
      if (!b?.eventId) continue;
      weight.set(b.eventId, (weight.get(b.eventId) || 0) + (b.individualIds?.length || 0));
    }
    if (!weight.size) return null;
    return [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [batchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The contacts that belong to THIS round.
   *
   * Scoped to the batches carrying the winning eventId. Without that, a
   * volunteer holding two batches for two different sabhas would have last
   * month's contacts classified against this week's register — every one of them
   * absent, because they were never on that day's list.
   *
   * With no eventId anywhere (pre-Phase-27 batches) there is nothing to scope by
   * and the whole queue is treated as one round, which is what it was.
   */
  const roundIds = useMemo(() => {
    if (!roundEventId) return null;
    const s = new Set();
    for (const b of batches) {
      if (b?.eventId !== roundEventId) continue;
      (b.individualIds || []).forEach((id) => s.add(id));
    }
    return s;
  }, [batchKey, roundEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The sabha ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!batchKey) { setEvent(null); return undefined; }
    setEventLoading(true);
    (async () => {
      try {
        if (roundEventId) {
          const snap = await getDoc(doc(db, 'events', roundEventId));
          if (cancelled) return;
          if (snap.exists()) { setEvent({ id: snap.id, ...snap.data() }); return; }
          // A deleted sabha falls through to the guess rather than blanking the
          // panel — the same choice resolveRoundEvent documents.
        }
        // Fallback for batches cut before eventId existed. Ten documents, once:
        // a range filter and an order on the SAME field, so no composite index.
        const snap = await getDocs(query(
          collection(db, 'events'),
          where('date', '<=', todayISO()),
          orderBy('date', 'desc'),
          limit(10),
        ));
        if (cancelled) return;
        const recent = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEvent(resolveRoundEvent(batches[0], recent));
      } catch {
        // The review is a bonus panel, never the screen's reason for existing.
        if (!cancelled) setEvent(null);
      } finally {
        if (!cancelled) setEventLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [batchKey, roundEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Before the sabha there is nothing to review, and an empty register for a
  // sabha that has not happened yet is the correct, uninteresting answer. So the
  // listener does not open at all until the day arrives.
  const eventOver = Boolean(event?.date && event.date <= todayISO());

  // ── The register ──────────────────────────────────────────────────────────
  useEffect(() => {
    setAttendedIds(null);
    if (!event?.id || !eventOver) return undefined;
    return subscribeToAttendance(event.id, (rows) => {
      setAttendedIds(new Set(rows.map((r) => r.individualId).filter(Boolean)));
    });
  }, [event?.id, eventOver]);

  const roundContacts = useMemo(
    () => contacts.filter((c) => c && (!roundIds || roundIds.has(c.id))),
    [contacts, roundIds],
  );

  const review = useMemo(() => {
    if (!event?.id || !attendedIds) return null;
    return classifyRound({ contacts: roundContacts, attendedIds, intent, eventId: event.id });
  }, [roundContacts, attendedIds, intent, event?.id]);

  const summary = useMemo(() => (review ? summarizeRound(review) : null), [review]);

  // The tally and the work list are different numbers once the round is frozen:
  // "6 said yes and didn't come" stays 6 all week, while the queue behind it
  // empties as the calls get made.
  const { pending, counts: pendingCounts } = useMemo(
    () => (review ? pendingRound(review) : { pending: null, counts: null }),
    [review],
  );

  // `review.frozen` is the second way in: once an admin has closed the round the
  // snapshot on each contact holds its own attendance, so the panel stays right
  // even if somebody later clears the register.
  const ready = Boolean(review && (attendedIds.size > 0 || review.frozen));

  return {
    event,
    eventOver,
    loading: eventLoading || outcomesLoading,
    /** How many people were marked present at the sabha in total. 0 with
     *  eventOver true is the "nobody has marked it yet" case. */
    attendanceMarked: attendedIds ? attendedIds.size : 0,
    attendanceLoaded: attendedIds !== null,
    review,
    summary,
    groups: review?.groups || null,
    counts: review?.counts || null,
    pending,
    pendingCounts,
    ready,
    roundContacts,
  };
}

export default useRoundReview;
