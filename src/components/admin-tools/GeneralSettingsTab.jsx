// src/components/admin-tools/GeneralSettingsTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 43 — the app-wide knobs that are not email, templates or outcomes.
//
// Settings living in settings/app (see DEFAULT_APP_SETTINGS). That document is
// deliberately separate from settings/email: its READ is open to every volunteer,
// so the attendance screen and the batch screens can honour these without the
// send_emails gate that guards the email settings. Only the WRITE is gated — on
// manage_templates, the same permission firestore.rules requires for every
// settings/{docId} except niyamDharma — so a role that can open Admin Tools but
// not manage settings sees the values read-only rather than a Save button that
// would only ever produce a permission-denied toast.
//
//   • Attendance window — the hardcoded "opens 30 min before, closes 30 min
//     after" is now a toggle. Off = mark attendance at any time (a late sabha,
//     a next-morning back-fill). See lib/attendanceWindow.js + AttendanceMarking.
//   • Default batch size — the size Generate starts from and the cap a mid-week
//     top-up fills an existing batch to before spilling the rest into a new
//     batch. Was hardcoded (25 on Generate's field, 40 on the Tools top-up),
//     which is exactly how a batch of 22 grew to 36 while the roster was cut in
//     25s. One number now drives both, for every mandal.
//   • Auto-clear call outcomes (PHASE 46) — off by default. When on, a scheduled
//     job clears the call status + note on a sabha's batched contacts this many
//     hours after the sabha, so the next round starts fresh without a manual
//     reset. See functions/outcomeCleanup.js; the toggle + delay write here.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Layers, Eraser, CheckCircle2, Lock, Loader2, Bell } from 'lucide-react';
import { saveSettings, describeSettingsError } from '../../services/settingsService';
import { useSettings } from '../../hooks/useSettings';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import SettingsRulesBanner from './SettingsRulesBanner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Label } from '../ui/Input';
import { cn } from '../../lib/cn';

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <label
      className={cn('relative inline-flex shrink-0 items-center', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
      aria-label={label}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-orange-500 peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </label>
  );
}

