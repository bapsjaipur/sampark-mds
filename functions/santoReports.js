/**
 * functions/santoReports.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 50 — the Santo volunteer-birthday report.
 *
 * "There is a Santo role. For that I want to send only the volunteer list, their
 *  DOB and Anniversary, to their email. A Santo created for one Mandal receives
 *  all its volunteers' birthdays/anniversaries; a Santo with two Mandals gets
 *  both. Timing ~5 AM IST."
 *
 * A Santo oversees one or more Mandals (the mandals ticked in the `programs`
 * field on their volunteer record — the same field that already decides which
 * birthday/anniversary emails a karyekar receives, and the only mandal field with
 * NO scope/roster side effects, so a Santo stays city-wide with no contact access).
 * Each morning this emails that Santo the day's birthdays and anniversaries of the
 * KARYEKARS whose OWN mandal is one of theirs.
 *
 * WHY "karyekars only". The ordinary birthday job (emailJobs.runBirthdaySummary)
 * covers every contact. This one is deliberately narrowed to volunteers — a
 * birthday contact counts only when a login is attached to them (its reverse link
 * `individuals.volunteerId`, or it is some active volunteer's `linkedIndividualId`).
 * A volunteer with no linked contact has no birth date stored anywhere and cannot
 * appear; that is a data limit, not a filter choice.
 *
 * READS. One settings read; it bails before anything else when the toggle is off.
 * Then buildBirthdayData's two single-field equality queries (today's dob / anniv
 * contacts — tiny) and, only when there IS someone today, one volunteers + one
 * roles read via annotateVolunteers (shared cost, same as every report job). One
 * mail doc per Santo who actually has someone to wish. Comfortably inside the
 * 50k-read / 20k-write day.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const {
  getEmailSettings, annotateVolunteers, queueMail, isDeliverable,
} = require('./lib/mailer');
const { buildBirthdayData, getMessageTemplates } = require('./lib/reportData');
const { buildBirthdayReport } = require('./lib/emailTemplates');
const { expandMandalGroups } = require('./lib/volunteerScope');
const { schedules } = require('./lib/scheduleConfig');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'us-central1';
// Asia/Kolkata so the cron fires at the stated 5 AM IST, not 5 AM UTC.
const SCHEDULE_OPTS = { region: REGION, timeZone: 'Asia/Kolkata', timeoutSeconds: 300, memory: '256MiB' };
const SANTO_BIRTHDAY_SCHEDULE = schedules.santoVolunteerBirthday || '7 5 * * *';

// A ceiling on how many Santos one run will mail, mirroring the other fan-outs —
// a guard against a misconfiguration turning every account into a recipient.
const MAX_SANTOS = 50;

/**
 * Is this volunteer a Santo (for the purpose of this report)? Mirrors the client
 * isSantoRole in src/constants/roleTemplates.js: the definitive signal is a
 * resolved scope of 'none', with the permission shape as the fallback for older
 * records that never stored a scopeKind. Never name-based — role names are free
 * text (see isSantoRole's own note).
 */
function isSantoVolunteer(v) {
  if (v.scopeKind === 'none') return true;
  const perms = Array.isArray(v.permissions) ? v.permissions : [];
  return perms.includes('view_padhramani')
    && !perms.includes('view_all_contacts')
    && !perms.includes('view_assigned_contacts')
    && !perms.includes('edit_contacts');
}

/**
 * runSantoVolunteerBirthday({ now, force })
 *
 * @param {boolean} [force] bypass the enable toggle (manual trigger / testing).
 * @returns a small summary: { skipped } | { sent: [...], checked }.
 */
async function runSantoVolunteerBirthday({ now = new Date(), force = false } = {}) {
  const settings = await getEmailSettings();
  if (!force && !settings.autoSantoVolunteerBirthdayEnabled) return { skipped: 'disabled' };

  // Cheapest signal first: is anyone's birthday/anniversary today at all?
  const templates = await getMessageTemplates();
  const data = await buildBirthdayData({ now, templates });
  if (!data.birthdays.length && !data.anniversaries.length) {
    return { sent: [], reason: 'nobody has a birthday or anniversary today' };
  }

  // One pass over the roster: it supplies BOTH the Santo recipients and the set of
  // which contacts are karyekars. requireDeliverableEmail:false so the karyekar set
  // is complete regardless of who has a reportEmail.
  const volunteers = await annotateVolunteers({ requireDeliverableEmail: false });

  // Contacts that a login is attached to — the "is this a volunteer" test.
  const volunteerIndividualIds = new Set(
    volunteers.map((v) => v.linkedIndividualId).filter(Boolean),
  );
  const isKaryekar = (entry) => Boolean(entry.volunteerId) || volunteerIndividualIds.has(entry.id);

  const volBirthdays = data.birthdays.filter(isKaryekar);
  const volAnniversaries = data.anniversaries.filter(isKaryekar);
  if (!volBirthdays.length && !volAnniversaries.length) {
    return { sent: [], reason: 'no karyekar birthdays or anniversaries today' };
  }

  // Santos who can actually receive: a deliverable reportEmail and at least one
  // mandal ticked (programs). Nothing sends to an unconfigured Santo.
  const santos = volunteers.filter((v) => isSantoVolunteer(v)
    && isDeliverable(v.email)
    && Array.isArray(v.programs) && v.programs.length);
  if (!santos.length) return { sent: [], reason: 'no Santo has both a report email and a mandal set' };

  const sent = [];
  for (const santo of santos.slice(0, MAX_SANTOS)) {
    // Bal ⇄ Sishu stay paired, matching every other mandal match in the app.
    const mandalSet = new Set(expandMandalGroups(santo.programs));
    const inScope = (entry) => entry.mandal && mandalSet.has(entry.mandal);

    const birthdays = volBirthdays.filter(inScope);
    const anniversaries = volAnniversaries.filter(inScope);
    if (!birthdays.length && !anniversaries.length) continue; // nobody in this Santo's mandal(s) today

    const { subject, html, text } = buildBirthdayReport(
      { birthdays, anniversaries, dateLabel: data.dateLabel },
      { forSanto: { name: santo.name, mandals: santo.programs } },
    );

    await queueMail({
      to: santo.email,
      subject,
      html,
      text,
      kind: 'santo-volunteer-birthday',
      meta: { santoId: santo.id, mandals: santo.programs, birthdays: birthdays.length, anniversaries: anniversaries.length },
      settings,
    });
    sent.push({ santoId: santo.id, to: santo.email, birthdays: birthdays.length, anniversaries: anniversaries.length });
  }

  console.log(`[santo-birthday] mailed ${sent.length} of ${santos.length} configured Santo(s).`);
  return { sent, checked: santos.length };
}

exports.scheduledSantoVolunteerBirthday = onSchedule(
  { ...SCHEDULE_OPTS, schedule: SANTO_BIRTHDAY_SCHEDULE },
  async () => { await runSantoVolunteerBirthday({ now: new Date() }); },
);

module.exports = {
  runSantoVolunteerBirthday,
  scheduledSantoVolunteerBirthday: exports.scheduledSantoVolunteerBirthday,
};
