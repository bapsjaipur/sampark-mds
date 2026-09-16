// src/services/batchService.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 20 — the full batch engine, ported from Sevak Call's Code.gs.
//
// Phase 4 shipped only the two primitives at the bottom of the original file:
// getIndividualsByArea() and createBatch(). Everything an admin actually did
// day-to-day in the legacy app lived in Code.gs and had no equivalent here:
//   generateBatches / assignBatch / unassignBatch / clearAllBatches /
//   reassignContacts / getBatchStats
// which meant the only way to give a volunteer work was to hand-tick every
// contact in a checkbox list — feasible for 20 contacts, not for 1240.
//
// One DELIBERATE DEVIATION from the legacy behaviour, called out because it is a
// silent data-loss bug there rather than a feature: Sevak Call's assignBatch()
// blanked the Status and Reference columns for every contact in the batch on
// each assignment. Reassigning a batch to cover for an absent volunteer
// therefore destroyed the call history of everyone in it, with no warning and no
// undo. Here that is an explicit opt-in (`resetStatuses`), defaulted to false,
// and the UI states what it will erase.
//
// Batch document shape:
//   batches/{id} = {
//     name, area, mandal, batchNumber, individualIds[], contactCount,
//     assignedVolunteerId | null, assignedAt | null,
//     createdBy, createdAt,
//     eventId | null, eventDate | null    ← PHASE 27: which sabha this was calling for
//     updatedAt | null                    ← PHASE 28: last hand-edit of the roster
//   }
//
// PHASE 21 — `mandal` is new and is what makes scoped batches possible. A batch
// cut for "Yuvak Mandal in Vaishali Nagar" carries area='Vaishali Nagar' AND
// mandal='Yuvak Mandal', so both an Area Moderator and a Mandal Super Moderator
// can find their own work without reading every contact inside every batch.
// Pre-Phase-21 batches have no `mandal` field at all; treat missing as "mixed",
// never as null-the-value, or every legacy batch disappears from a mandal view.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection, doc, documentId, limit, onSnapshot, orderBy, query, serverTimestamp, where,
} from 'firebase/firestore';
// PHASE 24 — metered drop-ins (src/lib/fsMetered.js): same signatures, they count.
// This is the most expensive file in the app: assembling a batch reads whole
// collections and writes one document per contact, so it is exactly the place
// where a quota disappears without anyone noticing. onSnapshot stays on the real
// module — a listener is metered where it is opened, not here.
import {
  addDoc, deleteDoc, getDoc, getDocs, updateDoc, writeBatch,
} from '../lib/fsMetered';
import { db } from '../lib/firebase';
import { chunk } from '../lib/firestoreHelpers';
import { SCOPE_KINDS, matchesScope } from '../lib/scope';

// Firestore caps a WriteBatch at 500 operations. Every helper below that writes
// in bulk splits on this, otherwise a 700-contact area fails the whole commit.
const WRITE_BATCH_LIMIT = 450;

// `in` filters are capped at 30 values by Firestore.
const IN_LIMIT = 30;

/**
 * Individuals don't carry `area` directly (only households do), so this
 * resolves matching households first, then fetches their individuals.
 */
export async function getIndividualsByArea(area) {
  const hSnap = await getDocs(query(collection(db, 'households'), where('area', '==', area)));
  const householdIds = hSnap.docs.map((d) => d.id);
  if (!householdIds.length) return [];

  const all = [];
  for (const c of chunk(householdIds, IN_LIMIT)) {
    const iSnap = await getDocs(query(collection(db, 'individuals'), where('householdId', 'in', c)));
    iSnap.forEach((d) => all.push({ id: d.id, ...d.data() }));
  }
  return all;
}

async function areasForHouseholdIds(householdIds) {
  const map = {};
  for (const c of chunk(householdIds.filter(Boolean), IN_LIMIT)) {
    const snap = await getDocs(query(collection(db, 'households'), where(documentId(), 'in', c)));
    snap.forEach((d) => { map[d.id] = d.data().area || null; });
  }
  return map;
}

/**
 * getIndividualsForTarget({ areas, mandals })
 *
 * The Phase 21 candidate query. Returns individuals with an extra `_area`
 * carrying the RESOLVED area (their own field for standalone contacts, otherwise
 * their household's) so the caller can group by area × mandal without a second
 * round of lookups.
 *
 * Query strategy depends on which axis is narrower, because area lives on the
 * household and mandal on the individual:
 *   • areas given  → households by area, then their individuals, then filter by
 *     mandal in memory. Cheaper than the reverse: households are far fewer than
 *     individuals, and the mandal filter costs nothing once the rows are here.
 *   • mandals only → individuals by mandal directly, then resolve their areas
 *     for naming.
 *   • neither      → refuses, unless allowFullScan is passed.
 *
 * That refusal is deliberate. "Neither" means reading the whole `individuals`
 * collection — 3,000+ documents against a 50k/day free-tier budget, from a screen
 * where an empty selection is far more likely to be a mis-click than an intent to
 * batch the entire city. Every UI path already requires a target, so nothing
 * legitimate is blocked; a future caller that really does want everything has to
 * say so in one word.
 */
