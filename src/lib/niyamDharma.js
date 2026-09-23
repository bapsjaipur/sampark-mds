// src/lib/niyamDharma.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 42 — the Niyam Dharma Agna vocabulary: the daily observances a contact
// keeps (Tulsi Kanthi, Mala Jaap, Nitya Pooja, Ghar Sabha…).
//
// This mirrors callingStatuses.js exactly, for the same reasons:
//
//   • This file is the DEFAULT list. Admins edit the live list at
//     settings/niyamDharma (see the Niyam Dharma editor on the Areas & Mandals
//     screen + useNiyamDharma), and this supplies the seed + validation.
//
//   • `key` is what gets written into individuals.niyamDharma[]. Nothing in the
//     database stores a label, so changing a key would orphan every contact
//     already carrying the old one. The editor therefore treats `key` as
//     write-once and lets `label` be edited freely — so fixing a spelling (the
//     user's stated reason for wanting this admin-editable) never loses data.
//
//   • `enabled:false` retires a niyam from the contact form and the dashboard
//     without deleting it, so contacts who already carry it keep their history.
// ─────────────────────────────────────────────────────────────────────────────

/** The seed list — the four the user named. Keys are stable identifiers; labels
 *  are what admins see and can re-spell. */
export const DEFAULT_NIYAM_DHARMAS = [
  { key: 'tulsiKanthi', label: 'Wears Tulsi Kanthi', enabled: true },
  { key: 'malaJaap',    label: 'Mala Jaap',          enabled: true },
  { key: 'nityaPooja',  label: 'Nitya Pooja',        enabled: true },
  { key: 'gharSabha',   label: 'Ghar Sabha',         enabled: true },
];

/** A key that is safe as a Firestore array member and stable across renames. */
export const NIYAM_KEY_RE = /^[A-Za-z0-9_]+$/;

/**
 * Coerces whatever is sitting in settings/niyamDharma into a safe list. Anything
 * malformed is dropped rather than thrown on — a bad settings doc must degrade
 * to "fewer checkboxes", never a broken contact form.
 */
export function normalizeNiyams(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_NIYAM_DHARMAS;
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key ?? '').trim();
    if (!key || !NIYAM_KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    list.push({
      key,
      label: String(item.label ?? '').trim() || key,
      // An absent `enabled` reads as "on" — a doc written before the flag
      // existed, or an admin who never touched the toggle.
      enabled: item.enabled !== false,
    });
  }
  return list.length ? list : DEFAULT_NIYAM_DHARMAS;
}

/** Only the niyams still switched on — for the contact form and the dashboard. */
export function enabledNiyams(niyams = DEFAULT_NIYAM_DHARMAS) {
  return niyams.filter((n) => n.enabled !== false);
}

/**
 * A stored keys[] → ['Mala Jaap', 'Ghar Sabha'] label list, for CSV/PDF export
 * and table cells. Unknown keys (a retired niyam a contact still carries) fall
 * back to the raw key so nothing silently vanishes from an export.
 */
export function niyamLabels(keys, niyams = DEFAULT_NIYAM_DHARMAS) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const byKey = new Map(niyams.map((n) => [n.key, n.label]));
  return keys.map((k) => byKey.get(k) || k);
}

/** Convenience join used by the CSV/PDF exporter. */
export function niyamLabelString(keys, niyams = DEFAULT_NIYAM_DHARMAS, sep = ', ') {
  return niyamLabels(keys, niyams).join(sep);
}
