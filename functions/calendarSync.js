/**
 * functions/calendarSync.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 35 — birthday & anniversary reminders as a subscribable calendar.
 *
 * WHAT A VOLUNTEER GETS. A private URL they paste once into Google Calendar
 * ("Other calendars → From URL") or Apple Calendar. From then on every contact
 * they are responsible for shows up as an all-day, yearly-repeating event on
 * their birthday / anniversary — 🎂 and 💐 — with a one-tap WhatsApp link in the
 * event notes. No per-volunteer setup beyond that paste; nothing to install.
 *
 * WHY A FEED AND NOT PUSHED EVENTS. A subscribed ICS feed is read-only and
 * stateless: the calendar app re-fetches it every few hours and REPLACES what it
 * had, matching events by UID. So editing a contact's DOB and rebuilding the feed
 * re-syncs automatically — the UID is stable per (contact, type), so the event
 * MOVES rather than duplicating, which is exactly the "edit → re-sync, don't
 * create again" the feature was asked for. (Google refreshes external calendars
 * every ~8–24h; that latency is Google's, not ours. The admin "Rebuild now"
 * button forces our side to be current immediately; the calendar still refreshes
 * on its own clock.) Two-way sync / instant push needs per-user OAuth — a
 * separate, heavier piece, deliberately not this one.
 *
 * READS BUDGET (the hard constraint — <50k reads/day). A live per-request scan
 * would be ruinous: an admin's feed is every birthday in the database, re-fetched
 * several times a day by Google. So the whole dataset — every contact with a
 * birthday or anniversary, area resolved via household, WhatsApp link pre-built —
 * is computed ONCE a day by rebuildCalendarCache and written to Cloud Storage.
 * Serving a feed reads that file (Storage, not Firestore) and filters it in
 * memory by the caller's scope. Per fetch that is ~1 token lookup + the caller's
 * volunteer/role docs — a handful of reads, not thousands.
 *
 * SCOPING. Mirrors src/services/reminderService.js exactly: area lives on the
 * HOUSEHOLD, mandal on the INDIVIDUAL, and lib/volunteerScope.js decides who sees
 * whom (global/area/mandal/intersect/union/none). An admin (view_all_contacts)
 * gets everyone; a mandal head gets their mandal; a plain karyakarta gets the one
 * cell of the area×mandal grid they hold.
 *
 * SECURITY. The subscription URL carries a random token, not a login — calendar
 * apps cannot send auth headers, so the URL IS the credential (treat it like a
 * password; rotating it from the app invalidates the old one instantly). Tokens
 * live in calendarTokens/{token}, a collection no client rule allows: it is
 * written by the getMyCalendarFeed callable and read by the feed, both through
 * the Admin SDK. Keeping tokens out of the volunteer document means one volunteer
 * cannot read another's token from the volunteer list and subscribe to their feed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const crypto = require('crypto');

const { resolveScope, matchesScope } = require('./lib/volunteerScope');
const { volunteerRoleIds, permissionsForVolunteer } = require('./lib/callerAccess');
const { buildWhatsAppUrl, DEFAULT_BIRTHDAY_TEMPLATE, DEFAULT_ANNIVERSARY_TEMPLATE } = require('./lib/wa');
const { istParts } = require('./lib/reportData');
const { schedules } = require('./lib/scheduleConfig');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const TZ = 'Asia/Kolkata';
const SCHEDULE_OPTS = { region: REGION, timeZone: TZ, timeoutSeconds: 300, memory: '512MiB' };

/** The precomputed dataset the feed serves. One object, overwritten daily. */
const CACHE_FILE = 'calendar/reminders-dataset.json';
/** token → { volunteerId } lookup. Server-only (no client rule matches it). */
const TOKEN_COLLECTION = 'calendarTokens';
const PRODID = '-//BAPS Jaipur MDS//Reminders//EN';

