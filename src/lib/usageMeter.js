// src/lib/usageMeter.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — HOW MANY FIRESTORE READS AND WRITES DID WE JUST SPEND?
//
// The Spark (free) plan allows 50,000 document reads, 20,000 writes and 20,000
// deletes per day. There is no API that reports the current figure — the Firebase
// console reads it from the billing pipeline, which the client cannot see. So the
// only way to know before the quota runs out is to count what THIS app asks for,
// which is what this module does.
//
// WHAT COUNTS AS ONE READ, exactly as Google bills it:
//
//   • A listener's first server snapshot bills one read per document delivered.
//     Every later snapshot bills only the documents that CHANGED. Both cases are
//     therefore `snap.docChanges().length` — the first snapshot reports every
//     document as an 'added' change, so one line covers both.
//   • A snapshot served from the local cache bills NOTHING. metadata.fromCache
//     says so, and skipping those is the whole reason enabling persistence in
//     firebase.js is the single biggest saving in this app.
//   • getDocs() bills one read per document returned, minimum one — an empty
//     result is still a billed read.
//   • getCountFromServer() bills one read per 1,000 documents counted, minimum
//     one. That is why a count is always cheaper than fetching to length.
//   • Writes and deletes bill one each, per document. A 400-document WriteBatch
//     is 400 writes, not one.
//
// The tally is an ESTIMATE, and honest about it: it covers the paths that were
// instrumented (every list, every hook, every service that moves real volume).
// Anything reached by an un-instrumented call is invisible here — so treat the
// number as a floor, and the Firebase console as the truth.
//
// Storage is localStorage, per device, keyed by the QUOTA day rather than the
// local one: Firestore's daily allowance resets at midnight US Pacific, so a
// tally kept by Indian local date would appear to reset 12.5 hours early and
// read as "plenty left" when the real budget was nearly gone.
// ─────────────────────────────────────────────────────────────────────────────

/** The Spark plan's daily document allowance. */
export const FREE_TIER = {
  reads: 50000,
  writes: 20000,
  deletes: 20000,
};

const STORE_KEY = 'mds.firestoreUsage.v1';

/** Firestore quotas reset at midnight America/Los_Angeles, not local midnight. */
export function quotaDay(at = new Date()) {
  try {
    // en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function blank(day) {
  return { day, reads: 0, writes: 0, deletes: 0, bySource: {}, startedAt: Date.now() };
}

function load() {
  const today = quotaDay();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && saved.day === today) {
      return {
        ...blank(today),
        ...saved,
        bySource: saved.bySource && typeof saved.bySource === 'object' ? saved.bySource : {},
      };
    }
  } catch {
    /* corrupt or unavailable storage — start clean rather than throw on import */
  }
  return blank(today);
}

let state = load();
const listeners = new Set();

// localStorage writes are free but synchronous, and a 3,000-document snapshot
// arrives as one burst of counts. Coalesce into one persist per tick-ish.
let flushTimer = null;
function persist() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* private mode / quota — the in-memory tally still works for this session */
    }
  }, 1000);
}

function rollDay() {
  const today = quotaDay();
  if (state.day !== today) {
    state = blank(today);
    return true;
  }
  return false;
}

function bump(kind, n, source) {
  if (!Number.isFinite(n) || n <= 0) return;
  rollDay();
  state = {
    ...state,
    [kind]: state[kind] + n,
    bySource: {
      ...state.bySource,
      [source || 'other']: {
        reads: (state.bySource[source || 'other']?.reads || 0) + (kind === 'reads' ? n : 0),
        writes: (state.bySource[source || 'other']?.writes || 0) + (kind === 'writes' ? n : 0),
        deletes: (state.bySource[source || 'other']?.deletes || 0) + (kind === 'deletes' ? n : 0),
      },
    },
  };
  persist();
  listeners.forEach((fn) => { try { fn(state); } catch { /* a broken subscriber must not stop the count */ } });
}

/**
 * Bill a realtime snapshot. Call this for EVERY snapshot, cached ones included —
 * it decides itself whether they cost anything, which keeps the decision in one
 * place instead of at forty call sites.
 *
 * Accepts a QuerySnapshot or a single DocumentSnapshot: a doc listener has no
 * docChanges(), and every server update on it is exactly one read.
 */
export function meterSnapshot(snap, source) {
  if (!snap) return 0;
  if (snap.metadata?.fromCache) return 0;
  if (typeof snap.docChanges !== 'function') {
    bump('reads', 1, source);
    return 1;
  }
  let n = 0;
  try {
    n = snap.docChanges().length;
  } catch {
    n = snap.size ?? 0;
  }
  bump('reads', n, source);
  return n;
}

/** Bill a one-shot getDocs(). An empty result still costs one read. */
export function meterGetDocs(snap, source) {
  if (!snap) return 0;
  if (snap.metadata?.fromCache) return 0;
  const n = Math.max(1, snap.size ?? 0);
  bump('reads', n, source);
  return n;
}

/** Bill a getDoc(). One read, or nothing when the cache answered. */
export function meterGetDoc(snap, source) {
  if (snap?.metadata?.fromCache) return 0;
  bump('reads', 1, source);
  return 1;
}

/** Bill a getCountFromServer(): one read per 1,000 documents counted, min one. */
export function meterCount(count, source) {
  const n = Math.max(1, Math.ceil((Number(count) || 0) / 1000));
  bump('reads', n, source);
  return n;
}

export function meterWrites(n, source) {
  bump('writes', n, source);
}

export function meterDeletes(n, source) {
  bump('deletes', n, source);
}

/** Current tally. A copy, so a component holding it cannot mutate the store. */
export function getUsage() {
  rollDay();
  return { ...state, bySource: { ...state.bySource } };
}

/** Live updates for the Admin Tools dashboard. Returns an unsubscribe. */
export function subscribeUsage(fn) {
  listeners.add(fn);
  fn(getUsage());
  return () => listeners.delete(fn);
}

/** Percentage of the day's allowance spent, clamped for the progress bars. */
export function usagePct(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 1000) / 10);
}

/** Manual reset, for the "start counting again" button on the usage tab. */
export function resetUsage() {
  state = blank(quotaDay());
  persist();
  listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });
}
