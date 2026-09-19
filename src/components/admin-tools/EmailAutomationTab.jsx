// src/components/admin-tools/EmailAutomationTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 20 — the control panel for the automated reports, replacing Sevak Call's
// "EmailSettings" sheet tab.
//
// The legacy setup had two problems this screen exists to solve. First, the
// toggles lived in spreadsheet cells with no validation, so a typo silently
// disabled a report and nobody noticed for weeks. Second — and worse — there was
// no way to see WHO a report would go to before sending it, so the usual
// discovery method was a karyakar mentioning they never got one.
//
// Hence "Who receives these" (previewEmailRecipients) sits above the toggles,
// and dry-run mode is offered prominently: it writes the emailLogs row and
// builds the whole message but never touches the mail queue.
//
// TWO PERMISSIONS, NOT ONE. The screen opens on `send_emails`, but the settings
// document itself is written under `manage_templates` — that is what
// firestore.rules enforces on settings/{docId}. Showing an enabled Save button to
// a `send_emails`-only role would produce a permission-denied toast that looks
// like a bug in the app, so the editable half is disabled for them instead. Read
// the recipient list, send, and read the log: yes. Change what everyone else
// receives: no.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Mail, Send, RefreshCw, AlertTriangle, CheckCircle2, Users, FlaskConical, Clock, Lock,
  CalendarClock, Info, CalendarPlus, Copy, MessageCircle, CalendarDays,
} from 'lucide-react';
import { db } from '../../lib/firebase';
import { saveSettings, describeSettingsError } from '../../services/settingsService';
import { getMyCalendarFeed, rebuildCalendarCacheNow } from '../../services/calendarService';
import { getWhatsAppCloudStatus, saveWhatsAppCloudConfig, sendWhatsAppCloudMessage } from '../../services/whatsappCloudService';
import { getGoogleCalendarStatus, saveGoogleCalendarConfig } from '../../services/googleCalendarService';
import { useSettings } from '../../hooks/useSettings';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { confirmDialog } from '../ui/ConfirmHost';
import RequirePermission from '../RequirePermission';
import SettingsRulesBanner from './SettingsRulesBanner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Label, Textarea } from '../ui/Input';
import { cn } from '../../lib/cn';
import {
  describeCron, parseTimeCron, buildTimeCron, cronToTimeInput, isValidCron, WEEKDAYS,
} from '../../lib/cron';

const TOGGLES = [
  {
    key: 'autoDailyAdminEnabled',
    title: 'Daily calling report',
    cronKey: 'scheduleDailyCron',
    when: 'Every night at 10:05 pm',
    description: 'Totals, a per-volunteer table and a status breakdown for the day, with a PDF attached. Goes to everyone listed below.',
  },
  {
    key: 'autoDailyVolunteerEnabled',
    title: 'Daily report to each volunteer',
    when: 'Same time, per person',
    description: 'Sends each volunteer only their own numbers — and only if they logged something that day. Needs a report email on their volunteer record.',
  },
  {
    key: 'autoPostSabhaAdminEnabled',
    title: 'Post-sabha attendance report',
    cronKey: 'schedulePostSabhaCron',
    when: 'Checked every 15 minutes',
    description: 'Fires about 10 minutes after a sabha ends, once per event. Includes the 12-month attendance ratio and who did not come.',
  },
  {
    key: 'autoPostSabhaVolunteerEnabled',
    title: 'Copy to whoever took attendance',
    when: 'With the report above',
    description: 'Also sends the attendance report to the volunteers who marked people present.',
  },
  {
    key: 'autoSkBatchReportsEnabled',
    title: 'Calling list to each Sampark Karyakarta',
    when: 'With the report above',
    description: 'One PDF per karyakarta covering only the batch they were given: who came, who did not, and what each absentee had said when called — so the follow-up calls are ready to make. Needs a report email on their volunteer record. Waits until attendance has been marked.',
  },
  {
    key: 'autoBirthdayEnabled',
    title: 'Birthday & anniversary summary',
    cronKey: 'scheduleBirthdayCron',
    when: 'Every morning at 6:10 am',
    description: 'Today’s birthdays and anniversaries with a one-tap WhatsApp link per person. Skipped on days with nobody to wish.',
  },
  {
    key: 'autoSabhaDigestEnabled',
    title: 'Weekly sabha coverage',
    cronKey: 'scheduleSabhaDigestCron',
    when: 'Monday mornings at 7:12 am',
    description: 'Which area’s sabha happened last week and which didn’t, six weeks of history per schedule, and who has now missed two in a row. Covers completed weeks only.',
  },
  {
    key: 'autoSabhaDigestVolunteerEnabled',
    title: 'Coverage copy to each mandal head',
    when: 'With the report above',
    description: 'The same digest narrowed to the sabhas that person runs — and only sent to someone who actually has a miss to chase, so a clean week stays quiet.',
  },
];

