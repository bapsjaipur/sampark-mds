// src/hooks/useHouseholds.js
// MERGE FIX: import path — '../contexts/AuthContext' -> '../hooks/usePermissions'
// (canonical hook; `useAuth` is exported as an alias so this line barely changed).
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "./usePermissions";
import { logActivity } from "../lib/activityLog";
import { deleteHouseholdCascade } from "../services/householdService";

export function useHouseholds() {
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { showToast } = useToast();
  const { volunteer } = useAuth();

  useEffect(() => {
    const q = query(collection(db, "households"), orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setHouseholds(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error(err); setError(err); setLoading(false); showToast({ type: "error", message: "Couldn't load households. Check your connection." }); }
    );
    return unsub;
  }, [showToast]);

  const createHousehold = useCallback(
    async (data) => {
      const tempId = `temp-${Date.now()}`;
      const optimisticDoc = { id: tempId, ...data, createdAt: new Date(), updatedAt: new Date(), _pending: true };
      setHouseholds((prev) => [optimisticDoc, ...prev]);
      try {
        const ref = await addDoc(collection(db, "households"), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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

  return { households, loading, error, createHousehold, updateHousehold, deleteHousehold };
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