export default function GeneralSettingsTab() {
  const { settings, loading, readDenied } = useSettings('app');
  const { volunteer, hasPermission } = useAuth();
  const { showToast } = useToast();
  const canEdit = hasPermission('manage_templates');

  // Local draft, seeded from the live settings and re-seeded whenever they
  // change from under us. `dirty` gates the Save button so an untouched tab can't
  // write a no-op.
  const [windowEnforced, setWindowEnforced] = useState(true);
  const [defaultBatchSize, setDefaultBatchSize] = useState(25);
  const [clearEnabled, setClearEnabled] = useState(false);
  const [clearDelayHours, setClearDelayHours] = useState(12);
  // PHASE 48 — in-app notification knobs (same settings/app document).
  const [notifyBatchAssigned, setNotifyBatchAssigned] = useState(true);
  const [notifySabhaReminder, setNotifySabhaReminder] = useState(true);
  const [notifyAttendanceMarked, setNotifyAttendanceMarked] = useState(true);
  const [notifyBirthdays, setNotifyBirthdays] = useState(true);
  const [reminderLeadHours, setReminderLeadHours] = useState(24);
  const [retentionDays, setRetentionDays] = useState(30);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setWindowEnforced(settings.attendanceWindowEnforced !== false);
    setDefaultBatchSize(Number(settings.defaultBatchSize) || 25);
    setClearEnabled(settings.autoClearOutcomesEnabled === true);
    setClearDelayHours(Number(settings.clearOutcomesAfterHours) || 12);
    setNotifyBatchAssigned(settings.notifyBatchAssigned !== false);
    setNotifySabhaReminder(settings.notifySabhaReminder !== false);
    setNotifyAttendanceMarked(settings.notifyAttendanceMarked !== false);
    setNotifyBirthdays(settings.notifyBirthdays !== false);
    setReminderLeadHours(Number(settings.sabhaReminderLeadHours) || 24);
    setRetentionDays(Number(settings.notificationRetentionDays) || 30);
    setDirty(false);
  }, [settings]);

  const sizeError = useMemo(() => {
    const n = Number(defaultBatchSize);
    if (!Number.isFinite(n) || n < 1 || n > 500) return 'Enter a whole number between 1 and 500.';
    return null;
  }, [defaultBatchSize]);

  const delayError = useMemo(() => {
    const n = Number(clearDelayHours);
    if (!Number.isFinite(n) || n < 1 || n > 720) return 'Enter a whole number of hours between 1 and 720 (30 days).';
    return null;
  }, [clearDelayHours]);

  // The reminder sweep only looks 7 days ahead (REMINDER_MAX_LOOKAHEAD_DAYS in
  // functions/notifications.js), so a lead longer than that could never fire.
  const leadError = useMemo(() => {
    const n = Number(reminderLeadHours);
    if (!Number.isFinite(n) || n < 1 || n > 168) return 'Enter a whole number of hours between 1 and 168 (7 days).';
    return null;
  }, [reminderLeadHours]);

  const retentionError = useMemo(() => {
    const n = Number(retentionDays);
    if (!Number.isFinite(n) || n < 1 || n > 365) return 'Enter a whole number of days between 1 and 365.';
    return null;
  }, [retentionDays]);

  async function handleSave() {
    if (sizeError || delayError || leadError || retentionError) return;
    setSaving(true);
    try {
      await saveSettings('app', {
        attendanceWindowEnforced: windowEnforced,
        defaultBatchSize: Math.max(1, Math.min(500, Math.round(Number(defaultBatchSize)))),
        autoClearOutcomesEnabled: clearEnabled,
        clearOutcomesAfterHours: Math.max(1, Math.min(720, Math.round(Number(clearDelayHours)))),
        notifyBatchAssigned,
        notifySabhaReminder,
        notifyAttendanceMarked,
        notifyBirthdays,
        sabhaReminderLeadHours: Math.max(1, Math.min(168, Math.round(Number(reminderLeadHours)))),
        notificationRetentionDays: Math.max(1, Math.min(365, Math.round(Number(retentionDays)))),
      }, volunteer?.id);
      setDirty(false);
      showToast({ type: 'success', message: 'App settings saved.' });
    } catch (err) {
      showToast({ type: 'error', message: describeSettingsError(err, readDenied) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading settings…</p>;

  return (
    <div className="space-y-4">
      <SettingsRulesBanner show={readDenied} />

      {!canEdit && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-600">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            These are shown read-only. Changing them needs the
            {' '}<strong>Manage Message Templates &amp; Email Settings</strong> permission.
          </span>
        </div>
      )}

      {/* ── Attendance window ─────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <CalendarClock className="h-4 w-4 text-orange-600" /> Attendance window
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              When on, attendance can only be marked from 30 minutes before a sabha starts until
              30 minutes after it ends — the original behaviour. Turn it off to mark attendance at
              any time, e.g. a sabha that started late or a register filled in the next morning.
            </p>
          </div>
          <Toggle
            checked={windowEnforced}
            disabled={!canEdit}
            onChange={(v) => { setWindowEnforced(v); setDirty(true); }}
            label="Enforce the attendance window"
          />
        </div>
        <p className={cn('mt-2 text-[11px] font-medium', windowEnforced ? 'text-slate-400' : 'text-sky-700')}>
          {windowEnforced ? 'Window enforced — marking is time-limited.' : 'Window off — marking is open at any time.'}
        </p>
      </Card>

      {/* ── Default batch size ────────────────────────────────────────────── */}
      <Card className="p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Layers className="h-4 w-4 text-orange-600" /> Default batch size
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          The number of contacts a batch is cut to on the Generate screen, and the size a mid-week
          top-up fills an existing batch up to before starting a new one. Applies to every mandal.
          Either screen can still type a different size for a single run.
        </p>
        <div className="mt-3 sm:w-40">
          <Label>Contacts per batch</Label>
          <Input
            type="number" min={1} max={500} inputMode="numeric"
            value={defaultBatchSize}
            disabled={!canEdit}
            onChange={(e) => { setDefaultBatchSize(e.target.value); setDirty(true); }}
          />
          {sizeError && <p className="mt-1 text-[11px] text-rose-600">{sizeError}</p>}
        </div>
      </Card>

      {/* ── Auto-clear call outcomes after a sabha ─────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Eraser className="h-4 w-4 text-orange-600" /> Auto-clear call outcomes after a sabha
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              When on, a while after each sabha ends the call status and reference note on the
              contacts in that sabha’s calling batches are cleared automatically, so the next round
              starts fresh — the same as pressing “reset” on the calling screen. Only that sabha’s
              contacts are touched, and the full call history stays in the activity log. Leave off to
              clear rounds by hand.
            </p>
          </div>
          <Toggle
            checked={clearEnabled}
            disabled={!canEdit}
            onChange={(v) => { setClearEnabled(v); setDirty(true); }}
            label="Auto-clear call outcomes after a sabha"
          />
        </div>
        <div className="mt-3 sm:w-48">
          <Label>Clear this many hours after the sabha</Label>
          <Input
            type="number" min={1} max={720} inputMode="numeric"
            value={clearDelayHours}
            disabled={!canEdit || !clearEnabled}
            onChange={(e) => { setClearDelayHours(e.target.value); setDirty(true); }}
          />
          {delayError && <p className="mt-1 text-[11px] text-rose-600">{delayError}</p>}
          <p className="mt-1 text-[11px] text-slate-400">
            Measured from when the sabha ends. 12 hours by default — long enough for the post-sabha
            reports to have gone out first. The sweep runs hourly, so clearing happens within about
            an hour of this mark.
          </p>
        </div>
      </Card>

      {/* ── In-app notifications (PHASE 48) ────────────────────────────────── */}
      <Card className="p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Bell className="h-4 w-4 text-orange-600" /> In-app notifications
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          The notification bell is on for everyone and only ever reaches people whose area, mandal
          and role match — these switches just turn each automatic alert on or off. They do not
          affect hand-sent bulk alerts, which are controlled by the “Send notifications” permission
          in the Roles tab.
        </p>

        <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {[
            ['notifyBatchAssigned', notifyBatchAssigned, setNotifyBatchAssigned,
              'When a batch is assigned', 'The volunteer the batch is handed to gets one bell.'],
            ['notifySabhaReminder', notifySabhaReminder, setNotifySabhaReminder,
              'Sabha reminder', 'Everyone in that sabha’s scope is reminded before it starts.'],
            ['notifyAttendanceMarked', notifyAttendanceMarked, setNotifyAttendanceMarked,
              'When attendance starts', 'That sabha’s area / mandal leaders are told once, when the register is first marked.'],
            ['notifyBirthdays', notifyBirthdays, setNotifyBirthdays,
              'Birthdays & anniversaries', 'Each caller gets a bell listing their own contacts’ birthdays, alongside the daily email.'],
          ].map(([key, value, setter, title, help]) => (
            <div key={key} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-800">{title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{help}</p>
              </div>
              <Toggle
                checked={value}
                disabled={!canEdit}
                onChange={(v) => { setter(v); setDirty(true); }}
                label={title}
              />
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Remind this many hours before a sabha</Label>
            <Input
              type="number" min={1} max={168} inputMode="numeric"
              value={reminderLeadHours}
              disabled={!canEdit || !notifySabhaReminder}
              onChange={(e) => { setReminderLeadHours(e.target.value); setDirty(true); }}
            />
            {leadError && <p className="mt-1 text-[11px] text-rose-600">{leadError}</p>}
            <p className="mt-1 text-[11px] text-slate-400">
              The reminder lands on the first hourly sweep after a sabha enters this window. Up to 7 days.
            </p>
          </div>
          <div>
            <Label>Keep read notifications for (days)</Label>
            <Input
              type="number" min={1} max={365} inputMode="numeric"
              value={retentionDays}
              disabled={!canEdit}
              onChange={(e) => { setRetentionDays(e.target.value); setDirty(true); }}
            />
            {retentionError && <p className="mt-1 text-[11px] text-rose-600">{retentionError}</p>}
            <p className="mt-1 text-[11px] text-slate-400">
              Items you’ve already seen are swept nightly after this long. Unread items are never auto-deleted.
            </p>
          </div>
        </div>
      </Card>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button variant="accent" onClick={handleSave} disabled={!dirty || saving || Boolean(sizeError) || Boolean(delayError) || Boolean(leadError) || Boolean(retentionError)}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Save settings</>}
          </Button>
          {dirty && !saving && <span className="text-[11px] text-slate-400">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
