/**
 * functions/emailJobs.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 20 — the email automation, ported from Sevak Call's time-driven Apps
 * Script triggers.
 *
 *   legacy dailyEmailTrigger (22:00)      → scheduledDailyReport
 *   legacy 15-minute post-sabha poll      → scheduledPostSabhaReports
 *   legacy birthday trigger (06:00)       → scheduledBirthdaySummary
 *   (new) admin "send now" buttons         → sendManualEmail / previewEmailRecipients
 *
 * Every job follows the same three steps: read settings/email and bail if the
 * toggle is off, build the numbers (lib/reportData.js), hand the message to the
 * outbox (lib/mailer.js). Nothing here talks to SMTP; see lib/mailer.js.
 *
 * FAILURE POSTURE. A report is useful, not critical. So:
 *   • a missing PDF never blocks the email — the numbers are in the HTML too
 *   • an empty recipient list is logged to emailLogs and is not an error
 *   • one event failing in the post-sabha loop does not abort the others
 * A scheduled function that throws gets retried by Cloud Scheduler, and a report
 * that retries can duplicate — so the only thing guarded with a transaction is
 * the post-sabha claim, which is the one job that must send exactly once.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const {
  getEmailSettings, resolveReportRecipients, loadMailableVolunteers, queueMail, isDeliverable,
} = require('./lib/mailer');
const {
  buildDailyReport, buildPostSabhaReport, buildSkBatchReport, buildBirthdayReport,
} = require('./lib/emailTemplates');
const {
  buildDailyStats, findEventsToReport, buildPostSabhaReport: buildPostSabhaData,
  buildBirthdayData, getMessageTemplates,
} = require('./lib/reportData');
const { dailyReportPdf, postSabhaPdf, skBatchPdf, birthdayPdf } = require('./lib/pdfReport');
const { permissionsForVolunteer, volunteerRoleIds } = require('./lib/callerAccess');
// PHASE 38 — the per-karyakarta batch follow-up list. Shares the post-sabha tick
// but nothing else; see runSkBatchReports below.
const { buildSkBatchReports, MAX_SK_EMAILS_PER_EVENT } = require('./lib/skReport');
const { ROUND_GROUPS } = require('./lib/roundClassify');
// PHASE 33 — the weekly sabha coverage digest lives in its own file (it has a
// schedule of its own and no PDF), but its manual "send now" belongs here with
// the other three so the admin screen has one callable to talk to.
const { runSabhaDigest } = require('./sabhaDigest');
// PHASE 34 — cron strings now live in one editable place. See lib/scheduleConfig.js
// for why they are read from a file rather than settings/email at runtime.
const { schedules } = require('./lib/scheduleConfig');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const TZ = 'Asia/Kolkata';

// jsPDF plus a few hundred contact documents comfortably exceeds the 256MiB
// default, and the daily job reads the whole activity log for the day.
const SCHEDULE_OPTS = { region: REGION, timeZone: TZ, timeoutSeconds: 300, memory: '512MiB' };

// Schedules are read from lib/scheduleConfig.js (defaults, overridable by the
// admin panel via schedules.local.json). They are deliberately a few minutes off
// the hour — Cloud Scheduler fires thousands of :00 jobs across the region at
// once and Firestore reads queue behind each other; nobody notices a report
// arriving at 22:05 instead of 22:00.
const DAILY_SCHEDULE = schedules.daily;       // legacy dailyEmailTrigger ran at 22:00 IST
const POST_SABHA_SCHEDULE = schedules.postSabha; // legacy polled every 15 minutes
const BIRTHDAY_SCHEDULE = schedules.birthday;    // legacy birthday trigger ran at 06:00 IST

/** Bounded fan-out for the per-volunteer variants — see runDailyReport. */
const MAX_PER_VOLUNTEER_EMAILS = 40;

// ── Daily calling report ────────────────────────────────────────────────────

