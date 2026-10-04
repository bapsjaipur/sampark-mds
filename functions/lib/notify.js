/**
 * functions/lib/notify.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 48 — the in-app bell, server side: who to notify, and how to write it.
 *
 * WHY THIS EXISTS AT ALL. Until now the only way the app could tell a volunteer
 * anything was email, and email needs a deliverable `reportEmail` — a field most
 * karyakartas have never had filled in, because until Phase 38 nothing needed it.
 * The result was that the person who most needed to know "you have been given a
 * batch" was the least likely to be told. A notification needs nothing but a
 * login, and every volunteer has one, so the bell is the first channel in this
 * app that can actually reach everybody.
 *
 * THE SHAPE. One inbox subcollection per recipient:
 *
 *     notifications/{uid}/inbox/{itemId}
 *
 * Keyed by auth uid — the same key space as `volunteers/{uid}` — so the client
 * reads its own inbox with no query and no index beyond the composite below, and
 * firestore.rules can gate the whole thing on `request.auth.uid == uid`. The
 * subcollection is named `inbox` rather than `items` specifically so the nightly
 * cleanup's collectionGroup query cannot collide with another `items`
 * subcollection anywhere else in the database.
 *
 * WHO WRITES. Only the server. `allow create: if false` in the rules — a client
 * that could create in its own inbox could also create in EVERYONE's if the path
 * were ever loosened, and the whole point of the fan-out is that it is decided by
 * the scope engine on the server, not by the sender's browser.
 *
 * READ BUDGET. The recipient list is computed from ONE `volunteers` read plus ONE
 * `roles` read per fan-out, never one read per recipient. `writeNotifications`
 * dedupes and caps, so a runaway audience resolves to MAX_NOTIFY_FANOUT writes
 * and a console warning rather than a quota incident.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');
const { annotateVolunteers } = require('./mailer');
const { volunteerRoleIds } = require('./callerAccess');
const { expandMandalGroups } = require('./volunteerScope');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Notification types. Kept as a frozen map so a typo is an undefined, not a
 *  string that silently becomes its own type and its own icon-less row. */
const NOTIFY_TYPES = {
  BATCH_ASSIGNED: 'batch_assigned',
  SABHA_REMINDER: 'sabha_reminder',
  ATTENDANCE_MARKED: 'attendance_marked',
  BIRTHDAY: 'birthday',
  BULK_ALERT: 'bulk_alert',
};

/**
 * Hard ceiling on one fan-out.
 *
 * Every recipient is one document write, and the whole design is sized against a
 * 20k write/day budget shared with everything else the app does. A "send to
 * everyone" alert that resolved to 900 people would be 900 writes in one call —
 * affordable occasionally, ruinous on a loop. The cap turns a mistake into a
 * truncated alert plus a loud log line instead of an exhausted quota at 3pm.
 * Firestore's own batch limit is 500, so this is also the write-chunk size below;
 * a fan-out larger than this is refused rather than split across calls.
 */
const MAX_NOTIFY_FANOUT = 500;

/** Firestore rejects a batch over 500 writes. Stay one under so a future
 *  bookkeeping write in the same batch cannot push it over. */
const WRITE_BATCH_LIMIT = 450;

/** Longest a notification title/body may be — a mail body pasted into `body` by
 *  mistake should not sit in every recipient's inbox forever. */
const MAX_TITLE = 120;
const MAX_BODY = 500;

/**
 * Every ACTIVE volunteer, annotated for the scope engine — the notifier's twin of
 * mailer.loadMailableVolunteers(), differing in exactly one respect: no
 * `reportEmail` requirement. `requireDeliverableEmail: false` is what makes the
 * bell reach the karyakarta who has never had an address on file.
 *
 * ONE volunteers read + ONE roles read, regardless of how many recipients.
 *
 * @returns {Promise<Array<{id, name, permissions, roles, assignedAreas,
 *   assignedMandals, scopeKind, program, programs}>>}
 */
async function loadNotifiableVolunteers() {
  return annotateVolunteers({ requireDeliverableEmail: false });
}

/** Lowercased, trimmed, deduped, non-empty — the exact comparison the audience
 *  filters are written against. */
function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x) => String(x || '').trim()).filter(Boolean))];
}

/**
 * resolveNotificationAudience(volunteers, audience) → recipients
 *
 * The audience is the union of five optional selectors, which is what lets one
 * callable serve "this Mandal", "these three Roles", "everyone" and a single
 * named volunteer without five code paths:
 *
 *   everyone     → every volunteer
 *   areas[]      → volunteers DIRECTLY assigned to any of these areas
 *   mandals[]    → volunteers directly assigned to any of these mandals
 *   roleIds[]    → volunteers holding any of these roles
 *   volunteerIds → those volunteers, by id
 *
 * WHY DIRECT ASSIGNMENT AND NOT matchesScope(). `matchesScope` answers "does this
 * person's territory COVER this mandal", which is the right question for a contact
 * and the wrong one for an audience: an unrestricted or area-scoped volunteer
 * covers every mandal in their area, so a "send to Malviya Nagar" alert resolved
 * with matchesScope would notify the whole area team and every admin as well as
 * the mandal's own volunteers. Direct membership keeps a targeted broadcast
 * targeted. The unrestricted/global people are not left out — they receive every
 * `everyone` broadcast and they are the backstop audience for alerts that a human
 * sends deliberately.
 *
 * Bal ⇄ Sishu Mandal stay paired (expandMandalGroups), matching every other scope
 * filter in the app: a Sishu Mandal head who picks "Bal Mandal" on the composer
 * means the group, not the literal string.
 *
 * @param {Array} volunteers  a loadNotifiableVolunteers() result
 * @param {object} audience
 * @returns {Array} the matching volunteer records, deduped by id
 */
