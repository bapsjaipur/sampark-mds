// src/hooks/useAllContacts.js
// Powers the standalone "All Contacts" page. Individuals no longer require a
// household, so this reads the `individuals` collection directly (rather than
// per-household like useIndividuals.js) and exposes optimistic
// create/update/delete.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — READS. This is the most expensive hook in the app, so it is worth
// being precise about what it now costs.
//
// It used to subscribe to the WHOLE collection and filter in memory. That was
// correct but ruinous: 3,100 individuals is 3,100 billed reads per listener, and
// the Spark plan allows 50,000 a day — fourteen visits to Contacts and the app is
// dark until midnight US Pacific.
//
// Two things changed:
//
//   1. IT NARROWS ON THE SERVER. `individuals.area` is denormalised from the
//      parent household (IndividualForm writes it for every member;
//      backfillMemberAreas repairs strays; Data Integrity reports 0 missing), and
//      `mandal` lives on the individual already. So a scoped volunteer's list is
//      one `where(... 'in' ...)` and they are billed for their own people only —
//      typically a few hundred instead of three thousand.
//
//   2. IT SHARES ITS LISTENER. Via useSharedCollection, ContactsPage and the Data
//      Integrity scan open ONE listener between them, and coming back to a page
//      inside the grace window is free.
//
// Firestore allows only one `in` clause per query and caps it at 30 values, which
// dictates the shapes below: AREA and MANDAL are one query each; INTERSECT queries
// the area axis and applies the mandal half in memory; UNION is two listeners
// merged by id. matchesScope() still runs over whatever comes back — it is the
// same predicate every other scoped list in the app uses, it applies the half a
// query cannot express, and it keeps the list honest if the 30-value cap truncates
// the filter.
//
// No composite index is needed: the scoped queries deliberately carry no orderBy
// (a filter + sort on different fields would demand one), and the few hundred rows
// are sorted in memory instead.
//
// Reads of `individuals` are permission-only on the server — rules cannot see a
// query's constraints, so scope predicates there would fail whole list queries
// rather than return fewer rows (see the header of firestore.rules). Contact-level
// read scoping is therefore the client's job, and this is where it happens.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  collection, addDoc, setDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy, limit, where, getCountFromServer, writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "./usePermissions";
import { logActivity } from "../lib/activityLog";
import { toMonthDay } from "../lib/dateHelpers";
import { friendlyFirestoreError } from "../lib/firestoreErrorMessage";
import { SCOPE_KINDS, matchesScope } from "../lib/scope";
import { useSharedCollection } from "./useSharedCollection";
import { meterCount, meterWrites, meterDeletes } from "../lib/usageMeter";

/** Firestore's hard cap on values in an `in` filter. */
const IN_LIMIT = 30;

// The "N total" line needs a server count, and getCountFromServer bills a read per
// 1,000 documents — small, but it would be spent again on every single visit to
// Contacts. One figure per session-minute is plenty for a headline number.
const COUNT_TTL_MS = 5 * 60 * 1000;
let countCache = null; // { at, total, ungrouped }

function byName(a, b) {
  return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" });
}

/**
 * @param {{ pageSize?: number }} [opts] — pass a pageSize (e.g. 20) to paginate
 *   the unrestricted list via a growing-limit listener. A SCOPED list ignores it:
 *   its query has no orderBy (see the header), so a limit would return an
 *   arbitrary slice, and the scoped set is small enough to load whole anyway.
 */
