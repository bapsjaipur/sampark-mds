// src/hooks/useMyBatchQueue.js
// Ports loadVolunteerContacts()'s core idea: pull everything assigned to the
// signed-in volunteer via the batches collection (Phase 4), flatten into one
// ordered queue, and track position through it. Live via onSnapshot so a
// newly-assigned batch appears without a manual refresh.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './usePermissions';

export function useMyBatchQueue() {
  const { volunteer } = useAuth();
  const [batches, setBatches] = useState([]);
  const [individuals, setIndividuals] = useState({}); // id -> individual doc
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Live: which batches are assigned to me.
  useEffect(() => {
    if (!volunteer?.id) { setBatches([]); setLoading(false); return; }
    const q = query(collection(db, 'batches'), where('assignedVolunteerId', '==', volunteer.id));
    const unsub = onSnapshot(q, (snap) => setBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [volunteer?.id]);

  // Flatten to an ordered, deduplicated list of individualIds across all my batches.
  const individualIds = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    for (const b of batches) {
      for (const id of b.individualIds || []) {
        if (!seen.has(id)) { seen.add(id); ordered.push(id); }
      }
    }
    return ordered;
  }, [batches]);

  // Live-subscribe to each individual doc so status/reference updates reflect
  // immediately (e.g. if edited elsewhere in the app while calling).
  useEffect(() => {
    if (individualIds.length === 0) { setIndividuals({}); setLoading(false); return; }
    setLoading(true);
    const unsubs = individualIds.map((id) =>
      onSnapshot(doc(db, 'individuals', id), (snap) => {
        setIndividuals((prev) => ({ ...prev, [id]: snap.exists() ? { id: snap.id, ...snap.data() } : null }));
      })
    );
    setLoading(false);
    return () => unsubs.forEach((u) => u());
  }, [individualIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const contacts = useMemo(
    () => individualIds.map((id) => individuals[id]).filter(Boolean),
    [individualIds, individuals]
  );

  const current = contacts[currentIdx] || null;

  const next = useCallback(() => setCurrentIdx((i) => i + 1), []);
  const jumpTo = useCallback((idx) => setCurrentIdx(idx), []);
  const isDone = contacts.length > 0 && currentIdx >= contacts.length;

  return { contacts, current, currentIdx, next, jumpTo, isDone, loading, batches };
}