async function runDailyReport({ now = new Date(), force = false } = {}) {
  const settings = await getEmailSettings();
  const wantAdmin = force || settings.autoDailyAdminEnabled;
  // `force` deliberately does NOT extend to the per-volunteer copies. Pressing
  // "Send daily report" on the admin screen is a request for the digest — an
  // admin checking the layout should not silently mail every volunteer who
  // logged a call today. Turning that on stays an explicit settings decision.
  const wantVolunteer = settings.autoDailyVolunteerEnabled;

  if (!wantAdmin && !wantVolunteer) {
    console.log('[daily] both daily toggles are off — nothing to do.');
    return { skipped: 'disabled' };
  }

  const stats = await buildDailyStats({ now });
  const results = { date: stats.dateKey, admin: null, volunteers: [] };

  if (wantAdmin) {
    const to = await resolveReportRecipients(settings);
    const { subject, html, text } = buildDailyReport(stats);
    const pdf = dailyReportPdf(stats);
    results.admin = await queueMail({
      to,
      subject,
      html,
      text,
      attachments: pdf ? [pdf] : [],
      kind: 'daily-admin',
      meta: { date: stats.dateKey, contacts: stats.totals.contacts, calls: stats.totals.calls },
      settings,
    });
  }

  if (wantVolunteer) {
    // Only volunteers who actually did something today. The legacy version
    // mailed every volunteer nightly, so most people received "0 calls" every
    // day and stopped reading the ones that mattered.
    const mailable = await loadMailableVolunteers();
    const byId = new Map(mailable.map((v) => [v.id, v]));
    const active = stats.perVolunteer.filter((v) => byId.has(v.volunteerId)).slice(0, MAX_PER_VOLUNTEER_EMAILS);

    if (stats.perVolunteer.length > active.length) {
      console.log(`[daily] ${stats.perVolunteer.length - active.length} active volunteer(s) had no reportEmail set or exceeded the per-run cap.`);
    }

    for (const v of active) {
      const person = byId.get(v.volunteerId);
      const { subject, html, text } = buildDailyReport(stats, { forVolunteer: { id: person.id, name: person.name } });
      /* eslint-disable no-await-in-loop */
      const res = await queueMail({
        to: [person.email],
        subject,
        html,
        text,
        kind: 'daily-volunteer',
        meta: { date: stats.dateKey, volunteerId: person.id, contacts: v.contacts },
        settings,
      });
      /* eslint-enable no-await-in-loop */
      results.volunteers.push({ volunteerId: person.id, ...res });
    }
  }

  return results;
}

// ── Post-sabha attendance report ────────────────────────────────────────────

const MAX_SEND_ATTEMPTS = 3;

/**
 * Claim an event for reporting. Returns true if this invocation owns the send.
 *
 * The 15-minute poll means two overlapping runs are entirely possible, and a
 * sanchalak receiving the same attendance report three times is how people learn
 * to ignore it. The claim and the attempt counter are set in one transaction, so
 * exactly one caller wins.
 */
async function claimEvent(eventId, now) {
  const ref = db.collection('events').doc(eventId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const e = snap.data();
    if (e.emailedAt) return false;
    if ((e.emailAttempts || 0) >= MAX_SEND_ATTEMPTS) {
      console.error(`[post-sabha] giving up on event ${eventId} after ${e.emailAttempts} failed attempts.`);
      return false;
    }
    tx.update(ref, {
      emailedAt: now,
      emailAttempts: (e.emailAttempts || 0) + 1,
    });
    return true;
  });
}

/** Release a failed claim so the next poll retries it (bounded by emailAttempts). */
async function releaseEvent(eventId, message) {
  await db.collection('events').doc(eventId).update({
    emailedAt: null,
    emailError: String(message || '').slice(0, 500),
  }).catch((err) => console.error(`[post-sabha] could not release event ${eventId}:`, err.message));
}

