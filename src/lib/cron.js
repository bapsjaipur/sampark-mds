// src/lib/cron.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 34 — turn the five job cron strings into something an admin can read and
// edit on the Report Emails tab, without teaching anyone cron syntax.
//
// Only the shapes this project actually uses get a friendly editor:
//   • "M H * * *"   a daily job at a wall-clock time      (daily, birthday)
//   • "M H * * D"   a weekly job on one weekday at a time  (digest, generation)
//   • "*\/N * * * *"  a polling frequency                    (post-sabha)
// Anything else falls back to a raw cron text box, so nothing is un-editable —
// the friendly control just quietly steps aside. All times are IST; Cloud
// Scheduler runs these jobs in Asia/Kolkata (see functions SCHEDULE_OPTS).
// ─────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = [
  { value: '0', short: 'Sun', long: 'Sunday' },
  { value: '1', short: 'Mon', long: 'Monday' },
  { value: '2', short: 'Tue', long: 'Tuesday' },
  { value: '3', short: 'Wed', long: 'Wednesday' },
  { value: '4', short: 'Thu', long: 'Thursday' },
  { value: '5', short: 'Fri', long: 'Friday' },
  { value: '6', short: 'Sat', long: 'Saturday' },
];

/** A plausible 5-field cron string. Loose on purpose — Cloud Scheduler is the
 *  real validator; this only catches empties and the wrong field count. */
export function isValidCron(cron) {
  return typeof cron === 'string' && cron.trim().split(/\s+/).length === 5;
}

function isInt(field) {
  return /^\d+$/.test(field);
}

/** cron 0–7 (7 and 0 both mean Sunday) → our 0–6 weekday value, or null. */
function normalizeDow(field) {
  if (!isInt(field)) return null;
  const n = Number(field) % 7; // 7 → 0 (Sunday)
  return String(n);
}

/** "22" + "5" → "10:05 pm". Hour is 0–23. */
export function formatTime(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return '';
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "22:05" (an <input type="time"> value) for a simple time cron, else "". */
export function cronToTimeInput(cron) {
  const parsed = parseTimeCron(cron);
  if (!parsed) return '';
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
}

/**
 * Parse the friendly shapes. Returns:
 *   { kind: 'daily',   minute, hour }
 *   { kind: 'weekly',  minute, hour, dow }   dow = '0'..'6'
 *   { kind: 'everyN',  minutes }
 * or null when the string is something more exotic (→ use the raw box).
 */
export function parseTimeCron(cron) {
  if (!isValidCron(cron)) return null;
  const [min, hr, dom, mon, dow] = cron.trim().split(/\s+/);

  // Every-N-minutes poll: "*/15 * * * *"
  const everyN = /^\*\/(\d+)$/.exec(min);
  if (everyN && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { kind: 'everyN', minutes: Number(everyN[1]) };
  }

  if (!isInt(min) || !isInt(hr) || dom !== '*' || mon !== '*') return null;
  const minute = Number(min);
  const hour = Number(hr);
  if (minute > 59 || hour > 23) return null;

  if (dow === '*') return { kind: 'daily', minute, hour };

  const day = normalizeDow(dow);
  if (day === null) return null; // ranges/lists → raw box
  return { kind: 'weekly', minute, hour, dow: day };
}

/** Build a daily/weekly cron from an <input type="time"> value + optional day. */
export function buildTimeCron(timeValue, dow) {
  const [h, m] = String(timeValue || '').split(':');
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const dowField = dow == null || dow === '' ? '*' : String(dow);
  return `${minute} ${hour} * * ${dowField}`;
}

/** A human sentence for any cron — used for the small grey line under each row. */
export function describeCron(cron) {
  const parsed = parseTimeCron(cron);
  if (!parsed) return isValidCron(cron) ? cron.trim() : 'Not scheduled';

  if (parsed.kind === 'everyN') {
    return parsed.minutes === 1 ? 'Every minute' : `Every ${parsed.minutes} minutes`;
  }
  const time = formatTime(parsed.hour, parsed.minute);
  if (parsed.kind === 'daily') return `Every day at ${time}`;
  const day = WEEKDAYS.find((d) => d.value === parsed.dow);
  return `Every ${day ? day.long : 'week'} at ${time}`;
}