// PHASE 34 — the five job schedules the admin can edit, in the order they run
// through a week. Each maps to a cron field on settings/email. `mode` picks the
// friendly control: a wall-clock time, a time-plus-weekday, or a poll interval.
// `note` explains what "generation" even is — it has no toggle of its own above.
const SCHEDULE_FIELDS = [
  {
    key: 'scheduleDailyCron', overlayKey: 'daily', mode: 'daily',
    title: 'Daily calling report',
    note: 'Runs once a night. 22:05 by default so a full day of calls is in.',
  },
  {
    key: 'scheduleBirthdayCron', overlayKey: 'birthday', mode: 'daily',
    title: 'Birthday & anniversary summary',
    note: 'A morning time works best — the wishes go out for the same day.',
  },
  {
    key: 'scheduleSabhaDigestCron', overlayKey: 'sabhaDigest', mode: 'weekly',
    title: 'Weekly sabha coverage',
    note: 'Pick the morning after your sabha week closes, so the week is complete.',
  },
  {
    key: 'scheduleSabhaGenerationCron', overlayKey: 'sabhaGeneration', mode: 'weekly',
    title: 'Create the coming week’s sabhas',
    note: 'The background job that turns each recurring sabha into next week’s dated event. No email — run it a day or two before the digest.',
  },
  {
    key: 'schedulePostSabhaCron', overlayKey: 'postSabha', mode: 'everyN',
    title: 'Post-sabha attendance check',
    note: 'How often to look for a sabha that just ended. More frequent = a faster report, a few more reads each day.',
  },
  {
    key: 'scheduleCalendarRebuildCron', overlayKey: 'calendarRebuild', mode: 'daily',
    title: 'Rebuild the birthday calendar',
    note: 'The background job behind the subscribable calendar below. Runs before dawn so the day’s events are ready. No email.',
  },
];

const KIND_LABELS = {
  'daily-admin': 'Daily report',
  'daily-volunteer': 'Daily report (volunteer)',
  'daily-manual': 'Daily report (manual)',
  'post-sabha': 'Post-sabha attendance',
  'post-sabha-manual': 'Post-sabha (manual)',
  'post-sabha-sk': 'Karyakarta calling list',
  'post-sabha-sk-manual': 'Karyakarta calling list (manual)',
  birthday: 'Birthday summary',
  'birthday-manual': 'Birthday summary (manual)',
  'sabha-digest': 'Sabha coverage',
  'sabha-digest-volunteer': 'Sabha coverage (mandal head)',
};

const STATUS_STYLES = {
  queued: 'bg-emerald-50 text-emerald-700',
  'dry-run': 'bg-sky-50 text-sky-700',
  skipped: 'bg-amber-50 text-amber-700',
};

function formatTimestamp(ts) {
  if (!ts) return 'just now';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Greys out a disabled field without changing the shared Input component. */
const LOCKABLE = 'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <label
      className={cn('relative inline-flex shrink-0 items-center', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
      aria-label={label}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-orange-500 peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </label>
  );
}

/** Shared styling for the time/day/number inputs so they line up with <Input>. */
const CRON_INPUT = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200';

/**
 * The friendly editor for one schedule. It never blocks a value: if the stored
 * cron isn't one of the three shapes it understands (someone hand-tuned it, or a
 * future field uses a range), it steps aside and shows the raw cron in a text box
 * so the string stays editable rather than being silently rewritten.
 */
function ScheduleEditor({ mode, cron, onChange, disabled }) {
  const parsed = parseTimeCron(cron);
  const timeVal = cronToTimeInput(cron); // '' unless it's a plain time cron

  const fitsFriendly = mode === 'everyN'
    ? !!(parsed && parsed.kind === 'everyN')
    : !!timeVal; // daily + weekly both need a real time

  if (!fitsFriendly) {
    return (
      <div>
        <input
          type="text"
          disabled={disabled}
          className={cn(CRON_INPUT, LOCKABLE, 'w-48 font-mono')}
          value={cron || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="min hour * * day"
          aria-label="Cron expression"
        />
        <p className="mt-1 text-[11px] text-slate-400">Custom schedule — five cron fields, minute first.</p>
      </div>
    );
  }

  if (mode === 'everyN') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500">Every</span>
        <input
          type="number" min={1} max={59} inputMode="numeric"
          disabled={disabled}
          className={cn(CRON_INPUT, LOCKABLE, 'w-16')}
          value={parsed.minutes}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= 59) onChange(`*/${n} * * * *`);
          }}
          aria-label="Minutes between checks"
        />
        <span className="text-xs text-slate-500">minutes</span>
      </div>
    );
  }

  // daily or weekly — a time input, plus a weekday picker for weekly.
  const dow = parsed && parsed.kind === 'weekly' ? parsed.dow : '1';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="time"
        disabled={disabled}
        className={cn(CRON_INPUT, LOCKABLE)}
        value={timeVal}
        onChange={(e) => onChange(buildTimeCron(e.target.value, mode === 'weekly' ? dow : null) || cron)}
        aria-label="Time of day"
      />
      {mode === 'weekly' && (
        <select
          disabled={disabled}
          className={cn(CRON_INPUT, LOCKABLE)}
          value={dow}
          onChange={(e) => onChange(buildTimeCron(timeVal, e.target.value) || cron)}
          aria-label="Day of week"
        >
          {WEEKDAYS.map((d) => <option key={d.value} value={d.value}>{d.long}</option>)}
        </select>
      )}
    </div>
  );
}

