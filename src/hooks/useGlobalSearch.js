// src/hooks/useGlobalSearch.js — unchanged from Phase 3, only the firebase
// import path already matched src/lib/firebase.js so no edits were needed.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";

export function useGlobalSearch(searchTerm, households) {
  const [allIndividuals, setAllIndividuals] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!searchTerm?.trim() || loaded) return;
    const q = query(collection(db, "individuals"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      setAllIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    });
    return unsub;
  }, [searchTerm, loaded]);

  const householdsById = useMemo(() => {
    const map = new Map();
    households.forEach((h) => map.set(h.id, h));
    return map;
  }, [households]);

  const results = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase();
    if (!term) return { individuals: [], households: [] };

    const matchedIndividuals = allIndividuals
      .filter(
        (i) =>
          i.name?.toLowerCase().includes(term) ||
          i.mobile?.includes(term) ||
          i.mandal?.toLowerCase().includes(term) ||
          householdsById.get(i.householdId)?.area?.toLowerCase().includes(term)
      )
      .map((i) => ({ ...i, household: householdsById.get(i.householdId) }));

    const matchedHouseholds = households.filter(
      (h) =>
        h.area?.toLowerCase().includes(term) ||
        h.address?.toLowerCase().includes(term) ||
        h.samparkKaryakartaName?.toLowerCase().includes(term) ||
        h.samparkKaryakartaNumber?.includes(term)
    );

    return { individuals: matchedIndividuals, households: matchedHouseholds };
  }, [searchTerm, allIndividuals, householdsById, households]);

  return { ...results, isSearching: Boolean(searchTerm?.trim()), loaded };
}