async function runPostSabhaReports({ now = new Date(), force = false, eventId = null } = {}) {
  const settings = await getEmailSettings();
  const wantAdmin = force || settings.autoPostSabhaAdminEnabled;
  const wantVolunteer = force || settings.autoPostSabhaVolunteerEnabled;

  if (!wantAdmin && !wantVolunteer) return { skipped: 'disabled' };

  // Dry run cannot mean here what it means for the other two reports.
  //
  // claimEvent stamps emailedAt BEFORE the message is built, because the whole
  // point of the claim is that the 15-minute poll must not send twice. queueMail
  // then returns skipped:'dry-run' and sends nothing — but the claim stands, and
  // there is no screen anywhere that re-arms a claimed event. So a single
  // dry-run tick would permanently consume the real report and the sanchalak
  // would simply never receive it: the exact failure dry run exists to prevent.
  //
  // Skipping the job outright is therefore the only honest reading of "build it
  // but don't send it" for this one report. A manual send passes force and is
  // unaffected — that is a person deliberately asking for one named event.
  if (!force && settings.dryRun) {
    console.log('[post-sabha] dry run is on — skipping entirely so that no event is claimed and no report is lost.');
    return { skipped: 'dry-run', sent: [], checked: 0 };
  }

  let due;
  if (eventId) {
    due = [{ id: eventId }];
  } else {
    due = await findEventsToReport({ now });
    if (due.length === 0) return { sent: [], checked: 0 };
  }

  const sent = [];
  for (const event of due) {
    /* eslint-disable no-await-in-loop */
    // A manual re-send skips the claim: the admin pressed the button knowing a
    // report already went out, and the guard exists to stop the scheduler
    // duplicating, not to stop a person.
    if (!force) {
      const owned = await claimEvent(event.id, now);
      if (!owned) continue;
    }

    try {
      const report = await buildPostSabhaData({ eventId: event.id, now });
      const to = wantAdmin ? await resolveReportRecipients(settings) : [];
      const attendanceTakers = wantVolunteer ? await volunteerEmailsFor(report) : [];
      const recipients = [...new Set([...to, ...attendanceTakers])];

      const { subject, html, text } = buildPostSabhaReport(report);
      const pdf = postSabhaPdf(report);
      const res = await queueMail({
        to: recipients,
        subject,
        html,
        text,
        attachments: pdf ? [pdf] : [],
        kind: 'post-sabha',
        meta: {
          eventId: event.id,
          title: report.event.title,
          date: report.event.date,
          present: report.present.length,
          turnoutPct: report.turnoutPct,
        },
        settings,
      });

      if (!force) {
        await db.collection('events').doc(event.id).update({
          emailStatus: res.queued ? 'queued' : (res.skipped || 'skipped'),
          emailError: admin.firestore.FieldValue.delete(),
        }).catch(() => {});
      }
      sent.push({ eventId: event.id, ...res });
    } catch (err) {
      console.error(`[post-sabha] event ${event.id} failed:`, err.message);
      if (!force) await releaseEvent(event.id, err.message);
      sent.push({ eventId: event.id, queued: false, error: err.message });
    }
    /* eslint-enable no-await-in-loop */
  }

  return { sent, checked: due.length };
}

/** Volunteers who took the attendance, if they have a reportEmail on file. */
async function volunteerEmailsFor(report) {
  const wanted = new Set(report.markedByIds || []);
  if (wanted.size === 0) return [];
  const mailable = await loadMailableVolunteers();
  return mailable.filter((v) => wanted.has(v.id)).map((v) => v.email);
}

// ── Per-karyakarta batch follow-up list ─────────────────────────────────────

/**
 * PHASE 38 — one email per Sampark Karyakarta, covering only their own batch.
 *
 * Separate from runPostSabhaReports in every way that matters, and deliberately
 * so. That job answers a sanchalak's question and mails one identical copy to
 * everybody with send_emails; this one answers "of the forty people I rang, who
 * came" and mails a different PDF to each karyakarta. Sharing the tick is a cost
 * decision — one events range query serves both — not a coupling.
 *
 * ITS OWN CLAIM FIELD, `skReportsSentAt`. Reusing `emailedAt` would have broken
 * both jobs: this one declines to send while the attendance register is empty and
 * needs to come back on the next tick, and a shared claim would mean either
 * blocking the sanchalak's report for the same 15 minutes or having it consume
 * this one permanently. Two fields, one finder — see findEventsToReport.
 *
 * WHY THE GRACE PERIOD IS LONGER. The sanchalak's report can go out ten minutes
 * after a sabha ends and be roughly right; a slightly low headcount is a number
 * on a dashboard. This one turns "not in the register" into a phone call, so it
 * waits until the register has plausibly been finished. If it still has not been,
 * registerUnmarked holds the send and the claim is released.
 */
