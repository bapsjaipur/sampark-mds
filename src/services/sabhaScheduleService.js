// src/services/sabhaScheduleService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 33 — sabhaSchedules/{id}, and the generator that turns them into events.
//
// A schedule document is small and long-lived:
//   { area, mandal, dayOfWeek, time, intervalWeeks, startDate, endDate|null,
//     durationMinutes, speaker, title, active, createdBy, createdAt, updatedAt }
//
// The arithmetic lives in src/lib/sabhaSchedule.js so the grid on screen and the
// documents written here can never disagree about which Sundays exist.
// ─────────────────────────────────────────────────────────────────────────────

import { collection, doc, onSnapshot, query, serverTimestamp } from 'firebase/firestore';
import { addDoc, updateDoc, deleteDoc, setDoc } from '../lib/fsMetered';
import { db } from '../lib/firebase';
import {
  DEFAULT_WEEKS_AHEAD, eventFromSchedule, pendingOccurrences, scheduledEventId,
} from '../lib/sabhaSchedule';
import { normaliseAreas, eventAreas } from '../lib/scope';

const COL = 'sabhaSchedules';

/** '' → null for area/mandal, and numbers coerced, so every write is one shape. */
function normalise(data) {
  const out = { ...data };
  // areas[] is the joint/city-wide list (Phase 34); the scalar `area` is kept as
  // areas[0] for firestore.rules and pre-Phase-34 readers. Either field arriving
  // rewrites both, so a schedule can never be stored half-updated.
  if ('areas' in out || 'area' in out) {
    const norm = normaliseAreas('areas' in out ? out.areas : null, 'area' in out ? out.area : null);
    out.areas = norm.areas;
    out.area = norm.area;
  }
  if ('mandal' in out) out.mandal = out.mandal || null;
  // Phase 43: blank sub-area stored as null so a schedule moved off a sub-area
  // doesn't keep an empty string that reads as "has one".
  if ('subArea' in out) out.subArea = out.subArea || null;
  if ('endDate' in out) out.endDate = out.endDate || null;
  if ('dayOfWeek' in out) out.dayOfWeek = Number(out.dayOfWeek);
  if ('intervalWeeks' in out) out.intervalWeeks = Math.max(1, Math.min(52, Number(out.intervalWeeks) || 1));
  if ('durationMinutes' in out) out.durationMinutes = Number(out.durationMinutes) || 120;
  if ('active' in out) out.active = out.active !== false;
  return out;
}

export async function createSchedule(data) {
  return addDoc(collection(db, COL), {
    ...normalise(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateSchedule(scheduleId, data) {
  return updateDoc(doc(db, COL, scheduleId), {
    ...normalise(data),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Deletes the RULE only. Sabhas it already produced stay put, with their
 * attendance intact — deleting a schedule must never erase a track record, and a
 * cascade would be a fan-out of writes nobody asked for. Future occurrences that
 * are no longer wanted are ordinary events and can be deleted from the calendar.
 */
export async function deleteSchedule(scheduleId) {
  return deleteDoc(doc(db, COL, scheduleId));
}

/** Pausing beats deleting: the history stays attributable to a live rule. */
export async function setScheduleActive(scheduleId, active) {
  return updateDoc(doc(db, COL, scheduleId), { active: Boolean(active), updatedAt: serverTimestamp() });
}

/**
 * Live subscription to every schedule.
 *
 * Unfiltered — the collection is one document per (area, mandal) pair, so tens,
 * not thousands, and firestore.rules gates the whole collection on the same
 * permission that lets you see events. Scoping happens client-side, exactly as
 * the events subscription does.
 */
export function subscribeToSchedules(callback, onError) {
  return onSnapshot(
    query(collection(db, COL)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

/**
 * MATERIALISE the next few weeks of sabhas.
 *
 * Idempotent by construction: each write is a `setDoc` on the derived id
 * `sch_{scheduleId}_{date}`, and `pendingOccurrences` has already dropped every
 * date that has a document — whether this generator made it or a volunteer made
 * it by hand. So running it twice writes nothing the second time, which is what
 * lets the button on screen and the weekly Cloud Function share this code.
 *
 * `createdAt`/`updatedAt` are set on creation only... except they can't be,
 * because a `setDoc` without merge overwrites. That is deliberate — we only ever
 * setDoc ids that were established to be absent, so nothing existing is touched.
 *
 * Writes are counted: one per new sabha. Eighteen areas at one sabha a week over
 * a four-week window is ~72 writes a month, against a 20k/day budget.
 *
 * @returns {Promise<{created: number, skipped: number, failed: Array<{date: string, area: string, error: string}>}>}
 */
export async function generateMissingEvents({
  schedules = [], existingEvents = [], createdBy = null,
  weeksAhead = DEFAULT_WEEKS_AHEAD, today = new Date(), limit = 200,
}) {
  const due = pendingOccurrences({ schedules, events: existingEvents, weeksAhead, today });
  const batch = due.slice(0, limit);
  const failed = [];
  let created = 0;

  // Sequential, not Promise.all. A generation run is a few dozen writes at most,
  // and a burst of parallel setDocs against a rules-checked collection is how you
  // trip the client's write queue for no gain in wall time that anyone notices.
  for (const { schedule, date } of batch) {
    try {
      await setDoc(doc(db, 'events', scheduledEventId(schedule.id, date)), {
        ...eventFromSchedule(schedule, date, createdBy),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      created += 1;
    } catch (err) {
      const list = eventAreas(schedule);
      failed.push({
        date,
        area: list.length ? list.join(' + ') : 'All areas',
        mandal: schedule.mandal || '—',
        error: err?.code || err?.message || 'unknown',
      });
    }
  }

  return { created, skipped: due.length - batch.length, failed, due: due.length };
}
