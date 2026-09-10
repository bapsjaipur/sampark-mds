// src/services/eventService.js
// Phase 6 — events/{id} + attendance/{eventId_individualId}. See
// PHASE6-NOTES.md for the schema decision (long-format attendance
// collection instead of the legacy's per-event Sheet column).

import {
  collection, doc, query, where, orderBy, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
// PHASE 24 — metered drop-ins (src/lib/fsMetered.js): same signatures, they count.
// Marking a sabha's attendance is one write per person present, which is the
// single biggest write burst in normal daily use.
import {
  addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
} from '../lib/fsMetered';
import { db } from '../lib/firebase';

export async function createEvent({ title, date, time, durationMinutes, speaker, mandal, area, createdBy }) {
  return addDoc(collection(db, 'events'), {
    title, date, time,
    durationMinutes: Number(durationMinutes) || 120,
    speaker: speaker || '',
    mandal: mandal || null,
    area: area || null,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateEvent(eventId, data) {
  const patch = { ...data, updatedAt: serverTimestamp() };
  // createEvent stores a blank mandal/area as null, but EventForm submits ''
  // for "all Mandals". Left as-is, an edited event no longer matches the
  // `mandal == null` scoping the post-sabha report uses. Normalise here so both
  // paths write the same shape.
  if ('mandal' in patch) patch.mandal = patch.mandal || null;
  if ('area' in patch) patch.area = patch.area || null;
  return updateDoc(doc(db, 'events', eventId), patch);
}

export async function deleteEvent(eventId) {
  return deleteDoc(doc(db, 'events', eventId));
}

/** Live subscription to all events, sorted soonest-first by date. Filtering by
 * mandal/area scope happens client-side in the component, same pattern as
 * the rest of the app (mirrors how households/individuals scoping works). */
export function subscribeToEvents(callback, scope = null) {
  const events = collection(db, 'events');
  // Firestore rules require the query itself to prove its scope. A mandal head
  // therefore subscribes with their assigned mandal constraint rather than
  // downloading the city calendar and hiding rows afterwards.
  const scopedMandals = !scope?.unrestricted && scope?.kind === 'mandal'
    ? (scope.mandals || []).filter(Boolean).slice(0, 30) : [];
  const q = scopedMandals.length
    ? query(events, where('mandal', 'in', scopedMandals))
    : query(events, orderBy('date', 'asc'));
  return onSnapshot(q, (snap) => callback(
    snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  ));
}

/** Picks the nearest event that hasn't fully ended yet — ports
 * pickUpcomingSabha()'s "next relevant event" behavior from the legacy app. */
export function pickUpcomingEvent(events) {
  const now = new Date();
  const withEnd = events
    .map((e) => {
      const start = e.date && e.time ? new Date(`${e.date}T${e.time}`) : null;
      if (!start || Number.isNaN(start.getTime())) return null;
      const end = new Date(start.getTime() + (Number(e.durationMinutes) || 120) * 60000);
      return { ...e, _start: start, _end: end };
    })
    .filter(Boolean)
    .filter((e) => e._end >= now)
    .sort((a, b) => a._start - b._start);
  return withEnd[0] || null;
}

// ── Attendance ──────────────────────────────────────────────────────────
// Doc ID is deterministic (`${eventId}_${individualId}`) so marking present
// is idempotent — calling it twice for the same person doesn't create
// duplicates, and it makes "unmark" a simple delete-by-ID.

function attendanceDocId(eventId, individualId) {
  return `${eventId}_${individualId}`;
}

export async function markPresent({ eventId, individualId, markedBy }) {
  const ref = doc(db, 'attendance', attendanceDocId(eventId, individualId));
  await setDoc(ref, { eventId, individualId, status: 'present', markedBy, markedAt: serverTimestamp() });
}

export async function unmarkPresent({ eventId, individualId }) {
  await deleteDoc(doc(db, 'attendance', attendanceDocId(eventId, individualId)));
}

export async function isMarkedPresent({ eventId, individualId }) {
  const snap = await getDoc(doc(db, 'attendance', attendanceDocId(eventId, individualId)));
  return snap.exists();
}

/** Live subscription to everyone marked present for one event. */
export function subscribeToAttendance(eventId, callback) {
  const q = query(collection(db, 'attendance'), where('eventId', '==', eventId));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/**
 * Live present-count for EVERY event, as `{ [eventId]: count }`.
 *
 * One unfiltered listener on `attendance`, grouped client-side. The two
 * alternatives were both worse:
 *   • a denormalised `presentCount` on events/{id} — attendance writes need
 *     edit_contacts while event writes need manage_events, so the karyekar
 *     marking someone present cannot legally bump the counter, and
 *     `attendance` update is `if false` so a trigger-free client can't fix it;
 *   • getCountFromServer per event — a fresh round-trip per card on every
 *     render, and no live updates while a sabha is being marked.
 *
 * The collection holds one small doc per (event, person) pair, so it stays in
 * the low thousands for years of weekly sabhas.
 */
export function subscribeToAttendanceCounts(callback) {
  return onSnapshot(collection(db, 'attendance'), (snap) => {
    const counts = {};
    snap.docs.forEach((d) => {
      const eventId = d.data().eventId;
      if (eventId) counts[eventId] = (counts[eventId] || 0) + 1;
    });
    callback(counts);
  });
}

/**
 * The same single listener as above, but handing back the rows as well as the
 * counts: `{ counts: {eventId: n}, byEvent: {eventId: [row]} }`.
 *
 * The events screen needs both — a present-count on every card in the list AND
 * the actual rows for whichever event is selected (to mark, export and chart).
 * Running subscribeToAttendanceCounts alongside subscribeToAttendance(eventId)
 * would mean two listeners over the same collection and two chances for the
 * badge and the list to disagree mid-update.
 */
export function subscribeToAllAttendance(callback) {
  return onSnapshot(collection(db, 'attendance'), (snap) => {
    const counts = {};
    const byEvent = {};
    snap.docs.forEach((d) => {
      const row = { id: d.id, ...d.data() };
      if (!row.eventId) return;
      counts[row.eventId] = (counts[row.eventId] || 0) + 1;
      (byEvent[row.eventId] ||= []).push(row);
    });
    callback({ counts, byEvent });
  });
}

/**
 * One-time fetch of an individual's attendance rows.
 *
 * Ordered by markedAt only as a tiebreaker — callers should re-sort by the
 * joined event's own date. Every row imported during the Sevak Call migration
 * carries the same markedAt (the migration run's timestamp), so markedAt order
 * says nothing useful about which sabha came first. See useAttendanceHistory.
 */
export async function getAttendanceHistoryForIndividual(individualId) {
  const q = query(collection(db, 'attendance'), where('individualId', '==', individualId), orderBy('markedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Live version of the above — used by the profile panel so a mark made on the
 *  events screen shows up without a reload. */
export function subscribeToAttendanceForIndividual(individualId, callback, onError) {
  const q = query(collection(db, 'attendance'), where('individualId', '==', individualId));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}
