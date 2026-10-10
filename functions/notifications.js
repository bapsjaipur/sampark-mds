/**
 * functions/notifications.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 48 — the in-app bell. Everything that WRITES a notification lives here
 * except the birthday fold-in (which rides the already-loaded birthday job in
 * functions/emailJobs.js at zero extra reads) and the fan-out writer itself
 * (functions/lib/notify.js).
 *
 * The pieces:
 *
 *   sendBulkNotification   onCall — the one-click "gather at this place at this
 *                          time" alert. Gated on the dynamic `send_notifications`
 *                          permission, decided in the Roles tab like everything
 *                          else. The audience is a union of Area / Mandal / Role /
 *                          named-volunteer / Everyone selectors — see
 *                          resolveNotificationAudience in lib/notify.js.
 *   onBatchAssigned        onDocumentWritten('batches/{id}') — the assignee gets
 *                          one bell when assignedVolunteerId changes.
 *   onAttendanceMarked     onDocumentCreated('attendance/{id}') — ONE alert per
 *                          sabha to that sabha's area/mandal leaders, claimed on
 *                          the event so the flood of per-person marks sends once.
 *   scheduledSabhaReminder onSchedule — a lead-time heads-up before each sabha,
 *                          claimed once per event, fanned out to everyone in scope.
 *   scheduledNotificationCleanup onSchedule — nightly bounded delete of SEEN items
 *                          past the retention window, so the per-user listener
 *                          stays cheap forever.
 *
 * READ DISCIPLINE. Every hook bails on the cheapest possible signal before it
 * reads anything (see each handler's first lines). The reminders and the
 * attendance trigger load the volunteer list ONCE for the whole fan-out — never
 * per recipient. All of this is sized against a shared 50k-read / 20k-write day.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const { permissionsForVolunteer } = require('./lib/callerAccess');
const { resolveScope, matchesScope, eventInScope, expandMandalGroups, SCOPE_KINDS } = require('./lib/volunteerScope');
const { getAppSettings } = require('./lib/appSettings');
const { schedules } = require('./lib/scheduleConfig');
const {
  NOTIFY_TYPES, loadNotifiableVolunteers, resolveNotificationAudience, writeNotifications,
} = require('./lib/notify');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const CALLABLE_OPTS = { region: REGION, timeoutSeconds: 120, memory: '256MiB' };
const TRIGGER_OPTS = { region: REGION, memory: '256MiB' };
const SCHEDULE_OPTS = { region: REGION, timeZone: 'Asia/Kolkata', timeoutSeconds: 300, memory: '256MiB' };

/** An event older than this stops being worth a reminder — a guard against a
 *  stale calendar row whose date string is far in the past still matching a range. */
const REMINDER_MAX_LOOKAHEAD_DAYS = 7;

/** Nightly cleanup delete ceiling. Keeps the sweep bounded and, with a 30-day
 *  retention, comfortably ahead of a month's accumulation for this user base. */
const MAX_CLEANUP_DELETES = 2000;

/** How many names a birthday notification lists before it says "and N more". */
const BIRTHDAY_NAME_CAP = 3;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ── IST helpers ─────────────────────────────────────────────────────────────
// Small and local on purpose: lib/reportData.js carries the same two conversions
// for the email jobs, but they are not exported, and importing that whole report
// module (and its templates) into the notification trigger would pull far more
// than two four-line functions. KEEP IN SYNC with istInstant/istDateKey there.

/** 'YYYY-MM-DD' + 'HH:MM' (IST) → the UTC instant, or null when unusable. */
function istInstant(dateStr, timeStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '')) || [null, '0', '0'];
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  return new Date(utc - IST_OFFSET_MS);
}

/** The IST calendar day ('YYYY-MM-DD') a UTC instant falls on. */
function istDateKey(instant) {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function addDaysToKey(dateKey, n) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** 'Malviya Nagar · Yuvak Mandal' — a sabha's one-line identity for a body line. */
function describeEvent(event) {
  const areas = Array.isArray(event.areas) ? event.areas.filter(Boolean) : (event.area ? [event.area] : []);
  const areaLabel = areas.length ? areas.join(' + ') : 'All areas';
  return [event.title || 'Sabha', areaLabel, event.mandal].filter(Boolean).join(' · ');
}

// ── Caller permission ───────────────────────────────────────────────────────

/**
 * The same gate emailJobs.js uses for sendManualEmail, re-stated here rather than
 * shared, because the emailJobs one is module-private and re-exporting a plain
 * function through an index.js that only re-exports Cloud Function definitions is
 * exactly the constraint the project already documents. The logic is deliberately
 * identical: roleRefs[] union via lib/callerAccess, so a permission granted by a
 * volunteer's SECOND role still counts.
 */
async function requirePermission(request, permission) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const vDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!vDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const perms = await permissionsForVolunteer(db, vDoc.data());
  if (!perms.includes(permission)) {
    throw new HttpsError('permission-denied', `Missing ${permission} permission.`);
  }
  return { id: vDoc.id, ...vDoc.data() };
}

