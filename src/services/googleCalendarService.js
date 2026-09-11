// src/services/googleCalendarService.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin client wrappers over the Phase 37 per-user Google Calendar callables
// (functions/googleCalendar.js). No secret ever lives here — the OAuth client
// secret and each volunteer's refresh token are server-only. getStatus reports
// connection state; startAuth returns the Google consent URL to open.
// ─────────────────────────────────────────────────────────────────────────────
import { getFunctions, httpsCallable } from 'firebase/functions';

/** Per-caller state: { configured, enabled, connected, email, lastSyncAt, lastSyncCount, redirectUri }. */
export async function getGoogleCalendarStatus() {
  const fn = httpsCallable(getFunctions(), 'getGoogleCalendarStatus');
  const res = await fn({});
  return res.data;
}

/**
 * Admin: save the OAuth client. Blank clientSecret keeps the stored one;
 * clearSecret:true wipes it. { enabled, clientId, clientSecret?, clearSecret? }
 */
export async function saveGoogleCalendarConfig(payload) {
  const fn = httpsCallable(getFunctions(), 'saveGoogleCalendarConfig');
  const res = await fn(payload || {});
  return res.data;
}

/** Begin the connect flow → { url } (the Google consent screen to open). */
export async function startGoogleCalendarAuth() {
  const fn = httpsCallable(getFunctions(), 'startGoogleCalendarAuth');
  const res = await fn({});
  return res.data;
}

/** Push my in-scope birthdays/anniversaries into my calendar (idempotent). */
export async function syncMyGoogleCalendar() {
  const fn = httpsCallable(getFunctions(), 'syncMyGoogleCalendar');
  const res = await fn({});
  return res.data;
}

/** Forget my token and revoke access. */
export async function disconnectGoogleCalendar() {
  const fn = httpsCallable(getFunctions(), 'disconnectGoogleCalendar');
  const res = await fn({});
  return res.data;
}
