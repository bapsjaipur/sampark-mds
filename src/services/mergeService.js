// src/services/mergeService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 41 — MERGING TWO RECORDS OF ONE PERSON, WITHOUT LOSING THE HISTORY.
//
// The Data Integrity tab could only ever DELETE a duplicate, which throws away
// everything attached to it: which sabhas that copy was marked present at, which
// batch it sits in, the notes a karyakarta typed against it. So the operator's
// real choice was "keep two records of one man" or "delete half his history",
// and both are wrong. This is the third option.
//
// WHAT MOVES, AND WHY EACH ONE IS DONE THE WAY IT IS
//
//   attendance     The reason this feature exists — "i want those merge so there
//                  all history of sabha attendance also merge". A mark lives at
//                  the deterministic id `${eventId}_${individualId}`, so it cannot
//                  be re-pointed by updating a field: the id itself encodes who
//                  it belongs to. firestore.rules says the same thing in the other
//                  direction — `allow update` requires eventId AND individualId to
//                  be unchanged, i.e. a mark may be rewritten, never moved. So the
//                  winner's row is CREATED and the loser's is DELETED.
//                  If the winner was already marked present at that sabha, the
//                  existing row is left exactly as it is — its markedBy/markedAt
//                  are the true record of who marked him and when, and restamping
//                  them with today's merge would be a small lie in the audit trail.
//
//   batches        `individualIds[]` and `contactCount` are rewritten together, as
//                  a pair, in one update — the rule the whole batchService follows.
//                  arrayRemove + increment(-1) would drift the moment the array and
//                  the count disagreed, and they do disagree in legacy documents.
//
//   volunteers     A login created "From an existing contact" carries
//                  `linkedIndividualId`, and the contact carries `volunteerId`.
//                  Merge away the linked copy and that login points at a deleted
//                  document — the volunteer's own profile page goes blank. Both
//                  ends are re-pointed.
//
//   the fields     Blank-filling only. The primary is whatever the operator chose
//                  and its values are never overwritten; a field it leaves empty is
//                  taken from the first duplicate that has one. `callCount` sums
//                  (the calls really were made), `hobby` unions, and `reference` —
//                  the notes — CONCATENATES rather than picks, because two
//                  karyakartas' notes about one man are both true.
//
//   activity       Deliberately NOT re-pointed. firestore.rules keeps it
//                  append-only (`allow update, delete: if false`) and that is the
//                  point of an audit log: it records what happened to a document
//                  that existed at the time. Rewriting history to say the calls
//                  were always against the surviving record would make the trail
//                  agree with the present at the cost of it being true. The merge
//                  writes its own row instead, naming both ids, so the old rows
//                  remain findable.
//
//   households     Nothing to do. Membership is a pointer ON the individual
//                  (`householdId`); households hold no member array and no primary
//                  contact id, so the surviving record's pointer is the whole story.
//
// ORDER AND FAILURE. Everything is additive first, the deletes go last, in their
// own commit. If a rules failure or a dropped connection stops it halfway the
// surviving record has already gained the history and the duplicate still exists
// — visibly, in the next scan — so re-running finishes the job. The reverse order
// would lose the history on a half-failure. Re-running is safe: creating an
// attendance row that already exists is skipped, and an id already removed from a
// batch array simply isn't there to remove.
//
// COST. Per merge: 1 attendance query per record (winner + losers), 1 batch query
// and 1 volunteer query per 30 losers. Writes: one per attendance mark moved
// (×2 — create + delete), one per touched batch, one per re-pointed login, one for
// the primary, one per deleted duplicate, one audit row. A typical two-record
// merge with a season of attendance is roughly 25 reads and 30 writes — small
// against the 50k/20k daily budget, but the count is returned so a bulk session
// can be watched rather than guessed at.
// ─────────────────────────────────────────────────────────────────────────────
import { collection, doc, query, serverTimestamp, where } from 'firebase/firestore';
import { deleteDoc, getDocs, updateDoc, writeBatch } from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { chunk } from '../lib/firestoreHelpers';

const WRITE_BATCH_LIMIT = 450;
const IN_LIMIT = 30;

// Never blank-filled from a duplicate onto the survivor.
//   id/_key            not data
//   createdAt/By       the survivor's own provenance; taking the duplicate's
//                      would date the record to the wrong entry
//   updatedAt          stamped by this write
//   source/importRunId the import markers. firestore.rules lets import_data
//                      delete a contact ONLY if source == 'history-import', so
//                      copying that marker onto a hand-entered survivor would
//                      quietly widen who may delete him.
//   mergeIgnore        dismissals are about a pair, and the pair is gone
//   volunteerId        handled explicitly below, with the other end of the link
const NEVER_COPY = new Set([
  'id', '_key', 'createdAt', 'createdBy', 'updatedAt',
  'source', 'importRunId', 'mergeIgnore', 'mergedFrom', 'volunteerId',
]);