export async function getIndividualsForTarget({ areas = [], mandals = [], allowFullScan = false } = {}) {
  const areaList = (areas || []).filter(Boolean);
  const mandalList = (mandals || []).filter(Boolean);

  const byId = new Map();
  const add = (row, area) => {
    if (byId.has(row.id)) return;
    byId.set(row.id, { ...row, _area: area || row.area || null });
  };

  if (areaList.length) {
    const areaByHousehold = {};
    for (const c of chunk(areaList, IN_LIMIT)) {
      const hSnap = await getDocs(query(collection(db, 'households'), where('area', 'in', c)));
      hSnap.forEach((d) => { areaByHousehold[d.id] = d.data().area || null; });
    }

    for (const c of chunk(Object.keys(areaByHousehold), IN_LIMIT)) {
      const iSnap = await getDocs(query(collection(db, 'individuals'), where('householdId', 'in', c)));
      iSnap.forEach((d) => {
        const row = { id: d.id, ...d.data() };
        add(row, areaByHousehold[row.householdId]);
      });
    }

    // Standalone contacts (Phase 13/16) have householdId === null and carry
    // `area` themselves. Without this second pass they are invisible to batch
    // generation — which is how a contact ends up never being called.
    for (const c of chunk(areaList, IN_LIMIT)) {
      const iSnap = await getDocs(query(collection(db, 'individuals'), where('area', 'in', c)));
      iSnap.forEach((d) => {
        const row = { id: d.id, ...d.data() };
        add(row, row.area);
      });
    }

    const rows = [...byId.values()];
    return mandalList.length ? rows.filter((r) => mandalList.includes(r.mandal)) : rows;
  }

  if (mandalList.length) {
    for (const c of chunk(mandalList, IN_LIMIT)) {
      const iSnap = await getDocs(query(collection(db, 'individuals'), where('mandal', 'in', c)));
      iSnap.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
    }
    const rows = [...byId.values()];
    const hIds = [...new Set(rows.map((r) => r.householdId).filter(Boolean))];
    const areaByHousehold = await areasForHouseholdIds(hIds);
    return rows.map((r) => ({ ...r, _area: r.area || areaByHousehold[r.householdId] || null }));
  }

  if (!allowFullScan) {
    throw new Error('Pick at least one area or one mandal — batching every contact at once is not allowed.');
  }
  const iSnap = await getDocs(collection(db, 'individuals'));
  const rows = iSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const hIds = [...new Set(rows.map((r) => r.householdId).filter(Boolean))];
  const areaByHousehold = await areasForHouseholdIds(hIds);
  return rows.map((r) => ({ ...r, _area: r.area || areaByHousehold[r.householdId] || null }));
}

export async function createBatch({
  name, area, mandal, individualIds, assignedVolunteerId, createdBy,
  eventId = null, eventDate = null,
}) {
  return addDoc(collection(db, 'batches'), {
    name,
    area: area || null,
    mandal: mandal || null,
    individualIds,
    contactCount: individualIds.length,
    assignedVolunteerId: assignedVolunteerId || null,
    assignedAt: assignedVolunteerId ? serverTimestamp() : null,
    createdBy: createdBy || null,
    createdAt: serverTimestamp(),
    // PHASE 27 — which sabha this round is calling for. See generateBatches.
    eventId: eventId || null,
    eventDate: eventDate || null,
  });
}

export function subscribeToBatches(cb, onError) {
  // orderBy createdAt would exclude the Phase 4 documents, which predate the
  // field. Sorting happens client-side instead so nothing is ever hidden.
  return onSnapshot(
    collection(db, 'batches'),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (b.batchNumber || 0) - (a.batchNumber || 0)
        || (a.name || '').localeCompare(b.name || ''));
      cb(rows);
    },
    (err) => onError && onError(err),
  );
}

/**
 * The next batch number, read as ONE document instead of the whole collection.
 *
 * A pre-Phase-21 batch carries no `batchNumber` at all and so is missing from
 * this index — which is correct here, because those documents contribute nothing
 * to the maximum. If every batch is numberless the query comes back empty and
 * numbering starts at 1, exactly as the old full scan did.
 */
export async function nextBatchNumber() {
  const snap = await getDocs(query(
    collection(db, 'batches'), orderBy('batchNumber', 'desc'), limit(1),
  ));
  const top = snap.docs[0] ? Number(snap.docs[0].data().batchNumber) : 0;
  return (Number.isFinite(top) ? top : 0) + 1;
}

/** How the eligible contacts are cut up. */
export const GROUP_BY = {
  PAIR: 'pair',     // one set of batches per (area × mandal) — the Phase 21 default
  AREA: 'area',     // one set per area, mandals mixed together (legacy behaviour)
  MANDAL: 'mandal', // one set per mandal, areas mixed together
};

const NO_AREA = 'No area';
const NO_MANDAL = 'No mandal';

function groupsFor(rows, groupBy) {
  const map = new Map();
  for (const r of rows) {
    const area = r._area || null;
    const mandal = r.mandal || null;
    let key;
    let label;
    if (groupBy === GROUP_BY.AREA) {
      key = `a:${area || NO_AREA}`;
      label = area || NO_AREA;
    } else if (groupBy === GROUP_BY.MANDAL) {
      key = `m:${mandal || NO_MANDAL}`;
      label = mandal || NO_MANDAL;
    } else {
      key = `p:${area || NO_AREA}|${mandal || NO_MANDAL}`;
      label = `${area || NO_AREA} · ${mandal || NO_MANDAL}`;
    }
    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        // The stored area/mandal is only set when this group really is confined
        // to one value. Writing 'No area' into the field would make it look like
        // a real area everywhere else in the app.
        area: groupBy === GROUP_BY.MANDAL ? null : area,
        mandal: groupBy === GROUP_BY.AREA ? null : mandal,
        rows: [],
      });
    }
    map.get(key).rows.push(r);
  }
  // Alphabetical so the generated batch numbers run in a predictable order —
  // an admin reading "Batch 12" should be able to guess roughly where it is.
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The gate that decides who a batch can contain.
 *
 * PHASE 26 — `onlyCallingPool` is the follow-up-list filter, and it is the reason
 * this app can do what the legacy Sevak Call sheet did by hand: cut this week's
 * batches from the ~400 who are actually rung, and once a year cut them from all
 * 1000+ instead. It is deliberately an IN-MEMORY predicate:
 *
 *   • `where('callingPool', '!=', false)` would drop every contact that has no
 *     such field, which today is all of them. A Firestore inequality only matches
 *     documents where the field exists.
 *   • These rows are already in hand and already being post-filtered, so the test
 *     costs nothing and needs no composite index.
 *
 * ABSENT MEANS ON — see services/callingPoolService.js for why that is the only
 * migration-free reading of the field.
 */
