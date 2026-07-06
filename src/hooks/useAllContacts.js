// src/hooks/useAllContacts.js
// Powers the new standalone "All Contacts" page. Individuals no longer
// require a household — this subscribes to the whole individuals
// collection (like useGlobalSearch, but as the primary view, not a lazy
// search-only load) and exposes optimistic create/update/delete, mirroring
// useIndividuals.js's pattern but without a householdId dependency.
import { useEffect, useState, useCallback } from "react";
import {
  collection, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "./usePermissions";
import { logActivity } from "../lib/activityLog";
import { toMonthDay } from "../lib/dateHelpers";
import { friendlyFirestoreError } from "../lib/firestoreErrorMessage";

export function useAllContacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { showToast } = useToast();
  const { volunteer } = useAuth();

  useEffect(() => {
    const q = query(collection(db, "individuals"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => { setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error(err); setError(err); setLoading(false); showToast({ type: "error", message: friendlyFirestoreError(err, "contacts") }); }
    );
    return unsub;
  }, [showToast]);

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

  return { contacts, loading, error, createContact, updateContact, deleteContact };
}