function EmailAutomationInner() {
  const { settings, loading, readDenied } = useSettings('email');
  const { volunteer, hasPermission } = useAuth();
  const { showToast } = useToast();

  // firestore.rules gates settings/{docId} writes on manage_templates, so this
  // is the same condition the database will apply — not a second opinion.
  const canEditSettings = hasPermission('manage_templates');

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState('');
  const [testAddress, setTestAddress] = useState('');
  const [audience, setAudience] = useState(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [logs, setLogs] = useState([]);

  // PHASE 35 — the subscribable calendar. Nothing loads on mount: minting a feed
  // link is a write, and rebuilding scans every contact, so both wait for a click.
  const [rebuilding, setRebuilding] = useState(false);
  const [calFeed, setCalFeed] = useState(null); // { url, scopeKind, unrestricted, empty }
  const [calFeedLoading, setCalFeedLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // PHASE 36 — WhatsApp Cloud API. Status is a plain read of the config doc, so it
  // loads on mount; the access token is never returned, only whether one is set.
  const [waStatus, setWaStatus] = useState(null);
  const [waDraft, setWaDraft] = useState({ enabled: false, phoneNumberId: '', apiVersion: 'v21.0', accessToken: '' });
  const [waSaving, setWaSaving] = useState(false);
  const [waTestTo, setWaTestTo] = useState('');
  const [waTestText, setWaTestText] = useState('Namaste 🙏 Test message from BAPS Jaipur MDS.');
  const [waSending, setWaSending] = useState(false);

  // PHASE 37 — per-user Google Calendar push. Same pattern: status on mount, the
  // client secret is write-only (never returned).
  const [gcalStatus, setGcalStatus] = useState(null);
  const [gcalDraft, setGcalDraft] = useState({ enabled: false, clientId: '', clientSecret: '' });
  const [gcalSaving, setGcalSaving] = useState(false);
  const [gcalCopied, setGcalCopied] = useState(false);

  // Only seed the draft once — re-seeding on every snapshot would wipe whatever
  // the admin is typing the moment their own save round-trips.
  useEffect(() => {
    if (settings && !draft) {
      setDraft({
        ...settings,
        extraRecipientsText: (Array.isArray(settings.extraRecipients) ? settings.extraRecipients : []).join('\n'),
      });
    }
  }, [settings, draft]);

  useEffect(() => {
    const q = query(collection(db, 'emailLogs'), orderBy('createdAt', 'desc'), limit(15));
    return onSnapshot(
      q,
      (snap) => setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      // A missing index or a role without send_emails must not blank the screen.
      (err) => console.warn('[EmailAutomationTab] emailLogs listener stopped:', err.message),
    );
  }, []);

  // Load the two integration statuses once. Each is a couple of reads of a config
  // doc; a not-yet-deployed callable just leaves the card in its "not configured"
  // state rather than blanking the screen — same forgiving posture as the log.
  useEffect(() => {
    getWhatsAppCloudStatus()
      .then((s) => {
        setWaStatus(s);
        setWaDraft((d) => ({ ...d, enabled: !!s.enabled, phoneNumberId: s.phoneNumberId || '', apiVersion: s.apiVersion || 'v21.0' }));
      })
      .catch((err) => console.warn('[EmailAutomationTab] WhatsApp status unavailable:', err.message));
    getGoogleCalendarStatus()
      .then((s) => {
        setGcalStatus(s);
        setGcalDraft((d) => ({ ...d, enabled: !!s.enabled, clientId: s.clientId || '' }));
      })
      .catch((err) => console.warn('[EmailAutomationTab] Google Calendar status unavailable:', err.message));
  }, []);

  const loadAudience = useMemo(() => async () => {
    setAudienceLoading(true);
    try {
      const fn = httpsCallable(getFunctions(), 'previewEmailRecipients');
      const res = await fn();
      setAudience(res.data);
    } catch (err) {
      showToast({ type: 'error', message: err.message || 'Could not work out the recipient list.' });
    } finally {
      setAudienceLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadAudience(); }, [loadAudience]);

  const dirty = useMemo(() => {
    if (!draft || !settings) return false;
    const current = { ...settings, extraRecipientsText: (settings.extraRecipients || []).join('\n') };
    return Object.keys(draft).some((k) => {
      if (k === 'extraRecipients' || k === 'updatedAt' || k === 'updatedBy') return false;
      return String(draft[k]) !== String(current[k]);
    });
  }, [draft, settings]);

  async function handleSave() {
    if (!draft) return;
    if (!canEditSettings) {
      showToast({ type: 'error', message: 'Changing these settings needs the “Manage Message Templates & Email Settings” permission.' });
      return;
    }
    const extraRecipients = draft.extraRecipientsText
      .split(/[\n,;]+/)
      .map((a) => a.trim())
      .filter(Boolean);

    const bad = extraRecipients.filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a));
    if (bad.length) {
      showToast({ type: 'error', message: `Not a valid email address: ${bad[0]}` });
      return;
    }

    const cap = Number(draft.maxRecipients);
    if (!Number.isFinite(cap) || cap < 1) {
      showToast({ type: 'error', message: 'Recipient cap must be at least 1.' });
      return;
    }

    // Each schedule must still be five cron fields. buildTimeCron/ScheduleEditor
    // keep them well-formed, but the raw-cron fallback lets someone type freely —
    // so guard here rather than deploy a string Cloud Scheduler will reject.
    const badCron = SCHEDULE_FIELDS.find((f) => !isValidCron(draft[f.key]));
    if (badCron) {
      showToast({ type: 'error', message: `“${badCron.title}” needs a valid schedule (five cron fields, e.g. 5 22 * * *).` });
      return;
    }

    setSaving(true);
    try {
      await saveSettings('email', {
        autoDailyAdminEnabled: !!draft.autoDailyAdminEnabled,
        autoDailyVolunteerEnabled: !!draft.autoDailyVolunteerEnabled,
        autoPostSabhaAdminEnabled: !!draft.autoPostSabhaAdminEnabled,
        autoPostSabhaVolunteerEnabled: !!draft.autoPostSabhaVolunteerEnabled,
        autoSkBatchReportsEnabled: !!draft.autoSkBatchReportsEnabled,
        autoBirthdayEnabled: !!draft.autoBirthdayEnabled,
        autoSabhaDigestEnabled: !!draft.autoSabhaDigestEnabled,
        autoSabhaDigestVolunteerEnabled: !!draft.autoSabhaDigestVolunteerEnabled,
        dryRun: !!draft.dryRun,
        senderName: String(draft.senderName || '').trim(),
        fromAddress: String(draft.fromAddress || '').trim(),
        maxRecipients: cap,
        extraRecipients,
        // PHASE 34 — schedules. Saved here so the panel and pull-schedules.js can
        // read them; they only change WHEN a job fires after the functions are
        // redeployed with the new values (see the note in the Schedule times card).
        scheduleDailyCron: String(draft.scheduleDailyCron).trim(),
        schedulePostSabhaCron: String(draft.schedulePostSabhaCron).trim(),
        scheduleBirthdayCron: String(draft.scheduleBirthdayCron).trim(),
        scheduleSabhaDigestCron: String(draft.scheduleSabhaDigestCron).trim(),
        scheduleSabhaGenerationCron: String(draft.scheduleSabhaGenerationCron).trim(),
        scheduleCalendarRebuildCron: String(draft.scheduleCalendarRebuildCron).trim(),
      }, volunteer?.id);
      setDraft(null); // re-seed from the saved document
      showToast({ type: 'success', message: 'Email settings saved.' });
      loadAudience();
    } catch (err) {
      showToast({ type: 'error', message: describeSettingsError(err, readDenied) });
    } finally {
      setSaving(false);
    }
  }

  async function handleSend(kind, useTestAddress) {
    if (useTestAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(testAddress.trim())) {
      showToast({ type: 'error', message: 'Enter a valid address to send the test to.' });
      return;
    }
    setSending(`${kind}${useTestAddress ? '-test' : ''}`);
    try {
      const fn = httpsCallable(getFunctions(), 'sendManualEmail');
      const res = await fn(useTestAddress ? { kind, to: [testAddress.trim()] } : { kind });
      const result = res.data?.result || {};
      const queued = result.queued ?? result.admin?.queued;
      const skipped = result.skipped || result.admin?.skipped;

      if (skipped === 'nobody-today') {
        showToast({ type: 'info', message: 'Nobody has a birthday or anniversary today, so nothing was sent.' });
      } else if (queued) {
        showToast({ type: 'success', message: 'Queued. It should arrive within a minute.' });
      } else if (skipped === 'dry-run') {
        showToast({ type: 'info', message: 'Dry run is on — the report was built and logged but not sent.' });
      } else if (skipped === 'no-recipients') {
        showToast({ type: 'error', message: 'Nothing sent: no deliverable recipient addresses. See "Who receives these" above.' });
      } else {
        showToast({ type: 'info', message: 'Done — check the log below for what happened.' });
      }
    } catch (err) {
      showToast({ type: 'error', message: err.message || 'Send failed.' });
    } finally {
      setSending('');
    }
  }

  // A callable that isn't deployed yet comes back as not-found/internal; say so
  // plainly rather than surfacing a raw CORS/500 that reads like a real bug.
  function calendarError(err) {
    const code = String(err?.code || '');
    if (code.includes('not-found') || code.includes('internal') || code.includes('unavailable')) {
      return 'The calendar functions aren’t deployed yet. Deploy the functions, then try this again.';
    }
    return err?.message || 'Something went wrong with the calendar.';
  }

  async function handleRebuildCalendar() {
    setRebuilding(true);
    try {
      const res = await rebuildCalendarCacheNow();
      showToast({
        type: 'success',
        message: `Calendar rebuilt — ${res.birthdays} birthday${res.birthdays === 1 ? '' : 's'} and ${res.anniversaries} anniversar${res.anniversaries === 1 ? 'y' : 'ies'}. Subscribers refresh on their calendar’s own cycle.`,
      });
    } catch (err) {
      showToast({ type: 'error', message: calendarError(err) });
    } finally {
      setRebuilding(false);
    }
  }

  async function loadCalFeed(rotate = false) {
    if (rotate) {
      const ok = await confirmDialog({
        title: 'Rotate your calendar link?',
        message: 'The old URL stops working immediately and anyone you shared it with must re-subscribe.',
        confirmText: 'Rotate',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setCalFeedLoading(true);
    try {
      const res = await getMyCalendarFeed({ rotate });
      setCalFeed(res);
      setCopied(false);
      if (rotate) showToast({ type: 'success', message: 'New link generated — the old one no longer works.' });
    } catch (err) {
      showToast({ type: 'error', message: calendarError(err) });
    } finally {
      setCalFeedLoading(false);
    }
  }

  async function copyCalFeed() {
    if (!calFeed?.url) return;
    try {
      await navigator.clipboard.writeText(calFeed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ type: 'info', message: 'Couldn’t copy automatically — select the link and copy it by hand.' });
    }
  }

  // Shared "is this even deployed" mapping for the two integration cards.
  function integrationError(err, label) {
    const code = String(err?.code || '');
    if (code.includes('not-found') || code.includes('internal') || code.includes('unavailable')) {
      return `The ${label} functions aren’t deployed yet. Deploy the functions, then try this again.`;
    }
    return err?.message || `Something went wrong with ${label}.`;
  }

  async function handleSaveWhatsApp() {
    setWaSaving(true);
    try {
      const res = await saveWhatsAppCloudConfig({
        enabled: !!waDraft.enabled,
        phoneNumberId: String(waDraft.phoneNumberId || '').trim(),
        apiVersion: String(waDraft.apiVersion || 'v21.0').trim() || 'v21.0',
        accessToken: String(waDraft.accessToken || '').trim(), // blank keeps the stored token
      });
      setWaStatus((s) => ({ ...(s || {}), ...res }));
      setWaDraft((d) => ({ ...d, accessToken: '' })); // never keep the token in component state
      showToast({ type: 'success', message: 'WhatsApp settings saved.' });
    } catch (err) {
      showToast({ type: 'error', message: integrationError(err, 'WhatsApp') });
    } finally {
      setWaSaving(false);
    }
  }

  async function handleClearWhatsAppToken() {
    const ok = await confirmDialog({
      title: 'Remove the saved WhatsApp access token?',
      message: 'Automatic sending stops until a new token is saved.',
      confirmText: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    setWaSaving(true);
    try {
      const res = await saveWhatsAppCloudConfig({
        enabled: !!waDraft.enabled,
        phoneNumberId: String(waDraft.phoneNumberId || '').trim(),
        apiVersion: String(waDraft.apiVersion || 'v21.0').trim() || 'v21.0',
        clearToken: true,
      });
      setWaStatus((s) => ({ ...(s || {}), ...res }));
      showToast({ type: 'info', message: 'Access token removed.' });
    } catch (err) {
      showToast({ type: 'error', message: integrationError(err, 'WhatsApp') });
    } finally {
      setWaSaving(false);
    }
  }

  async function handleSendWhatsAppTest() {
    const to = String(waTestTo || '').trim();
    const text = String(waTestText || '').trim();
    if (!to || !text) {
      showToast({ type: 'error', message: 'Enter a mobile number and a message to test.' });
      return;
    }
    setWaSending(true);
    try {
      const res = await sendWhatsAppCloudMessage({ to, text });
      if (res?.skipped === 'not-configured') {
        showToast({ type: 'info', message: 'Not sent — save a token and tick Enable first.' });
      } else if (res?.ok) {
        showToast({ type: 'success', message: `Sent ✓${res.id ? ` (id ${res.id})` : ''}.` });
      } else {
        showToast({ type: 'info', message: 'Done — check the number received it.' });
      }
    } catch (err) {
      showToast({ type: 'error', message: err.message || 'WhatsApp send failed.' });
    } finally {
      setWaSending(false);
    }
  }

  async function handleSaveGoogle() {
    setGcalSaving(true);
    try {
      const res = await saveGoogleCalendarConfig({
        enabled: !!gcalDraft.enabled,
        clientId: String(gcalDraft.clientId || '').trim(),
        clientSecret: String(gcalDraft.clientSecret || '').trim(), // blank keeps the stored secret
      });
      setGcalStatus((s) => ({ ...(s || {}), ...res }));
      setGcalDraft((d) => ({ ...d, clientSecret: '' })); // never keep the secret in component state
      showToast({ type: 'success', message: 'Google Calendar settings saved.' });
    } catch (err) {
      showToast({ type: 'error', message: integrationError(err, 'Google Calendar') });
    } finally {
      setGcalSaving(false);
    }
  }

  async function copyRedirectUri() {
    if (!gcalStatus?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(gcalStatus.redirectUri);
      setGcalCopied(true);
      setTimeout(() => setGcalCopied(false), 2000);
    } catch {
      showToast({ type: 'info', message: 'Couldn’t copy automatically — select the URL and copy it by hand.' });
    }
  }

  if (loading || !draft) return <p className="text-sm text-slate-400">Loading email settings…</p>;

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // The exact contents of functions/schedules.local.json for the times shown —
  // shown in the "apply" box so it can be pasted straight in. Keys match
  // DEFAULT_SCHEDULES in functions/lib/scheduleConfig.js and the FIELD_MAP in
  // functions/pull-schedules.js.
  const scheduleOverlay = SCHEDULE_FIELDS.reduce((acc, f) => {
    acc[f.overlayKey] = String(draft[f.key] || '').trim();
    return acc;
  }, {});
  const scheduleOverlayText = JSON.stringify(scheduleOverlay, null, 2);

  return (
    <div className="space-y-5">
      <SettingsRulesBanner show={readDenied} />

      {/* ── Delivery prerequisite ─────────────────────────────────────────── */}
      <Card className="border-sky-200 bg-sky-50/50 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-sky-900">
          <Mail className="h-4 w-4" /> How these get delivered
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-sky-800">
          Reports are handed to the Firebase <strong>Trigger Email from Firestore</strong> extension, which sends
          them through the SMTP account it is configured with. If that extension is not installed on the project,
          everything below still runs and is recorded in the log — but no mail leaves. Volunteers do not have a real
          email address by default: someone has to fill in <strong>Report email</strong> on their volunteer record.
        </p>
      </Card>

      {/* ── Audience ──────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Users className="h-4 w-4 text-slate-400" /> Who receives these
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Anyone whose role grants <em>Send &amp; Receive Report Emails</em> and has a report email set, plus the
              extra addresses below.
            </p>
          </div>
          <button
            onClick={loadAudience}
            disabled={audienceLoading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', audienceLoading && 'animate-spin')} /> Refresh
          </button>
        </div>

        {audienceLoading && !audience && <p className="text-xs text-slate-400">Working it out…</p>}

        {audience && (
          <div className="space-y-2">
            {audience.count === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Nobody would receive a report right now.</strong> Add a report email to a volunteer whose
                  role has the emails permission, or add an address to the extra recipients below.
                </span>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-600">{audience.count} recipient{audience.count === 1 ? '' : 's'}</p>
                <p className="mt-1 break-words text-xs text-slate-500">{audience.recipients.join(', ')}</p>
              </div>
            )}

            {audience.missingEmail?.length > 0 && (
              <p className="text-xs text-amber-700">
                No report email set (so they get nothing): {audience.missingEmail.join(', ')}
              </p>
            )}
            {audience.dryRun && (
              <p className="flex items-center gap-1 text-xs font-medium text-sky-700">
                <FlaskConical className="h-3.5 w-3.5" /> Dry run is on — nothing is actually being sent.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ── Toggles ───────────────────────────────────────────────────────── */}
      {!canEditSettings && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>
            You can see the setup, send reports and read the log, but not change what everyone else receives. Editing
            the settings below needs the <strong>Manage Message Templates &amp; Email Settings</strong> permission.
          </span>
        </div>
      )}

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Clock className="h-4 w-4 text-slate-400" /> Scheduled reports
        </h3>
        <div className="divide-y divide-slate-100">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-800">{t.title}</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {t.cronKey ? describeCron(draft[t.cronKey]) : t.when}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>
              </div>
              <Toggle
                checked={!!draft[t.key]}
                onChange={(v) => set({ [t.key]: v })}
                label={t.title}
                disabled={!canEditSettings}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* ── Schedule times ────────────────────────────────────────────────── */}
      <Card className="p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <CalendarClock className="h-4 w-4 text-slate-400" /> Schedule times
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          When each job runs, in IST (Asia/Kolkata). You can edit and save a time here, but a Cloud Functions
          schedule is fixed when the functions are deployed — so a change only takes effect after the next deploy,
          using the steps below.
        </p>

        <div className="divide-y divide-slate-100">
          {SCHEDULE_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 sm:pr-4">
                <p className="text-[13px] font-medium text-slate-800">{f.title}</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{describeCron(draft[f.key])}</p>
                <p className="mt-0.5 text-xs text-slate-500">{f.note}</p>
              </div>
              <div className="shrink-0">
                <ScheduleEditor
                  mode={f.mode}
                  cron={draft[f.key]}
                  onChange={(next) => set({ [f.key]: next })}
                  disabled={!canEditSettings}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Applying the change — the half that actually moves the schedule. */}
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">Saving is step 1 of 2 — a new time goes live only after a redeploy.</p>
            <p className="mt-1 text-amber-800">
              Save these settings, then from the <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">functions</code> folder
              either run <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">npm run schedules:pull</code> (it copies
              the saved times into <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">functions/schedules.local.json</code>)
              or paste the block below into that file by hand:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-amber-200 bg-white/70 p-2 font-mono text-[11px] leading-relaxed text-slate-700">{scheduleOverlayText}</pre>
            <p className="mt-2 text-amber-800">
              Then redeploy: <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">firebase deploy --only functions</code>.
              Until then the times above are what <em>will</em> run, not necessarily what is running now.
            </p>
          </div>
        </div>
      </Card>

      {/* ── Birthday & anniversary calendar (Phase 35) ────────────────────── */}
      <Card className="p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <CalendarPlus className="h-4 w-4 text-slate-400" /> Birthday &amp; anniversary calendar
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          A subscribe-once calendar feed: each volunteer adds one private link to Google or Apple Calendar and every
          contact <em>they</em> are responsible for shows up as a yearly all-day event, with the WhatsApp wish a tap
          away. Editing a contact’s date of birth moves the same event rather than adding a duplicate. The shared list
          is rebuilt on the schedule above; the button below rebuilds it right now.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={handleRebuildCalendar} disabled={rebuilding}>
            <RefreshCw className={cn('h-3.5 w-3.5', rebuilding && 'animate-spin')} />
            {rebuilding ? 'Rebuilding…' : 'Rebuild now'}
          </Button>
          <span className="text-xs text-slate-400">
            Refreshes the dataset immediately — useful right after a bulk edit. Subscribed calendars still pick up
            changes on Google/Apple’s own refresh cycle, usually within a day.
          </span>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <Label>Your personal calendar link</Label>
          {!calFeed ? (
            <div className="mt-1">
              <Button variant="ghost" onClick={() => loadCalFeed(false)} disabled={calFeedLoading}>
                {calFeedLoading ? 'Getting your link…' : 'Show my calendar link'}
              </Button>
              <p className="mt-1 text-xs text-slate-400">
                A private URL scoped to exactly what you can see. Treat it like a password — anyone who has it can
                see that same list of birthdays.
              </p>
            </div>
          ) : (
            <div className="mt-1 space-y-2">
              {calFeed.empty && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Your link works, but no contact in your scope has a birthday or anniversary saved yet, so the
                  calendar will be empty until some dates are filled in.
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  readOnly
                  value={calFeed.url}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-600"
                  aria-label="Your calendar subscription URL"
                />
                <Button variant="secondary" onClick={copyCalFeed} className="shrink-0">
                  {copied ? <><CheckCircle2 className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Google Calendar → <em>Other calendars → From URL</em>, paste, and add. Apple Calendar →
                <em> File → New Calendar Subscription</em>. It updates itself from then on.
              </p>
              <button
                type="button"
                onClick={() => loadCalFeed(true)}
                disabled={calFeedLoading}
                className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-rose-600 hover:underline disabled:opacity-50"
              >
                Shared it by mistake? Rotate the link
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* ── WhatsApp Cloud API (Phase 36) ─────────────────────────────────── */}
      <Card className="p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <MessageCircle className="h-4 w-4 text-slate-400" /> WhatsApp Cloud API
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          The one-tap wa.me links elsewhere in the app still need a person to press send. This is the automatic
          sender — messages go straight through Meta’s WhatsApp Cloud API. The access token is stored server-side
          and is never shown here again once saved.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', waStatus?.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            {waStatus?.configured ? 'Configured' : 'Not configured'}
          </span>
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', waStatus?.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            {waStatus?.enabled ? 'Enabled' : 'Off'}
          </span>
          {waStatus?.tokenSet && <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">Token saved</span>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-slate-800">Send automatically through Meta</p>
            <p className="mt-0.5 text-xs text-slate-500">When off, the app only builds wa.me links for a human to send.</p>
          </div>
          <Toggle checked={!!waDraft.enabled} onChange={(v) => setWaDraft((d) => ({ ...d, enabled: v }))} label="Enable WhatsApp Cloud API" disabled={!canEditSettings} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Phone number ID</Label>
            <Input className={LOCKABLE} disabled={!canEditSettings} value={waDraft.phoneNumberId} onChange={(e) => setWaDraft((d) => ({ ...d, phoneNumberId: e.target.value }))} placeholder="From Meta → WhatsApp → API Setup" />
          </div>
          <div>
            <Label>API version</Label>
            <Input className={LOCKABLE} disabled={!canEditSettings} value={waDraft.apiVersion} onChange={(e) => setWaDraft((d) => ({ ...d, apiVersion: e.target.value }))} placeholder="v21.0" />
          </div>
        </div>

        <div className="mt-3">
          <Label>Access token</Label>
          <Input
            type="password"
            className={LOCKABLE}
            disabled={!canEditSettings}
            value={waDraft.accessToken}
            onChange={(e) => setWaDraft((d) => ({ ...d, accessToken: e.target.value }))}
            placeholder={waStatus?.tokenSet ? 'Saved — leave blank to keep it' : 'Paste the permanent access token'}
          />
          <p className="mt-1 text-xs text-slate-400">
            Stored server-side only, never shown again. Use a System User <em>permanent</em> token — the 24-hour test
            token from the dashboard expires overnight.
          </p>
        </div>

        {canEditSettings && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="accent" onClick={handleSaveWhatsApp} disabled={waSaving}>
              {waSaving ? 'Saving…' : 'Save WhatsApp settings'}
            </Button>
            {waStatus?.tokenSet && (
              <Button variant="ghost" onClick={handleClearWhatsAppToken} disabled={waSaving}>Remove token</Button>
            )}
          </div>
        )}

        <div className="mt-4 border-t border-slate-100 pt-3">
          <Label>Send a test message</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={waTestTo} onChange={(e) => setWaTestTo(e.target.value)} placeholder="10-digit mobile" className="sm:w-48" />
            <Input value={waTestText} onChange={(e) => setWaTestText(e.target.value)} placeholder="Message text" className="sm:flex-1" />
            <Button variant="secondary" onClick={handleSendWhatsAppTest} disabled={waSending} className="shrink-0">
              {waSending ? 'Sending…' : 'Send test'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-amber-700">
            Meta only delivers free-form text within 24 hours of the person last messaging your number. For
            unsolicited birthday wishes you must use a pre-approved message <em>template</em> — so this test works
            best sent to a number that has just messaged the business.
          </p>
        </div>
      </Card>

      {/* ── Google Calendar push (Phase 37) ───────────────────────────────── */}
      <Card className="p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <CalendarDays className="h-4 w-4 text-slate-400" /> Google Calendar (per-volunteer push)
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          An optional upgrade over the subscribe-once feed above: once an OAuth client is set up here, each volunteer
          can connect their own Google account from the Reminders screen and press “Sync now” to write their in-scope
          birthdays straight into their calendar — updated in place, never duplicated. The client secret is stored
          server-side and never shown again.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', gcalStatus?.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            {gcalStatus?.configured ? 'Configured' : 'Not configured'}
          </span>
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', gcalStatus?.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            {gcalStatus?.enabled ? 'Enabled' : 'Off'}
          </span>
        </div>

        <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-600">
          <p className="font-medium text-slate-700">One-time setup in the Google Cloud console</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>APIs &amp; Services → Credentials → create an <strong>OAuth client ID</strong> (type “Web application”).</li>
            <li>Under “Authorised redirect URIs”, add the exact URL below.</li>
            <li>Enable the <strong>Google Calendar API</strong> for the project.</li>
            <li>Paste the Client ID and secret here, then tick Enable.</li>
          </ol>
          {gcalStatus?.redirectUri && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={gcalStatus.redirectUri}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-600"
                aria-label="Redirect URI to register in Google Cloud"
              />
              <Button variant="secondary" onClick={copyRedirectUri} className="shrink-0">
                {gcalCopied ? <><CheckCircle2 className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-slate-800">Allow volunteers to connect Google Calendar</p>
            <p className="mt-0.5 text-xs text-slate-500">When off, the Connect button on the Reminders screen stays hidden.</p>
          </div>
          <Toggle checked={!!gcalDraft.enabled} onChange={(v) => setGcalDraft((d) => ({ ...d, enabled: v }))} label="Enable Google Calendar sync" disabled={!canEditSettings} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>OAuth client ID</Label>
            <Input className={LOCKABLE} disabled={!canEditSettings} value={gcalDraft.clientId} onChange={(e) => setGcalDraft((d) => ({ ...d, clientId: e.target.value }))} placeholder="xxxxx.apps.googleusercontent.com" />
          </div>
          <div>
            <Label>OAuth client secret</Label>
            <Input
              type="password"
              className={LOCKABLE}
              disabled={!canEditSettings}
              value={gcalDraft.clientSecret}
              onChange={(e) => setGcalDraft((d) => ({ ...d, clientSecret: e.target.value }))}
              placeholder={gcalStatus?.configured ? 'Saved — leave blank to keep it' : 'From the OAuth client'}
            />
          </div>
        </div>

        {canEditSettings && (
          <div className="mt-4 flex items-center gap-2">
            <Button variant="accent" onClick={handleSaveGoogle} disabled={gcalSaving}>
              {gcalSaving ? 'Saving…' : 'Save Google Calendar settings'}
            </Button>
          </div>
        )}
      </Card>

      {/* ── Sender & safety ───────────────────────────────────────────────── */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Sender &amp; safety</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Sender name</Label>
            <Input
              className={LOCKABLE}
              disabled={!canEditSettings}
              value={draft.senderName || ''}
              onChange={(e) => set({ senderName: e.target.value })}
              placeholder="BAPS Jaipur MDS"
            />
          </div>
          <div>
            <Label>From address</Label>
            <Input
              type="email"
              className={LOCKABLE}
              disabled={!canEditSettings}
              value={draft.fromAddress || ''}
              onChange={(e) => set({ fromAddress: e.target.value })}
              placeholder="Leave blank to use the extension default"
            />
            <p className="mt-1 text-xs text-slate-400">
              Only set this if the address is verified with the SMTP provider — an unverified sender is rejected
              outright, which looks exactly like the automation being broken.
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Recipient cap per send</Label>
            <Input
              type="number" min={1} max={500} inputMode="numeric"
              className={LOCKABLE}
              disabled={!canEditSettings}
              value={draft.maxRecipients}
              onChange={(e) => set({ maxRecipients: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-400">Extra recipients beyond this are dropped and noted in the log.</p>
          </div>
          <div>
            <Label>Extra recipients</Label>
            <Textarea
              rows={3}
              className={LOCKABLE}
              disabled={!canEditSettings}
              value={draft.extraRecipientsText}
              onChange={(e) => set({ extraRecipientsText: e.target.value })}
              placeholder={'sanchalak@example.com\ntrustee@example.com'}
            />
            <p className="mt-1 text-xs text-slate-400">One per line. For people who need the reports but never sign in.</p>
          </div>
        </div>

        <label className={cn(
          'mt-3 flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900',
          !canEditSettings && 'opacity-60',
        )}>
          <input
            type="checkbox"
            checked={!!draft.dryRun}
            disabled={!canEditSettings}
            onChange={(e) => set({ dryRun: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-sky-300 accent-sky-600 disabled:cursor-not-allowed"
          />
          <span>
            <strong className="flex items-center gap-1"><FlaskConical className="h-3 w-3" /> Dry run</strong>
            <span className="mt-0.5 block text-sky-800">
              Build and log every report but send nothing. Worth leaving on for the first few days so the recipient
              list and the numbers can be checked before anything reaches a real inbox. Note that the post-sabha
              report is skipped altogether while this is on, rather than built and discarded — otherwise a sabha
              would be marked as reported without anyone receiving it.
            </span>
          </span>
        </label>

        {canEditSettings && (
          <div className="mt-4 flex items-center gap-2">
            <Button variant="accent" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          </div>
        )}
      </Card>

      {/* ── Manual sends ──────────────────────────────────────────────────── */}
      <Card className="p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Send className="h-4 w-4 text-slate-400" /> Send now
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Sends the report to the recipients listed above right now, whether or not its schedule is switched on. The
          per-volunteer copies are not included — that stays a settings decision. There are no buttons for the
          post-sabha report or the karyakarta calling lists: both need a specific sabha, so they only go out on the
          15-minute check after one has actually finished and its attendance has been marked.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => handleSend('daily', false)} disabled={!!sending}>
            {sending === 'daily' ? 'Sending…' : 'Send daily report'}
          </Button>
          <Button variant="secondary" onClick={() => handleSend('birthday', false)} disabled={!!sending}>
            {sending === 'birthday' ? 'Sending…' : 'Send birthday summary'}
          </Button>
          <Button variant="secondary" onClick={() => handleSend('sabhaCoverage', false)} disabled={!!sending}>
            {sending === 'sabhaCoverage' ? 'Sending…' : 'Send sabha coverage'}
          </Button>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <Label>Send a test to one address</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={testAddress}
              onChange={(e) => setTestAddress(e.target.value)}
              placeholder="you@example.com"
              className="sm:flex-1"
            />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => handleSend('daily', true)} disabled={!!sending}>
                {sending === 'daily-test' ? 'Sending…' : 'Daily'}
              </Button>
              <Button variant="ghost" onClick={() => handleSend('birthday', true)} disabled={!!sending}>
                {sending === 'birthday-test' ? 'Sending…' : 'Birthday'}
              </Button>
              <Button variant="ghost" onClick={() => handleSend('sabhaCoverage', true)} disabled={!!sending}>
                {sending === 'sabhaCoverage-test' ? 'Sending…' : 'Sabha'}
              </Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">Goes only to this address. The real recipient list is untouched.</p>
        </div>
      </Card>

      {/* ── Log ───────────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Recent sends</p>
        {logs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            Nothing sent yet.
          </p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <Card key={log.id} className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">{KIND_LABELS[log.kind] || log.kind}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLES[log.status] || 'bg-slate-100 text-slate-600')}>
                    {log.status === 'queued' && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                    {log.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{log.subject}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {formatTimestamp(log.createdAt)} · {log.recipientCount} recipient{log.recipientCount === 1 ? '' : 's'}
                  {log.attachmentCount > 0 && ` · ${log.attachmentCount} attachment`}
                  {log.truncated > 0 && ` · ${log.truncated} dropped by the cap`}
                  {log.reason && ` · ${log.reason}`}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmailAutomationTab() {
  return (
    <RequirePermission
      permission="send_emails"
      fallback={<p className="text-sm text-slate-500">You don&apos;t have permission to manage report emails.</p>}
    >
      <EmailAutomationInner />
    </RequirePermission>
  );
}
