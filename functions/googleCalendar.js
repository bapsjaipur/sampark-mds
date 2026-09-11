// functions/googleCalendar.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 37 — per-user Google Calendar push (OAuth 2.0), the "instant, two-way"
// upgrade over the read-only ICS feed in calendarSync.js.
//
// WHAT IT ADDS OVER THE ICS FEED. The subscribable feed (Phase 35) already puts
// every in-scope birthday into a volunteer's Google/Apple Calendar with zero
// setup — but it is read-only and Google only re-fetches it every ~8–24h. This
// path writes events straight into the volunteer's OWN Google Calendar via the
// API, so a "Sync now" is instant and the events are real editable entries. It is
// the heavier option the user picked for "per-user later"; the ICS feed remains
// the no-setup default.
//
// IDEMPOTENT BY EVENT ID. Each event is written with a deterministic id derived
// from the contact id and type (birthday/anniversary), so a re-sync UPDATES the
// same event instead of duplicating it — editing a DOB then syncing moves the
// existing event, matching the "re-sync, don't create again" requirement.
//
// ── SETUP THE ADMIN MUST DO ONCE (there is no way around this for OAuth) ──
//   1. Google Cloud console → APIs & Services → Credentials → create an OAuth
//      2.0 Client ID of type "Web application".
//   2. Add this authorised redirect URI (exactly):
//        https://us-central1-<project>.cloudfunctions.net/googleOAuthCallback
//   3. Enable the "Google Calendar API" for the project.
//   4. Paste the Client ID + Client Secret into the admin panel (saveGoogle
//      CalendarConfig) and tick "enabled".
// Until that is done every function here is a guarded no-op: status reports
// `configured:false` and nothing throws.
//
// SECRET STORAGE. Client secret and each volunteer's refresh token are bearer
// credentials and never touch a browser: they live in googleCalendarConfig/config
// and googleCalendarTokens/{volunteerId}, both closed to all clients in
// firestore.rules (allow read, write: if false) and reached only by these
// callables through the Admin SDK. Status/among calls never return the secret or
// the refresh token.
// ─────────────────────────────────────────────────────────────────────────────
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const { matchesScope } = require('./lib/volunteerScope');
const calendar = require('./calendarSync');

const { loadDataset, buildCalendarDataset, scopeForVolunteer, anchorDate, locationLine } = calendar._internal;

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const CONFIG_DOC = 'googleCalendarConfig/config';
const TOKEN_COLLECTION = 'googleCalendarTokens';
const STATE_COLLECTION = 'googleOAuthStates';

// Manage the user's own events + read their email for display. calendar.events is
// the narrowest scope that can create/update events; we never read other calendars.
const OAUTH_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'];
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const CAL_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// A single manual sync writes at most this many events, so a huge (admin-wide)
// scope can't run the callable past its timeout or hammer the Calendar API. The
// ICS feed has no such limit and is the right tool for very large scopes.
const MAX_EVENTS_PER_SYNC = 300;

function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'baps-jaipur-mds';
}

function redirectUri() {
  return `https://${REGION}-${projectId()}.cloudfunctions.net/googleOAuthCallback`;
}

// ── config / auth helpers ──────────────────────────────────────────────────────

async function readConfig() {
  const snap = await db.doc(CONFIG_DOC).get();
  const d = snap.exists ? snap.data() : {};
  return {
    enabled: !!d.enabled,
    clientId: String(d.clientId || ''),
    clientSecret: String(d.clientSecret || ''),
  };
}

function isConfigured(cfg) {
  return !!cfg.clientId && !!cfg.clientSecret;
}

async function requireVolunteer(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const vSnap = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!vSnap.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  return { id: vSnap.id, ...vSnap.data() };
}

async function permissionsFor(volunteerData) {
  const { permissionsForVolunteer } = require('./lib/callerAccess');
  return permissionsForVolunteer(db, volunteerData);
}

