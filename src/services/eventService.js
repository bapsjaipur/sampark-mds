// src/services/eventService.js
// Phase 6 — events/{id} + attendance/{eventId_individualId}. See
// PHASE6-NOTES.md for the schema decision (long-format attendance
// collection instead of the legacy's per-event Sheet column).

import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
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
  return updateDoc(doc(db, 'events', eventId), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteEvent(eventId) {
  return deleteDoc(doc(db, 'events', eventId));
}

/** Live subscription to all events, sorted soonest-first by date. Filtering by
 * mandal/area scope happens client-side in the component, same pattern as
 * the rest of the app (mirrors how households/individuals scoping works). */
export function subscribeToEvents(callback) {
  const q = query(collection(db, 'events'), orderBy('date', 'asc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
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

/** One-time fetch of an individual's full attendance history (used on their profile). */
export async function getAttendanceHistoryForIndividual(individualId) {
  const q = query(collection(db, 'attendance'), where('individualId', '==', individualId), orderBy('markedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