function resolveNotificationAudience(volunteers, audience = {}) {
  const list = Array.isArray(volunteers) ? volunteers : [];
  const areas = cleanList(audience.areas);
  const mandals = cleanList(audience.mandals);
  const roleIds = cleanList(audience.roleIds);
  const volunteerIds = cleanList(audience.volunteerIds);
  const everyone = audience.everyone === true;

  // A broadcast with no selector at all is a bug in the composer, not a silent
  // "everyone". Returning the empty set makes the callable report count 0, which
  // the sender can see, instead of mailing the city by accident.
  if (!everyone && !areas.length && !mandals.length && !roleIds.length && !volunteerIds.length) {
    return [];
  }

  const wantedMandals = expandMandalGroups(mandals);
  const idSet = new Set(volunteerIds);
  const roleSet = new Set(roleIds);

  const out = [];
  const seen = new Set();
  for (const v of list) {
    if (!v || !v.id || seen.has(v.id)) continue;

    let match = everyone;
    if (!match && idSet.size) match = idSet.has(v.id);
    if (!match && areas.length) {
      match = (v.assignedAreas || []).some((a) => areas.includes(a));
    }
    if (!match && wantedMandals.length) {
      match = (v.assignedMandals || []).some((m) => wantedMandals.includes(m));
    }
    if (!match && roleSet.size) {
      match = volunteerRoleIds(v).some((r) => roleSet.has(r));
    }
    if (!match) continue;

    seen.add(v.id);
    out.push(v);
  }
  return out;
}

/**
 * writeNotifications(recipients, payload) → number written
 *
 * The single write path for every notification in the app — the four automatic
 * triggers, the birthday fold-in, and the hand-sent bulk alert all end here, so
 * there is exactly one place where a notification is shaped, deduped and capped.
 *
 * @param {Array}  recipients  volunteer records (or anything with an `id`); ids
 *   are deduped first, so a volunteer who matched three audience selectors gets
 *   ONE notification, not three.
 * @param {object} payload
 * @param {string} payload.type   one of NOTIFY_TYPES
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {string} [payload.link]   in-app route opened on click ('/my-contacts')
 * @param {object} [payload.scope]  { area, mandal } for display/debug
 * @param {object} [payload.meta]   { eventId, batchId, … } — dedup/navigation
 * @param {object} [payload.sentBy] { id, name } — bulk alerts only
 * @param {Map|object} [payload.byUid]  per-recipient overrides, keyed by uid.
 *   The birthday fold-in uses this: each volunteer's list is THEIR matched
 *   contacts, so the body differs per person while the fan-out stays one batch.
 *   A uid present here gets `{ ...base, ...byUid[uid] }`.
 *
 * @returns {Promise<{written:number, truncated:number, total:number}>}
 */
async function writeNotifications(recipients, payload = {}) {
  const list = Array.isArray(recipients) ? recipients : [];
  const byUid = payload.byUid instanceof Map
    ? payload.byUid
    : new Map(Object.entries(payload.byUid || {}));

  // Dedupe by uid BEFORE capping, or three selectors matching the same person
  // would each consume one of the 500 slots.
  const uids = [];
  const seen = new Set();
  for (const r of list) {
    const uid = typeof r === 'string' ? r : r && r.id;
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    uids.push(uid);
  }

  const total = uids.length;
  const capped = uids.slice(0, MAX_NOTIFY_FANOUT);
  const truncated = total - capped.length;
  if (truncated > 0) {
    console.warn(
      `[notify] ${payload.type || 'notification'}: ${total} recipients exceeded `
      + `MAX_NOTIFY_FANOUT=${MAX_NOTIFY_FANOUT}; ${truncated} dropped. `
      + 'Narrow the audience (an Area or a Mandal, not everyone) and send again.',
    );
  }
  if (!capped.length) return { written: 0, truncated, total };

  const now = admin.firestore.FieldValue.serverTimestamp();
  const base = {
    type: payload.type || NOTIFY_TYPES.BULK_ALERT,
    title: String(payload.title || '').slice(0, MAX_TITLE),
    body: String(payload.body || '').slice(0, MAX_BODY),
    link: payload.link || null,
    scope: payload.scope || null,
    meta: payload.meta || {},
    sentBy: payload.sentBy || null,
    seen: false,
    seenAt: null,
    createdAt: now,
  };

  let written = 0;
  for (let i = 0; i < capped.length; i += WRITE_BATCH_LIMIT) {
    const batch = db.batch();
    for (const uid of capped.slice(i, i + WRITE_BATCH_LIMIT)) {
      const override = byUid.get(uid);
      const ref = db.collection('notifications').doc(uid).collection('inbox').doc();
      batch.set(ref, override ? { ...base, ...override } : base);
      written += 1;
    }
    await batch.commit();
  }

  console.log(`[notify] wrote ${written} ${base.type} notification(s)${truncated ? ` (${truncated} dropped)` : ''}`);
  return { written, truncated, total };
}

module.exports = {
  NOTIFY_TYPES,
  MAX_NOTIFY_FANOUT,
  loadNotifiableVolunteers,
  resolveNotificationAudience,
  writeNotifications,
  db,
};
