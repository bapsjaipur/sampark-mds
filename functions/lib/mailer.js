/**
 * functions/lib/mailer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 20 — email transport + recipient resolution.
 *
 * The legacy Sevak Call app sent mail with MailApp.sendEmail() straight out of
 * Apps Script, using the script owner's Gmail quota. There is no equivalent in
 * Cloud Functions, so mail here is handed to the Firebase "Trigger Email from
 * Firestore" extension: writing a document to mail/{id} makes the extension
 * deliver it through the configured SMTP account and stamp the result back onto
 * the same document (`delivery.state`).
 *
 * That means this file never talks to an SMTP server itself — it writes
 * documents. Two consequences worth knowing:
 *   • Nothing here can tell you a message was *delivered*, only that it was
 *     queued. Delivery state lands on the mail doc afterwards; emailLogs rows
 *     carry the mail doc id so the two can be joined.
 *   • If the extension isn't installed the writes still succeed and nothing is
 *     sent. queueMail therefore always writes an emailLogs row, so the admin
 *     screen shows "queued, never delivered" rather than silence.
 *
 * RECIPIENT ADDRESSES: volunteers/{uid} has no login email — auth uses a
 * synthetic <10-digit-phone>@baps-jaipur-mds.local address that no mail server
 * will accept. Report recipients come from a separate, genuinely deliverable
 * `reportEmail` field on the volunteer doc, plus an explicit
 * settings/email.extraRecipients[] list for people (a sanchalak, an accountant)
 * who need the reports without holding a login at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');
const { volunteerRoleIds } = require('./callerAccess');
const { resolveScope, expandMandalGroups } = require('./volunteerScope');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const MAIL_COLLECTION = 'mail';
const LOG_COLLECTION = 'emailLogs';
const SETTINGS_COLLECTION = 'settings';

// ─── Document size guard ─────────────────────────────────────────────────────
// A mail/{id} document carries the whole message — HTML body, plain-text
// alternative AND every attachment base64'd inline — and Firestore refuses any
// document over 1,048,576 bytes. Nothing checked, so an oversized report threw
// INVALID_ARGUMENT out of mailRef.set() and the caller's error path took over:
// for the post-sabha job that means releaseEvent(), a retry on the next 15-minute
// tick, three attempts, then permanent abandonment — the report is LOST, not
// merely unattached. Which is precisely the outcome the report exists to avoid.
//
// So the size is checked before writing and the message is degraded, in order of
// least to most damaging: drop the attachments first (the same numbers are in
// the HTML), and only if it is still too big replace the body with a short notice
// plus as much of the plain-text version as fits. Truncating plain text is safe;
// truncating HTML mid-tag is not, which is why the HTML is replaced rather than cut.
const FIRESTORE_DOC_LIMIT = 1048576;

// A budget, not the limit. JSON.stringify does not account for field names, the
// document's own key paths or Firestore's per-field overhead, and the same body
// is about to be described in an emailLogs row too. ~150KB of headroom.
const MAIL_DOC_BUDGET = 900 * 1024;

/** How much of the text alternative to keep when the body has to be replaced. */
const SALVAGED_TEXT_BYTES = 64 * 1024;

function approxDocBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Mirror of DEFAULT_EMAIL_SETTINGS in src/services/settingsService.js.
 * Duplicated deliberately: functions/ and src/ are separate npm packages with
 * separate module systems (CommonJS vs ESM) and no shared build step, so there
 * is nowhere to put one copy. KEEP THE TWO IN SYNC.
 */