const MAX_SK_ATTEMPTS = 3;

async function claimSkReports(eventId, now) {
  const ref = db.collection('events').doc(eventId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const e = snap.data();
    if (e.skReportsSentAt) return false;
    if ((e.skReportAttempts || 0) >= MAX_SK_ATTEMPTS) {
      console.error(`[sk-batch] giving up on event ${eventId} after ${e.skReportAttempts} failed attempts.`);
      return false;
    }
    // The attempt counter is NOT incremented here, only on a genuine failure —
    // see releaseSkReports. An unmarked register is a "come back later", and
    // counting those would exhaust the three attempts in 45 minutes, long before
    // anybody had finished marking who turned up.
    tx.update(ref, { skReportsSentAt: now });
    return true;
  });
}

/**
 * Hand the event back for a later tick.
 * @param {boolean} countAttempt true for a real error (bounded retry), false for
 *   "not ready yet" (retried until the lookback window closes).
 */
async function releaseSkReports(eventId, message, countAttempt) {
  const patch = { skReportsSentAt: null };
  if (message) patch.skReportError = String(message).slice(0, 500);
  if (countAttempt) patch.skReportAttempts = admin.firestore.FieldValue.increment(1);
  await db.collection('events').doc(eventId).update(patch)
    .catch((err) => console.error(`[sk-batch] could not release event ${eventId}:`, err.message));
}

async function runSkBatchReports({ now = new Date(), force = false, eventId = null } = {}) {
  const settings = await getEmailSettings();
  if (!force && !settings.autoSkBatchReportsEnabled) return { skipped: 'disabled' };

  // Same reasoning as the post-sabha job: the claim is stamped before the message
  // is built, so a dry-run tick would consume the claim and send nothing, and
  // there is no screen that re-arms it. Skipping outright is the only honest
  // reading of "build it but don't send it" for a claimed job.
  if (!force && settings.dryRun) {
    console.log('[sk-batch] dry run is on — skipping entirely so that no event is claimed and no list is lost.');
    return { skipped: 'dry-run', sent: [], checked: 0 };
  }

  let due;
  if (eventId) {
    due = [{ id: eventId }];
  } else {
    due = await findEventsToReport({ now, claimField: 'skReportsSentAt', graceMinutes: 25 });
    if (due.length === 0) return { sent: [], checked: 0 };
  }

  const out = [];
  for (const event of due) {
    /* eslint-disable no-await-in-loop */
    if (!force) {
      const owned = await claimSkReports(event.id, now);
      if (!owned) continue;
    }

    try {
      const data = await buildSkBatchReports({ eventId: event.id, now });

      if (data.registerUnmarked) {
        // Not "nobody came" — nobody has said yet. Hand it back without counting
        // an attempt; the next tick tries again until the 24h window closes.
        console.log(`[sk-batch] event ${event.id} has no attendance marked yet — will retry.`);
        if (!force) await releaseSkReports(event.id, null, false);
        out.push({ eventId: event.id, skipped: 'register-unmarked' });
        continue;
      }

      if (data.reports.length === 0) {
        // No batch carries this eventId. That will never become true on its own,
        // so the claim stands and this stops asking.
        console.log(`[sk-batch] event ${event.id} has no assigned batches (${data.batchCount} batch doc(s) found) — nothing to send.`);
        out.push({ eventId: event.id, skipped: 'no-assigned-batches' });
        continue;
      }

      const undeliverable = data.reports.filter((r) => !r.deliverable);
      if (undeliverable.length) {
        // The silent failure this project has hit before: volunteers/{uid} has no
        // mailbox until somebody fills in reportEmail, and nothing anywhere says
        // so. Name them in the log so "I never got my list" has an answer.
        console.warn('[sk-batch] no reportEmail set for: '
          + undeliverable.map((r) => `${r.volunteerName} (${r.volunteerId})`).join(', '));
      }

      const deliverable = data.reports.filter((r) => r.deliverable).slice(0, MAX_SK_EMAILS_PER_EVENT);
      const overflow = data.reports.filter((r) => r.deliverable).length - deliverable.length;
      if (overflow > 0) {
        console.warn(`[sk-batch] event ${event.id}: ${overflow} karyakarta(s) over the ${MAX_SK_EMAILS_PER_EVENT}-email cap were not mailed.`);
      }

      const sent = [];
      for (const report of deliverable) {
        const { subject, html, text } = buildSkBatchReport(report, ROUND_GROUPS);
        const pdf = skBatchPdf(report, ROUND_GROUPS);
        // One queueMail per karyakarta, never a shared `to` list: two karyakartas
        // on one message would each receive the other's contacts, which is the
        // exact thing this report was asked to avoid.
        const res = await queueMail({
          to: [report.email],
          subject,
          html,
          text,
          attachments: pdf ? [pdf] : [],
          kind: 'post-sabha-sk',
          meta: {
            eventId: event.id,
            title: report.event.title,
            date: report.event.date,
            volunteerId: report.volunteerId,
            called: report.called,
            attended: report.attended,
            chase: report.chaseCount,
          },
          settings,
        });
        sent.push({ volunteerId: report.volunteerId, ...res });
      }

      if (!force) {
        await db.collection('events').doc(event.id).update({
          skReportStatus: `sent-${sent.filter((s) => s.queued).length}`,
          skReportError: admin.firestore.FieldValue.delete(),
        }).catch(() => {});
      }

      out.push({
        eventId: event.id,
        karyakartas: sent.length,
        skippedNoEmail: undeliverable.length,
        sent,
      });
    } catch (err) {
      console.error(`[sk-batch] event ${event.id} failed:`, err.message);
      if (!force) await releaseSkReports(event.id, err.message, true);
      out.push({ eventId: event.id, queued: false, error: err.message });
    }
    /* eslint-enable no-await-in-loop */
  }

  return { sent: out, checked: due.length };
}