// ── The precomputed dataset ───────────────────────────────────────────────────

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Only the households referenced by the birthday/anniversary set — for area. */
async function loadHouseholdsByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = {};
  for (const slice of chunk(unique, 300)) {
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(...slice.map((id) => db.collection('households').doc(id)));
    snaps.forEach((s) => { if (s.exists) map[s.id] = s.data(); });
  }
  return map;
}

/** settings/messageTemplate, read ONCE per rebuild so the feed itself reads none. */
async function getMessageTemplates() {
  try {
    const snap = await db.collection('settings').doc('messageTemplate').get();
    const d = snap.exists ? snap.data() : {};
    return {
      birthdayTemplate: d.birthdayTemplate || DEFAULT_BIRTHDAY_TEMPLATE,
      anniversaryTemplate: d.anniversaryTemplate || DEFAULT_ANNIVERSARY_TEMPLATE,
    };
  } catch (err) {
    console.error('[calendar] could not read settings/messageTemplate:', err.message);
    return { birthdayTemplate: DEFAULT_BIRTHDAY_TEMPLATE, anniversaryTemplate: DEFAULT_ANNIVERSARY_TEMPLATE };
  }
}

const FULL_DATE_RE = /^(\d{4})-\d{2}-\d{2}$/;

/**
 * buildCalendarDataset({ now })
 *
 * The two queries are single-field RANGES on the denormalised 'MM-DD' fields:
 * `>= '01-01'` and `<= '12-31'` returns exactly the contacts that HAVE a
 * birthday / anniversary (a missing or empty field sorts below '01-01' and is
 * skipped) and no others — the minimum read set, and no composite index. Each
 * entry carries its area (resolved via the household, like reminderService) and a
 * pre-built WhatsApp link, so serving a feed touches Firestore only for the
 * caller, never for the contacts.
 */
async function buildCalendarDataset({ now = new Date() } = {}) {
  const templates = await getMessageTemplates();

  const [dobSnap, annSnap] = await Promise.all([
    db.collection('individuals').where('dobMonthDay', '>=', '01-01').where('dobMonthDay', '<=', '12-31').get(),
    db.collection('individuals').where('anniversaryMonthDay', '>=', '01-01').where('anniversaryMonthDay', '<=', '12-31').get(),
  ]);

  const householdIds = new Set();
  dobSnap.forEach((d) => { const h = d.data().householdId; if (h) householdIds.add(h); });
  annSnap.forEach((d) => { const h = d.data().householdId; if (h) householdIds.add(h); });
  const households = await loadHouseholdsByIds([...householdIds]);

  // area lives on the household; a standalone contact carries its own. Mirrors
  // individualScopeArea() in src/lib/scope.js.
  const areaOf = (i) => i.area || (i.householdId && households[i.householdId] ? households[i.householdId].area : null) || null;

  // One entry per contact: identity + resolved area + a WhatsApp link built from
  // the given template, so the feed itself renders without any further reads.
  const entry = (i, template, monthDay, fullRaw) => {
    const area = areaOf(i);
    return {
      id: i.id,
      name: i.name || 'Unknown contact',
      mandal: i.mandal || null,
      area,
      monthDay,
      fullDate: FULL_DATE_RE.test(String(fullRaw || '')) ? fullRaw : null,
      waUrl: buildWhatsAppUrl({ mobile: i.mobile, template, contact: { ...i, area } }),
    };
  };

  const birthdays = dobSnap.docs.map((d) => {
    const i = { id: d.id, ...d.data() };
    return entry(i, templates.birthdayTemplate, i.dobMonthDay, i.dob);
  });

  const anniversaries = annSnap.docs.map((d) => {
    const i = { id: d.id, ...d.data() };
    return entry(i, templates.anniversaryTemplate, i.anniversaryMonthDay, i.anniversary);
  });

  return {
    generatedAt: now.toISOString(),
    counts: { birthdays: birthdays.length, anniversaries: anniversaries.length },
    birthdays,
    anniversaries,
  };
}

