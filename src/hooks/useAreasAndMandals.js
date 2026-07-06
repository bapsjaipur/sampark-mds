// src/hooks/useAreasAndMandals.js
// Live subscription to the areas/mandals reference collections. Falls back
// to DEFAULT_AREAS/DEFAULT_MANDALS (areaMandalCodes.js) if those collections
// are still loading or empty, so dropdowns never render blank.
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DEFAULT_AREAS, DEFAULT_MANDALS, DEFAULT_LEVELS } from '../lib/areaMandalCodes';

export function useAreasAndMandals() {
  const [areas, setAreas] = useState(DEFAULT_AREAS);
  const [mandals, setMandals] = useState(DEFAULT_MANDALS);
  const [levels, setLevels] = useState(DEFAULT_LEVELS);

  useEffect(() => {
    const unsubA = onSnapshot(query(collection(db, 'areas'), orderBy('name')), (snap) => {
      if (!snap.empty) setAreas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {}); // errors surface on the AreasMandalsManager admin screen; dropdowns just keep their defaults
    const unsubM = onSnapshot(query(collection(db, 'mandals'), orderBy('name')), (snap) => {
      if (!snap.empty) setMandals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
    const unsubL = onSnapshot(query(collection(db, 'levels'), orderBy('name')), (snap) => {
      if (!snap.empty) setLevels(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => { unsubA(); unsubM(); unsubL(); };
  }, []);

  return { areas, mandals, levels };
}