/** Exchange a refresh token for a short-lived access token. */
async function accessTokenFromRefresh(cfg, refreshToken) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `token endpoint returned ${res.status}`;
    const err = new Error(msg);
    err.revoked = json?.error === 'invalid_grant'; // the user removed our access
    throw err;
  }
  return json.access_token;
}

// ── event shaping ──────────────────────────────────────────────────────────────

// Google Calendar event ids must be base32hex (chars 0-9 a-v), length 5–1024. A
// SHA-1 hex digest uses only 0-9a-f, which is a subset, so it is already legal;
// prefixing with a type marker keeps birthday and anniversary ids distinct and
// stable per contact — that stability is what makes a re-sync update in place.
function eventId(kind, contactId) {
  const h = crypto.createHash('sha1').update(String(contactId)).digest('hex');
  return `baps${kind === 'dob' ? 'b' : 'a'}${h}`;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD' and the exclusive all-day end (next day). */
function dateParts(anchor) {
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(4, 6));
  const d = Number(anchor.slice(6, 8));
  const start = `${anchor.slice(0, 4)}-${anchor.slice(4, 6)}-${anchor.slice(6, 8)}`;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const z = (n) => String(n).padStart(2, '0');
  const end = `${next.getUTCFullYear()}-${z(next.getUTCMonth() + 1)}-${z(next.getUTCDate())}`;
  return { start, end };
}

function eventBody(kind, entry, curYear) {
  const anchor = anchorDate(entry.monthDay, entry.fullDate, curYear);
  if (!anchor) return null;
  const { start, end } = dateParts(anchor);
  const emoji = kind === 'dob' ? '🎂' : '💐';
  const label = kind === 'dob' ? 'Birthday' : 'Anniversary';
  const descLines = [
    locationLine(entry.mandal, entry.area),
    entry.waUrl ? `WhatsApp wishes: ${entry.waUrl}` : '',
    'Synced from BAPS Jaipur MDS',
  ].filter(Boolean);
  return {
    id: eventId(kind, entry.id),
    summary: `${emoji} ${entry.name} — ${label}`,
    start: { date: start },
    end: { date: end },
    recurrence: ['RRULE:FREQ=YEARLY'],
    transparency: 'transparent',
    description: descLines.join('\n'),
  };
}

/**
 * Upsert one event: PUT (update) by id, and if it does not exist yet (404), POST
 * (insert) it with that id. Returns 'ok' or throws for a real error. A 409 on
 * insert means a race created it — treat as success.
 */
