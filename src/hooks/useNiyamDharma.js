// src/hooks/useNiyamDharma.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 42 — the live Niyam Dharma vocabulary, read from settings/niyamDharma.
//
// Every screen that renders the niyam checkboxes (the contact form), the niyam
// labels (CSV export, contacts table) or the niyam counts (dashboard) reads it
// through here rather than importing the module constant, so an admin edit on
// the Areas & Mandals screen shows up everywhere without a redeploy.
//
// Mirrors useCallOutcomes: settings/* is readable by every signed-in volunteer
// (see firestore.rules), and on any error useSettings resolves to the defaults
// by design, so the worst case is "the checkboxes look like they did before the
// admin renamed them", never a blank form.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import { useSettings } from './useSettings';
import { normalizeNiyams, enabledNiyams, niyamLabels, niyamLabelString } from '../lib/niyamDharma';

export function useNiyamDharma() {
  const { settings, loading } = useSettings('niyamDharma');

  // The full list (including retired rows) drives the editor and label lookups;
  // `enabled` is what the contact form and dashboard offer.
  const niyams = useMemo(() => normalizeNiyams(settings?.niyams), [settings?.niyams]);
  const enabled = useMemo(() => enabledNiyams(niyams), [niyams]);

  const helpers = useMemo(() => ({
    /** stored keys[] → ['Mala Jaap', …], resolving against the live labels. */
    labels: (keys) => niyamLabels(keys, niyams),
    /** stored keys[] → "Mala Jaap, Ghar Sabha", for CSV/PDF/table cells. */
    labelString: (keys, sep) => niyamLabelString(keys, niyams, sep),
    /** Falls back to the raw key so a retired niyam still reads sensibly. */
    label: (key) => niyams.find((n) => n.key === key)?.label || key || '',
  }), [niyams]);

  return { niyams, enabled, loading, ...helpers };
}

export default useNiyamDharma;
