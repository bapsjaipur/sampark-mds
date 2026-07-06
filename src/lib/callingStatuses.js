// src/lib/callingStatuses.js
// The REAL status vocabulary, ported from index__1_.html's chip buttons —
// replaces the placeholder snake_case set (not_contacted/contacted/etc.)
// that Phase 4 invented before the legacy app's actual data was available.
// Exact value strings matter: they're what gets stored on individuals.status
// and shown to karyekars who already know these labels.
//
// "Wrong Number" existed in the legacy markup but was commented out /
// disabled there — kept out here too, can be re-enabled by uncommenting.

export const STATUS_CHIPS = [
  { value: 'Interested', label: 'Interested', emoji: '\u2705', colorClass: 'chip-green' },
  { value: 'Not Interested', label: 'Not Interested', emoji: '\u274c', colorClass: 'chip-red' },
  { value: 'Call Back Later', label: 'Call Back Later', emoji: '\ud83d\udd52', colorClass: 'chip-yellow' },
  { value: 'No Answer', label: 'No Answer', emoji: '\ud83d\udcf5', colorClass: 'chip-blue' },
  { value: 'Already Volunteer', label: 'Already Volunteer', emoji: '\ud83d\ude4f', colorClass: 'chip-green' },
  { value: 'Donated', label: 'Donated', emoji: '\ud83d\udc9c', colorClass: 'chip-purple' },
  { value: 'Follow Up', label: 'Follow Up', emoji: '\ud83d\udd01', colorClass: 'chip-yellow' },
];

// Statuses that populate the two follow-up quick-filter buttons.
export const FOLLOW_UP_STATUS_GROUPS = {
  callBack: ['Call Back Later'],
  noAnswer: ['No Answer'],
};

export function statusColorClasses(value) {
  const chip = STATUS_CHIPS.find((c) => c.value === value);
  const map = {
    'chip-green': 'bg-emerald-100 text-emerald-800 border-emerald-300',
    'chip-red': 'bg-rose-100 text-rose-800 border-rose-300',
    'chip-yellow': 'bg-amber-100 text-amber-800 border-amber-300',
    'chip-blue': 'bg-sky-100 text-sky-800 border-sky-300',
    'chip-purple': 'bg-purple-100 text-purple-800 border-purple-300',
  };
  return map[chip?.colorClass] || 'bg-slate-100 text-slate-600 border-slate-300';
}
