/**
 * functions/sabhaDigest.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 33 — the weekly follow-up email.
 *
 * "automatically sabha creation will help in seeing track record which area and
 *  which day sabha not happen. so easy to fallow up there Volunteer."
 *
 * sabhaScheduler.js fills the calendar in; this reports on what actually
 * happened. Monday 07:12 IST, so the week it describes is genuinely over and the
 * message lands at the start of the week somebody can do something about it.
 *
 * TWO AUDIENCES, TWO DIFFERENT RULES ABOUT WHEN TO SEND.
 *
 * The ADMIN digest goes out every week regardless, because "everything met" is
 * itself the answer to the question the report is asked to settle, and a weekly
 * report that only appears when things are wrong trains people to read its
 * arrival as an accusation.
 *
 * The PER-MANDAL-HEAD copy goes out ONLY to someone with something to chase.
 * The legacy Sevak Call daily report mailed every volunteer nightly, so most
 * people received "0 calls" every day and stopped opening any of them — the
 * comment in emailJobs.runDailyReport says as much. A weekly "your sabhas all
 * happened" is the same mistake at a slower tempo, and it would spend the one
 * piece of attention this feature has on the weeks that need none.
 *
 * SCOPE. Whose sabhas are whose is decided by lib/volunteerScope.js, a
 * transcription of src/lib/scope.js. The failure this guards against is not a
 * crash: it is a Vaishali Nagar sanchalak being asked to follow up Malviya
 * Nagar's missed sabhas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');

const {
  getEmailSettings, resolveReportRecipients, loadMailableVolunteers, queueMail,
} = require('./lib/mailer');
const { buildSabhaCoverageReport } = require('./lib/emailTemplates');
const { loadSabhaCoverage, DEFAULT_WEEKS_BACK } = require('./lib/sabhaCoverage');
const { resolveScope, matchesScope } = require('./lib/volunteerScope');
const { formatDayMonth } = require('./lib/sabhaDates');
// PHASE 34 — editable cron, see lib/scheduleConfig.js.
const { schedules } = require('./lib/scheduleConfig');

const REGION = 'us-central1';
const TZ = 'Asia/Kolkata';

// The coverage build runs ~100 count() aggregations and holds six weeks of
// events in memory. Well inside 256MiB, but the default 60s timeout is not
// enough for a hundred sequential round trips on a cold instance.
const SCHEDULE_OPTS = { region: REGION, timeZone: TZ, timeoutSeconds: 300, memory: '512MiB' };

// Monday 07:12 IST by default. Off the hour for the same reason as the other
// jobs — Cloud Scheduler stampedes at :00 and Firestore reads queue behind each
// other. Editable from the admin panel via lib/scheduleConfig.js.
const DIGEST_SCHEDULE = schedules.sabhaDigest;

/** Bounded fan-out. Same cap as the per-volunteer daily report. */
const MAX_PER_VOLUNTEER_EMAILS = 40;

/** Recomputes the tiles for a narrowed set of rows, so a mandal head's copy
 *  counts their own sabhas rather than the city's. */
function narrow(data, rows) {
  const totals = rows.reduce((acc, r) => {
    acc.held += r.held;
    acc.unmarked += r.unmarked;
    acc.missed += r.missed;
    acc.due += r.dueTotal;
    if (r.needsFollowUp) acc.followUp += 1;
    if (r.paused) acc.paused += 1; else acc.active += 1;
    return acc;
  }, { schedules: rows.length, active: 0, paused: 0, held: 0, unmarked: 0, missed: 0, due: 0, followUp: 0 });
  return { ...data, rows, totals };
}

/**
 * Is there anything here worth a person's Monday morning?
 *
 * Deliberately a LOWER bar than the admin digest's `needsFollowUp` (two misses
 * in a row). A mandal head is responsible for one mandal, so "your sabha did not
 * happen last Sunday" is a single specific fact they can act on this week —
 * waiting for a second miss before telling anyone means the first one passes
 * unnoticed, which is the thing the user asked this feature to prevent. The
 * two-miss threshold exists for the city-wide list, where sixty schedules with
 * occasional blips would bury the ones that have genuinely stopped.
 *
 * Paused schedules never count. Pausing is somebody stating that this sabha is
 * not running; a gap is then the expected outcome, not a lapse, and mailing the
 * head every Monday about a sabha they themselves switched off is exactly how
 * this report would teach people to filter it away.
 */