const DEFAULT_EMAIL_SETTINGS = {
  autoDailyAdminEnabled: true,
  autoDailyVolunteerEnabled: false,
  autoPostSabhaAdminEnabled: true,
  autoPostSabhaVolunteerEnabled: false,
  // PHASE 38 — the per-karyakarta batch follow-up list. Default OFF: it mails one
  // message per karyakarta rather than one per sabha, so it should be switched on
  // deliberately once reportEmail is filled in for the SK-YM role.
  autoSkBatchReportsEnabled: false,
  autoBirthdayEnabled: true,
  // PHASE 44 — the per-volunteer birthday/anniversary copy, scoped to each
  // karyakar's assigned area/mandal. Default OFF: switch on once mandal heads
  // have a reportEmail, exactly like the other per-volunteer fan-outs.
  autoBirthdayVolunteerEnabled: false,
  // PHASE 50 — the Santo copy: at ~5 AM IST, each Santo gets the day's birthdays
  // and anniversaries of the KARYEKARS in the mandal(s) ticked on their record.
  // Off by default; inert until a Santo has both a reportEmail and mandal(s), so
  // turning it on cannot surprise anyone. KEEP IN SYNC with the mirror in
  // src/services/settingsService.js.
  autoSantoVolunteerBirthdayEnabled: false,
  // PHASE 33 — the weekly sabha coverage digest.
  autoSabhaDigestEnabled: true,
  autoSabhaDigestVolunteerEnabled: false,
  senderName: 'BAPS Jaipur MDS',
  fromAddress: '',
  dryRun: false,
  maxRecipients: 50,
  extraRecipients: [],
  // PHASE 34 — cron strings edited from the Report Emails tab. Runtime code here
  // does NOT use these to decide when to fire (the schedule is fixed at deploy —
  // see lib/scheduleConfig.js); they live in settings/email only so the panel can
  // read and write them, and pull-schedules.js can copy them into the deploy.
  // KEEP IN SYNC with src/services/settingsService.js and lib/scheduleConfig.js.
  scheduleDailyCron: '5 22 * * *',
  schedulePostSabhaCron: '*/30 * * * *',
  scheduleBirthdayCron: '10 6 * * *',
  scheduleSabhaDigestCron: '12 7 * * 1',
  scheduleSabhaGenerationCron: '7 4 * * 0',
  // PHASE 35 — the calendar-feed dataset rebuild. See functions/calendarSync.js.
  scheduleCalendarRebuildCron: '40 3 * * *',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The synthetic auth domain — an address ending in this is a login, not a mailbox. */
const SYNTHETIC_DOMAIN = 'baps-jaipur-mds.local';

function isDeliverable(address) {
  const a = String(address || '').trim().toLowerCase();
  if (!a || !EMAIL_RE.test(a)) return false;
  return !a.endsWith(`@${SYNTHETIC_DOMAIN}`);
}

async function getEmailSettings() {
  try {
    const snap = await db.collection(SETTINGS_COLLECTION).doc('email').get();
    const data = snap.exists ? snap.data() : {};
    return { ...DEFAULT_EMAIL_SETTINGS, ...data };
  } catch (err) {
    console.error('[mailer] could not read settings/email, using defaults:', err.message);
    return { ...DEFAULT_EMAIL_SETTINGS };
  }
}

/** roleId -> permissions[] for every role, fetched once per job run. */
async function loadRolePermissions() {
  const snap = await db.collection('roles').get();
  const map = {};
  snap.forEach((d) => { map[d.id] = (d.data().permissions || []); });
  return map;
}

/**
 * Every volunteer with a deliverable reportEmail, annotated with the
 * permissions their role(s) grant. Used both for "who gets the admin digest" and
 * "which volunteer gets their own numbers".
 *
 * PHASE 21 ROLES, PHASE 33 FIX. This read `rolePerms[v.roleRef]` — the single
 * legacy field — while every callable resolved permissions as the UNION across
 * `roleRefs[]` (lib/callerAccess.js). A volunteer whose send_emails came from
 * the SECOND entry of roleRefs[] therefore resolved to permissions:[] here and
 * silently received nothing, forever, with no error anywhere: the recipient list
 * simply came back one name short and the missing person had no way to notice
 * except by never getting an email. `roleRef` stays as the pre-Phase-21
 * fallback, which is exactly what volunteerRoleIds() encodes.
 *
 * @returns {Promise<Array<{id, name, email, mobile, permissions, roles,
 *   assignedAreas, assignedMandals, scopeKind, program, programs}>>}
 */
async function loadMailableVolunteers() {
  return annotateVolunteers({ requireDeliverableEmail: true });
}

/**
 * PHASE 48 — the shared half of both loaders.
 *
 * The notification fan-out (functions/lib/notify.js) needs the SAME annotated
 * volunteer list as the mailer, differing in exactly one respect: it must not
 * require a deliverable reportEmail, because an in-app bell reaches everyone with
 * a login whether or not anybody has typed an address onto their record. Rather
 * than copy the role-union / scope-annotation loop into a second file (where the
 * two would drift the first time a field is added), the pass lives here once and
 * both entry points call it.
 *
 * @param {object}  opts
 * @param {boolean} opts.requireDeliverableEmail  true for the mailer (only people
 *   who can actually be posted to), false for the notifier (any active volunteer).
 */
async function annotateVolunteers({ requireDeliverableEmail } = {}) {
  const [vSnap, rolesSnap] = await Promise.all([
    db.collection('volunteers').get(),
    db.collection('roles').get(),
  ]);

  const roleDocs = {};
  rolesSnap.forEach((d) => { roleDocs[d.id] = { id: d.id, ...d.data() }; });

  const out = [];
  vSnap.forEach((d) => {
    const v = d.data();
    if (v.isActive === false) return;
    // PHASE 51 — per-volunteer "receive report emails" switch. OFF keeps the login
    // and the address on file but stops ALL automated reports, by treating the
    // address as undeliverable HERE — the one place every report job resolves its
    // recipients from. Default ON (undefined/true), so existing volunteers are
    // unaffected. The in-app bell path (requireDeliverableEmail:false) still
    // includes them: it reaches people by uid, not email, and is never gated on this.
    const email = v.reportEmailEnabled === false
      ? ''
      : (isDeliverable(v.reportEmail) ? String(v.reportEmail).trim() : '');
    if (requireDeliverableEmail && !email) return;

    const roles = volunteerRoleIds(v).map((id) => roleDocs[id]).filter(Boolean);
    const permissions = [...new Set(roles.flatMap((r) => (Array.isArray(r.permissions) ? r.permissions : [])))];

    out.push({
      id: d.id,
      name: v.name || 'Volunteer',
      email,
      mobile: v.mobile || '',
      permissions,
      // The role DOCUMENTS, not just their ids — the sabha digest needs
      // scopeKind/scopeKindChosen off them to work out whose sabhas are whose.
      roles,
      assignedAreas: Array.isArray(v.assignedAreas) ? v.assignedAreas : [],
      assignedMandals: Array.isArray(v.assignedMandals) ? v.assignedMandals : [],
      scopeKind: typeof v.scopeKind === 'string' ? v.scopeKind : null,
      // PHASE 45 — which wing ('Yuvak' | 'Bal Mandal') this person works in.
      // Already on the document we just read, so it costs no extra reads. The
      // per-recipient report copies use it to stop a Yuvak-wing area coordinator
      // being mailed every Bal Mandal sabha (and vice versa). See
      // programCoversMandal() in volunteerScope.js.
      program: typeof v.program === 'string' ? v.program : null,
      // PHASE 47 — the explicit list of mandals this person works with (the
      // multi-select successor to `program`). Rides on the same document, so no
      // extra reads. programsCoverMandal() routes each birthday/sabha copy by it,
      // falling back to the binary `program` above when it is absent.
      programs: Array.isArray(v.programs)
        ? v.programs.filter((x) => typeof x === 'string' && x)
        : null,
      // Phase 50: the contact this login is attached to, if any. The Santo
      // volunteer-birthday report uses it to tell which of today's birthday
      // contacts are actually karyekars. Already on the document — no extra read.
      linkedIndividualId: v.linkedIndividualId || null,
    });
  });
  return out;
}

/**
 * Addresses for the admin-facing digests: anyone whose role grants
 * `send_emails`, plus settings/email.extraRecipients.
 *
 * `send_emails` doubles as "receives report emails" — the permission label in
 * src/constants/permissions.js says so. One permission for both directions
 * keeps the matrix honest: if you can trigger a report you can also see it.
 *
 * @param {object} settings  settings/email (loaded if omitted).
 * @param {object} [opts]
 * @param {Array}  [opts.volunteers]  a pre-loaded loadMailableVolunteers()
 *   result to reuse, so a caller that already has the list does not read the
 *   volunteers + roles collections a second time.
 * @param {Set|Array} [opts.excludeEmails]  lowercased addresses to drop from the
 *   send_emails audience. The birthday job uses it to keep a mandal/area-scoped
 *   karyakar who receives their OWN scoped copy off the whole-city combined copy.
 *   extraRecipients are NEVER excluded — they are the explicit city-wide list.
 */
async function resolveReportRecipients(settings, { volunteers = null, excludeEmails = null } = {}) {
  const s = settings || (await getEmailSettings());
  const vols = volunteers || (await loadMailableVolunteers());
  const exclude = excludeEmails instanceof Set
    ? excludeEmails
    : new Set((Array.isArray(excludeEmails) ? excludeEmails : []).map((a) => String(a || '').toLowerCase()));

  const addresses = new Map(); // lowercased address -> display name
  vols
    .filter((v) => v.email && v.permissions.includes('send_emails'))
    .forEach((v) => {
      const key = v.email.toLowerCase();
      if (exclude.has(key)) return;
      addresses.set(key, v.name);
    });

  (Array.isArray(s.extraRecipients) ? s.extraRecipients : [])
    .map((a) => String(a || '').trim())
    .filter(isDeliverable)
    .forEach((a) => { if (!addresses.has(a.toLowerCase())) addresses.set(a.toLowerCase(), a); });

  return [...addresses.keys()];
}

/**
 * resolveReportAudience(settings, { permission, volunteers, excludeEmails }) — the
 * PHASE 52 recipient resolver. Replaces "everyone with send_emails gets the
 * whole-city copy" with "everyone whose role holds `permission`, each delivered a
 * copy scoped to THEIR mandal(s)".
 *
 * Returns an array of buckets: `[{ mandals, emails }]`.
 *   • `mandals: null`  → the city-wide bucket (unrestricted recipients +
 *                        extraRecipients). The caller builds the FULL report.
 *   • `mandals: [..]`  → a scoped bucket; the caller builds a copy filtered to
 *                        exactly those mandal names. One bucket per distinct
 *                        mandal-set in use, so N heads of the same mandal are one
 *                        build and one send.
 *
 * A recipient is unrestricted when resolveScope says so (Admin / view_all). A
 * scoped recipient's mandal set is their Programmes (`programs`), expanded for
 * Bal⇄Sishu; a scoped recipient with NO programmes is dropped — there is nothing
 * to scope the report to, and sending them the whole city is the bug this fixes.
 *
 * @param {object} settings  settings/email.
 * @param {object} p
 * @param {string} p.permission  the receive_* permission to gate on.
 * @param {Array}  [p.volunteers]  pre-loaded loadMailableVolunteers() to reuse.
 * @param {Set|Array} [p.excludeEmails]  lowercased addresses to drop (e.g. people
 *   who already got a per-volunteer self-copy), so nobody is mailed twice.
 */
async function resolveReportAudience(settings, { permission, volunteers = null, excludeEmails = null } = {}) {
  const s = settings || (await getEmailSettings());
  const vols = volunteers || (await loadMailableVolunteers());
  const exclude = excludeEmails instanceof Set
    ? excludeEmails
    : new Set((Array.isArray(excludeEmails) ? excludeEmails : []).map((a) => String(a || '').toLowerCase()));

  const cityWide = new Set();          // lowercased address
  const byMandalKey = new Map();       // key -> { mandals:[], emails:Set }

  vols.forEach((v) => {
    if (!v.email || !v.permissions.includes(permission)) return;
    const key = v.email.toLowerCase();
    if (exclude.has(key)) return;
    const scope = resolveScope({ volunteer: v, roles: v.roles, permissions: v.permissions });
    if (scope.unrestricted) { cityWide.add(key); return; }
    const mandals = expandMandalGroups(Array.isArray(v.programs) ? v.programs.filter(Boolean) : []);
    if (!mandals.length) return; // scoped recipient with no Programmes → nothing to scope to
    const bucketKey = mandals.map((m) => String(m).toLowerCase()).sort().join('|');
    if (!byMandalKey.has(bucketKey)) byMandalKey.set(bucketKey, { mandals, emails: new Set() });
    byMandalKey.get(bucketKey).emails.add(key);
  });

  // extraRecipients are external addresses with no scope — always city-wide.
  (Array.isArray(s.extraRecipients) ? s.extraRecipients : [])
    .map((a) => String(a || '').trim())
    .filter(isDeliverable)
    .forEach((a) => { const k = a.toLowerCase(); if (!exclude.has(k)) cityWide.add(k); });

  const buckets = [];
  if (cityWide.size) buckets.push({ mandals: null, emails: [...cityWide] });
  byMandalKey.forEach((b) => buckets.push({ mandals: b.mandals, emails: [...b.emails] }));
  return buckets;
}

/**
 * queueMail({ to, subject, html, text, attachments, kind, meta })
 *
 * Writes one mail/{id} document (unless dryRun) and always one emailLogs/{id}
 * row. `to` is capped at settings.maxRecipients — a runaway loop that tries to
 * mail 1200 contacts should be truncated and logged, not sent.
 *
 * @returns {Promise<{queued:boolean, skipped?:string, mailId?:string, logId:string, recipients:string[], truncated:number}>}
 */
async function queueMail({ to, subject, html, text, attachments, kind = 'manual', meta = {}, settings }) {
  const s = settings || (await getEmailSettings());

  const clean = [...new Set(
    (Array.isArray(to) ? to : [to])
      .map((a) => String(a || '').trim())
      .filter(isDeliverable)
      .map((a) => a.toLowerCase()),
  )];

  const cap = Number(s.maxRecipients) > 0 ? Number(s.maxRecipients) : DEFAULT_EMAIL_SETTINGS.maxRecipients;
  const recipients = clean.slice(0, cap);
  const truncated = clean.length - recipients.length;
  if (truncated > 0) {
    console.warn(`[mailer] ${kind}: ${clean.length} recipients exceeded maxRecipients=${cap}; dropped ${truncated}.`);
  }

  const logRef = db.collection(LOG_COLLECTION).doc();
  const baseLog = {
    kind,
    subject: subject || '',
    recipients,
    recipientCount: recipients.length,
    truncated,
    attachmentCount: (attachments || []).length,
    dryRun: !!s.dryRun,
    meta,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (recipients.length === 0) {
    await logRef.set({ ...baseLog, status: 'skipped', reason: 'no-deliverable-recipients' });
    console.warn(`[mailer] ${kind}: nothing sent — no deliverable recipient addresses.`);
    return { queued: false, skipped: 'no-recipients', logId: logRef.id, recipients, truncated };
  }

  if (s.dryRun) {
    await logRef.set({ ...baseLog, status: 'dry-run', reason: 'dryRun enabled in settings/email' });
    console.log(`[mailer] DRY RUN ${kind} -> ${recipients.join(', ')} :: ${subject}`);
    return { queued: false, skipped: 'dry-run', logId: logRef.id, recipients, truncated };
  }

  const message = { subject: subject || '(no subject)', html: html || '' };
  if (text) message.text = text;
  if (attachments && attachments.length) message.attachments = attachments.filter(Boolean);

  const mailDoc = { to: recipients, message };
  // The extension falls back to its own configured default sender when `from`
  // is absent, which is the safer default — a wrong From is a hard SMTP reject.
  if (isDeliverable(s.fromAddress)) {
    mailDoc.from = s.senderName ? `${s.senderName} <${s.fromAddress}>` : s.fromAddress;
  }

  // ── Keep the write under the document limit — see the note at the top. ─────
  let attachmentsDropped = 0;
  let bodyReplaced = false;

  if (approxDocBytes(mailDoc) > MAIL_DOC_BUDGET && message.attachments?.length) {
    attachmentsDropped = message.attachments.length;
    delete message.attachments;
    console.warn(
      `[mailer] ${kind}: message exceeded ${Math.round(MAIL_DOC_BUDGET / 1024)}KB — `
      + `dropped ${attachmentsDropped} attachment(s). The figures are still in the email body.`,
    );
  }

  if (approxDocBytes(mailDoc) > MAIL_DOC_BUDGET) {
    bodyReplaced = true;
    const salvaged = Buffer.from(String(text || ''), 'utf8')
      .subarray(0, SALVAGED_TEXT_BYTES).toString('utf8');
    console.error(
      `[mailer] ${kind}: the body alone is over ${Math.round(MAIL_DOC_BUDGET / 1024)}KB `
      + `(Firestore's document limit is ${Math.round(FIRESTORE_DOC_LIMIT / 1024)}KB). `
      + 'Sending a short notice instead of the full report — check the report query for a runaway result set.',
    );
    message.html = '<p style="font-family:sans-serif;font-size:14px">'
      + 'This report was too large to send by email. Open <strong>BAPS Jaipur MDS</strong> to see the full figures.'
      + '</p>'
      + (salvaged ? `<pre style="font-family:monospace;font-size:12px;white-space:pre-wrap">${escapeHtml(salvaged)}</pre>` : '');
    message.text = salvaged
      ? `This report was too large to send in full. The first part follows.\n\n${salvaged}`
      : 'This report was too large to send by email. Open BAPS Jaipur MDS to see the figures.';
  }

  const mailRef = db.collection(MAIL_COLLECTION).doc();
  await mailRef.set(mailDoc);
  await logRef.set({
    ...baseLog,
    status: 'queued',
    mailId: mailRef.id,
    attachmentCount: (message.attachments || []).length,
    attachmentsDropped,
    bodyReplaced,
  });

  console.log(`[mailer] queued ${kind} -> ${recipients.length} recipient(s) as mail/${mailRef.id}`);
  return {
    queued: true, mailId: mailRef.id, logId: logRef.id, recipients, truncated,
    attachmentsDropped, bodyReplaced,
  };
}

module.exports = {
  DEFAULT_EMAIL_SETTINGS,
  MAIL_COLLECTION,
  LOG_COLLECTION,
  getEmailSettings,
  isDeliverable,
  loadMailableVolunteers,
  // PHASE 48 — the same pass without the "has a reportEmail" filter, so the
  // in-app notifier (lib/notify.js) can reach every active volunteer.
  annotateVolunteers,
  loadRolePermissions,
  resolveReportRecipients,
  resolveReportAudience,
  queueMail,
  db,
};