function cacheFileRef() {
  return admin.storage().bucket().file(CACHE_FILE);
}

async function saveDataset(dataset) {
  await cacheFileRef().save(JSON.stringify(dataset), {
    contentType: 'application/json',
    resumable: false,
    metadata: { cacheControl: 'no-store' },
  });
}

async function loadDataset() {
  const file = cacheFileRef();
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    console.error('[calendar] dataset file is not valid JSON:', err.message);
    return null;
  }
}

async function rebuild(now = new Date()) {
  const dataset = await buildCalendarDataset({ now });
  await saveDataset(dataset);
  return dataset.counts;
}

// ── ICS (RFC 5545) rendering ──────────────────────────────────────────────────

/** Escape a text value: backslash, semicolon, comma and newline are special. */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets (RFC 5545 §3.1). Continuation lines begin with
 * a single space, so they carry 74 octets of content. Split on CHARACTER
 * boundaries measured in UTF-8 bytes, never mid-codepoint — an emoji cut in half
 * corrupts the whole event in strict parsers.
 */
function foldLine(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const segs = [];
  let cur = '';
  let curBytes = 0;
  let first = true;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    const limit = first ? 75 : 74;
    if (curBytes + chBytes > limit) {
      segs.push(cur);
      cur = ch;
      curBytes = chBytes;
      first = false;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  if (cur) segs.push(cur);
  return segs.map((seg, idx) => (idx === 0 ? seg : ` ${seg}`)).join('\r\n');
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * The YYYYMMDD the yearly rule is anchored on. Prefer the real birth/marriage
 * year (a genuine Feb-29 date proves that year was a leap year, so it is always a
 * valid DATE); otherwise this year, nudged forward to the next leap year when the
 * date is 29 February so DTSTART is a day that actually exists.
 */
function anchorDate(monthDay, fullDate, curYear) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(monthDay || ''));
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!month || !day || month > 12 || day > 31) return null;

  let year = curYear;
  const fd = FULL_DATE_RE.exec(String(fullDate || ''));
  if (fd) year = Number(fd[1]);

  if (month === 2 && day === 29) {
    while (!isLeap(year)) year += 1;
  }
  return `${String(year).padStart(4, '0')}${m[1]}${m[2]}`;
}

/** DTSTAMP — the instant this feed was generated, in UTC basic format. */
function utcStamp(now) {
  const z = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${z(now.getUTCMonth() + 1)}${z(now.getUTCDate())}`
    + `T${z(now.getUTCHours())}${z(now.getUTCMinutes())}${z(now.getUTCSeconds())}Z`;
}

function locationLine(mandal, area) {
  const parts = [];
  if (mandal) parts.push(`Mandal: ${mandal}`);
  if (area) parts.push(`Area: ${area}`);
  return parts.join(' · ');
}

function vevent({ uid, anchor, summary, descriptionLines, stamp }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${anchor}`,
    'RRULE:FREQ=YEARLY',
    // An anniversary is not a commitment on the reader's time — free, not busy.
    'TRANSP:TRANSPARENT',
    `SUMMARY:${escapeText(summary)}`,
  ];
  const desc = descriptionLines.filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * datasetToICS(dataset, { scope, calName, now })
 *
 * Filters the precomputed dataset by the caller's scope IN MEMORY (matchesScope,
 * the same predicate the app and the rules use) and renders one VCALENDAR. An
 * empty result is still a valid, empty calendar — a subscription that resolves to
 * nothing must not error, or the volunteer sees a broken calendar rather than an
 * empty one.
 */