function isActionable(rows) {
  return rows.some((r) => !r.paused && (r.needsFollowUp || r.missed > 0 || r.unmarked > 0));
}

async function runSabhaDigest({ now = new Date(), force = false, weeksBack = DEFAULT_WEEKS_BACK, to = null } = {}) {
  const settings = await getEmailSettings();
  const wantAdmin = force || settings.autoSabhaDigestEnabled;
  // `force` deliberately does NOT extend to the per-mandal copies — pressing
  // "Send sabha digest" on the admin screen is a request for the digest, not a
  // decision to mail every sanchalak in the city. Mirrors runDailyReport.
  const wantVolunteer = !to && settings.autoSabhaDigestVolunteerEnabled;

  if (!wantAdmin && !wantVolunteer) {
    console.log('[sabha-digest] both toggles are off — nothing to do.');
    return { skipped: 'disabled' };
  }

  const data = await loadSabhaCoverage({ now, weeksBack });
  const opts = { formatDate: formatDayMonth };
  const results = { period: data.periodLabel, admin: null, volunteers: [] };

  if (wantAdmin) {
    const recipients = to || (await resolveReportRecipients(settings));
    const { subject, html, text } = buildSabhaCoverageReport(data, opts);
    results.admin = await queueMail({
      to: recipients,
      subject,
      html,
      text,
      kind: 'sabha-digest',
      meta: {
        from: data.from,
        to: data.to,
        schedules: data.totals.schedules,
        held: data.totals.held,
        missed: data.totals.missed,
        followUp: data.totals.followUp,
      },
      settings,
    });
  }

  if (wantVolunteer && data.rows.length) {
    const mailable = await loadMailableVolunteers();

    const candidates = mailable
      // manage_events is the permission that makes somebody responsible for a
      // sabha — the same one firestore.rules requires to create the schedule in
      // the first place. Asking for a different one here would mean the person
      // who set the sabha up is not the person told when it stops happening.
      .filter((v) => v.permissions.includes('manage_events'))
      .map((v) => ({
        person: v,
        scope: resolveScope({ volunteer: v, roles: v.roles, permissions: v.permissions }),
      }))
      // An unrestricted volunteer would receive the whole city twice — once here
      // and once as the admin digest above. They are the admin audience.
      .filter(({ scope }) => !scope.unrestricted && !scope.empty);

    let sent = 0;
    for (const { person, scope } of candidates) {
      if (sent >= MAX_PER_VOLUNTEER_EMAILS) {
        console.warn(`[sabha-digest] per-volunteer cap of ${MAX_PER_VOLUNTEER_EMAILS} reached; ${candidates.length - sent} not mailed.`);
        break;
      }

      const mine = data.rows.filter((r) => matchesScope(scope, {
        area: r.area === '—' ? null : r.area,
        mandal: r.mandal === '—' ? null : r.mandal,
      }));
      if (!mine.length) continue;
      if (!isActionable(mine)) continue; // see the header — silence is the point

      const narrowed = narrow(data, mine);
      const { subject, html, text } = buildSabhaCoverageReport(narrowed, {
        ...opts,
        forVolunteer: { id: person.id, name: person.name },
      });

      /* eslint-disable no-await-in-loop */
      const res = await queueMail({
        to: [person.email],
        subject,
        html,
        text,
        kind: 'sabha-digest-volunteer',
        meta: {
          from: data.from,
          to: data.to,
          volunteerId: person.id,
          schedules: mine.length,
          followUp: narrowed.totals.followUp,
        },
        settings,
      });
      /* eslint-enable no-await-in-loop */
      results.volunteers.push({ volunteerId: person.id, ...res });
      sent += 1;
    }

    if (!results.volunteers.length) {
      console.log('[sabha-digest] no mandal head had anything to chase this week.');
    }
  }

  return results;
}

exports.runSabhaDigest = runSabhaDigest;

exports.scheduledSabhaDigest = onSchedule(
  { ...SCHEDULE_OPTS, schedule: DIGEST_SCHEDULE },
  async () => {
    const res = await runSabhaDigest({ now: new Date() });
    console.log('[sabha-digest] done:', JSON.stringify(res));
  },
);
