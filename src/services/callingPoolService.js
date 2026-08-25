// src/services/callingPoolService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 26 — THE FOLLOW-UP CALLING LIST.
//
// The request, verbatim:
//
//   "currently our method of follow up for yuvak is only follow up selected
//    contacts approx 400+ out of 1000+ because there is only 10-12 volunteers
//    have to call so 600+ contacts unable to make call or those 600+ never come
//    only one time in a year. that why they exclude only from calling. similarly
//    now i want to apply this type of feature in this so only selected contacts
//    will generate batches, and i 1000+ contacts when require to call once in a
//    year then also can generate batch of all contacts."
//
// So: two lists out of one roster. The weekly follow-up list is the ~400 who are
// actually rung; the roster is still all 1000+, and once a year the batch
// generator has to be able to sweep every one of them. Nobody is deleted, nobody
// is hidden — they are simply not in this week's calling.
//
// ONE FIELD DOES ALL OF IT: individuals/{id}.callingPool
//
//   absent  → ON the calling list   ← every contact that exists today
//   true    → ON the calling list
//   false   → OFF the calling list
//
// WHY ABSENT MEANS ON, and why that is not negotiable:
//
//   1. There are 1000+ existing contacts and not one of them has the field. If
//      absent meant OFF, the day this ships every batch generation returns zero
//      contacts and the app looks broken until somebody hand-ticks a thousand
//      people. Default-in is the only migration-free reading.
//
//   2. It matches what the karyakartas already do. They don't build a call list
//      from nothing each week — they take the roster and EXCLUDE the people who
//      come once a year. "Excluded" is the exceptional state, so `false` is the
//      value worth storing.
//
//   3. It fails safe. A dropped write leaves somebody on the list and they get an
//      extra phone call. The opposite default fails by silently never ringing
//      someone, which is the failure nobody would notice for months.
//
// THE FIRESTORE TRAP THIS FILE EXISTS TO DOCUMENT:
//
//   where('callingPool', '!=', false)      ← WRONG. Returns nothing useful.
//
// A Firestore inequality only matches documents where the field EXISTS. `!=
// false` therefore skips every legacy contact — the exact 1000+ this feature is
// for. The pool filter is consequently an in-memory predicate
// (`c.callingPool === false`) inside batchService's filterEligible(), which costs
// nothing extra because that function is already post-filtering rows it holds,
// and needs no composite index.
//
// PERMISSION: reuses edit_contacts. Writing individuals/{id} already requires it
// in firestore.rules, so nothing here waits on a rules deploy.
// ─────────────────────────────────────────────────────────────────────────────
import { collection, doc } from 'firebase/firestore';
// Metered drop-ins — a segment action can be 600 writes against a 20k/day cap, so
// it has to show up in the usage dashboard. See lib/fsMetered.js.
import { writeBatch } from '../lib/fsMetered';
import { db } from '../lib/firebase';

// Firestore caps a WriteBatch at 500 operations; same headroom batchService uses.
const WRITE_BATCH_LIMIT = 450;

/**
 * Is this contact on the follow-up calling list?
 *
 * The one place the absent-means-on rule is written as code. Everything that
 * needs the answer — the batch generator, the contact card, the season view —
 * calls this rather than testing the field, so the default can never be read two
 * different ways in two different files.
 */
export function isInCallingPool(contact) {
  return contact?.callingPool !== false;
}

/** How many of a list are on the calling list, and how many are off it. */
export function splitByCallingPool(contacts = []) {
  const inPool = [];
  const outPool = [];
  contacts.forEach((c) => (isInCallingPool(c) ? inPool : outPool).push(c));
  return { inPool, outPool };
}

/**
 * setCallingPoolBulk(ids, inPool, meta) — move people on or off the list.
 *
 * @param {string[]} ids     individual document ids
 * @param {boolean}  inPool  true = on the calling list, false = off it
 * @param {object}   [meta]  { by } — uid of whoever pressed the button
 * @returns {Promise<{ updated: number, batches: number }>}
 *
 * `true` is stored explicitly rather than deleting the field. Both readings mean
 * the same thing to isInCallingPool(), but a stored `true` is the difference
 * between "somebody decided this person is in" and "nobody has ever looked at
 * this person" — and when a sanchalak asks why a contact is being rung, that
 * distinction plus callingPoolAt is the whole answer.
 *
 * Ids are de-duplicated first: the season view can hand over overlapping
 * segments, and paying twice for the same document is real money on the free
 * plan.
 */
export async function setCallingPoolBulk(ids = [], inPool, meta = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { updated: 0, batches: 0 };

  const col = collection(db, 'individuals');
  const patch = {
    callingPool: Boolean(inPool),
    callingPoolAt: new Date().toISOString(),
    ...(meta.by ? { callingPoolBy: meta.by } : {}),
  };

  let batches = 0;
  for (let i = 0; i < unique.length; i += WRITE_BATCH_LIMIT) {
    const slice = unique.slice(i, i + WRITE_BATCH_LIMIT);
    const wb = writeBatch(db);
    // update(), not set(merge) — these documents exist. A set() on an id that has
    // since been deleted would resurrect it as a stub with nothing but a
    // callingPool field, which would then show up in every roster as a blank row.
    slice.forEach((id) => wb.update(doc(col, id), patch));
    await wb.commit();
    batches += 1;
  }

  return { updated: unique.length, batches };
}

/** Convenience wrappers, so call sites read as the sentence they mean. */
export function addToCallingPool(ids, meta) {
  return setCallingPoolBulk(ids, true, meta);
}

export function removeFromCallingPool(ids, meta) {
  return setCallingPoolBulk(ids, false, meta);
}
