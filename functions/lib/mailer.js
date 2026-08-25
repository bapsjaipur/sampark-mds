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
  autoBirthdayEnabled: true,
  senderName: 'BAPS Jaipur MDS',
  fromAddress: '',
  dryRun: false,
  maxRecipients: 50,
  extraRecipients: [],
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
 * permissions their role grants. Used both for "who gets the admin digest" and
 * "which volunteer gets their own numbers".
 *
 * @returns {Promise<Array<{id, name, email, mobile, permissions, assignedAreas}>>}
 */
async function loadMailableVolunteers() {
  const [vSnap, rolePerms] = await Promise.all([
    db.collection('volunteers').get(),
    loadRolePermissions(),
  ]);

  const out = [];
  vSnap.forEach((d) => {
    const v = d.data();
    if (v.isActive === false) return;
    if (!isDeliverable(v.reportEmail)) return;
    out.push({
      id: d.id,
      name: v.name || 'Volunteer',
      email: String(v.reportEmail).trim(),
      mobile: v.mobile || '',
      permissions: rolePerms[v.roleRef] || [],
      assignedAreas: Array.isArray(v.assignedAreas) ? v.assignedAreas : [],
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
 */
async function resolveReportRecipients(settings) {
  const s = settings || (await getEmailSettings());
  const volunteers = await loadMailableVolunteers();

  const addresses = new Map(); // lowercased address -> display name
  volunteers
    .filter((v) => v.permissions.includes('send_emails'))
    .forEach((v) => addresses.set(v.email.toLowerCase(), v.name));

  (Array.isArray(s.extraRecipients) ? s.extraRecipients : [])
    .map((a) => String(a || '').trim())
    .filter(isDeliverable)
    .forEach((a) => { if (!addresses.has(a.toLowerCase())) addresses.set(a.toLowerCase(), a); });

  return [...addresses.keys()];
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
  loadRolePermissions,
  resolveReportRecipients,
  queueMail,
  db,
};
