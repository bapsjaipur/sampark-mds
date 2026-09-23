// src/components/admin-tools/GeneralSettingsTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 43 — the app-wide knobs that are not email, templates or outcomes.
//
// Two settings, both living in settings/app (see DEFAULT_APP_SETTINGS). That
// document is deliberately separate from settings/email: its READ is open to
// every volunteer, so the attendance screen and the batch screens can honour
// these without the send_emails gate that guards the email settings. Only the
// WRITE is gated — on manage_templates, the same permission firestore.rules
// requires for every settings/{docId} except niyamDharma — so a role that can
// open Admin Tools but not manage settings sees the values read-only rather than
// a Save button that would only ever produce a permission-denied toast.
//
//   • Attendance window — the hardcoded "opens 30 min before, closes 30 min
//     after" is now a toggle. Off = mark attendance at any time (a late sabha,
//     a next-morning back-fill). See lib/attendanceWindow.js + AttendanceMarking.
//   • Default batch size — the size Generate starts from and the cap a mid-week
//     top-up fills an existing batch to before spilling the rest into a new
//     batch. Was hardcoded (25 on Generate's field, 40 on the Tools top-up),
//     which is exactly how a batch of 22 grew to 36 while the roster was cut in
//     25s. One number now drives both, for every mandal.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Layers, CheckCircle2, Lock, Loader2 } from 'lucide-react';
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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setWindowEnforced(settings.attendanceWindowEnforced !== false);
    setDefaultBatchSize(Number(settings.defaultBatchSize) || 25);
    setDirty(false);
  }, [settings]);

  const sizeError = useMemo(() => {
    const n = Number(defaultBatchSize);
    if (!Number.isFinite(n) || n < 1 || n > 500) return 'Enter a whole number between 1 and 500.';
    return null;
  }, [defaultBatchSize]);

  async function handleSave() {
    if (sizeError) return;
    setSaving(true);
    try {
      await saveSettings('app', {
        attendanceWindowEnforced: windowEnforced,
        defaultBatchSize: Math.max(1, Math.min(500, Math.round(Number(defaultBatchSize)))),
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

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button variant="accent" onClick={handleSave} disabled={!dirty || saving || Boolean(sizeError)}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Save settings</>}
          </Button>
          {dirty && !saving && <span className="text-[11px] text-slate-400">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