function datasetToICS(dataset, { scope, calName, now = new Date() }) {
  const curYear = istParts(now).year;
  const stamp = utcStamp(now);
  const inScope = (e) => matchesScope(scope, { area: e.area || null, mandal: e.mandal || null });

  const events = [];

  (dataset.birthdays || []).filter(inScope).forEach((e) => {
    const anchor = anchorDate(e.monthDay, e.fullDate, curYear);
    if (!anchor) return;
    const born = FULL_DATE_RE.exec(String(e.fullDate || ''));
    events.push(...vevent({
      uid: `bday-${e.id}@baps-jaipur-mds`,
      anchor,
      summary: `🎂 ${e.name} — Birthday`,
      descriptionLines: [
        locationLine(e.mandal, e.area),
        born ? `Born ${born[1]}` : '',
        e.waUrl ? `WhatsApp wishes: ${e.waUrl}` : '',
        'Shared from BAPS Jaipur MDS',
      ],
      stamp,
    }));
  });

  (dataset.anniversaries || []).filter(inScope).forEach((e) => {
    const anchor = anchorDate(e.monthDay, e.fullDate, curYear);
    if (!anchor) return;
    const since = FULL_DATE_RE.exec(String(e.fullDate || ''));
    events.push(...vevent({
      uid: `anniv-${e.id}@baps-jaipur-mds`,
      anchor,
      summary: `💐 ${e.name} — Anniversary`,
      descriptionLines: [
        locationLine(e.mandal, e.area),
        since ? `Since ${since[1]}` : '',
        e.waUrl ? `WhatsApp wishes: ${e.waUrl}` : '',
        'Shared from BAPS Jaipur MDS',
      ],
      stamp,
    }));
  });

  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName || 'BAPS Reminders')}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    // Ask the client to re-fetch twice a day; most honour one of these two.
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];
  return [...head, ...events, 'END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n';
}

// ── Per-volunteer scope (resolved live, cheaply) ──────────────────────────────

async function scopeForVolunteer(volunteer) {
  const ids = volunteerRoleIds(volunteer);
  let roles = [];
  let permissions = [];
  if (ids.length) {
    const snaps = await db.getAll(...ids.map((id) => db.collection('roles').doc(id)));
    roles = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
    permissions = [...new Set(roles.flatMap((r) => (Array.isArray(r.permissions) ? r.permissions : [])))];
  }
  return resolveScope({ volunteer, roles, permissions });
}

function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'baps-jaipur-mds';
}

/** The public feed URL for a token. The Gen-2 cloudfunctions.net alias is stable;
 *  the exact host can also be confirmed in the Firebase console after deploy. */
function feedUrl(token) {
  return `https://${REGION}-${projectId()}.cloudfunctions.net/calendarFeed?token=${encodeURIComponent(token)}`;
}

// ── Cloud Functions ───────────────────────────────────────────────────────────

/** Nightly: recompute the dataset the feed serves. Idempotent — a retry simply
 *  overwrites the file, so letting it throw (and be retried) is safe. */
exports.rebuildCalendarCache = onSchedule({ ...SCHEDULE_OPTS, schedule: schedules.calendarRebuild }, async () => {
  const counts = await rebuild(new Date());
  console.log('[calendar] cache rebuilt:', JSON.stringify(counts));
});

/**
 * The subscribable feed. Public HTTP (calendar apps fetch it anonymously); the
 * token in the query is the credential. Reads: 1 token doc + 1 volunteer doc +
 * the caller's role docs, then Cloud Storage for the dataset — no per-contact
 * Firestore reads.
 */
