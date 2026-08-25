// src/hooks/useCallOutcomes.js
// ─────────────────────────────────────────────────────────────────────────────
// The live calling-outcome vocabulary, read from settings/callOutcomes.
//
// Every screen that renders an outcome — the chips on the calling flow, the
// status badge in the contacts table, the dropdown in the sampark drawer —
// should read it through here rather than importing the module constant, so an
// admin edit shows up everywhere without a redeploy.
//
// settings/* is readable by every signed-in volunteer (see firestore.rules), so
// this works for karyekars too, not just admins. On any error useSettings
// resolves to the defaults by design, which means the worst case is "the chips
// look like they did before the admin renamed them", never a blank screen.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import { useSettings } from './useSettings';
import {
  normalizeOutcomes,
  followUpGroupsFrom,
  colorClassesForToken,
  NEUTRAL_CHIP_CLASS,
  UNREACHED_INTENT,
} from '../lib/callingStatuses';

export function useCallOutcomes() {
  const { settings, loading } = useSettings('callOutcomes');

  const outcomes = useMemo(() => normalizeOutcomes(settings?.outcomes), [settings?.outcomes]);
  const followUpGroups = useMemo(() => followUpGroupsFrom(outcomes), [outcomes]);

  // Map lookups rather than a .find() per render: the contacts table calls this
  // once per visible row, and the calling screen once per chip.
  const byValue = useMemo(() => {
    const m = new Map();
    outcomes.forEach((o) => m.set(o.value, o));
    return m;
  }, [outcomes]);

  const helpers = useMemo(() => ({
    /** Tailwind chip classes for a stored status string. */
    colorClasses: (value) => (byValue.has(value) ? colorClassesForToken(byValue.get(value).colorClass) : NEUTRAL_CHIP_CLASS),
    /** '' when the outcome has no emoji, or the status is unknown. */
    emoji: (value) => byValue.get(value)?.emoji || '',
    /** Falls back to the raw stored string so retired outcomes still read sensibly. */
    label: (value) => byValue.get(value)?.label || value || '',
    /** True when a status string is still in the configured list. */
    isKnown: (value) => byValue.has(value),
    /**
     * PHASE 27 — the attendance intent behind a stored status, for the
     * post-sabha review. Mirrors lib/callingStatuses.intentOf() but off the Map,
     * because the review calls it once per contact in the batch.
     *
     * Blank and unknown both read as `unreached` so every contact lands in
     * exactly one group — see intentOf() for why that beats returning null.
     */
    intent: (value) => {
      const v = String(value || '').trim();
      if (!v) return UNREACHED_INTENT;
      const chip = byValue.get(v);
      if (!chip) return UNREACHED_INTENT;
      return chip.intent || null;
    },
  }), [byValue]);

  return { outcomes, followUpGroups, loading, ...helpers };
}

export default useCallOutcomes;
