// src/hooks/useHouseholds.js
// MERGE FIX: import path — '../contexts/AuthContext' -> '../hooks/usePermissions'
// (canonical hook; `useAuth` is exported as an alias so this line barely changed).
//
// PHASE 23c — SCOPE. This hook narrowed by `assignedAreas` regardless of the
// role's scopeKind, which is wrong in one direction that matters: a MANDAL-scoped
// volunteer (a Mandal head) holds no areas at all, so they were shown an empty
// list and lost the only route to their own members. A household carries an
// `area` but NO mandal — its members may be in several — so the server rule
// householdScopeOk() allows a mandal-scoped volunteer EVERY household and leaves
// the narrowing to the member level. filterHouseholdsByScope() in src/lib/scope.js
// says the same thing; this file now matches both.
//
// PHASE 24 — READS. Five pages call this hook and each mount used to open its own
// listener over all ~420 households, so simply walking Contacts → Households →
// Events billed three full sweeps. It now goes through useSharedCollection: one
// listener per distinct query for the whole session, replayed free to every later
// subscriber, and returning to a page inside the grace window costs nothing.
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection, addDoc, updateDoc, doc, serverTimestamp, query, orderBy, limit, where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "./usePermissions";
import { logActivity } from "../lib/activityLog";
import { deleteHouseholdCascade, deleteHouseholdOnly as deleteHouseholdOnlySvc } from "../services/householdService";
import { friendlyFirestoreError } from "../lib/firestoreErrorMessage";
import { SCOPE_KINDS } from "../lib/scope";
import { useSharedCollection } from "./useSharedCollection";
import { meterWrites } from "../lib/usageMeter";

/**
 * @param {{ pageSize?: number }} [opts] — pass a pageSize (e.g. 20) to
 *   paginate: a single real-time listener whose `limit` grows by pageSize
 *   each `loadMore()`. Called with NO args (the default), it subscribes to
 *   the whole collection exactly as before — so every non-list consumer
 *   (HouseholdDetailPage's find-by-id, Batches/Events area lists) is
 *   unaffected. See PHASE18-NOTES 1.4.
 */