async function upsertEvent(accessToken, body) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const put = await fetch(`${CAL_EVENTS}/${body.id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (put.ok) return 'updated';
  if (put.status === 404) {
    const post = await fetch(CAL_EVENTS, { method: 'POST', headers, body: JSON.stringify(body) });
    if (post.ok || post.status === 409) return 'created';
    const j = await post.json().catch(() => null);
    throw new Error(j?.error?.message || `insert failed (${post.status})`);
  }
  const j = await put.json().catch(() => null);
  throw new Error(j?.error?.message || `update failed (${put.status})`);
}

// ── callables ──────────────────────────────────────────────────────────────────

/** getGoogleCalendarStatus() → per-caller connection + project config state. */
exports.getGoogleCalendarStatus = onCall({ region: REGION }, async (request) => {
  const volunteer = await requireVolunteer(request);
  const cfg = await readConfig();
  const tokenSnap = await db.collection(TOKEN_COLLECTION).doc(volunteer.id).get();
  const t = tokenSnap.exists ? tokenSnap.data() : null;
  return {
    configured: isConfigured(cfg),
    enabled: cfg.enabled,
    clientId: cfg.clientId, // NOT a secret — it travels in the consent URL; the admin needs to see the saved value
    connected: !!(t && t.refreshToken),
    email: t?.email || '',
    lastSyncAt: t?.lastSyncAt ? t.lastSyncAt.toDate().toISOString() : null,
    lastSyncCount: t?.lastSyncCount ?? null,
    redirectUri: redirectUri(), // shown in the panel so the admin registers the exact URI
  };
});

/**
 * saveGoogleCalendarConfig({ enabled, clientId, clientSecret? })
 * Blank clientSecret keeps the stored one; clearSecret:true wipes it.
 */
exports.saveGoogleCalendarConfig = onCall({ region: REGION }, async (request) => {
  const volunteer = await requireVolunteer(request);
  const perms = await permissionsFor(volunteer);
  if (!perms.includes('manage_templates')) {
    throw new HttpsError('permission-denied', 'Missing the “Manage Message Templates & Email Settings” permission.');
  }
  const data = request.data || {};
  const patch = {
    enabled: !!data.enabled,
    clientId: String(data.clientId || '').trim(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: volunteer.id,
  };
  if (data.clearSecret) {
    patch.clientSecret = '';
  } else {
    const secret = String(data.clientSecret || '').trim();
    if (secret) patch.clientSecret = secret;
  }
  await db.doc(CONFIG_DOC).set(patch, { merge: true });
  const cfg = await readConfig();
  return { ok: true, configured: isConfigured(cfg), enabled: cfg.enabled };
});

/**
 * startGoogleCalendarAuth() → { url } — the Google consent screen to send the
 * caller to. A one-time signed state nonce ties the eventual callback back to
 * this volunteer (the callback is an anonymous HTTP endpoint with no auth
 * context, so the volunteer id cannot come from the request itself).
 */
exports.startGoogleCalendarAuth = onCall({ region: REGION }, async (request) => {
  const volunteer = await requireVolunteer(request);
  const cfg = await readConfig();
  if (!isConfigured(cfg)) throw new HttpsError('failed-precondition', 'Google Calendar isn’t configured yet — an admin must add the OAuth client first.');
  if (!cfg.enabled) throw new HttpsError('failed-precondition', 'Google Calendar sync is switched off.');

  const nonce = crypto.randomBytes(24).toString('hex');
  await db.collection(STATE_COLLECTION).doc(nonce).set({
    volunteerId: volunteer.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',   // ask for a refresh token
    prompt: 'consent',        // force a refresh token even on re-connect
    include_granted_scopes: 'true',
    state: nonce,
  });
  return { url: `${AUTH_ENDPOINT}?${params.toString()}` };
});

/**
 * googleOAuthCallback — where Google redirects the browser after consent. Public
 * HTTP (no Firebase auth on the redirect); the `state` nonce is the only thing
 * that identifies the volunteer, and it is single-use.
 */
exports.googleOAuthCallback = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  const done = (title, msg) => res.status(200).send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<div style="font-family:system-ui;max-width:26rem;margin:4rem auto;text-align:center;padding:0 1rem">`
    + `<h2 style="color:#c2410c">${title}</h2><p style="color:#475569">${msg}</p>`
    + `<p style="color:#94a3b8;font-size:.85rem">You can close this tab and return to the app.</p></div>`,
  );

  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (req.query.error) { done('Not connected', `Google reported: ${String(req.query.error)}.`); return; }
    if (!code || !state) { done('Not connected', 'The sign-in response was incomplete.'); return; }

    const stateRef = db.collection(STATE_COLLECTION).doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) { done('Link expired', 'That sign-in link was already used or has expired. Please start again from the app.'); return; }
    const volunteerId = stateSnap.data().volunteerId;
    await stateRef.delete(); // single-use

    const cfg = await readConfig();
    if (!isConfigured(cfg)) { done('Not configured', 'Google Calendar is no longer configured.'); return; }

    // Exchange the auth code for tokens.
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokenJson = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenJson) { done('Not connected', tokenJson?.error_description || 'Google refused the sign-in.'); return; }

    // On the first consent Google returns a refresh_token; on a repeat it may not.
    // prompt=consent above makes it return one each time, but guard anyway.
    const refreshToken = tokenJson.refresh_token || null;

    let email = '';
    try {
      const infoRes = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
      if (infoRes.ok) email = (await infoRes.json()).email || '';
    } catch { /* email is cosmetic */ }

    const patch = { email, connectedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (refreshToken) patch.refreshToken = refreshToken;
    await db.collection(TOKEN_COLLECTION).doc(volunteerId).set(patch, { merge: true });

    const stored = await db.collection(TOKEN_COLLECTION).doc(volunteerId).get();
    if (!stored.data()?.refreshToken) {
      done('Almost there', 'Google didn’t return a refresh token. In your Google Account → Security → Third-party access, remove “BAPS Jaipur MDS”, then connect again.');
      return;
    }
    done('Connected ✓', `Your Google Calendar${email ? ` (${email})` : ''} is linked. Go back to the app and press “Sync now”.`);
  } catch (err) {
    console.error('[googleOAuthCallback] failed:', err);
    done('Something went wrong', 'Please try connecting again from the app.');
  }
});