/** Trimmed, capped string from untrusted input. */
function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// ── sendBulkNotification ────────────────────────────────────────────────────

/**
 * sendBulkNotification({ audience, title, body, link, preview, toSelf })
 *
 * audience: { everyone?, areas?[], mandals?[], roleIds?[], volunteerIds?[] }
 * preview:  true → resolve and return { count, sample } WITHOUT writing, so the
 *           composer can show "this will reach N people" before it commits.
 * toSelf:   true → write only to the caller, so a sender can see exactly what a
 *           recipient sees before alarming anybody. A preview that reaches
 *           everybody is not a preview.
 *
 * Returns { count, written, truncated, sample }.
 */
exports.sendBulkNotification = onCall(CALLABLE_OPTS, async (request) => {
  const caller = await requirePermission(request, 'send_notifications');
  const data = request.data || {};
  const audience = data.audience && typeof data.audience === 'object' ? data.audience : {};

  const title = cleanText(data.title, 120);
  const body = cleanText(data.body, 500);
  if (!title) throw new HttpsError('invalid-argument', 'A title is required.');

  const volunteers = await loadNotifiableVolunteers();
  let recipients = resolveNotificationAudience(volunteers, audience);

  if (data.preview === true) {
    return {
      count: recipients.length,
      written: 0,
      truncated: 0,
      // First few names so the sender can sanity-check the audience is the team
      // they meant and not, say, every Yuvak in Jaipur.
      sample: recipients.slice(0, 8).map((v) => v.name || v.id),
    };
  }

  if (!recipients.length) {
    throw new HttpsError('invalid-argument', 'That audience resolves to nobody — pick an Area, a Mandal, a Role, some volunteers, or Everyone.');
  }

  // A test write goes only to the caller, using their own record so the bell
  // shows a real name — never the whole audience.
  const toSelf = data.toSelf === true;
  if (toSelf) recipients = [{ id: request.auth.uid }];

  const { written, truncated, total } = await writeNotifications(recipients, {
    type: NOTIFY_TYPES.BULK_ALERT,
    title,
    body,
    link: cleanText(data.link, 200) || '/notifications',
    sentBy: toSelf ? null : { id: caller.id, name: caller.name || 'A coordinator' },
  });

  return { count: total, written, truncated, sample: [] };
});

// ── onBatchAssigned ─────────────────────────────────────────────────────────

/**
 * One bell to the assignee when a batch is assigned.
 *
 * ORDERING IS THE WHOLE POINT. `batches/{id}` is written for all sorts of
 * reasons — status updates, round rolls, the nightly tools — and this trigger
 * fires on every one of them. Reading settings or the volunteer list up front
 * would mean a settings read and a volunteers read per ordinary batch write, all
 * day. So the FIRST thing checked is the cheapest possible signal: did
 * assignedVolunteerId actually change, and land on a real value? An unchanged
 * field, an unassignment, or a brand-new unassigned batch is dropped before a
 * single read happens.
 */
exports.onBatchAssigned = onDocumentWritten({ ...TRIGGER_OPTS, document: 'batches/{batchId}' }, async (event) => {
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after) return; // deleted

  const prevAssignee = (before && before.assignedVolunteerId) || null;
  const assignee = after.assignedVolunteerId || null;
  if (!assignee || assignee === prevAssignee) return;

  const settings = await getAppSettings();
  if (!settings.notifyBatchAssigned) return;

  // Only now the one extra read: the assignee's name for the body.
  const vSnap = await db.collection('volunteers').doc(assignee).get();
  const name = vSnap.exists ? (vSnap.data().name || 'there') : 'there';

  const batchName = (after.name || after.batchNumber) ? `Batch ${after.name || after.batchNumber}` : 'A new batch';
  const where = [after.area, after.mandal].filter(Boolean).join(' · ');

  await writeNotifications([{ id: assignee }], {
    type: NOTIFY_TYPES.BATCH_ASSIGNED,
    title: 'A batch has been assigned to you',
    body: `${batchName}${where ? ` (${where})` : ''} is now yours — open My Contacts to start calling, ${name}.`,
    link: '/my-contacts',
    scope: { area: after.area || null, mandal: after.mandal || null },
    meta: { batchId: event.params.batchId },
  });
});