function filterEligible(rows, {
  onlyUncalled, skipAlreadyBatched, requirePhone, alreadyBatched, onlyCallingPool = true,
}) {
  const skipped = { noPhone: 0, alreadyBatched: 0, alreadyCalled: 0, notInPool: 0 };
  const eligible = rows.filter((c) => {
    if (requirePhone && String(c.mobile || '').replace(/\D/g, '').length < 10) { skipped.noPhone++; return false; }
    if (onlyCallingPool && c.callingPool === false) { skipped.notInPool++; return false; }
    if (skipAlreadyBatched && alreadyBatched.has(c.id)) { skipped.alreadyBatched++; return false; }
    if (onlyUncalled && String(c.status || '').trim()) { skipped.alreadyCalled++; return false; }
    return true;
  });
  return { eligible, skipped };
}

/**
 * The `batches` collection in the one shape both callers need.
 *
 * This used to be loadAlreadyBatchedIds() and returned only the Set of ids that
 * already sit in some batch. planTopUps() below needs the DOCUMENTS too — which
 * batch has room, who holds it, which sabha it belongs to — and reading the
 * collection a second time to find that out would double the cost of every
 * preview. So the documents are the return value now and the Set is derived.
 *
 * `batchRows` lets the caller hand over the list it is already subscribed to —
 * BatchesPage keeps a live onSnapshot on `batches` for the Batches tab, so
 * re-reading the collection here charged a second time for rows already in
 * memory. Only when nothing is supplied does this fall back to a read.
 */