/**
 * syncMyGoogleCalendar() — push the caller's in-scope birthdays/anniversaries
 * into their Google Calendar, updating existing events in place. Reuses the
 * precomputed dataset (Cloud Storage), so it costs only the caller's own
 * Firestore reads plus the Calendar API writes.
 */
exports.syncMyGoogleCalendar = onCall({ region: REGION, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const volunteer = await requireVolunteer(request);
  const cfg = await readConfig();
  if (!isConfigured(cfg) || !cfg.enabled) return { skipped: 'not-configured' };

  const tokenSnap = await db.collection(TOKEN_COLLECTION).doc(volunteer.id).get();
  const refreshToken = tokenSnap.exists ? tokenSnap.data().refreshToken : null;
  if (!refreshToken) return { skipped: 'not-connected' };

  let accessToken;
  try {
    accessToken = await accessTokenFromRefresh(cfg, refreshToken);
  } catch (err) {
    if (err.revoked) {
      // The user revoked access in their Google account — forget the dead token.
      await db.collection(TOKEN_COLLECTION).doc(volunteer.id).set(
        { refreshToken: admin.firestore.FieldValue.delete() }, { merge: true },
      );
      return { skipped: 'not-connected' };
    }
    throw new HttpsError('failed-precondition', err.message || 'Could not refresh Google access.');
  }

  const scope = await scopeForVolunteer(volunteer);
  const dataset = (await loadDataset()) || (await buildCalendarDataset({ now: new Date() }));
  const curYear = new Date().getFullYear();

  const inScope = (e) => matchesScope(scope, { area: e.area || null, mandal: e.mandal || null });
  const jobs = [
    ...(dataset.birthdays || []).filter(inScope).map((e) => ['dob', e]),
    ...(dataset.anniversaries || []).filter(inScope).map((e) => ['anniversary', e]),
  ];

  const capped = jobs.length > MAX_EVENTS_PER_SYNC;
  const slice = jobs.slice(0, MAX_EVENTS_PER_SYNC);

  let upserted = 0;
  const errors = [];
  for (const [kind, entry] of slice) {
    const body = eventBody(kind, entry, curYear);
    if (!body) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await upsertEvent(accessToken, body);
      upserted += 1;
    } catch (err) {
      if (errors.length < 5) errors.push(`${entry.name}: ${err.message}`);
    }
  }

  await db.collection(TOKEN_COLLECTION).doc(volunteer.id).set({
    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSyncCount: upserted,
  }, { merge: true });

  return { ok: true, upserted, total: jobs.length, capped, maxPerSync: MAX_EVENTS_PER_SYNC, errors };
});

/** disconnectGoogleCalendar() — forget the caller's token and best-effort revoke. */
exports.disconnectGoogleCalendar = onCall({ region: REGION }, async (request) => {
  const volunteer = await requireVolunteer(request);
  const ref = db.collection(TOKEN_COLLECTION).doc(volunteer.id);
  const snap = await ref.get();
  const refreshToken = snap.exists ? snap.data().refreshToken : null;
  if (refreshToken) {
    try {
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch { /* revoking is best-effort; we forget it regardless */ }
  }
  await ref.delete();
  return { ok: true };
});
