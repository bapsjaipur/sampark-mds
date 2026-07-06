// src/lib/dateHelpers.js
// Form-facing date helpers: converts a full YYYY-MM-DD date (as produced by
// <input type="date">) to display strings / the denormalized MM-DD field.
// Distinct from dateRanges.js, which computes "next N days" MM-DD windows
// for the Reminders Dashboard — different job, kept as a separate file.

export function toMonthDay(fullDateStr) {
  if (!fullDateStr) return "";
  const d = new Date(fullDateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/** Formats a full date string for display, e.g. "12 Jul 1994". */
export function formatDate(fullDateStr) {
  if (!fullDateStr) return "—";
  const d = new Date(fullDateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
