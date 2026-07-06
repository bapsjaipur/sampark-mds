// src/lib/attendanceWindow.js
// Ported from the legacy checkAttendanceWindow() in index__1_.html: attendance
// marking opens 30 minutes before an event's start time and stays open until
// 30 minutes after it ends (start + duration). Outside that window, marking
// is disabled in the UI — same behavior as the legacy app.
//
// NOTE: this is a UI convenience, not a security boundary, matching the
// legacy app's own behavior (it only ever disabled pointer-events client
// side). firestore.rules does NOT enforce the window server-side — adding
// that would mean every attendance write reads the parent event doc and
// does time-math inside a security rule, which is possible but adds get()
// cost to every single check-in. Flagged here as a deliberate trade-off,
// not an oversight.

const BUFFER_MINUTES = 30;

export function getEventWindow(event) {
  if (!event?.date || !event?.time) return null;
  const start = new Date(`${event.date}T${event.time}`);
  if (Number.isNaN(start.getTime())) return null;
  const durationMs = (Number(event.durationMinutes) || 120) * 60000;
  const windowStart = new Date(start.getTime() - BUFFER_MINUTES * 60000);
  const windowEnd = new Date(start.getTime() + durationMs + BUFFER_MINUTES * 60000);
  return { start, windowStart, windowEnd };
}

/** Returns 'before' | 'open' | 'after' | 'unknown' (missing date/time). */
export function getWindowState(event) {
  const w = getEventWindow(event);
  if (!w) return 'unknown';
  const now = new Date();
  if (now < w.windowStart) return 'before';
  if (now > w.windowEnd) return 'after';
  return 'open';
}

export function isAttendanceOpen(event) {
  return getWindowState(event) === 'open';
}
