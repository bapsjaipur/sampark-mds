// src/services/notificationService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 48 — client side of the in-app notification bell.
//
// Two halves, both thin:
//   • sendBulkNotification / previewBulkNotification — the ONE callable
//     (functions/notifications.js). The right to send is decided server-side from
//     the send_notifications grant; nothing here trusts the client's own claim.
//     preview resolves the audience count WITHOUT writing, so the composer can say
//     "this reaches N people" before it commits.
//   • subscribeToMyNotifications + fetchInbox + markSeen / markAllSeen / dismiss —
//     the per-user inbox at notifications/{uid}/inbox/{id}, written ONLY by the
//     server (Admin SDK) and read/updated/deleted here by its owner (firestore.rules).
//
// READ DISCIPLINE. The live listener is the one standing cost, so it is bounded
// like usePresence's: unread-only, newest 30, metered through meterSnapshot (there
// is no onSnapshot wrapper in fsMetered — a realtime listener bills per CHANGED
// doc, not per read, so meterSnapshot is the right meter). An idle bell re-reads
// nothing; it costs again only when the unread set actually changes. The full
// inbox page uses a paged one-shot getDocs instead, so opening it is one bounded
// read, not a second standing listener.
// ─────────────────────────────────────────────────────────────────────────────

import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection, query, where, orderBy, limit, startAfter, onSnapshot, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getDocs, updateDoc, deleteDoc, writeBatch } from '../lib/fsMetered';
import { meterSnapshot } from '../lib/usageMeter';

/** Newest unread kept live. Matches the "30+" cap the bell badge shows. */
export const UNREAD_LISTEN_LIMIT = 30;

/**
 * Send a bulk alert. audience = { everyone?, areas?[], mandals?[], roleIds?[],
 * volunteerIds?[] }. Returns { count, written, truncated, sample }.
 */
export async function sendBulkNotification(payload) {
  const fn = httpsCallable(getFunctions(), 'sendBulkNotification');
  const res = await fn(payload || {});
  return res.data;
}

/**
 * Resolve how many people an audience reaches WITHOUT writing anything, so the
 * composer can confirm the blast radius first. Same callable, preview flag. A
 * placeholder title is sent only because the callable requires one; preview
 * short-circuits before any write, so it never reaches a recipient.
 */
export async function previewBulkNotification(audience) {
  const fn = httpsCallable(getFunctions(), 'sendBulkNotification');
  const res = await fn({ audience, title: 'preview', preview: true });
  return res.data; // { count, sample }
}

/** Send only to yourself (toSelf), to see exactly what a recipient will see. */
export async function sendTestToSelf(payload) {
  const fn = httpsCallable(getFunctions(), 'sendBulkNotification');
  const res = await fn({ ...(payload || {}), toSelf: true });
  return res.data;
}

/**
 * Live unread inbox for one volunteer. Raw onSnapshot (fsMetered has no listener
 * wrapper) metered by meterSnapshot. Returns an unsubscribe; cb receives an array
 * of { id, ...item } newest-first, or [] on error so the bell degrades to empty
 * rather than throwing.
 *
 * ONE listener per uid, ref-counted. The bell is mounted in two places at once
 * (desktop sidebar + mobile top bar — src/components/AppLayout.jsx), and one of
 * the two is only CSS-hidden, so React keeps BOTH mounted and both subscribe.
 * Without sharing, that is two identical realtime listeners billing the same
 * changes twice against the daily read budget. Here every caller for a given uid
 * attaches to a single shared onSnapshot; the query detaches only when the last
 * caller unsubscribes. A late subscriber is handed the last known snapshot
 * synchronously, so a second bell never flashes empty.
 */
const _liveSubs = new Map(); // uid -> { unsub, listeners:Set<cb>, last:Array }

export function subscribeToMyNotifications(uid, cb) {
  if (!uid) { cb([]); return () => {}; }

  let entry = _liveSubs.get(uid);
  if (!entry) {
    entry = { unsub: null, listeners: new Set(), last: [] };
    const q = query(
      collection(db, 'notifications', uid, 'inbox'),
      where('seen', '==', false),
      orderBy('createdAt', 'desc'),
      limit(UNREAD_LISTEN_LIMIT),
    );
    entry.unsub = onSnapshot(
      q,
      (snap) => {
        meterSnapshot(snap, 'notifications');
        entry.last = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        entry.listeners.forEach((fn) => { try { fn(entry.last); } catch { /* one bad consumer must not drop the rest */ } });
      },
      (err) => {
        console.warn('[notifications] listener error:', err?.message || err);
        entry.last = [];
        entry.listeners.forEach((fn) => { try { fn([]); } catch { /* ignore */ } });
      },
    );
    _liveSubs.set(uid, entry);
  }

  entry.listeners.add(cb);
  cb(entry.last); // hand the newcomer what we already know, no extra read

  return () => {
    entry.listeners.delete(cb);
    if (entry.listeners.size === 0) {
      entry.unsub?.();
      _liveSubs.delete(uid);
    }
  };
}

/**
 * One page of the full inbox (seen and unread), newest first. getDocs is metered,
 * so a page costs exactly its size in reads. Pass the returned `cursor` back to
 * fetch the next page; `done` is true once a short page says there is no more.
 */
export async function fetchInbox(uid, { pageSize = 25, cursor = null } = {}) {
  if (!uid) return { items: [], cursor: null, done: true };
  const col = collection(db, 'notifications', uid, 'inbox');
  const q = cursor
    ? query(col, orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
    : query(col, orderBy('createdAt', 'desc'), limit(pageSize));
  const snap = await getDocs(q);
  return {
    items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    done: snap.docs.length < pageSize,
  };
}

/** Mark one item seen. Only seen/seenAt — the only keys firestore.rules allows. */
export async function markSeen(uid, itemId) {
  if (!uid || !itemId) return;
  await updateDoc(doc(db, 'notifications', uid, 'inbox', itemId), {
    seen: true,
    seenAt: serverTimestamp(),
  });
}

/** Mark a set of items seen in one WriteBatch (exact-metered on commit). */
export async function markAllSeen(uid, items) {
  const ids = (items || []).map((it) => (typeof it === 'string' ? it : it?.id)).filter(Boolean);
  if (!uid || !ids.length) return;
  // writeBatch caps at 500 ops; the unread listener never holds more than
  // UNREAD_LISTEN_LIMIT, but chunk anyway so the full inbox page (which may pass a
  // longer list) can't overflow a single batch.
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 450)) {
      batch.update(doc(db, 'notifications', uid, 'inbox', id), {
        seen: true,
        seenAt: serverTimestamp(),
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

/** Permanently remove one item from your own inbox. */
export async function dismiss(uid, itemId) {
  if (!uid || !itemId) return;
  await deleteDoc(doc(db, 'notifications', uid, 'inbox', itemId));
}