// `false` and `0` are ANSWERS, not blanks. callingPool:false means somebody took
// this person off the follow-up list on purpose, and a merge must not undo that
// by treating it as an empty slot waiting to be filled.
function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * What the surviving record will look like — computed WITHOUT touching the
 * network so the UI can show it before anything is written. Exported for the
 * preview; mergeContacts() calls it again itself rather than trusting a value
 * that travelled through component state.
 *
 * @param {object} primary       the record that survives
 * @param {object[]} duplicates  the records folded into it
 * @returns {{ updates: object, filled: Array<{field:string, value:any, from:string}> }}
 */
export function planMerge(primary, duplicates) {
  const updates = {};
  const filled = [];

  // Oldest first, so when two duplicates both offer a value for an empty field
  // the one that has been in the database longest wins — it is the one whose
  // value other people have already been reading.
  const others = [...duplicates].sort((a, b) => {
    const ta = a.createdAt?.seconds ?? a.createdAt?.toMillis?.() ?? 0;
    const tb = b.createdAt?.seconds ?? b.createdAt?.toMillis?.() ?? 0;
    return ta - tb;
  });

  const keys = new Set();
  others.forEach((o) => Object.keys(o).forEach((k) => keys.add(k)));

  keys.forEach((k) => {
    if (NEVER_COPY.has(k) || k.startsWith('_')) return;
    if (k === 'callCount' || k === 'hobby' || k === 'reference') return;  // below
    if (!isBlank(primary[k])) return;
    const donor = others.find((o) => !isBlank(o[k]));
    if (!donor) return;
    updates[k] = donor[k];
    filled.push({ field: k, value: donor[k], from: donor.name || donor.id });
  });

  // The calls really were made, to that number, by those karyakartas. A merge
  // that reset the count to the survivor's would make an active contact look
  // never-rung and push him to the front of the next batch.
  const totalCalls = [primary, ...others].reduce((n, r) => n + (Number(r.callCount) || 0), 0);
  if (totalCalls !== (Number(primary.callCount) || 0)) {
    updates.callCount = totalCalls;
    filled.push({ field: 'callCount', value: totalCalls, from: 'sum of all records' });
  }

  const hobbies = [...new Set([primary, ...others].flatMap((r) => (Array.isArray(r.hobby) ? r.hobby : [])))];
  if (hobbies.length > (primary.hobby?.length || 0)) {
    updates.hobby = hobbies;
    filled.push({ field: 'hobby', value: hobbies, from: 'combined' });
  }

  // Notes are free text written by different people at different times. There is
  // no "more correct" one to pick, so both are kept, separated and attributed.
  const notes = [];
  const seenNote = new Set();
  [primary, ...others].forEach((r) => {
    const t = String(r.reference || '').trim();
    if (!t || seenNote.has(t)) return;
    seenNote.add(t);
    notes.push(t);
  });
  const mergedNotes = notes.join(' · ');
  if (mergedNotes !== String(primary.reference || '').trim()) {
    updates.reference = mergedNotes;
    filled.push({ field: 'reference', value: mergedNotes, from: 'both records, joined' });
  }

  return { updates, filled };
}