// ── Birthday & anniversary summary ──────────────────────────────────────────

async function runBirthdaySummary({ now = new Date(), force = false } = {}) {
  const settings = await getEmailSettings();
  if (!force && !settings.autoBirthdayEnabled) return { skipped: 'disabled' };

  const templates = await getMessageTemplates();
  const data = await buildBirthdayData({ now, templates });

  if (!force && data.birthdays.length === 0 && data.anniversaries.length === 0) {
    console.log(`[birthday] nobody to wish on ${data.dateKey}.`);
    return { skipped: 'nobody-today', date: data.dateKey };
  }

  const to = await resolveReportRecipients(settings);
  const { subject, html, text } = buildBirthdayReport(data);
  const pdf = birthdayPdf(data);

  return queueMail({
    to,
    subject,
    html,
    text,
    attachments: pdf ? [pdf] : [],
    kind: 'birthday',
    meta: { date: data.dateKey, birthdays: data.birthdays.length, anniversaries: data.anniversaries.length },
    settings,
  });
}

// ── Scheduled entry points ──────────────────────────────────────────────────

exports.scheduledDailyReport = onSchedule({ ...SCHEDULE_OPTS, schedule: DAILY_SCHEDULE }, async () => {
  const res = await runDailyReport({ now: new Date() });
  console.log('[daily] done:', JSON.stringify(res));
});

exports.scheduledPostSabhaReports = onSchedule({ ...SCHEDULE_OPTS, schedule: POST_SABHA_SCHEDULE }, async () => {
  const now = new Date();
  const res = await runPostSabhaReports({ now });
  if (res.checked) console.log('[post-sabha] done:', JSON.stringify(res));

  // PHASE 38 — the karyakarta lists ride the same tick. Awaited in sequence, not
  // in parallel: they claim different fields so there is no race, but running
  // them together doubles the peak read rate for no gain on a job with 300
  // seconds of budget and 15 minutes until the next one.
  //
  // In its own try so a failure in one fan-out cannot swallow the other — the
  // sanchalak's report has already been sent by this point and its claim is
  // committed, so throwing here would only lose the log line.
  try {
    const sk = await runSkBatchReports({ now });
    if (sk.checked) console.log('[sk-batch] done:', JSON.stringify(sk));
  } catch (err) {
    console.error('[sk-batch] tick failed:', err);
  }
});

