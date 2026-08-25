// src/lib/callingStatuses.js
// ─────────────────────────────────────────────────────────────────────────────
// The calling-outcome vocabulary.
//
// Until now this file WAS the vocabulary: seven hardcoded chips, so renaming
// "Call Back Later" to "Call Later" meant a code change and a redeploy. It is
// now the DEFAULT vocabulary — admins edit the live list at
// settings/callOutcomes (see CallOutcomesTab + useCallOutcomes), and this file
// supplies the seed, the validation, and the colour palette.
//
// Two invariants that the editor must never break, both load-bearing:
//
//   1. `value` is what gets written to individuals.status. Nothing in the
//      database stores an outcome *id*, so changing a value orphans every
//      contact already carrying the old string. The editor therefore lets you
//      edit `label` / `emoji` / `colour` freely but treats `value` as
//      write-once (settable when the row is created, frozen afterwards).
//
//   2. '' (empty string) is the "no outcome" sentinel — StatusChips sends it
//      to deselect, and `if (c.status)` is how "already called" is counted in
//      several places. An outcome whose value is blank would make a contact
//      look uncalled forever, so blank values are rejected.
//
// Colours are a fixed token set rather than free-form Tailwind classes: the
// classes have to appear literally in source for Tailwind's purge to keep them
// in the built CSS, so a colour typed into an admin text box would silently
// render as unstyled.
// ─────────────────────────────────────────────────────────────────────────────

/** The named follow-up queues the calling screen offers. Consumed by key. */
export const FOLLOW_UP_GROUPS = [
  { key: 'callBack', label: 'Call Back' },
  { key: 'noAnswer', label: 'No Answer' },
];

/**
 * PHASE 27 — what an outcome MEANS for sabha attendance.
 *
 * The post-sabha review crosses "what they said on the call" against "did they
 * turn up", and the interesting cell is *said yes and did not come*. Deciding
 * which outcomes count as "said yes" cannot be a hardcoded list of strings:
 * this vocabulary is admin-editable, so the moment somebody renames
 * "Interested" to "Aayenge" a literal comparison silently reclassifies every
 * contact as unreached and the review reports that nobody promised anything.
 *
 * So intent is declared on the outcome itself, the same way `followUp` already
 * declares which queue a chip belongs to. Admins set it once in
 * Admin Tools → Call Outcomes and every screen derives from it.
 *
 * `null` means "this outcome says nothing about attendance" — Donated is the
 * seeded example. Those contacts are counted as called but sit out of the
 * promise-keep maths entirely, which is correct: a donation is not an RSVP.
 */
export const CALL_INTENTS = [
  { key: 'coming',     label: 'Said they will come',  short: 'Coming',       tone: 'emerald' },
  { key: 'maybe',      label: 'Might come / deciding', short: 'Maybe',       tone: 'amber' },
  { key: 'notComing',  label: 'Said they cannot come', short: 'Not coming',  tone: 'rose' },
  { key: 'unreached',  label: 'Could not be reached',  short: 'Not reached', tone: 'sky' },
];

/** The intent assumed for a contact with no outcome at all. A never-called
 *  contact is indistinguishable from one nobody could get hold of, and both
 *  need the same action next week, so they share a bucket. */
export const UNREACHED_INTENT = 'unreached';

/**
 * Fixed colour palette. `chip` is the class string used on the outcome button
 * and status badge; `dot` is a solid swatch for the admin picker. Both are
 * written out in full so Tailwind's content scanner sees them.
 */