// ── onAttendanceMarked ──────────────────────────────────────────────────────

/**
 * ONE alert per sabha when its attendance starts being marked, to that sabha's
 * AREA and MANDAL leaders.
 *
 * Two deliberate limits:
 *   • Claimed on the EVENT (`attendanceNotifiedAt`), not per attendance row. A
 *     register for a 60-person sabha is 60 created documents; unclaimed, that is
 *     60 identical alerts to every leader. The claim collapses the whole register
 *     into a single notification the moment the first person is marked.
 *   • AREA/MANDAL scopes only — GLOBAL (Admin / view_all_contacts) is excluded,
 *     or the whole city's leadership rings on every weekly sabha anywhere.
 */
exports.onAttendanceMarked = onDocumentCreated({ ...TRIGGER_OPTS, document: 'attendance/{attnId}' }, async (event) => {
  const row = event.data && event.data.data ? event.data.data() : null;
  if (!row) return;
  // COST GUARD. A bulk history import creates thousands of attendance docs in one
  // go, and each fires this trigger. Left unguarded, every one reads settings + the
  // event, and the first mark on each imported sabha loads the ENTIRE volunteer list
  // and notifies leaders about a sabha that happened long ago — thousands of
  // invocations and tens of thousands of reads for one import, plus spurious alerts.
  // Imported marks carry source:'history-import'; skip them before ANY read. This
  // trigger is for a LIVE register being marked in the app, never migrated history.
  if (row.source === 'history-import') return;
  const eventId = row.eventId ? String(row.eventId) : '';
  if (!eventId) return;

  const settings = await getAppSettings();
  if (!settings.notifyAttendanceMarked) return;

  const evRef = db.collection('events').doc(eventId);
  const evSnap = await evRef.get();
  if (!evSnap.exists) return;
  const ev = evSnap.data();

  // Claim-once, the claimEvent idiom from emailJobs.js. Whoever wins the
  // transaction sends; every later mark on the same sabha loses and exits.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(evRef);
    if (!snap.exists) return false;
    if (snap.data().attendanceNotifiedAt) return false;
    tx.update(evRef, { attendanceNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  const volunteers = await loadNotifiableVolunteers();
  const leaders = volunteers.filter((v) => {
    const scope = resolveScope({ volunteer: v, roles: v.roles, permissions: v.permissions });
    // Leaders only: a scoped Area/Mandal holder, never GLOBAL/unrestricted.
    if (scope.kind !== SCOPE_KINDS.AREA && scope.kind !== SCOPE_KINDS.MANDAL) return false;
    if (scope.empty) return false;
    return eventInScope(scope, ev);
  });

  if (!leaders.length) {
    console.log(`[notify] attendance marked on ${eventId} but no area/mandal leader is in scope.`);
    return;
  }

  await writeNotifications(leaders, {
    type: NOTIFY_TYPES.ATTENDANCE_MARKED,
    title: 'Attendance has started for a sabha',
    body: `${describeEvent(ev)} — the register is being marked now.`,
    link: '/events',
    scope: { area: ev.area || null, mandal: ev.mandal || null },
    meta: { eventId },
  });
});

// ── scheduledSabhaReminder ──────────────────────────────────────────────────

/**
 * A heads-up before an upcoming sabha, to everyone in scope.
 *
 * A forward single-field range on `date` (the same no-composite-index query
 * sabhaScheduler.js uses), then an exact per-event time comparison in memory so
 * only sabhas inside the lead window are picked up. Claimed once per event on
 * `reminderNotifiedAt`, so the hourly tick sends each sabha's reminder exactly
 * once, on the first tick after it enters the window.
 */
exports.scheduledSabhaReminder = onSchedule(
  { ...SCHEDULE_OPTS, schedule: schedules.sabhaReminder || '30 9 * * *' },
  async () => {
    const now = new Date();
    const settings = await getAppSettings();
    if (!settings.notifySabhaReminder) return;

    const leadHours = Number(settings.sabhaReminderLeadHours) > 0 ? Number(settings.sabhaReminderLeadHours) : 24;
    const horizonMs = now.getTime() + leadHours * 60 * 60 * 1000;

    const fromKey = istDateKey(now);
    const toKey = addDaysToKey(fromKey, Math.min(REMINDER_MAX_LOOKAHEAD_DAYS, Math.ceil(leadHours / 24) + 1));

    const snap = await db.collection('events')
      .where('date', '>=', fromKey)
      .where('date', '<=', toKey)
      .get();

    const due = snap.docs.filter((d) => {
      const e = d.data();
      if (e.reminderNotifiedAt) return false;
      const start = istInstant(e.date, e.time);
      if (!start) return false;
      const ms = start.getTime();
      return ms > now.getTime() && ms <= horizonMs;
    });

    if (!due.length) {
      console.log(`[notify] sabha reminder: nothing due in the next ${leadHours}h.`);
      return;
    }

    // Volunteers loaded ONCE for every due sabha, not once per sabha.
    const volunteers = await loadNotifiableVolunteers();
    const scoped = volunteers.map((v) => ({
      id: v.id,
      scope: resolveScope({ volunteer: v, roles: v.roles, permissions: v.permissions }),
    })).filter(({ scope }) => !scope.empty);

    let sent = 0;
    for (const d of due) {
      const ev = d.data();

      // Claim-once per event — one hourly tick at a time.
      const claimed = await db.runTransaction(async (tx) => {
        const ref = db.collection('events').doc(d.id);
        const s = await tx.get(ref);
        if (!s.exists || s.data().reminderNotifiedAt) return false;
        tx.update(ref, { reminderNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
        return true;
      });
      if (!claimed) continue;

      const recipients = scoped.filter(({ scope }) => eventInScope(scope, ev)).map(({ id }) => ({ id }));
      if (!recipients.length) continue;

      await writeNotifications(recipients, {
        type: NOTIFY_TYPES.SABHA_REMINDER,
        title: 'Sabha reminder',
        body: `${describeEvent(ev)}${ev.time ? ` — ${ev.time} IST` : ''}.`,
        link: '/events',
        scope: { area: ev.area || null, mandal: ev.mandal || null },
        meta: { eventId: d.id },
      });
      sent += 1;
    }

    console.log(`[notify] sabha reminder: sent for ${sent} of ${due.length} due sabha(s).`);
  },
);

// ── scheduledNotificationCleanup ────────────────────────────────────────────

/**
 * Delete SEEN notifications past the retention window.
 *
 * Only `seen == true` rows: an unread item is something a person has not looked
 * at yet and deleting it silently is the one thing a notification system must not
 * do. Seen + old is exactly the pile that would otherwise grow without bound and
 * make the per-user unread listener heavier every month.
 *
 * collectionGroup('inbox'), which is why the subcollection is named `inbox` and
 * not `items` — no other `items` subcollection exists to be swept up by mistake.
 * Bounded by MAX_CLEANUP_DELETES per run; the nightly cadence drains any backlog
 * over a few nights without one giant delete.
 */
exports.scheduledNotificationCleanup = onSchedule(
  { ...SCHEDULE_OPTS, schedule: schedules.notificationCleanup || '45 2 * * *' },
  async () => {
    const settings = await getAppSettings();
    const days = Number(settings.notificationRetentionDays) > 0 ? Number(settings.notificationRetentionDays) : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snap = await db.collectionGroup('inbox')
      .where('seen', '==', true)
      .where('createdAt', '<', cutoff)
      .limit(MAX_CLEANUP_DELETES)
      .get();

    if (snap.empty) {
      console.log(`[notify] cleanup: nothing seen and older than ${days} day(s).`);
      return;
    }

    const refs = snap.docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 450) {
      const batch = db.batch();
      refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }

    console.log(`[notify] cleanup: deleted ${refs.length} seen notification(s) older than ${days} day(s).`);
  },
);

// ── Exports used by index.js ────────────────────────────────────────────────
module.exports = {
  sendBulkNotification: exports.sendBulkNotification,
  onBatchAssigned: exports.onBatchAssigned,
  onAttendanceMarked: exports.onAttendanceMarked,
  scheduledSabhaReminder: exports.scheduledSabhaReminder,
  scheduledNotificationCleanup: exports.scheduledNotificationCleanup,
};