exports.scheduledBirthdaySummary = onSchedule({ ...SCHEDULE_OPTS, schedule: BIRTHDAY_SCHEDULE }, async () => {
  const res = await runBirthdaySummary({ now: new Date() });
  console.log('[birthday] done:', JSON.stringify(res));
});

// ── Callables for the admin UI ──────────────────────────────────────────────

async function requirePermission(request, permission) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const vDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!vDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  // PHASE 21 — via lib/callerAccess so this matches every other callable and
  // src/hooks/usePermissions.jsx. Reading only the legacy single `roleRef` meant
  // an admin whose send_emails came from the SECOND entry of roleRefs[] was
  // refused here while the UI showed them the button — client and server
  // disagreeing, with only the client on screen.
  const perms = await permissionsForVolunteer(db, vDoc.data());
  if (!perms.includes(permission)) {
    throw new HttpsError('permission-denied', `Missing ${permission} permission.`);
  }
  return { id: vDoc.id, ...vDoc.data() };
}

/**
 * sendManualEmail({ kind, eventId, to })
 *
 * kind: 'daily' | 'postSabha' | 'birthday'
 * `to` overrides the resolved recipient list — used by the admin screen's "send
 * a test to myself" so the real list is never touched while checking layout.
 *
 * force = true throughout: pressing the button is the intent, so the "is this
 * report enabled" toggle and the post-sabha already-sent guard are both
 * bypassed. The one exception is the per-volunteer daily copy — see
 * runDailyReport — which stays governed by its own setting.
 */
exports.sendManualEmail = onCall({ region: REGION, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const caller = await requirePermission(request, 'send_emails');
  const { kind, eventId, to } = request.data || {};

  const override = Array.isArray(to) ? to.map((a) => String(a || '').trim()).filter(isDeliverable) : null;
  if (override && override.length === 0) {
    throw new HttpsError('invalid-argument', 'None of the supplied addresses look like real email addresses.');
  }

  const now = new Date();
  const settings = await getEmailSettings();

  try {
    if (kind === 'daily') {
      if (!override) return { ok: true, result: await runDailyReport({ now, force: true }) };
      const stats = await buildDailyStats({ now });
      const { subject, html, text } = buildDailyReport(stats);
      const pdf = dailyReportPdf(stats);
      const res = await queueMail({
        to: override, subject, html, text, attachments: pdf ? [pdf] : [],
        kind: 'daily-manual', meta: { date: stats.dateKey, by: caller.id }, settings,
      });
      return { ok: true, result: res };
    }

    if (kind === 'postSabha') {
      if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required for a post-sabha report.');
      if (!override) return { ok: true, result: await runPostSabhaReports({ now, force: true, eventId }) };
      const report = await buildPostSabhaData({ eventId, now });
      const { subject, html, text } = buildPostSabhaReport(report);
      const pdf = postSabhaPdf(report);
      const res = await queueMail({
        to: override, subject, html, text, attachments: pdf ? [pdf] : [],
        kind: 'post-sabha-manual', meta: { eventId, by: caller.id }, settings,
      });
      return { ok: true, result: res };
    }

    if (kind === 'birthday') {
      if (!override) return { ok: true, result: await runBirthdaySummary({ now, force: true }) };
      const templates = await getMessageTemplates();
      const data = await buildBirthdayData({ now, templates });
      const { subject, html, text } = buildBirthdayReport(data);
      const pdf = birthdayPdf(data);
      const res = await queueMail({
        to: override, subject, html, text, attachments: pdf ? [pdf] : [],
        kind: 'birthday-manual', meta: { date: data.dateKey, by: caller.id }, settings,
      });
      return { ok: true, result: res };
    }

    if (kind === 'skBatch') {
      if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required for a karyakarta batch report.');
      if (!override) return { ok: true, result: await runSkBatchReports({ now, force: true, eventId }) };
      // With an override this sends ONE email to the tester — the list belonging
      // to the karyakarta with the most follow-up calls, since that is the copy
      // worth looking at. Fanning a test out to every karyakarta's real inbox is
      // exactly what "send a test to myself" exists to avoid.
      const data = await buildSkBatchReports({ eventId, now });
      if (data.registerUnmarked) {
        throw new HttpsError('failed-precondition',
          'No attendance has been marked for this sabha yet, so there is nothing to compare the calls against.');
      }
      if (data.reports.length === 0) {
        throw new HttpsError('failed-precondition',
          'No batch is assigned to this sabha, so no karyakarta has a calling list for it.');
      }
      const report = data.reports[0];
      const { subject, html, text } = buildSkBatchReport(report, ROUND_GROUPS);
      const pdf = skBatchPdf(report, ROUND_GROUPS);
      const res = await queueMail({
        to: override, subject, html, text, attachments: pdf ? [pdf] : [],
        kind: 'post-sabha-sk-manual',
        meta: { eventId, volunteerId: report.volunteerId, by: caller.id },
        settings,
      });
      return { ok: true, result: { ...res, sampleOf: report.volunteerName, karyakartas: data.reports.length } };
    }

    if (kind === 'sabhaCoverage') {
      // No separate override branch: runSabhaDigest already takes `to`, and
      // passing it also suppresses the per-mandal fan-out — a test send must
      // reach one inbox, not every sanchalak in the city.
      return { ok: true, result: await runSabhaDigest({ now, force: true, to: override }) };
    }

    throw new HttpsError('invalid-argument', `Unknown report kind "${kind}".`);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('[sendManualEmail] failed:', err);
    throw new HttpsError('internal', err.message);
  }
});

