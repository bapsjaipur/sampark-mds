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
} from 'lucide-react';
import { db } from '../../lib/firebase';
import { saveSettings, describeSettingsError } from '../../services/settingsService';
import { useSettings } from '../../hooks/useSettings';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import RequirePermission from '../RequirePermission';
import SettingsRulesBanner from './SettingsRulesBanner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Label, Textarea } from '../ui/Input';
import { cn } from '../../lib/cn';

const TOGGLES = [
  {
    key: 'autoDailyAdminEnabled',
    title: 'Daily calling report',
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
    key: 'autoBirthdayEnabled',
    title: 'Birthday & anniversary summary',
    when: 'Every morning at 6:10 am',
    description: 'Today’s birthdays and anniversaries with a one-tap WhatsApp link per person. Skipped on days with nobody to wish.',
  },
];

const KIND_LABELS = {
  'daily-admin': 'Daily report',
  'daily-volunteer': 'Daily report (volunteer)',
  'daily-manual': 'Daily report (manual)',
  'post-sabha': 'Post-sabha attendance',
  'post-sabha-manual': 'Post-sabha (manual)',
  birthday: 'Birthday summary',
  'birthday-manual': 'Birthday summary (manual)',
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

    setSaving(true);
    try {
      await saveSettings('email', {
        autoDailyAdminEnabled: !!draft.autoDailyAdminEnabled,
        autoDailyVolunteerEnabled: !!draft.autoDailyVolunteerEnabled,
        autoPostSabhaAdminEnabled: !!draft.autoPostSabhaAdminEnabled,
        autoPostSabhaVolunteerEnabled: !!draft.autoPostSabhaVolunteerEnabled,
        autoBirthdayEnabled: !!draft.autoBirthdayEnabled,
        dryRun: !!draft.dryRun,
        senderName: String(draft.senderName || '').trim(),
        fromAddress: String(draft.fromAddress || '').trim(),
        maxRecipients: cap,
        extraRecipients,
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

  if (loading || !draft) return <p className="text-sm text-slate-400">Loading email settings…</p>;

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

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
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t.when}</p>
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
          per-volunteer copies are not included — that stays a settings decision. There is no button for the post-sabha
          report: it can only be triggered by the 15-minute check after a sabha has actually finished.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => handleSend('daily', false)} disabled={!!sending}>
            {sending === 'daily' ? 'Sending…' : 'Send daily report'}
          </Button>
          <Button variant="secondary" onClick={() => handleSend('birthday', false)} disabled={!!sending}>
            {sending === 'birthday' ? 'Sending…' : 'Send birthday summary'}
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
