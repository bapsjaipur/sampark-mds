// src/hooks/useAttendanceHistory.js
// ─────────────────────────────────────────────────────────────────────────────
// "Which sabhas has this person actually attended?" — joined against the event
// documents so each row can show the sabha's title and its own date.
//
// Why not just order the attendance rows by markedAt:
//   Every row brought across in the Sevak Call migration carries the migration
//   run's timestamp, so markedAt order puts a 2023 sabha and a 2025 sabha in
//   whatever sequence the import loop happened to use. events.date is the real
//   chronology, so the join is what makes the list meaningful — that's why this
//   hook exists rather than a bare call to getAttendanceHistoryForIndividual().
//
// Absence is not stored anywhere: a person who didn't come simply has no row.
// `eligibleCount` therefore only counts events this person could plausibly have
// attended (same Mandal, or an all-Mandal event) and only ones that have
// already happened — otherwise next month's sabha would drag the ratio down.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { subscribeToAttendanceForIndividual, subscribeToEvents } from '../services/eventService';

function eventStart(event) {
  if (!event?.date) return null;
  const d = new Date(`${event.date}T${event.time || '00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {string} individualId
 * @param {{ mandal?: string }} [individual] — used to scope `eligibleCount`.
 */
export function useAttendanceHistory(individualId, individual) {
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!individualId) { setRows([]); setLoading(false); return undefined; }
    setLoading(true);
    return subscribeToAttendanceForIndividual(
      individualId,
      (list) => { setRows(list); setLoading(false); },
      (err) => { console.error(err); setError(err); setLoading(false); },
    );
  }, [individualId]);

  useEffect(() => subscribeToEvents(setEvents), []);

  const eventsById = useMemo(() => {
    const m = new Map();
    events.forEach((e) => m.set(e.id, e));
    return m;
  }, [events]);

  // Newest sabha first, by the EVENT's date — not by when the row was written.
  const history = useMemo(() => (
    rows
      .map((r) => {
        const event = eventsById.get(r.eventId);
        return {
          ...r,
          event: event || null,
          // A deleted event leaves the attendance row orphaned; keep it visible
          // rather than silently dropping a sabha the person did attend.
          title: event?.title || 'Deleted event',
          date: event?.date || null,
          time: event?.time || null,
          mandal: event?.mandal || null,
          speaker: event?.speaker || '',
        };
      })
      .sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        if (a.date) return -1;
        if (b.date) return 1;
        return 0;
      })
  ), [rows, eventsById]);

  // Past events this person could have attended.
  const eligible = useMemo(() => {
    const now = new Date();
    const mandal = individual?.mandal || null;
    return events.filter((e) => {
      const start = eventStart(e);
      if (!start || start > now) return false;
      // An event pinned to a Mandal only counts for members of that Mandal.
      if (e.mandal && e.mandal !== mandal) return false;
      return true;
    });
  }, [events, individual?.mandal]);

  const attendedEligible = useMemo(() => {
    const ids = new Set(eligible.map((e) => e.id));
    return history.filter((h) => ids.has(h.eventId)).length;
  }, [history, eligible]);

  return {
    history,
    last: history[0] || null,
    total: history.length,
    eligibleCount: eligible.length,
    attendedEligible,
    /** 0-100, or null when there is nothing to divide by. */
    rate: eligible.length ? Math.round((attendedEligible / eligible.length) * 100) : null,
    loading,
    error,
  };
}

export default useAttendanceHistory;
