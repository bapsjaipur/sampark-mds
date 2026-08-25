// src/lib/fsMetered.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — DROP-IN METERED FIRESTORE.
//
// Every function here has the SAME signature as the firebase/firestore original
// and returns the same thing. A service opts into the usage meter by changing one
// import line:
//
//     import { getDocs, writeBatch } from 'firebase/firestore';   // before
//     import { getDocs, writeBatch } from '../lib/fsMetered';     // after
//
// Not a single call site changes. That matters because the alternative was
// sprinkling forty meterX() calls through the services, where the one somebody
// forgets is precisely the one spending the quota.
//
// The batch wrapper counts set/update/delete as they are queued and bills on
// commit, so the figure is exact — including the thing that surprises people most
// about Firestore, that a 400-document WriteBatch is 400 writes and one round trip,
// not one write.
//
// Labels are derived from the documents themselves (a DocumentReference knows its
// parent collection), so the usage dashboard can say "individuals" or "batches"
// without anyone passing a string.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getDoc as rawGetDoc,
  getDocs as rawGetDocs,
  getCountFromServer as rawGetCountFromServer,
  addDoc as rawAddDoc,
  setDoc as rawSetDoc,
  updateDoc as rawUpdateDoc,
  deleteDoc as rawDeleteDoc,
  writeBatch as rawWriteBatch,
} from 'firebase/firestore';
import { meterGetDoc, meterGetDocs, meterCount, meterWrites, meterDeletes } from './usageMeter';

/** Collection a DocumentReference lives in, for the "where did it go" list. */
function ofDoc(ref) {
  return ref?.parent?.id || 'unknown';
}

/** A CollectionReference knows its own id; a Query does not, so ask a result. */
function ofQuery(q, snap) {
  return q?.id || snap?.docs?.[0]?.ref?.parent?.id || 'query';
}

export async function getDoc(ref) {
  const snap = await rawGetDoc(ref);
  meterGetDoc(snap, ofDoc(ref));
  return snap;
}

export async function getDocs(q) {
  const snap = await rawGetDocs(q);
  meterGetDocs(snap, ofQuery(q, snap));
  return snap;
}

export async function getCountFromServer(q) {
  const snap = await rawGetCountFromServer(q);
  // Billed per 1,000 documents counted, not per document — which is exactly why a
  // count beats fetching a list to read its length.
  meterCount(snap.data().count, `${q?.id || 'query'} count`);
  return snap;
}

export async function addDoc(colRef, data) {
  const ref = await rawAddDoc(colRef, data);
  meterWrites(1, colRef?.id || 'unknown');
  return ref;
}

export async function setDoc(ref, ...rest) {
  const out = await rawSetDoc(ref, ...rest);
  meterWrites(1, ofDoc(ref));
  return out;
}

export async function updateDoc(ref, ...rest) {
  const out = await rawUpdateDoc(ref, ...rest);
  meterWrites(1, ofDoc(ref));
  return out;
}

export async function deleteDoc(ref) {
  const out = await rawDeleteDoc(ref);
  meterDeletes(1, ofDoc(ref));
  return out;
}

/**
 * A WriteBatch that counts. Same surface as the real one — set/update/delete
 * return the batch so existing chains keep working — plus an exact bill on commit.
 *
 * Counts are cleared after commit: a batch is single-use, and if a caller ever
 * reuses one the second commit must not re-bill the first commit's documents.
 */
export function writeBatch(dbRef) {
  const batch = rawWriteBatch(dbRef);
  let writes = 0;
  let deletes = 0;
  let label = null;

  const note = (ref) => { if (!label) label = ofDoc(ref); };

  const wrapper = {
    set(ref, ...rest) { batch.set(ref, ...rest); writes += 1; note(ref); return wrapper; },
    update(ref, ...rest) { batch.update(ref, ...rest); writes += 1; note(ref); return wrapper; },
    delete(ref) { batch.delete(ref); deletes += 1; note(ref); return wrapper; },
    async commit() {
      const out = await batch.commit();
      if (writes) meterWrites(writes, label || 'batch');
      if (deletes) meterDeletes(deletes, label || 'batch');
      writes = 0;
      deletes = 0;
      return out;
    },
  };
  return wrapper;
}