export function useAllContacts({ pageSize } = {}) {
  const [contacts, setContacts] = useState([]);
  const [limitCount, setLimitCount] = useState(pageSize || null);
  // True counts fetched from the server (not limited to the loaded page).
  const [serverTotal, setServerTotal] = useState(null);
  const [serverUngrouped, setServerUngrouped] = useState(null);
  const { showToast } = useToast();
  const { volunteer, scope } = useAuth();

  // view_all_contacts already resolves to an unrestricted scope (see
  // resolveScope), so the shape is the only thing worth asking about here.
  const isViewAll = scope.unrestricted;
  const isViewAssigned = !isViewAll && scope.kind !== SCOPE_KINDS.NONE;

  // Scope is an object rebuilt whenever the volunteer or their roles change;
  // these primitives keep the query from being rebuilt on identity alone.
  const areasKey = (scope.areas || []).join(",");
  const mandalsKey = (scope.mandals || []).join(",");

  const specs = useMemo(() => {
    const col = collection(db, "individuals");

    if (isViewAll) {
      const key = limitCount ? `individuals|all|${limitCount}` : "individuals|all";
      return [{
        key,
        source: "individuals",
        build: () => (limitCount
          ? query(col, orderBy("name"), limit(limitCount))
          : query(col, orderBy("name"))),
      }];
    }

    // No contact access, or a scoped role whose territory has not been assigned
    // yet: matches nothing, and opening a listener would cost reads to prove it.
    // scope.empty stays distinguishable from "the collection is empty" at the
    // call site.
    if (scope.kind === SCOPE_KINDS.NONE || scope.empty) return [];

    const areas = (scope.areas || []).slice(0, IN_LIMIT);
    const mandals = (scope.mandals || []).slice(0, IN_LIMIT);
    const areaSpec = areas.length ? {
      key: `individuals|area|${areas.join(",")}`,
      source: "individuals (area)",
      build: () => query(col, where("area", "in", areas)),
    } : null;
    const mandalSpec = mandals.length ? {
      key: `individuals|mandal|${mandals.join(",")}`,
      source: "individuals (mandal)",
      build: () => query(col, where("mandal", "in", mandals)),
    } : null;

    switch (scope.kind) {
      case SCOPE_KINDS.AREA:
        return areaSpec ? [areaSpec] : [];
      case SCOPE_KINDS.MANDAL:
        return mandalSpec ? [mandalSpec] : [];
      case SCOPE_KINDS.INTERSECT:
        // Both axes must match, so either one can be the server-side half and the
        // other is applied by matchesScope below. The area axis is chosen because
        // it is the same field useHouseholds narrows on, which keeps the two lists
        // on a page consistent with each other.
        return areaSpec ? [areaSpec] : (mandalSpec ? [mandalSpec] : []);
      case SCOPE_KINDS.UNION:
      default:
        return [areaSpec, mandalSpec].filter(Boolean);
    }
  }, [isViewAll, scope.kind, scope.empty, areasKey, mandalsKey, limitCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const over = Math.max((scope.areas || []).length, (scope.mandals || []).length);
    if (!isViewAll && over > IN_LIMIT) {
      console.warn(
        `[contacts] ${over} scope values assigned; Firestore can filter on ${IN_LIMIT}. `
        + "Contacts beyond that are not listed — split the role or raise it to a wider scope.",
      );
    }
  }, [isViewAll, areasKey, mandalsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rows, loading, error, fromCache } = useSharedCollection(specs);

  useEffect(() => {
    if (error) showToast({ type: "error", message: friendlyFirestoreError(error, "contacts") });
  }, [error, showToast]);

  // The shared store is the source of truth; local state exists so the optimistic
  // mutations below can paint before the server answers. Every snapshot replaces
  // it, which is what reconciles an optimistic row with its saved version.
  useEffect(() => {
    const visible = isViewAll
      ? rows
      : rows.filter((ind) => matchesScope(scope, { area: ind.area || null, mandal: ind.mandal || null }));
    // The unrestricted query is already ordered by the server; a scoped one is not
    // (no composite index — see the header), so it is sorted here.
    setContacts(isViewAll ? visible : [...visible].sort(byName));
  }, [rows, isViewAll, scope.kind, areasKey, mandalsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasMore = Boolean(limitCount) && rows.length === limitCount;

  // Server-side counts, for the "N total" line. Only the unrestricted case can be
  // counted on the server: a scoped count would need the same in-memory predicate
  // as the list, so it is left null and the call site falls back to
  // contacts.length — which IS the true scoped total, because the scoped query
  // returns the whole scope rather than a page of it.
  useEffect(() => {
    if (!isViewAll) {
      setServerTotal(null);
      setServerUngrouped(null);
      return;
    }
    if (countCache && Date.now() - countCache.at < COUNT_TTL_MS) {
      setServerTotal(countCache.total);
      setServerUngrouped(countCache.ungrouped);
      return;
    }
    const colRef = collection(db, "individuals");
    Promise.all([
      getCountFromServer(query(colRef)),
      getCountFromServer(query(colRef, where("householdId", "==", null))),
    ]).then(([totSnap, ungSnap]) => {
      const total = totSnap.data().count;
      const ungrouped = ungSnap.data().count;
      meterCount(total, "individuals count");
      meterCount(ungrouped, "individuals count");
      countCache = { at: Date.now(), total, ungrouped };
      setServerTotal(total);
      setServerUngrouped(ungrouped);
    }).catch(console.error);
  }, [isViewAll]);

  const loadMore = useCallback(() => {
    if (pageSize) setLimitCount((c) => (c || 0) + pageSize);
  }, [pageSize]);

  const withDerivedFields = (data) => ({
    ...data,
    dobMonthDay: data.dob !== undefined ? toMonthDay(data.dob) : undefined,
    anniversaryMonthDay: data.anniversary !== undefined ? toMonthDay(data.anniversary) : undefined,
  });

  /** Creates a standalone contact — householdId is explicitly null, not omitted,
   * so queries like where('householdId','==',null) work as expected. */
  const createContact = useCallback(
    async (data) => {
      // See useIndividuals.js's createIndividual for why `id` may be preset.
      const { id: presetId, ...rest } = data;
      const tempId = presetId || `temp-${Date.now()}`;
      const payload = withDerivedFields({ ...rest, householdId: null });
      const optimisticDoc = { id: tempId, ...payload, createdAt: new Date(), updatedAt: new Date(), _pending: true };
      setContacts((prev) => [...prev, optimisticDoc]);
      try {
        let newId;
        if (presetId) {
          await setDoc(doc(db, "individuals", presetId), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          newId = presetId;
        } else {
          const ref = await addDoc(collection(db, "individuals"), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          newId = ref.id;
        }
        meterWrites(1, "individuals");
        setContacts((prev) => prev.map((c) => (c.id === tempId ? { ...c, id: newId, _pending: false } : c)));
        logActivity({ volunteerId: volunteer?.id, individualId: newId, action: "create_individual" });
        showToast({ type: "success", message: `${data.name || "Contact"} added.` });
        return newId;
      } catch (err) {
        console.error(err);
        setContacts((prev) => prev.filter((c) => c.id !== tempId));
        showToast({ type: "error", message: "Couldn't save the contact. Try again." });
        return null;
      }
    },
    [showToast, volunteer]
  );

  const updateContact = useCallback(
    async (id, data) => {
      const previous = contacts.find((c) => c.id === id);
      const payload = withDerivedFields(data);
      setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...payload, updatedAt: new Date() } : c)));
      try {
        await updateDoc(doc(db, "individuals", id), { ...payload, updatedAt: serverTimestamp() });
        meterWrites(1, "individuals");
        logActivity({ volunteerId: volunteer?.id, individualId: id, action: "update_individual", details: { fields: Object.keys(data) } });
        showToast({ type: "success", message: "Contact updated." });
        return true;
      } catch (err) {
        console.error(err);
        if (previous) setContacts((prev) => prev.map((c) => (c.id === id ? previous : c)));
        showToast({ type: "error", message: "Couldn't save changes. Reverted." });
        return false;
      }
    },
    [contacts, showToast, volunteer]
  );

  const deleteContact = useCallback(
    async (id) => {
      const previous = contacts.find((c) => c.id === id);
      const previousIndex = contacts.findIndex((c) => c.id === id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      try {
        await deleteDoc(doc(db, "individuals", id));
        meterDeletes(1, "individuals");
        logActivity({ volunteerId: volunteer?.id, individualId: id, action: "delete_individual" });
        showToast({ type: "success", message: "Contact removed." });
        return true;
      } catch (err) {
        console.error(err);
        if (previous) setContacts((prev) => { const next = [...prev]; next.splice(previousIndex, 0, previous); return next; });
        showToast({ type: "error", message: "Couldn't remove the contact. Restored." });
        return false;
      }
    },
    [contacts, showToast, volunteer]
  );

  const bulkDeleteContacts = useCallback(
    async (ids) => {
      const snapshot = contacts.filter((c) => ids.includes(c.id));
      setContacts((prev) => prev.filter((c) => !ids.includes(c.id)));
      try {
        // A batch is one network round trip but bills one delete PER DOCUMENT —
        // 500 ids is 500 against the day's 20,000.
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = writeBatch(db);
          const slice = ids.slice(i, i + CHUNK);
          slice.forEach((id) => batch.delete(doc(db, "individuals", id)));
          await batch.commit();
          meterDeletes(slice.length, "individuals bulk delete");
        }
        logActivity({ volunteerId: volunteer?.id, action: "bulk_delete_individuals", details: { count: ids.length } });
        showToast({ type: "success", message: `${ids.length} contact${ids.length !== 1 ? "s" : ""} permanently deleted.` });
        return true;
      } catch (err) {
        console.error(err);
        setContacts((prev) => [...prev, ...snapshot]);
        showToast({ type: "error", message: "Couldn't delete contacts. Changes reverted." });
        return false;
      }
    },
    [contacts, showToast, volunteer]
  );

  return {
    contacts, loading, error, hasMore, loadMore, fromCache,
    createContact, updateContact, deleteContact, bulkDeleteContacts,
    serverTotal, serverUngrouped, isViewAll, isViewAssigned,
  };
}