/** Every attendance mark held by one individual. */
async function attendanceFor(individualId) {
  const snap = await getDocs(query(collection(db, 'attendance'), where('individualId', '==', individualId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * What a merge would cost and move, with nothing written. Same queries as the
 * real thing, so the number the operator approves is the number that happens.
 *
 * @returns {{ attendanceMoved:number, attendanceAlreadyHeld:number,
 *             batches:Array, volunteerLinks:number, filled:Array, writes:number }}
 */
export async function previewMerge({ primary, duplicates }) {
  const loserIds = duplicates.map((d) => d.id);
  const [mine, ...theirs] = await Promise.all([
    attendanceFor(primary.id),
    ...loserIds.map(attendanceFor),
  ]);
  const held = new Set(mine.map((a) => a.eventId));
  const incoming = theirs.flat();
  const newEvents = new Set();
  let already = 0;
  incoming.forEach((a) => {
    if (held.has(a.eventId) || newEvents.has(a.eventId)) already += 1;
    else newEvents.add(a.eventId);
  });

  const batches = await batchesHolding(loserIds);
  const links = await linkedVolunteers(loserIds);
  const { filled } = planMerge(primary, duplicates);

  const writes = newEvents.size + incoming.length + batches.length + links.length
    + 1 /* primary */ + loserIds.length + 1 /* audit */;

  return {
    attendanceMoved: newEvents.size,
    attendanceAlreadyHeld: already,
    batches: batches.map((b) => ({ id: b.id, name: b.name })),
    volunteerLinks: links.length,
    filled,
    writes,
  };
}

/** Batches whose `individualIds` contains any of these ids. */
async function batchesHolding(ids) {
  const out = new Map();
  for (const part of chunk(ids, IN_LIMIT)) {
    const snap = await getDocs(query(collection(db, 'batches'), where('individualIds', 'array-contains-any', part)));
    snap.docs.forEach((d) => out.set(d.id, { id: d.id, ...d.data() }));
  }
  return [...out.values()];
}

/** Volunteer logins pointing at any of these contacts. */
async function linkedVolunteers(ids) {
  const out = new Map();
  for (const part of chunk(ids, IN_LIMIT)) {
    const snap = await getDocs(query(collection(db, 'volunteers'), where('linkedIndividualId', 'in', part)));
    snap.docs.forEach((d) => out.set(d.id, { id: d.id, ...d.data() }));
  }
  return [...out.values()];
}

/** Commits `ops` (functions taking a WriteBatch) in chunks under the 500 cap. */
async function commitAll(ops) {
  for (const part of chunk(ops, WRITE_BATCH_LIMIT)) {
    const wb = writeBatch(db);
    part.forEach((apply) => apply(wb));
    await wb.commit();
  }
}

/**
 * Folds `duplicates` into `primary`, carrying the history across.
 *
 * @param {object}   params.primary     the full contact object that survives
 * @param {object[]} params.duplicates  the full contact objects to fold in
 * @param {string}   params.mergedBy    volunteer id, for the audit row
 * @param {function} [params.onStep]    (label:string) => void, for the UI
 * @returns {{ attendanceMoved, attendanceDeleted, batchesUpdated,
 *             volunteerLinks, deleted, writes }}
 */
export async function mergeContacts({ primary, duplicates = [], mergedBy = null, onStep = null } = {}) {
  if (!primary?.id) throw new Error('Pick which record to keep first.');
  const losers = duplicates.filter((d) => d && d.id && d.id !== primary.id);
  if (!losers.length) throw new Error('Nothing to merge — pick at least one duplicate.');
  const loserIds = losers.map((d) => d.id);
  const step = (s) => { if (onStep) onStep(s); };

  // ── 1. Attendance ──────────────────────────────────────────────────────────
  step('Reading sabha attendance…');
  const [mine, ...theirs] = await Promise.all([
    attendanceFor(primary.id),
    ...loserIds.map(attendanceFor),
  ]);
  const held = new Set(mine.map((a) => a.eventId));
  const attendanceOps = [];
  let moved = 0;
  theirs.flat().forEach((a) => {
    if (a.eventId && !held.has(a.eventId)) {
      held.add(a.eventId);
      moved += 1;
      const ref = doc(db, 'attendance', `${a.eventId}_${primary.id}`);
      // markedBy / markedAt are carried across verbatim. The mark was made by
      // that karyakarta on that evening; the merge is not a new marking.
      attendanceOps.push((wb) => wb.set(ref, {
        eventId: a.eventId,
        individualId: primary.id,
        status: a.status || 'present',
        markedBy: a.markedBy || mergedBy || null,
        markedAt: a.markedAt || serverTimestamp(),
      }));
    }
    attendanceOps.push((wb) => wb.delete(doc(db, 'attendance', a.id)));
  });
  const attendanceDeleted = theirs.flat().length;
  if (attendanceOps.length) {
    step(`Moving ${moved} sabha mark${moved === 1 ? '' : 's'}…`);
    await commitAll(attendanceOps);
  }

  // ── 2. Batches ─────────────────────────────────────────────────────────────
  step('Checking calling batches…');
  const batches = await batchesHolding(loserIds);
  const loserSet = new Set(loserIds);
  const batchOps = [];
  batches.forEach((b) => {
    const current = b.individualIds || [];
    // The survivor takes the duplicate's SEAT rather than being appended, so a
    // batch of 40 does not silently become 41 and a karyakarta's list does not
    // grow while they are halfway down it.
    const next = [];
    const seen = new Set();
    current.forEach((id) => {
      const mapped = loserSet.has(id) ? primary.id : id;
      if (seen.has(mapped)) return;
      seen.add(mapped);
      next.push(mapped);
    });
    if (next.length === current.length && next.every((id, i) => id === current[i])) return;
    batchOps.push((wb) => wb.update(doc(db, 'batches', b.id), {
      individualIds: next, contactCount: next.length, updatedAt: serverTimestamp(),
    }));
  });
  if (batchOps.length) {
    step(`Updating ${batchOps.length} batch${batchOps.length === 1 ? '' : 'es'}…`);
    await commitAll(batchOps);
  }

  // ── 3. Volunteer logins ────────────────────────────────────────────────────
  step('Checking volunteer logins…');
  const links = await linkedVolunteers(loserIds);
  if (links.length) {
    await commitAll(links.map((v) => (wb) => wb.update(doc(db, 'volunteers', v.id), {
      linkedIndividualId: primary.id,
    })));
  }
  // The other end of the same link. If the survivor has no volunteerId but a
  // duplicate did, the survivor inherits it — otherwise the login and the contact
  // point at each other from only one side and useVolunteerIdentity falls back to
  // matching on the phone number, which is exactly what merging was meant to stop.
  const donorVolunteerId = primary.volunteerId
    || losers.find((d) => d.volunteerId)?.volunteerId
    || links[0]?.id
    || null;

  // ── 4. The surviving record ────────────────────────────────────────────────
  step('Updating the record that stays…');
  const { updates } = planMerge(primary, losers);
  if (donorVolunteerId && donorVolunteerId !== primary.volunteerId) updates.volunteerId = donorVolunteerId;
  await updateDoc(doc(db, 'individuals', primary.id), {
    ...updates,
    // A permanent note on the record that it is a composite, and of what. Without
    // it a merged contact is indistinguishable from one that was always alone, and
    // the older `activity` rows — which still name the deleted ids — read as
    // orphans with nothing to tie them to.
    mergedFrom: [
      ...(primary.mergedFrom || []),
      ...losers.map((d) => ({
        id: d.id,
        name: d.name || '',
        mobile: d.mobile || '',
        mergedAt: new Date().toISOString(),
      })),
    ],
    updatedAt: serverTimestamp(),
  });

  // ── 5. The duplicates, last ────────────────────────────────────────────────
  step('Removing the duplicate record…');
  for (const id of loserIds) {
    await deleteDoc(doc(db, 'individuals', id));
  }

  // ── 6. Audit ───────────────────────────────────────────────────────────────
  // Written directly rather than through logActivity() so it lands even if the
  // helper's swallow-everything catch would have hidden a rules failure here —
  // a merge with no trail is the one outcome nobody can reconstruct afterwards.
  const wb = writeBatch(db);
  wb.set(doc(collection(db, 'activity')), {
    timestamp: serverTimestamp(),
    volunteerId: mergedBy,
    individualId: primary.id,
    action: 'merge_individuals',
    details: `Merged ${losers.map((d) => `${d.name || 'unnamed'} (${d.id})`).join(', ')} into ${primary.name || primary.id}`
      + ` · ${moved} sabha mark${moved === 1 ? '' : 's'} carried over`
      + `${batchOps.length ? ` · ${batchOps.length} batch${batchOps.length === 1 ? '' : 'es'} updated` : ''}`
      + `${links.length ? ` · ${links.length} login re-linked` : ''}`,
  });
  await wb.commit();

  return {
    attendanceMoved: moved,
    attendanceDeleted,
    batchesUpdated: batchOps.length,
    volunteerLinks: links.length,
    deleted: loserIds.length,
    writes: attendanceOps.length + batchOps.length + links.length + 1 + loserIds.length + 1,
  };
}

/**
 * "These two are not the same person." Recorded on ONE of the pair — the
 * lexicographically smaller id — because a dismissal is a fact about the pair,
 * not about either record, and storing it twice doubles the write for no gain.
 * findLikelyDuplicates() checks both directions.
 *
 * Takes the whole contact objects rather than ids: the caller already holds them
 * from useAllContacts(), so the existing `mergeIgnore` needs no re-read and the
 * dismissal costs exactly one write. That matters more than it looks — an
 * operator who cannot silence a false positive re-reads the same wrong
 * suggestion every week and stops reading the screen at all.
 */
export async function dismissDuplicatePair(rowA, rowB) {
  if (!rowA?.id || !rowB?.id || rowA.id === rowB.id) return;
  const [holder, other] = rowA.id < rowB.id ? [rowA, rowB] : [rowB, rowA];
  const existing = holder.mergeIgnore || [];
  if (existing.includes(other.id)) return;
  await updateDoc(doc(db, 'individuals', holder.id), {
    mergeIgnore: [...existing, other.id],
    updatedAt: serverTimestamp(),
  });
}