export const COLOR_TOKENS = [
  { key: 'chip-green',  label: 'Green',  chip: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-500' },
  { key: 'chip-red',    label: 'Red',    chip: 'bg-rose-100 text-rose-800 border-rose-300',          dot: 'bg-rose-500' },
  { key: 'chip-yellow', label: 'Amber',  chip: 'bg-amber-100 text-amber-800 border-amber-300',       dot: 'bg-amber-500' },
  { key: 'chip-blue',   label: 'Blue',   chip: 'bg-sky-100 text-sky-800 border-sky-300',             dot: 'bg-sky-500' },
  { key: 'chip-purple', label: 'Purple', chip: 'bg-purple-100 text-purple-800 border-purple-300',    dot: 'bg-purple-500' },
  { key: 'chip-orange', label: 'Orange', chip: 'bg-orange-100 text-orange-800 border-orange-300',    dot: 'bg-orange-500' },
  { key: 'chip-teal',   label: 'Teal',   chip: 'bg-teal-100 text-teal-800 border-teal-300',          dot: 'bg-teal-500' },
  { key: 'chip-pink',   label: 'Pink',   chip: 'bg-pink-100 text-pink-800 border-pink-300',          dot: 'bg-pink-500' },
  { key: 'chip-slate',  label: 'Grey',   chip: 'bg-slate-100 text-slate-700 border-slate-300',       dot: 'bg-slate-400' },
];

export const NEUTRAL_CHIP_CLASS = 'bg-slate-100 text-slate-600 border-slate-300';

const COLOR_MAP = COLOR_TOKENS.reduce((acc, t) => { acc[t.key] = t.chip; return acc; }, {});

/** Tailwind classes for one colour token key. Unknown keys fall back to grey. */
export function colorClassesForToken(tokenKey) {
  return COLOR_MAP[tokenKey] || NEUTRAL_CHIP_CLASS;
}

/**
 * The seed vocabulary — exactly the seven outcomes the karyekars already used
 * in the legacy Sevak Call sheet, so an untouched install behaves as before.
 * `followUp` maps a chip into one of the FOLLOW_UP_GROUPS queues (or null).
 * `intent` maps it onto CALL_INTENTS for the post-sabha review (or null).
 */
export const DEFAULT_STATUS_CHIPS = [
  { value: 'Interested',       label: 'Interested',       emoji: '✅', colorClass: 'chip-green',  followUp: null,       intent: 'coming' },
  { value: 'Not Interested',   label: 'Not Interested',   emoji: '❌', colorClass: 'chip-red',    followUp: null,       intent: 'notComing' },
  { value: 'Call Back Later',  label: 'Call Back Later',  emoji: '🕒', colorClass: 'chip-yellow', followUp: 'callBack', intent: 'maybe' },
  { value: 'No Answer',        label: 'No Answer',        emoji: '📵', colorClass: 'chip-blue',   followUp: 'noAnswer', intent: 'unreached' },
  // "Already Volunteer" is someone who runs the sabha rather than attends it,
  // but they are still expected in the hall, so it seeds as coming.
  { value: 'Already Volunteer', label: 'Already Volunteer', emoji: '🙏', colorClass: 'chip-green', followUp: null,      intent: 'coming' },
  // Deliberately intent-less: a donation is not an RSVP.
  { value: 'Donated',          label: 'Donated',          emoji: '💜', colorClass: 'chip-purple', followUp: null,       intent: null },
  { value: 'Follow Up',        label: 'Follow Up',        emoji: '🔁', colorClass: 'chip-yellow', followUp: 'callBack', intent: 'maybe' },
];

// Kept for callers that only need a static list and cannot use a hook —
// contactService.STATUS_OPTIONS is the one remaining case. Anything rendering
// outcomes to a volunteer should use useCallOutcomes() so admin edits show up.
export const STATUS_CHIPS = DEFAULT_STATUS_CHIPS;

/** Builds the `{ callBack: [...], noAnswer: [...] }` shape from a chip list. */
export function followUpGroupsFrom(chips = DEFAULT_STATUS_CHIPS) {
  const groups = {};
  FOLLOW_UP_GROUPS.forEach((g) => { groups[g.key] = []; });
  chips.forEach((c) => {
    if (c.followUp && groups[c.followUp]) groups[c.followUp].push(c.value);
  });
  return groups;
}

export const FOLLOW_UP_STATUS_GROUPS = followUpGroupsFrom(DEFAULT_STATUS_CHIPS);

/**
 * Colour classes for a stored status string.
 * @param {string} value  the literal string on individuals.status
 * @param {Array}  [chips] the live outcome list; defaults to the seed list so
 *   the existing single-argument callers keep working unchanged.
 */
export function statusColorClasses(value, chips = DEFAULT_STATUS_CHIPS) {
  const chip = chips.find((c) => c.value === value);
  return colorClassesForToken(chip?.colorClass);
}

/** The emoji for a stored status string, or '' when it has none. */
export function statusEmoji(value, chips = DEFAULT_STATUS_CHIPS) {
  return chips.find((c) => c.value === value)?.emoji || '';
}

/** Fast lookup of the seeded intent for one outcome value, used as the fallback
 *  for settings documents written before intent existed (see normalizeOutcomes). */
const SEEDED_INTENT = new Map(DEFAULT_STATUS_CHIPS.map((c) => [c.value, c.intent || null]));

/**
 * The attendance intent behind a stored status string.
 *
 * A blank status — never called, or cleared by a round close — reads as
 * `unreached`, not as null: the review has to place every contact somewhere, and
 * "nobody got through to them" is exactly what a blank means.
 *
 * An unknown string (a retired outcome a contact still carries) also reads as
 * unreached rather than being dropped. Losing somebody out of the review because
 * an admin deleted a button months ago would be worse than putting them in the
 * "try again" pile.
 */
export function intentOf(value, chips = DEFAULT_STATUS_CHIPS) {
  const v = String(value || '').trim();
  if (!v) return UNREACHED_INTENT;
  const chip = chips.find((c) => c.value === v);
  if (!chip) return UNREACHED_INTENT;
  return chip.intent || null;
}

/**
 * Coerces whatever is sitting in settings/callOutcomes into a safe chip list.
 * Anything malformed is dropped rather than thrown on — a bad settings doc must
 * degrade to "fewer buttons", never to a blank calling screen.
 */
export function normalizeOutcomes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_STATUS_CHIPS;
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = String(item.value ?? '').trim();
    if (!value || seen.has(value)) continue; // blank is the deselect sentinel
    seen.add(value);
    list.push({
      value,
      label: String(item.label ?? '').trim() || value,
      emoji: String(item.emoji ?? '').trim(),
      colorClass: COLOR_MAP[item.colorClass] ? item.colorClass : 'chip-slate',
      followUp: FOLLOW_UP_GROUPS.some((g) => g.key === item.followUp) ? item.followUp : null,
      // PHASE 27 migration. A settings document saved before intent existed has
      // no such key at all, and defaulting those to null would tell the
      // post-sabha review that not one of the outcomes means "coming" — every
      // contact would land in "could not reach" and the panel would report a
      // week in which nobody promised anything. So an ABSENT key inherits the
      // seed for that value, while an explicitly cleared one (null, which is
      // what the editor writes for "None") is respected.
      intent: 'intent' in item
        ? (CALL_INTENTS.some((i) => i.key === item.intent) ? item.intent : null)
        : (SEEDED_INTENT.get(value) || null),
    });
  }
  return list.length ? list : DEFAULT_STATUS_CHIPS;
}
