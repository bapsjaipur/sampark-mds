// src/hooks/useGlobalSearch.js — unchanged from Phase 3, only the firebase
// import path already matched src/lib/firebase.js so no edits were needed.
//
// PHASE 38 — SCOPE. This hook loaded the whole `individuals` and `households`
// collections on the first keystroke and returned every match, so the search box
// on the Households screen showed a mandal-scoped karyakarta every contact in the
// city — name, mobile, mandal and area — while the list right beneath it was
// correctly narrowed. Results are now put through the same predicate the lists
// use. See src/lib/scope.js for why the two collections are judged differently.
//
// The read cost is unchanged and still a full sweep, because a scoped QUERY can't
// express this: a household member carries no `area` of its own (it comes from the
// parent household), so `where('area','in',[…])` would silently drop exactly the
// people search exists to find. If this sweep ever becomes the read budget's
// problem, the fix is a search index, not a narrower query.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "./usePermissions";
import { matchesScope, individualScopeArea, filterHouseholdsByScope } from "../lib/scope";

// `householdsHint` (optional) is a list the caller already has loaded — used
// only as an immediate fallback before this hook's own full household load
// resolves. Since HouseholdsPage now paginates (1.4), search must NOT rely on
// that partial list: on first search it lazily loads the *entire* households
// collection itself (same pattern it already uses for individuals), so global
// search stays global regardless of how many list pages are loaded.
export function useGlobalSearch(searchTerm, householdsHint = []) {
  const { scope } = useAuth();
  const [allIndividuals, setAllIndividuals] = useState([]);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [householdsLoaded, setHouseholdsLoaded] = useState(false);

  useEffect(() => {
    if (!searchTerm?.trim() || loaded) return;
    const q = query(collection(db, "individuals"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      setAllIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    });
    return unsub;
  }, [searchTerm, loaded]);

  useEffect(() => {
    if (!searchTerm?.trim() || householdsLoaded) return;
    const q = query(collection(db, "households"), orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setAllHouseholds(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setHouseholdsLoaded(true);
    });
    return unsub;
  }, [searchTerm, householdsLoaded]);

  // Prefer the hook's own full load once it's in; until then, fall back to the
  // caller's hint so results aren't empty for the first frame.
  const households = householdsLoaded ? allHouseholds : householdsHint;

  const householdsById = useMemo(() => {
    const map = new Map();
    households.forEach((h) => map.set(h.id, h));
    return map;
  }, [households]);

  const results = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase();
    if (!term) return { individuals: [], households: [] };

    const householdsForMap = Object.fromEntries(householdsById);

    const matchedIndividuals = allIndividuals
      .filter(
        (i) =>
          i.name?.toLowerCase().includes(term) ||
          i.mobile?.includes(term) ||
          i.mandal?.toLowerCase().includes(term) ||
          householdsById.get(i.householdId)?.area?.toLowerCase().includes(term)
      )
      // The boundary, applied after the text match so the predicate stays cheap.
      // A contact's area is their own field for standalone contacts and the parent
      // household's for members — individualScopeArea knows the difference.
      .filter((i) => matchesScope(scope, {
        area: individualScopeArea(i, householdsForMap),
        mandal: i.mandal || null,
      }))
      .map((i) => ({ ...i, household: householdsById.get(i.householdId) }));

    const matchedHouseholds = filterHouseholdsByScope(households, scope).filter(
      (h) =>
        h.area?.toLowerCase().includes(term) ||
        h.address?.toLowerCase().includes(term) ||
        h.samparkKaryakartaName?.toLowerCase().includes(term) ||
        h.samparkKaryakartaNumber?.includes(term)
    );

    return { individuals: matchedIndividuals, households: matchedHouseholds };
  }, [searchTerm, allIndividuals, householdsById, households, scope]);

  return { ...results, isSearching: Boolean(searchTerm?.trim()), loaded };
}
