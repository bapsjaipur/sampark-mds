// src/services/calendarService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 35 — client side of the subscribable birthday/anniversary calendar.
//
// Two thin wrappers over the callables in functions/calendarSync.js:
//   getMyCalendarFeed()      → the signed-in volunteer's own private feed URL
//   rebuildCalendarCacheNow()→ force an immediate dataset rebuild (admin)
//
// Both are no-ops until the functions are deployed; the callers show a friendly
// "available after the next deploy" message when the callable is missing, the
// same posture the rest of the admin screen uses for backup/restore et al.
// ─────────────────────────────────────────────────────────────────────────────
import { getFunctions, httpsCallable } from 'firebase/functions';

/**
 * getMyCalendarFeed({ rotate })
 * @returns {Promise<{ url: string, scopeKind: string, unrestricted: boolean, empty: boolean }>}
 * Passing rotate:true mints a NEW token and invalidates the old URL.
 */
export async function getMyCalendarFeed({ rotate = false } = {}) {
  const fn = httpsCallable(getFunctions(), 'getMyCalendarFeed');
  const res = await fn({ rotate });
  return res.data;
}

/**
 * rebuildCalendarCacheNow()
 * @returns {Promise<{ ok: boolean, birthdays: number, anniversaries: number, generatedAt: string }>}
 */
export async function rebuildCalendarCacheNow() {
  const fn = httpsCallable(getFunctions(), 'rebuildCalendarCacheNow');
  const res = await fn({});
  return res.data;
}
