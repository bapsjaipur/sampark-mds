// functions/whatsappCloud.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 36 — WhatsApp Cloud API sender (Meta Graph API).
//
// The wa.me links elsewhere in the app open WhatsApp with a pre-filled message
// for a HUMAN to press send. This is the other half the user asked for: a
// server-side sender that posts a message through Meta's WhatsApp Cloud API with
// no human in the loop, configured entirely from the admin panel — no token in
// source, no redeploy to change it.
//
// WHERE THE TOKEN LIVES. Meta's access token is a bearer credential: whoever has
// it can send from the temple's number. It must never reach a browser, so it is
// NOT stored under settings/{docId} (those are world- or send_emails-readable —
// see firestore.rules). It lives in whatsappConfig/cloud, a collection closed to
// every client (allow read, write: if false); only these callables, through the
// Admin SDK, ever read it. getWhatsAppCloudStatus reports whether a token is set,
// never the token itself.
//
// This is a deliberate trade-off: a Firebase secret (defineSecret) is the more
// secure home, but a secret changes only with a redeploy, and the user asked to
// "control all from the admin dashboard, no need to hardcode". A server-only
// Firestore doc is the pragmatic middle — dashboard-editable, never client-read.
//
// GUARDED BY DEFAULT. With nothing configured, sendWhatsAppCloudMessage returns
// { skipped: 'not-configured' } rather than throwing, so callers (a future
// birthday job) can call it unconditionally and simply do nothing until an admin
// fills in the token and ticks "enabled".
// ─────────────────────────────────────────────────────────────────────────────
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { permissionsForVolunteer } = require('./lib/callerAccess');
const { normalizePhone } = require('./lib/wa');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const CONFIG_DOC = 'whatsappConfig/cloud';
const DEFAULT_API_VERSION = 'v21.0';

// ── auth helpers ─────────────────────────────────────────────────────────────

async function callerPermissions(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const volDoc = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!volDoc.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  return permissionsForVolunteer(db, volDoc.data());
}

function requireAny(permissions, needed, label) {
  if (!needed.some((p) => permissions.includes(p))) {
    throw new HttpsError('permission-denied', `Missing ${label}.`);
  }
}

// ── config ───────────────────────────────────────────────────────────────────

async function readConfig() {
  const snap = await db.doc(CONFIG_DOC).get();
  const d = snap.exists ? snap.data() : {};
  return {
    enabled: !!d.enabled,
    accessToken: String(d.accessToken || ''),
    phoneNumberId: String(d.phoneNumberId || ''),
    apiVersion: String(d.apiVersion || DEFAULT_API_VERSION),
  };
}

/** True only when a send could actually go out. */
function isSendable(cfg) {
  return cfg.enabled && !!cfg.accessToken && !!cfg.phoneNumberId;
}

// ── the actual Graph API call ──────────────────────────────────────────────────
// node 22 ships a global fetch, so no dependency is added for this.

async function postToGraph(cfg, toE164, text) {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toE164,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  });

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    // Meta nests the human-readable reason under error.message.
    const msg = json?.error?.message || `Graph API returned ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.graph = json?.error || null;
    throw err;
  }
  return json?.messages?.[0]?.id || null;
}

// ── callables ──────────────────────────────────────────────────────────────────

/**
 * getWhatsAppCloudStatus() → { configured, enabled, phoneNumberId, apiVersion, tokenSet }
 * Never returns the token. `configured` = a token AND a phone number id are set.
 */
exports.getWhatsAppCloudStatus = onCall({ region: REGION }, async (request) => {
  const permissions = await callerPermissions(request);
  requireAny(permissions, ['send_emails', 'manage_templates', 'manage_users'], 'permission to view messaging settings');
  const cfg = await readConfig();
  return {
    configured: !!cfg.accessToken && !!cfg.phoneNumberId,
    enabled: cfg.enabled,
    phoneNumberId: cfg.phoneNumberId,
    apiVersion: cfg.apiVersion,
    tokenSet: !!cfg.accessToken,
  };
});

/**
 * saveWhatsAppCloudConfig({ enabled, phoneNumberId, apiVersion, accessToken? })
 * A blank/omitted accessToken keeps the one already stored, so the panel can
 * toggle `enabled` or fix the phone id without re-typing the secret. Sending an
 * explicit empty string via `clearToken:true` wipes it.
 */
exports.saveWhatsAppCloudConfig = onCall({ region: REGION }, async (request) => {
  const permissions = await callerPermissions(request);
  requireAny(permissions, ['manage_templates'], 'the “Manage Message Templates & Email Settings” permission');

  const data = request.data || {};
  const patch = {
    enabled: !!data.enabled,
    phoneNumberId: String(data.phoneNumberId || '').trim(),
    apiVersion: String(data.apiVersion || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
  };

  if (data.clearToken) {
    patch.accessToken = '';
  } else {
    const token = String(data.accessToken || '').trim();
    if (token) patch.accessToken = token; // otherwise leave the stored one intact
  }

  await db.doc(CONFIG_DOC).set(patch, { merge: true });
  const cfg = await readConfig();
  return { ok: true, configured: !!cfg.accessToken && !!cfg.phoneNumberId, enabled: cfg.enabled, tokenSet: !!cfg.accessToken };
});

/**
 * sendWhatsAppCloudMessage({ to, text }) → { ok, id } | { skipped }
 *
 * `to` may be in any format — it is normalised to a 10-digit Indian number and
 * sent as 91XXXXXXXXXX. Returns { skipped:'not-configured' } (not an error) when
 * the integration is off, so a scheduled caller can fire it blindly.
 *
 * NOTE: WhatsApp only delivers a free-form text like this inside the 24-hour
 * customer-service window (i.e. after the person has messaged the number). For
 * unsolicited wishes Meta requires a pre-approved message TEMPLATE; wiring that
 * in is the follow-up once a template is approved in the Meta dashboard.
 */
exports.sendWhatsAppCloudMessage = onCall({ region: REGION }, async (request) => {
  const permissions = await callerPermissions(request);
  requireAny(permissions, ['send_emails', 'manage_templates'], 'permission to send messages');

  const { to, text } = request.data || {};
  const body = String(text || '').trim();
  if (!body) throw new HttpsError('invalid-argument', 'A message body is required.');

  const local = normalizePhone(to);
  if (!local) throw new HttpsError('invalid-argument', 'A valid 10-digit mobile number is required.');
  const toE164 = `91${local}`;

  const cfg = await readConfig();
  if (!isSendable(cfg)) return { skipped: 'not-configured' };

  try {
    const id = await postToGraph(cfg, toE164, body);
    return { ok: true, id };
  } catch (err) {
    // Surface Meta's own reason to the caller — a bad token or an unregistered
    // number is something the admin fixes in the Meta dashboard, not here.
    throw new HttpsError('failed-precondition', err.message || 'WhatsApp send failed.');
  }
});