/**
 * previewEmailRecipients() — who would actually receive a report right now, and
 * why the rest wouldn't. Exists because "I turned it on and nobody got anything"
 * is otherwise invisible: volunteers/{uid} has no email until someone fills in
 * reportEmail, and the failure is silent by design.
 */
exports.previewEmailRecipients = onCall({ region: REGION }, async (request) => {
  await requirePermission(request, 'send_emails');

  const settings = await getEmailSettings();
  const [recipients, mailable, allVolunteers, rolesSnap] = await Promise.all([
    resolveReportRecipients(settings),
    loadMailableVolunteers(),
    db.collection('volunteers').get(),
    db.collection('roles').get(),
  ]);

  const rolePerms = {};
  rolesSnap.forEach((d) => { rolePerms[d.id] = d.data().permissions || []; });

  const missingEmail = [];
  const noPermission = [];
  allVolunteers.forEach((d) => {
    const v = d.data();
    if (v.isActive === false) return;
    // PHASE 33 — the union across roleRefs[], matching loadMailableVolunteers().
    // Reading only the legacy `roleRef` meant this diagnostic reported a
    // volunteer as fine while the sender skipped them, which is worse than no
    // diagnostic: the screen exists precisely to explain "I turned it on and
    // nobody got anything".
    const perms = new Set(volunteerRoleIds(v).flatMap((id) => rolePerms[id] || []));
    if (!perms.has('send_emails')) return;
    if (!isDeliverable(v.reportEmail)) missingEmail.push(v.name || d.id);
  });
  mailable.forEach((v) => {
    if (!v.permissions.includes('send_emails')) noPermission.push(v.name);
  });

  return {
    recipients,
    count: recipients.length,
    extraRecipients: Array.isArray(settings.extraRecipients) ? settings.extraRecipients : [],
    missingEmail,
    haveEmailButNoPermission: noPermission,
    dryRun: !!settings.dryRun,
    maxRecipients: settings.maxRecipients,
  };
});

// NOTE: only Cloud Function definitions may be exported from a module that
// index.js re-exports — the deploy step treats every export as a function and
// chokes on a plain object. runDailyReport / runPostSabhaReports /
// runBirthdaySummary therefore stay module-private; the callables above are the
// supported way to trigger them by hand.