export function useHouseholds({ pageSize } = {}) {
  const [households, setHouseholds] = useState([]);
  const [limitCount, setLimitCount] = useState(pageSize || null);
  const { showToast } = useToast();
  const { volunteer, scope } = useAuth();

  const isViewAll = scope.unrestricted;
  // A household has no mandal, so a mandal-shaped scope cannot be expressed as a
  // filter on this collection — every household is potentially relevant and the
  // scoping happens where the members are. Matches householdScopeOk() in
  // firestore.rules, which allows kind == 'mandal' unconditionally.
  const byArea = !isViewAll
    && scope.kind !== SCOPE_KINDS.NONE
    && scope.kind !== SCOPE_KINDS.MANDAL;
  const areasKey = (scope.areas || []).join(",");

  const specs = useMemo(() => {
    const col = collection(db, "households");
    // No contact access at all; and an area-shaped scope with nothing assigned
    // matches nothing (`in` rejects an empty array anyway). Either way, no
    // listener is opened, so proving it costs no reads.
    if (!isViewAll && scope.kind === SCOPE_KINDS.NONE) return [];
    if (byArea && !(scope.areas || []).length) return [];

    const areas = (scope.areas || []).slice(0, 30);
    const tail = limitCount ? `|${limitCount}` : "";
    return [byArea
      ? {
        key: `households|area|${areas.join(",")}${tail}`,
        source: "households (area)",
        build: () => {
          const q = query(col, where("area", "in", areas), orderBy("area"));
          return limitCount ? query(q, limit(limitCount)) : q;
        },
      }
      : {
        key: `households|all${tail}`,
        source: "households",
        build: () => {
          const q = query(col, orderBy("updatedAt", "desc"));
          return limitCount ? query(q, limit(limitCount)) : q;
        },
      }];
  }, [isViewAll, byArea, scope.kind, areasKey, limitCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // `in` accepts at most 30 values. More than 30 areas on one volunteer is not a
  // real assignment, but silently dropping the rest would read as missing data, so
  // it is said out loud.
  useEffect(() => {
    const n = (scope.areas || []).length;
    if (byArea && n > 30) {
      console.warn(
        `[households] ${n} areas assigned; Firestore can filter on 30. `
        + `Households in the remaining ${n - 30} are not listed.`,
      );
    }
  }, [byArea, areasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rows, loading, error } = useSharedCollection(specs);

  useEffect(() => {
    if (error) showToast({ type: "error", message: friendlyFirestoreError(error, "households") });
  }, [error, showToast]);

  // The shared store is the source of truth; local state exists only so the
  // optimistic mutations below can paint before the server answers.
  useEffect(() => { setHouseholds(rows); }, [rows]);

  const hasMore = Boolean(limitCount) && rows.length === limitCount;

  const loadMore = useCallback(() => {
    if (pageSize) setLimitCount((c) => (c || 0) + pageSize);
  }, [pageSize]);

  const createHousehold = useCallback(
    async (data) => {
      const tempId = `temp-${Date.now()}`;
      const optimisticDoc = { id: tempId, ...data, createdAt: new Date(), updatedAt: new Date(), _pending: true };
      setHouseholds((prev) => [optimisticDoc, ...prev]);
      try {
        const ref = await addDoc(collection(db, "households"), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        meterWrites(1, "households");
        setHouseholds((prev) => prev.map((h) => (h.id === tempId ? { ...h, id: ref.id, _pending: false } : h)));
        logActivity({ volunteerId: volunteer?.id, action: "create_household", details: { householdId: ref.id } });
        showToast({ type: "success", message: "Household added." });
        return ref.id;
      } catch (err) {
        console.error(err);
        setHouseholds((prev) => prev.filter((h) => h.id !== tempId));
        showToast({ type: "error", message: "Couldn't save the household. Try again." });
        return null;
      }
    },
    [showToast, volunteer]
  );

  const updateHousehold = useCallback(
    async (id, data) => {
      const previous = households.find((h) => h.id === id);
      setHouseholds((prev) => prev.map((h) => (h.id === id ? { ...h, ...data, updatedAt: new Date() } : h)));
      try {
        await updateDoc(doc(db, "households", id), { ...data, updatedAt: serverTimestamp() });
        meterWrites(1, "households");
        logActivity({ volunteerId: volunteer?.id, action: "update_household", details: { householdId: id, fields: Object.keys(data) } });
        showToast({ type: "success", message: "Household updated." });
        return true;
      } catch (err) {
        console.error(err);
        if (previous) setHouseholds((prev) => prev.map((h) => (h.id === id ? previous : h)));
        showToast({ type: "error", message: "Couldn't update the household. Changes were reverted." });
        return false;
      }
    },
    [households, showToast, volunteer]
  );

  const deleteHousehold = useCallback(
    async (id) => {
      const previous = households.find((h) => h.id === id);
      const previousIndex = households.findIndex((h) => h.id === id);
      setHouseholds((prev) => prev.filter((h) => h.id !== id));
      try {
        const removedCount = await deleteHouseholdCascade(id);
        logActivity({ volunteerId: volunteer?.id, action: "delete_household", details: { householdId: id, individualsRemoved: removedCount } });
        showToast({ type: "success", message: removedCount > 0 ? `Household and ${removedCount} member(s) deleted.` : "Household deleted." });
        return true;
      } catch (err) {
        console.error(err);
        if (previous) setHouseholds((prev) => { const next = [...prev]; next.splice(previousIndex, 0, previous); return next; });
        showToast({ type: "error", message: "Couldn't delete the household. It has been restored." });
        return false;
      }
    },
    [households, showToast, volunteer]
  );

  const deleteHouseholdOnly = useCallback(
    async (id) => {
      const previous = households.find((h) => h.id === id);
      const previousIndex = households.findIndex((h) => h.id === id);
      setHouseholds((prev) => prev.filter((h) => h.id !== id));
      try {
        const keptCount = await deleteHouseholdOnlySvc(id);
        logActivity({ volunteerId: volunteer?.id, action: "delete_household_only", details: { householdId: id, membersKept: keptCount } });
        showToast({ type: "success", message: keptCount > 0 ? `Household deleted. ${keptCount} member(s) kept as standalone contacts.` : "Household deleted." });
        return true;
      } catch (err) {
        console.error(err);
        if (previous) setHouseholds((prev) => { const next = [...prev]; next.splice(previousIndex, 0, previous); return next; });
        showToast({ type: "error", message: "Couldn't delete the household. It has been restored." });
        return false;
      }
    },
    [households, showToast, volunteer]
  );

  return { households, loading, error, hasMore, loadMore, createHousehold, updateHousehold, deleteHousehold, deleteHouseholdOnly };
}

export function useFilteredHouseholds(households, { area, searchTerm } = {}) {
  return useMemo(() => {
    let result = households;
    if (area) result = result.filter((h) => h.area === area);
    if (searchTerm?.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter(
        (h) =>
          h.address?.toLowerCase().includes(term) ||
          h.area?.toLowerCase().includes(term) ||
          h.samparkKaryakartaName?.toLowerCase().includes(term) ||
          h.samparkKaryakartaNumber?.includes(term)
      );
    }
    return result;
  }, [households, area, searchTerm]);
}
