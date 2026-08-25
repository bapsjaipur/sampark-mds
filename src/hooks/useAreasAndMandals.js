// src/hooks/useAreasAndMandals.js
// Live subscription to the areas/mandals reference collections. Falls back
// to DEFAULT_AREAS/DEFAULT_MANDALS (areaMandalCodes.js) if those collections
// are still loading or empty, so dropdowns never render blank.
//
// PHASE 24 — READS. These three collections hold ~17 documents between them, but
// this hook is called by a dozen forms and dropdowns, and every mount used to open
// three fresh listeners. Shared now: three listeners for the whole session, so a
// form opening for the twentieth time costs nothing. Being cheap is also what makes
// it the right replacement for deriving an area list out of all 420 households.
import { useMemo } from 'react';
import { collection, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DEFAULT_AREAS, DEFAULT_MANDALS, DEFAULT_LEVELS } from '../lib/areaMandalCodes';
import { useSharedCollection } from './useSharedCollection';

// Built once at module scope: a stable spec array means useSharedCollection never
// re-subscribes, and `build` is only ever called on the first subscriber.
const AREA_SPEC = [{ key: 'areas', source: 'areas', build: () => query(collection(db, 'areas'), orderBy('name')) }];
const MANDAL_SPEC = [{ key: 'mandals', source: 'mandals', build: () => query(collection(db, 'mandals'), orderBy('name')) }];
const LEVEL_SPEC = [{ key: 'levels', source: 'levels', build: () => query(collection(db, 'levels'), orderBy('name')) }];

export function useAreasAndMandals() {
  // Errors surface on the AreasMandalsManager admin screen; dropdowns just keep
  // their defaults, which is why nothing here looks at `error`.
  const a = useSharedCollection(AREA_SPEC);
  const m = useSharedCollection(MANDAL_SPEC);
  const l = useSharedCollection(LEVEL_SPEC);

  const areas = useMemo(() => (a.rows.length ? a.rows : DEFAULT_AREAS), [a.rows]);
  const mandals = useMemo(() => (m.rows.length ? m.rows : DEFAULT_MANDALS), [m.rows]);
  const levels = useMemo(() => (l.rows.length ? l.rows : DEFAULT_LEVELS), [l.rows]);

  return { areas, mandals, levels };
}