async function loadBatchIndex(batchRows) {
  let rows = batchRows;
  if (!Array.isArray(rows)) {
    const bSnap = await getDocs(collection(db, 'batches'));
    rows = bSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const batched = new Set();
  rows.forEach((b) => (b?.individualIds || []).forEach((id) => batched.add(id)));
  return { rows, batched };
}

/** Timestamp | Date | string | null → epoch ms, 0 when there is nothing to read. */
function millisOf(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}

// A batch older than this is not "this round" even if it carries no eventId, and
// must not absorb a new arrival. Legacy batches predate the event stamp entirely,
// so without this guard somebody added in September could land in a batch cut in
// March and be counted into a round that closed months ago.
const TOP_UP_MAX_AGE_DAYS = 45;

/**
 * Where a mid-week arrival goes — planTopUps({ contacts, batches, size, eventId }).
 *
 * WHAT WENT WRONG WITHOUT IT. `skipAlreadyBatched` already made sure a contact
 * added on Tuesday was picked up by the next Generate run: they are in no batch, so
 * they are eligible. But the generator only knew how to CREATE batches, so two new
 * families became "Yuvak Mandal — Batch 37" — a batch of two, unassigned, sitting
 * below the eleven real ones. Somebody had to notice it and hand it out, and when
 * nobody did those two were never called, while looking on every screen exactly
 * like a normal batch. That is the "not assigned into any batches" confusion.
 *
 * WHAT HAPPENS INSTEAD. Before cutting anything new, this looks for a batch that
 * already covers those people and still has room, and appends to it. The
 * karyakarta already calling that mandal this week simply finds two more names on
 * their list — which is what they would expect if they had been told by hand.
 *
 * THE FOUR TESTS A TARGET MUST PASS, none of them optional:
 *
 *   • it must not CONTRADICT the contact. A batch stamped mandal:'Yuvak Mandal'
 *     may only take Yuvak contacts, or its own field becomes a lie and every
 *     screen that groups by it reports a mandal the batch does not hold. A NULL
 *     field is not a contradiction — an area-grouped batch legitimately spans
 *     mandals, so null means "no claim made", not "no mandal".
 *   • SAME SABHA. `eventId` must equal the run's exactly. Appending this week's
 *     arrival to last week's batch drops them into a round that is already being
 *     reviewed, where roundService would read the blank outcome as a call somebody
 *     failed to make.
 *   • ROOM. Never past `batchSize` — the size is the promise made to the volunteer.
 *   • NOT STALE. See TOP_UP_MAX_AGE_DAYS.
 *
 * ORDER OF PREFERENCE: assigned batches first, then the more specific batch, then
 * the emptiest. Assigned first because the entire point is that somebody rings
 * these people this week; an unassigned batch with room is usually a remainder
 * nobody has picked up, and dropping the new arrival there recreates the bug in a
 * quieter form.
 *
 * @returns {{topUps: Array, absorbed: Set<string>}} `absorbed` is what the caller
 *   must NOT also cut into a new batch — otherwise the contact ends up in two.
 */
function planTopUps({ contacts, batches, size, eventId }) {
  const runEvent = eventId || null;
  const cutoff = Date.now() - TOP_UP_MAX_AGE_DAYS * 86400000;

  const targets = (batches || [])
    .filter((b) => b && b.id && (b.eventId || null) === runEvent)
    .map((b) => ({
      id: b.id,
      name: b.name || 'batch',
      area: b.area || null,
      mandal: b.mandal || null,
      assignedVolunteerId: b.assignedVolunteerId || null,
      ids: Array.isArray(b.individualIds) ? b.individualIds : [],
      createdAt: millisOf(b.createdAt),
    }))
    .filter((t) => t.ids.length < size)
    // A createdAt of 0 means "no date we can read", which is what a
    // serverTimestamp() looks like on the writing client's own snapshot for a
    // moment. Treating unreadable as stale would exclude the batch cut seconds
    // ago, so only a date we CAN read and that IS old disqualifies a batch.
    .filter((t) => !t.createdAt || t.createdAt >= cutoff)
    .sort((a, b) => {
      const aAssigned = Boolean(a.assignedVolunteerId);
      const bAssigned = Boolean(b.assignedVolunteerId);
      if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
      const spec = (t) => (t.area ? 1 : 0) + (t.mandal ? 1 : 0);
      if (spec(a) !== spec(b)) return spec(b) - spec(a);
      if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length;
      return String(a.name).localeCompare(String(b.name));
    });

  if (!targets.length) return { topUps: [], absorbed: new Set() };

  const room = new Map(targets.map((t) => [t.id, size - t.ids.length]));
  const adds = new Map();
  const absorbed = new Set();

  for (const c of contacts) {
    const area = c._area || null;
    const mandal = c.mandal || null;
    const t = targets.find((x) => room.get(x.id) > 0
      && (x.area === null || x.area === area)
      && (x.mandal === null || x.mandal === mandal));
    if (!t) continue;
    room.set(t.id, room.get(t.id) - 1);
    if (!adds.has(t.id)) adds.set(t.id, []);
    adds.get(t.id).push(c.id);
    absorbed.add(c.id);
  }

  const topUps = targets.filter((t) => adds.has(t.id)).map((t) => {
    const add = adds.get(t.id);
    return {
      batchId: t.id,
      batchName: t.name,
      assignedVolunteerId: t.assignedVolunteerId,
      add,
      was: t.ids.length,
      now: t.ids.length + add.length,
      // The exact array to write, and the exact count with it — the same reason
      // editBatchContacts() writes both rather than arrayUnion + increment: the
      // pair cannot drift. Safe to build from memory because these rows come from
      // BatchesPage's live onSnapshot, which is as current as a getDoc and free.
      individualIds: [...t.ids, ...add],
    };
  });

  return { topUps, absorbed };
}

/**
 * previewBatchGeneration({ areas, mandals, groupBy, ... })
 *
 * Exactly the same selection and grouping generateBatches() will perform, minus
 * the writes. The generator calls into the same two helpers, so the preview
 * cannot drift from the result — which is the whole point: the previous version
 * deliberately ignored skipAlreadyBatched and therefore over-promised.
 */
export async function previewBatchGeneration({
  areas = [],
  mandals = [],
  groupBy = GROUP_BY.PAIR,
  batchSize = 40,
  onlyUncalled = true,
  skipAlreadyBatched = true,
  requirePhone = true,
  // PHASE 26 — true = this week's follow-up list only, false = the whole roster
  // (the once-a-year sweep). Defaults to the follow-up list, because that is what
  // "generate batches" means every week bar one.
  onlyCallingPool = true,
  batchRows = null,
  // PHASE 39 — put a mid-week arrival into a batch somebody is already calling
  // instead of cutting them a stray batch of two. See planTopUps().
  //
  // Gated on skipAlreadyBatched, and not merely as a nicety: with that filter off
  // the eligible list can contain contacts who ARE already in a batch, and
  // appending one of those to a batch they are already in would double them up.
  topUpExisting = true,
  // Which sabha this run is for. Only used to decide which existing batches belong
  // to the same round; the preview writes nothing.
  eventId = null,
} = {}) {
  // Same guard as generateBatches. The preview ran without one, so an empty
  // selection here used to scan every contact in the database to tell the admin
  // what an operation they cannot perform would have produced.
  if (!(areas || []).filter(Boolean).length && !(mandals || []).filter(Boolean).length) {
    throw new Error('Pick at least one area or one mandal to preview batches.');
  }
  const size = Math.max(1, Math.min(500, Number(batchSize) || 40));
  const canTopUp = Boolean(topUpExisting && skipAlreadyBatched);
  const candidates = await getIndividualsForTarget({ areas, mandals });
  const needIndex = skipAlreadyBatched || canTopUp;
  const { rows: existingBatches, batched: alreadyBatched } = needIndex
    ? await loadBatchIndex(batchRows)
    : { rows: [], batched: new Set() };
  const { eligible, skipped } = filterEligible(candidates, {
    onlyUncalled, skipAlreadyBatched, requirePhone, alreadyBatched, onlyCallingPool,
  });

  const { topUps, absorbed } = canTopUp
    ? planTopUps({ contacts: eligible, batches: existingBatches, size, eventId })
    : { topUps: [], absorbed: new Set() };

  // Only what is left after the existing batches have taken their share gets cut
  // into new ones — otherwise the preview promises batches the generator will not
  // create, which is the drift this whole preview exists to prevent.
  const remaining = absorbed.size ? eligible.filter((c) => !absorbed.has(c.id)) : eligible;

  const groups = groupsFor(remaining, groupBy).map((g) => ({
    key: g.key,
    label: g.label,
    area: g.area,
    mandal: g.mandal,
    contacts: g.rows.length,
    batches: Math.ceil(g.rows.length / size),
    remainder: g.rows.length % size,
  }));

  return {
    candidates: candidates.length,
    eligible: eligible.length,
    skipped,
    groups,
    totalBatches: groups.reduce((n, g) => n + g.batches, 0),
    // PHASE 39 — which existing batches would grow, and by how much. Named
    // batch-by-batch rather than totalled so the admin can see that the two new
    // Yuvak families are going onto a list somebody is already holding, and which
    // list that is.
    topUp: topUps.map((t) => ({
      batchId: t.batchId,
      batchName: t.batchName,
      assignedVolunteerId: t.assignedVolunteerId,
      add: t.add.length,
      was: t.was,
      now: t.now,
    })),
    topUpContacts: absorbed.size,
    // How many of the candidates are off the follow-up list, regardless of which
    // mode is selected. The generator shows this next to the mode switch so the
    // "Everyone" option can say what it would actually add.
    offCallList: candidates.filter((c) => c.callingPool === false).length,
    // PHASE 26 — the ids of in-scope contacts still carrying an outcome from a
    // previous round. Returned as ids rather than a count so "Start a new round"
    // clears exactly the people this preview measured; re-deriving the set at
    // click time from filters that may have moved is how a reset ends up wiping
    // somebody it never showed.
    //
    // NOT the same number as skipped.alreadyCalled: that counter is
    // filter-ordered, so a contact with an outcome AND no mobile lands in
    // `noPhone` and never reaches the status test — yet their outcome still has
    // to be cleared, or it lingers for good. This list is derived straight from
    // the candidates, so nothing hides behind an earlier filter.
    resettableIds: candidates
      .filter((c) => String(c.status || '').trim())
      // Tracks the "Who to call" choice: a weekly reset has no business
      // rewriting the 557 people this week's round is not calling anyway.
      .filter((c) => !onlyCallingPool || c.callingPool !== false)
      .map((c) => c.id),
  };
}

/**
 * generateBatches({ areas, mandals, groupBy, batchSize, ... })
 *
 * Splits the selected contacts into fixed-size unassigned batches, ready to hand
 * out. Ported from Code.gs generateBatches(), with three additions the legacy
 * version lacked:
 *   • skipAlreadyBatched — the sheet version happily put the same person into
 *     two batches, so two volunteers called them on the same evening.
 *   • requirePhone — a contact with no usable mobile is unworkable in the
 *     calling queue; batching them just pads the volunteer's count.
 *   • area × mandal grouping (Phase 21) — a batch mixing Yuvak and Mahila
 *     members cannot be handed to a mandal karyakarta at all, which is why
 *     PAIR is the default. `area` is still accepted as a single string so older
 *     call sites keep working.
 *   • onlyCallingPool (Phase 26) — cut from the follow-up list, or from the whole
 *     roster. The weekly cut is the follow-up list; once a year it is everyone.
 *   • eventId / eventDate (Phase 27) — the sabha these calls are inviting people
 *     to. Stamped on every batch in the run so that after the sabha the app can
 *     cross "who I called" against "who turned up"; without it that join is not
 *     expressible at all. Optional, and null on batches cut before this shipped
 *     — roundService.resolveRoundEvent() falls back to the most recent past event
 *     in the batch's mandal for those.
 *   • topUpExisting (Phase 39) — a contact added to a mandal mid-week joins a batch
 *     somebody is already calling, instead of becoming a stray batch of two that
 *     nobody notices and nobody assigns. See planTopUps() for the four tests a
 *     target batch has to pass. On by default: in week one there is nothing to top
 *     up so nothing changes, and from week two the only case it alters is the one
 *     that was broken.
 *
 * @returns {{created: number, batches: Array, groups: Array, skipped: object, eligible: number}}
 */
export async function generateBatches({
  area = null,          // legacy single-area form, still honoured
  areas = null,
  mandals = null,
  groupBy = GROUP_BY.PAIR,
  batchSize = 40,
  onlyUncalled = true,
  skipAlreadyBatched = true,
  requirePhone = true,
  onlyCallingPool = true,
  namePrefix = '',
  createdBy = null,
  batchRows = null,
  eventId = null,
  eventDate = null,
  // PHASE 39 — see planTopUps() and the note on previewBatchGeneration.
  topUpExisting = true,
}) {
  const areaList = Array.isArray(areas) ? areas.filter(Boolean) : (area ? [area] : []);
  const mandalList = Array.isArray(mandals) ? mandals.filter(Boolean) : [];

  if (!areaList.length && !mandalList.length) {
    throw new Error('Pick at least one area or one mandal to generate batches.');
  }
  const size = Math.max(1, Math.min(500, Number(batchSize) || 40));
  const canTopUp = Boolean(topUpExisting && skipAlreadyBatched);

  const candidates = await getIndividualsForTarget({ areas: areaList, mandals: mandalList });
  const needIndex = skipAlreadyBatched || canTopUp;
  const { rows: existingBatches, batched: alreadyBatched } = needIndex
    ? await loadBatchIndex(batchRows)
    : { rows: [], batched: new Set() };
  const { eligible, skipped } = filterEligible(candidates, {
    onlyUncalled, skipAlreadyBatched, requirePhone, alreadyBatched, onlyCallingPool,
  });

  if (eligible.length === 0) {
    return { created: 0, batches: [], groups: [], skipped, remainder: 0, eligible: 0, toppedUp: [], toppedUpContacts: 0 };
  }

  const { topUps, absorbed } = canTopUp
    ? planTopUps({ contacts: eligible, batches: existingBatches, size, eventId })
    : { topUps: [], absorbed: new Set() };

  // Absorbed contacts are NOT cut into new batches — they are already going
  // somewhere. Skipping this filter would put them in two batches, which is the
  // exact fault skipAlreadyBatched was added to prevent.
  const remaining = absorbed.size ? eligible.filter((c) => !absorbed.has(c.id)) : eligible;

  // The appends go first. If the run dies halfway, an existing batch that grew by
  // two is harmless; a new batch holding people who are also being appended
  // elsewhere is not, and doing the appends first makes that state unreachable.
  for (const slice of chunk(topUps, WRITE_BATCH_LIMIT)) {
    const wb = writeBatch(db);
    for (const t of slice) {
      wb.update(doc(db, 'batches', t.batchId), {
        individualIds: t.individualIds,
        contactCount: t.individualIds.length,
        updatedAt: serverTimestamp(),
      });
    }
    await wb.commit();
  }

  const groups = groupsFor(remaining, groupBy);
  let numbering = groups.length ? await nextBatchNumber() : 0;
  const created = [];

  // One flat list of (group, ids) pairs so the write-batching below stays a
  // simple chunk() over documents rather than nested loops that could each
  // exceed the 500-op cap on their own.
  const planned = [];
  for (const g of groups) {
    for (const ids of chunk(g.rows.map((r) => r.id), size)) {
      planned.push({ group: g, ids });
    }
  }

  for (const slice of chunk(planned, WRITE_BATCH_LIMIT)) {
    const wb = writeBatch(db);
    for (const { group, ids } of slice) {
      const ref = doc(collection(db, 'batches'));
      const payload = {
        name: `${namePrefix || group.label} — Batch ${numbering}`,
        area: group.area || null,
        mandal: group.mandal || null,
        batchNumber: numbering,
        individualIds: ids,
        contactCount: ids.length,
        assignedVolunteerId: null,
        assignedAt: null,
        createdBy,
        createdAt: serverTimestamp(),
        // The sabha this round is inviting to. Denormalised date alongside the id
        // so the calling screen can label the round without reading the event.
        eventId: eventId || null,
        eventDate: eventDate || null,
      };
      wb.set(ref, payload);
      created.push({ id: ref.id, ...payload });
      numbering++;
    }
    await wb.commit();
  }

  return {
    created: created.length,
    batches: created,
    groups: groups.map((g) => ({
      key: g.key, label: g.label, area: g.area, mandal: g.mandal, contacts: g.rows.length,
    })),
    skipped,
    eligible: eligible.length,
    // Size of the final, partially-filled batch — worth showing so an admin
    // knows one volunteer will get 7 contacts instead of 40.
    remainder: remaining.length % size,
    // PHASE 39 — the appends, so the caller can say "2 contacts joined 2 existing
    // batches" instead of reporting "0 created" and looking like it did nothing.
    toppedUp: topUps.map((t) => ({
      batchId: t.batchId, batchName: t.batchName, add: t.add.length, now: t.now,
    })),
    toppedUpContacts: absorbed.size,
  };
}

/**
 * assignBatch({ batchId, volunteerId, resetStatuses })
 *
 * resetStatuses replicates the legacy blank-the-columns behaviour. Off by
 * default; see the header note. When on, it clears status + reference on every
 * contact in the batch and writes one activity row per contact so the wipe is
 * at least auditable — the sheet version left no trace at all.
 */
export async function assignBatch({ batchId, volunteerId, assignedBy = null, resetStatuses = false }) {
  if (!batchId) throw new Error('batchId is required.');
  if (!volunteerId) throw new Error('Pick a volunteer to assign this batch to.');

  await updateDoc(doc(db, 'batches', batchId), {
    assignedVolunteerId: volunteerId,
    assignedAt: serverTimestamp(),
  });

  if (!resetStatuses) return { reset: 0 };

  const bSnap = await getDoc(doc(db, 'batches', batchId));
  const ids = bSnap.exists() ? (bSnap.data().individualIds || []) : [];

  let reset = 0;
  // Two writes per contact (the individual + its activity row), so halve the cap.
  for (const slice of chunk(ids, Math.floor(WRITE_BATCH_LIMIT / 2))) {
    const wb = writeBatch(db);
    for (const id of slice) {
      wb.update(doc(db, 'individuals', id), { status: '', reference: '', updatedAt: serverTimestamp() });
      wb.set(doc(collection(db, 'activity')), {
        timestamp: serverTimestamp(),
        volunteerId: assignedBy,
        individualId: id,
        action: 'status_reset',
        details: `Cleared on reassignment of batch ${batchId} to ${volunteerId}`,
      });
      reset++;
    }
    await wb.commit();
  }
  return { reset };
}

/**
 * resetCallStatuses({ individualIds, resetBy, note, onProgress })
 *
 * PHASE 26 — "start a new calling round".
 *
 * `status` is a single string on the contact with no round or date attached, so
 * once somebody is marked "Not reachable" they stay marked for good, and the
 * generator's "only contacts with no status yet" filter keeps skipping them week
 * after week. Before this there were exactly two ways out: untick that filter
 * (which re-batches them still wearing last week's outcome), or reassign the
 * batch they happen to still be in with `assignBatch({ resetStatuses: true })`.
 * Neither is a weekly reset, which is what a weekly round needs.
 *
 * Clears status + reference and writes one audit row per contact, deliberately
 * identical in shape to the reset inside assignBatch — the same wipe should look
 * the same in the trail however it was triggered. Call history in `activity` and
 * every attendance record are untouched: this clears the working column, not the
 * record of the work.
 *
 * Takes explicit ids rather than a filter, so the caller can only ever clear the
 * people it showed the admin.
 *
 * PHASE 29 — two options, both added for the dashboard's reset:
 *   clearCallCount — also zero `callCount`. A "new round" that still shows "4
 *                    calls" chips from last month is not a new round, and the
 *                    logged calls themselves survive in `activity` regardless.
 *   keepNotes      — leave `reference` alone. The remark from last week ("after
 *                    his exams") is often the most useful thing to carry into
 *                    this week's call, so the dashboard offers to keep it. Off by
 *                    default, which is the behaviour every existing caller gets.
 */
export async function resetCallStatuses({
  individualIds = [], resetBy = null, note = '',
  clearCallCount = false, keepNotes = false, onProgress,
} = {}) {
  const ids = [...new Set((individualIds || []).filter(Boolean))];
  if (!ids.length) return { reset: 0 };

  const patch = { status: '' };
  if (!keepNotes) patch.reference = '';
  if (clearCallCount) patch.callCount = 0;

  let reset = 0;
  // Two writes per contact (the individual + its activity row), so halve the cap.
  for (const slice of chunk(ids, Math.floor(WRITE_BATCH_LIMIT / 2))) {
    const wb = writeBatch(db);
    for (const id of slice) {
      wb.update(doc(db, 'individuals', id), { ...patch, updatedAt: serverTimestamp() });
      wb.set(doc(collection(db, 'activity')), {
        timestamp: serverTimestamp(),
        volunteerId: resetBy,
        individualId: id,
        action: 'status_reset',
        details: note || 'Cleared for a new calling round',
      });
      reset += 1;
    }
    await wb.commit();
    // After the commit, not before: a batch that threw must not be reported as done.
    onProgress?.({ done: reset, total: ids.length });
  }
  return { reset };
}

export async function unassignBatch({ batchId }) {
  if (!batchId) throw new Error('batchId is required.');
  await updateDoc(doc(db, 'batches', batchId), { assignedVolunteerId: null, assignedAt: null });
}
export async function renameBatch({ batchId, name }) {
  await updateDoc(doc(db, 'batches', batchId), { name: String(name || '').trim() || 'Untitled batch' });
}

/**
 * editBatchContacts({ batchId, add, remove, detachFrom, editedBy })
 *
 * PHASE 28 — hand-editing the roster of an existing batch.
 *
 * Generation cuts batches by area × mandal in fixed sizes, which is right for the
 * weekly bulk cut and wrong for every exception after it: a karyakarta who asks
 * for ten fewer, a contact who should be rung by their own cousin rather than a
 * stranger, a new contact added on Sunday who belongs in this week's round. Until
 * now the only tools for those were delete-and-regenerate (which loses the
 * assignment and the numbering) or the Manual tab (which can only create).
 *
 * THE ONE INVARIANT WORTH PROTECTING is that a contact sits in at most one batch.
 * Generation enforces it with skipAlreadyBatched, because two batches holding the
 * same person means two volunteers ringing them the same evening — the specific
 * embarrassment that filter exists to prevent. Hand-editing can breach it just as
 * easily, so `detachFrom` names the batches to pull the added contacts OUT of,
 * and the whole move is ONE commit: there is no instant at which the contact is
 * in both batches, and none at which they are in neither.
 *
 * READS: one getDoc for the target plus one per detach source (usually zero, and
 * capped). The target is re-read rather than trusted from the caller's listener
 * for a reason — the caller's copy can be seconds stale, and writing a whole
 * `individualIds` array from a stale copy silently reverts whatever another admin
 * just did. Cheap insurance at one read per save.
 *
 * @param {object}   opts
 * @param {string}   opts.batchId
 * @param {string[]} [opts.add]         individualIds to put in
 * @param {string[]} [opts.remove]      individualIds to take out
 * @param {string[]} [opts.detachFrom]  other batch ids to pull the added contacts from
 * @param {string}   [opts.editedBy]    volunteer id — must be the auth uid, the
 *                                      `activity` create rule checks it
 * @returns {{added:number, removed:number, detached:number, total:number}}
 */
const MAX_DETACH_SOURCES = 25;

export async function editBatchContacts({
  batchId, add = [], remove = [], detachFrom = [], editedBy = null,
} = {}) {
  if (!batchId) throw new Error('batchId is required.');

  const addIds = [...new Set((add || []).filter(Boolean))];
  const removeIds = new Set((remove || []).filter(Boolean));
  if (!addIds.length && !removeIds.size) return { added: 0, removed: 0, detached: 0, total: null };

  const ref = doc(db, 'batches', batchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('That batch no longer exists — reload the page.');
  const current = snap.data().individualIds || [];
  const batchName = snap.data().name || 'batch';

  // Removals first, then additions, so asking for the same id in both ends with
  // it present. That is the reading a UI produces when somebody unticks and
  // re-ticks the same person, and "present" is what they meant.
  const kept = current.filter((id) => !removeIds.has(id));
  const keptSet = new Set(kept);
  const added = addIds.filter((id) => !keptSet.has(id));
  const next = [...kept, ...added];
  const removed = current.length - kept.length;

  // Source batches are re-read for the same reason as the target, and because the
  // count has to come out exact: an arrayRemove + increment(-n) pair would drift
  // the moment n disagreed with what the document actually held.
  const addedSet = new Set(added);
  const sources = [];
  if (addedSet.size) {
    for (const srcId of [...new Set((detachFrom || []).filter((id) => id && id !== batchId))].slice(0, MAX_DETACH_SOURCES)) {
      const sRef = doc(db, 'batches', srcId);
      const sSnap = await getDoc(sRef);
      if (!sSnap.exists()) continue;
      const ids = sSnap.data().individualIds || [];
      const left = ids.filter((id) => !addedSet.has(id));
      if (left.length === ids.length) continue;
      sources.push({ ref: sRef, ids: left, pulled: ids.length - left.length });
    }
  }

  const wb = writeBatch(db);
  wb.update(ref, { individualIds: next, contactCount: next.length, updatedAt: serverTimestamp() });
  sources.forEach((s) => wb.update(s.ref, {
    individualIds: s.ids, contactCount: s.ids.length, updatedAt: serverTimestamp(),
  }));
  // One row for the edit, not one per contact: this is a single deliberate act by
  // one person, and 40 identical rows would bury the rest of the trail.
  wb.set(doc(collection(db, 'activity')), {
    timestamp: serverTimestamp(),
    volunteerId: editedBy,
    individualId: null,
    action: 'batch_contacts_edited',
    details: `${batchName}: ${added.length ? `+${added.length}` : ''}`
      + `${added.length && removed ? ', ' : ''}${removed ? `−${removed}` : ''}`
      + ` contact${added.length + removed === 1 ? '' : 's'} · now ${next.length}`
      + `${sources.length ? ` · moved out of ${sources.length} other batch${sources.length === 1 ? '' : 'es'}` : ''}`,
  });
  await wb.commit();

  return { added: added.length, removed, detached: sources.reduce((n, s) => n + s.pulled, 0), total: next.length };
}

/**
 * deleteBatch — removes the batch only. Contact statuses are left untouched:
 * a batch is a work assignment, not the record of the work.
 */
export async function deleteBatch(batchId) {
  await deleteDoc(doc(db, 'batches', batchId));
}

/**
 * clearAllBatches() — the legacy "Clear All Batches" admin button.
 * Destructive and irreversible; the UI must confirm by typed phrase, not a
 * window.confirm, before calling this.
 */
export async function clearAllBatches() {
  const snap = await getDocs(collection(db, 'batches'));
  const refs = snap.docs.map((d) => d.ref);
  for (const slice of chunk(refs, WRITE_BATCH_LIMIT)) {
    const wb = writeBatch(db);
    slice.forEach((ref) => wb.delete(ref));
    await wb.commit();
  }
  return { deleted: refs.length };
}

/**
 * reassignContacts({ fromVolunteerId, toVolunteerId })
 *
 * Ported from Code.gs reassignContacts(). Moves every batch owned by one
 * volunteer to another — the "Rakesh is travelling this week" operation. Passing
 * toVolunteerId = null unassigns them instead, which the legacy version could
 * not do (it required a target name and silently no-oped on a blank).
 */
export async function reassignContacts({ fromVolunteerId, toVolunteerId = null }) {
  if (!fromVolunteerId) throw new Error('fromVolunteerId is required.');
  if (fromVolunteerId === toVolunteerId) throw new Error('Source and destination volunteer are the same.');

  const snap = await getDocs(query(collection(db, 'batches'), where('assignedVolunteerId', '==', fromVolunteerId)));
  if (snap.empty) return { moved: 0, contacts: 0 };

  let contacts = 0;
  for (const slice of chunk(snap.docs, WRITE_BATCH_LIMIT)) {
    const wb = writeBatch(db);
    for (const d of slice) {
      contacts += (d.data().individualIds || []).length;
      wb.update(d.ref, {
        assignedVolunteerId: toVolunteerId || null,
        assignedAt: toVolunteerId ? serverTimestamp() : null,
      });
    }
    await wb.commit();
  }
  return { moved: snap.docs.length, contacts };
}

/**
 * filterBatchesByScope(batches, scope, viewerId)
 *
 * "Could this batch contain a contact I'm allowed to see?" — deliberately the
 * COULD question, not the DOES question. Answering DOES would mean reading every
 * individual in every batch on every render.
 *
 * A missing area (or mandal) on the batch means "spans all of them", not
 * "belongs to none": batches cut before Phase 21 have no mandal at all, and
 * reading a missing field as a mismatch would hide every one of them from every
 * moderator the day this ships.
 *
 * The viewer's own assigned batch is ALWAYS visible. Their scope governs which
 * territory they oversee; a batch already handed to them is their work, and
 * hiding it would leave them staring at an empty calling queue with no
 * explanation.
 */
export function filterBatchesByScope(batches, scope, viewerId = null) {
  if (!scope || scope.unrestricted) return batches || [];

  return (batches || []).filter((b) => {
    if (viewerId && b.assignedVolunteerId === viewerId) return true;
    if (scope.kind === SCOPE_KINDS.NONE) return false;

    const areaOk = !b.area || scope.areas.includes(b.area);
    const mandalOk = !b.mandal || scope.mandals.includes(b.mandal);

    switch (scope.kind) {
      case SCOPE_KINDS.AREA: return areaOk;
      // PHASE 31 — a MANDAL scope is the ONE case where a missing field is not
      // read as "spans everything". A mandal head oversees a column of the grid,
      // and a batch with no mandal is a city-wide Yuvak batch they can neither
      // edit (canEditBatch below refuses it, and so do the rules) nor act on. The
      // permissive reading put every legacy batch in a Bal Mandal head's list as
      // undeletable, unassignable noise — the opposite of "only my mandal".
      // Their own assigned batch is still exempt, via the viewerId check above.
      case SCOPE_KINDS.MANDAL: return Boolean(b.mandal) && scope.mandals.includes(b.mandal);
      case SCOPE_KINDS.INTERSECT: return areaOk && mandalOk;
      case SCOPE_KINDS.UNION:
      default: return areaOk || mandalOk;
    }
  });
}

/**
 * canEditBatch(batch, scope)
 *
 * "Will the SERVER let me write this batch?" — deliberately a different question
 * from filterBatchesByScope's "may I see it".
 *
 * The two disagree on purpose, and the disagreement is the bug this exists to
 * close. A batch with no area (or no mandal) SPANS everything, so it is shown to
 * everyone — hiding every pre-Phase-21 batch from every moderator would be worse.
 * But firestore.rules reads that same missing field as BROADER than a scoped
 * volunteer's territory and refuses the write, which is the conservative and
 * correct call: reassigning a city-wide batch is an admin act.
 *
 * Net effect before this: a moderator saw Assign / Rename / Delete on a legacy
 * batch, pressed one, and got "Missing or insufficient permissions" with nothing
 * to explain it. The buttons are now disabled with a reason instead.
 *
 * Mirrors batchScopeOk() + scopeAllows() in firestore.rules via matchesScope,
 * which is the same predicate the rules encode.
 */
export function canEditBatch(batch, scope) {
  if (!scope || scope.unrestricted) return true;
  if (scope.kind === SCOPE_KINDS.NONE) return false;
  return matchesScope(scope, { area: batch?.area || null, mandal: batch?.mandal || null });
}

/**
 * computeBatchStats(batches, individualsById)
 *
 * Pure function — the caller supplies the individuals it already has loaded
 * rather than this re-reading 1240 documents per render. Mirrors the shape of
 * the legacy getBatchStats() output so the UI reads the same way.
 *
 * `missing` counts individualIds whose document is absent from the supplied map.
 * That is either a deleted contact still referenced by a batch (real data drift,
 * worth surfacing) or simply not loaded yet — the UI labels it "unknown", not
 * "pending", so it can't be mistaken for outstanding work.
 */
export function computeBatchStats(batches, individualsById = {}) {
  const perBatch = (batches || []).map((b) => {
    const ids = b.individualIds || [];
    let called = 0, pending = 0, missing = 0;
    const statusCounts = {};
    for (const id of ids) {
      const ind = individualsById[id];
      if (!ind) { missing++; continue; }
      const s = String(ind.status || '').trim();
      if (s) { called++; statusCounts[s] = (statusCounts[s] || 0) + 1; }
      else pending++;
    }
    const known = called + pending;
    return {
      ...b,
      total: ids.length,
      called,
      pending,
      missing,
      statusCounts,
      progressPct: known ? Math.round((called / known) * 100) : 0,
    };
  });

  const totals = perBatch.reduce((acc, b) => ({
    batches: acc.batches + 1,
    assigned: acc.assigned + (b.assignedVolunteerId ? 1 : 0),
    contacts: acc.contacts + b.total,
    called: acc.called + b.called,
    pending: acc.pending + b.pending,
  }), { batches: 0, assigned: 0, contacts: 0, called: 0, pending: 0 });

  totals.unassigned = totals.batches - totals.assigned;
  totals.progressPct = totals.called + totals.pending
    ? Math.round((totals.called / (totals.called + totals.pending)) * 100)
    : 0;

  return { perBatch, totals };
}