exports.calendarFeed = onRequest({ region: REGION, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  try {
    const token = String((req.query && req.query.token) || '').trim();
    if (!token) { res.status(400).send('Missing calendar token.'); return; }

    const tokenSnap = await db.collection(TOKEN_COLLECTION).doc(token).get();
    if (!tokenSnap.exists) { res.status(404).send('Unknown or revoked calendar link.'); return; }

    const vSnap = await db.collection('volunteers').doc(tokenSnap.data().volunteerId).get();
    if (!vSnap.exists) { res.status(404).send('Volunteer not found.'); return; }
    const volunteer = { id: vSnap.id, ...vSnap.data() };

    const scope = await scopeForVolunteer(volunteer);

    let dataset = await loadDataset();
    if (!dataset) {
      // First request before the nightly job has ever run: build on demand so the
      // subscription is never broken, and persist it for the next reader.
      dataset = await buildCalendarDataset({ now: new Date() });
      await saveDataset(dataset).catch((err) => console.warn('[calendarFeed] could not persist first build:', err.message));
    }

    const ics = datasetToICS(dataset, {
      scope,
      calName: `BAPS Reminders — ${volunteer.name || 'My contacts'}`,
      now: new Date(),
    });

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="baps-reminders.ics"');
    res.set('Cache-Control', 'public, max-age=3600');
    res.status(200).send(ics);
  } catch (err) {
    console.error('[calendarFeed] failed:', err);
    res.status(500).send('Could not build the calendar right now.');
  }
});

/**
 * getMyCalendarFeed({ rotate? }) — mint (or return, or rotate) the caller's own
 * subscription link. Any signed-in volunteer may call it for themselves; the
 * token is written through the Admin SDK, so it needs no volunteer-doc rule.
 */
exports.getMyCalendarFeed = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const uid = request.auth.uid;
  const vRef = db.collection('volunteers').doc(uid);
  const vSnap = await vRef.get();
  if (!vSnap.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const volunteer = { id: vSnap.id, ...vSnap.data() };

  const rotate = !!(request.data && request.data.rotate);
  let token = typeof volunteer.calendarToken === 'string' ? volunteer.calendarToken : '';

  if (!token || rotate) {
    const next = crypto.randomBytes(24).toString('hex');
    const batch = db.batch();
    if (token) batch.delete(db.collection(TOKEN_COLLECTION).doc(token)); // revoke the old link
    batch.set(db.collection(TOKEN_COLLECTION).doc(next), {
      volunteerId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(vRef, { calendarToken: next }, { merge: true });
    await batch.commit();
    token = next;
  } else {
    // Self-heal a token whose lookup row went missing (e.g. a restore that brought
    // back volunteers but not calendarTokens) so an existing URL keeps working.
    const tRef = db.collection(TOKEN_COLLECTION).doc(token);
    if (!(await tRef.get()).exists) {
      await tRef.set({ volunteerId: uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }

  const scope = await scopeForVolunteer(volunteer);
  return {
    url: feedUrl(token),
    scopeKind: scope.kind,
    unrestricted: !!scope.unrestricted,
    empty: !!scope.empty,
  };
});

/**
 * rebuildCalendarCacheNow() — force an immediate dataset rebuild after editing
 * contacts, so the feed is current without waiting for the nightly job. Gated on
 * the same automation permission as the schedule editor.
 */
exports.rebuildCalendarCacheNow = onCall({ region: REGION, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const vSnap = await db.collection('volunteers').doc(request.auth.uid).get();
  if (!vSnap.exists) throw new HttpsError('permission-denied', 'Volunteer record not found.');
  const perms = await permissionsForVolunteer(db, vSnap.data());
  if (!perms.includes('manage_templates') && !perms.includes('send_emails')) {
    throw new HttpsError('permission-denied', 'Missing manage_templates permission.');
  }
  const counts = await rebuild(new Date());
  return { ok: true, ...counts, generatedAt: new Date().toISOString() };
});

// ── Reused by functions/googleCalendar.js (the per-user OAuth push). This is a
// plain object, and `firebase deploy` only inspects the exports of the ENTRY
// module (index.js) — which re-exports the four Cloud Functions above by name,
// never this — so exposing these internals adds no deployed function and keeps
// the dataset/scope logic in exactly one place. ──
exports._internal = {
  loadDataset,
  buildCalendarDataset,
  saveDataset,
  scopeForVolunteer,
  anchorDate,
  locationLine,
};
