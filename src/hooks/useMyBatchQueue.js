// src/hooks/useMyBatchQueue.js
// Ports loadVolunteerContacts()'s core idea: pull everything assigned to the
// signed-in volunteer via the batches collection (Phase 4), flatten into one
// ordered queue, and track position through it. Live via onSnapshot so a
// newly-assigned batch appears without a manual refresh.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './usePermissions';

/**
 * Where this volunteer had got to, remembered across a remount.
 *
 * Tapping "Profile" leaves /calling entirely and React Router remounts the page
 * on the way back, so plain component state always came back as contact #1 — with
 * a 40–100 name batch that meant hunting for your place every single time.
 *
 * The CONTACT ID is stored, not the index: batches get reassigned and reordered,
 * and an index would quietly resume at a stranger. localStorage rather than
 * Firestore because resuming must not cost a read against the daily budget, and
 * "where I was" is per-device by nature.
 */
const CURSOR_PREFIX = 'mds_calling_cursor:';

function readCursor(key) {
  if (!key) return null;
  try { return window.localStorage.getItem(key) || null; } catch { return null; }
}

function writeCursor(key, value) {
  if (!key) return;
  // Private mode and a full quota both throw. Resuming is a convenience; losing
  // it must never break the calling screen.
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function useMyBatchQueue() {
  const { volunteer } = useAuth();
  const [batches, setBatches] = useState([]);
  const [individuals, setIndividuals] = useState({}); // id -> individual doc
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentIdx, setCurrentIdx] = useState(0);

  const cursorKey = volunteer?.id ? `${CURSOR_PREFIX}${volunteer.id}` : null;
  // Read once, up front. The persist effect below would otherwise overwrite the
  // saved id with contacts[0] before the restore effect ever got to read it.
  const wantedIdRef = useRef(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    restoredRef.current = false;
    wantedIdRef.current = readCursor(cursorKey);
    setCurrentIdx(0);
  }, [cursorKey]);

  // Live: which batches are assigned to me.
  useEffect(() => {
    if (!volunteer?.id) { setBatches([]); setLoading(false); return; }
    setError(null);
    const q = query(collection(db, 'batches'), where('assignedVolunteerId', '==', volunteer.id));
    const unsub = onSnapshot(
      q,
      (snap) => setBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      // Without this handler a permission-denied read is swallowed and the queue
      // just looks empty — the exact symptom of an assigned volunteer who cannot
      // see their batch (their role has edit_contacts but no view_* permission,
      // and canReadBatches denied the read). Surface it so callers can tell
      // "denied" apart from "genuinely no batch".
      (err) => { setError(err); setBatches([]); setLoading(false); },
    );
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
      onSnapshot(
        doc(db, 'individuals', id),
        (snap) => {
          setIndividuals((prev) => ({ ...prev, [id]: snap.exists() ? { id: snap.id, ...snap.data() } : null }));
        },
        // A denied individual read is the other way this queue can silently empty.
        (err) => setError(err),
      )
    );
    setLoading(false);
    return () => unsubs.forEach((u) => u());
  }, [individualIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const contacts = useMemo(
    () => individualIds.map((id) => individuals[id]).filter(Boolean),
    [individualIds, individuals]
  );

  // Restore the saved position, once. Each individual arrives on its own snapshot
  // so `contacts` fills in over many commits — the wanted contact may be number 60
  // and simply not here yet. Keep looking until the queue has finished streaming
  // (contacts.length reaches individualIds.length), then stop and accept the top.
  useEffect(() => {
    if (restoredRef.current) return;
    const wanted = wantedIdRef.current;
    if (!wanted) { restoredRef.current = true; return; }
    if (contacts.length === 0) return;
    const idx = contacts.findIndex((c) => c.id === wanted);
    if (idx >= 0) {
      setCurrentIdx(idx);
      restoredRef.current = true;
    } else if (contacts.length >= individualIds.length) {
      // Everything has arrived and they are not in it — reassigned out of this
      // batch, or deleted. Start at the top rather than wait for a no-show.
      restoredRef.current = true;
    }
  }, [contacts, individualIds.length]);

  // Persist only AFTER the restore has settled, or the first partial queue would
  // save contacts[0] over the very id the restore is still waiting for.
  useEffect(() => {
    if (!cursorKey || !restoredRef.current) return;
    const id = contacts[currentIdx]?.id;
    if (id) writeCursor(cursorKey, id);
  }, [cursorKey, contacts, currentIdx]);

  const current = contacts[currentIdx] || null;

  const next = useCallback(() => setCurrentIdx((i) => i + 1), []);
  const jumpTo = useCallback((idx) => setCurrentIdx(idx), []);
  const isDone = contacts.length > 0 && currentIdx >= contacts.length;

  // Whether the opening contact came from a saved cursor rather than the top of
  // the batch. The screen says so once, so nobody thinks names went missing.
  const resumed = Boolean(wantedIdRef.current) && currentIdx > 0;

  return { contacts, current, currentIdx, next, jumpTo, isDone, resumed, loading, batches, error };
}
