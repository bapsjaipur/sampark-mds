// src/lib/dateRanges.js
// Reminders-dashboard-facing: computes MM-DD range windows for "next N days"
// queries against dobMonthDay/anniversaryMonthDay. Firestore range queries on
// a string field don't wrap around Dec 31 -> Jan 1, so a window crossing the
// year boundary is split into two ranges and merged by the caller.

function toMonthDay(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

export function getMonthDayWindow(days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + days);

  const startStr = toMonthDay(today);
  const endStr = toMonthDay(end);

  if (startStr <= endStr) {
    return [{ start: startStr, end: endStr }];
  }
  return [
    { start: startStr, end: '12-31' },
    { start: '01-01', end: endStr },
  ];
}

export function isMonthDayInWindows(monthDay, windows) {
  return windows.some((w) => monthDay >= w.start && monthDay <= w.end);
}
