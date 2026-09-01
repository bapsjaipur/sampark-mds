// src/components/sampark/ResetRoundModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 29 — resetting the dashboard.
//
// The dashboard has no numbers of its own. "Called 468", the progress bar, every
// outcome row and every mandal row are all one field read back: `status` on the
// contact. Which is why the dashboard never went down — nothing on the screen
// could clear that field, and the only reset in the app lived on Batches →
// Generate, scoped to whatever the generator preview happened to be counting.
// An admin looking at a stale 468 had no way to act on it from where they were
// standing.
//
// So the reset belongs here, and it can be sharper than the generator's because
// of one accident of the dashboard's design: the contacts are ALREADY loaded, via
// the shared listener. Picking who to clear therefore costs zero reads, and the
// choice can be as fine as the numbers on the screen behind it — all of them,
// one outcome ("just the No Answers, try them again"), or one mandal.
//
// WHAT IT WILL NOT DO. It clears the working column, not the record of the work:
// every logged call in `activity`, every sabha attendance mark, every frozen
// round verdict and the contact records themselves are untouched, and each
// clearance writes its own audit row. See resetCallStatuses() in batchService.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, AlertTriangle, Loader2, Check } from 'lucide-react';
import { resetCallStatuses } from '../../services/batchService';
import { useAuth } from '../../hooks/usePermissions';
import { useCallOutcomes } from '../../hooks/useCallOutcomes';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select, Label } from '../ui/Input';
import { cn } from '../../lib/cn';

// Two writes land per contact — the contact itself and its audit row. Spelled
// out on screen because this is the one action here that can move thousands of
// writes at once, and the project runs on the free plan's 20,000 a day.
const WRITES_PER_CONTACT = 2;
const DAILY_WRITE_LIMIT = 20000;

export default function ResetRoundModal({ open, onClose, individuals = [], scopeLabel = '' }) {
  const { volunteer } = useAuth();
  const { colorClasses: statusColorClasses } = useCallOutcomes();
  const { showToast } = useToast();

  const [mode, setMode] = useState('all');
  const [pickedStatus, setPickedStatus] = useState('');
  const [pickedMandal, setPickedMandal] = useState('');
  const [clearCallCount, setClearCallCount] = useState(false);
  const [keepNotes, setKeepNotes] = useState(false);
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);

  // Everyone the dashboard counted as called, and the two breakdowns the two
  // narrow modes offer. One pass, recomputed only when the list changes.
  const { called, byStatus, byMandal } = useMemo(() => {
    const list = individuals.filter((i) => i.status);
    const s = new Map();
    const m = new Map();
    for (const i of list) {
      s.set(i.status, (s.get(i.status) || 0) + 1);
      const key = i.mandal || 'Unassigned';
      m.set(key, (m.get(key) || 0) + 1);
    }
    return { called: list, byStatus: s, byMandal: m };
  }, [individuals]);

  useEffect(() => {
    if (!open) return;
    setMode('all');
    setPickedStatus('');
    setPickedMandal('');
    setClearCallCount(false);
    setKeepNotes(false);
    setArmed(false);
    setProgress(null);
  }, [open]);

  // Re-arming has to happen on every change to what would be cleared, otherwise
  // a confirm tap could land on a different set than the one it was aimed at.
  useEffect(() => { setArmed(false); }, [mode, pickedStatus, pickedMandal, clearCallCount, keepNotes]);

  const target = useMemo(() => {
    if (mode === 'status') return pickedStatus ? called.filter((i) => i.status === pickedStatus) : [];
    if (mode === 'mandal') return pickedMandal ? called.filter((i) => (i.mandal || 'Unassigned') === pickedMandal) : [];
    return called;
  }, [mode, pickedStatus, pickedMandal, called]);

  const n = target.length;
  const writes = n * WRITES_PER_CONTACT;

  async function handleReset() {
    if (!n || running) return;
    if (!armed) { setArmed(true); return; }

    setRunning(true);
    setProgress({ done: 0, total: n });
    try {
      const res = await resetCallStatuses({
        individualIds: target.map((i) => i.id),
        resetBy: volunteer?.id,
        clearCallCount,
        keepNotes,
        note: mode === 'status'
          ? `Cleared “${pickedStatus}” for a new calling round (Dashboard)`
          : mode === 'mandal'
            ? `Cleared ${pickedMandal} for a new calling round (Dashboard)`
            : 'Cleared for a new calling round (Dashboard)',
        onProgress: setProgress,
      });
      showToast({
        type: 'success',
        message: `Cleared ${res.reset} outcome${res.reset === 1 ? '' : 's'}. The dashboard is back to zero called.`,
      });
      onClose?.();
    } catch (err) {
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Firestore refused the clear — your role needs Edit Contacts, and a scoped role can only clear contacts inside its own area and mandal. Some contacts may already have been cleared.'
          : `Couldn’t finish the reset — ${err.message}`,
      });
    } finally {
      setRunning(false);
      setProgress(null);
      setArmed(false);
    }
  }

  const statusRows = [...byStatus.entries()].sort((a, b) => b[1] - a[1]);
  const mandalRows = [...byMandal.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <Modal open={open} onClose={running ? () => {} : onClose} title="Start a new calling round" size="lg">
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-slate-500">
          The dashboard counts a contact as <strong>called</strong> for as long as they carry an outcome.
          Clearing the outcome is what starts a fresh round — those contacts drop back to zero here, and the
          batch generator can reach them again next week.
          {scopeLabel && <> Only contacts in <strong>{scopeLabel}</strong> can be cleared from this screen.</>}
        </p>

        {called.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            Nothing to reset — no contact on this dashboard has an outcome yet.
          </div>
        ) : (
          <>
            {/* ── What to clear ──────────────────────────────────────────── */}
            <div>
              <Label>What to clear</Label>
              <div className="mt-1.5 space-y-1.5">
                <ModeRow
                  active={mode === 'all'}
                  onClick={() => setMode('all')}
                  title="Every outcome on this dashboard"
                  hint="The whole round is over and a new one starts."
                  count={called.length}
                />
                <ModeRow
                  active={mode === 'status'}
                  onClick={() => setMode('status')}
                  title="Only one outcome"
                  hint="Try the No Answers again without disturbing anyone who gave a real answer."
                  count={mode === 'status' && pickedStatus ? n : null}
                />
                {mode === 'status' && (
                  <div className="pl-3">
                    <Select value={pickedStatus} onChange={(e) => setPickedStatus(e.target.value)}>
                      <option value="">Pick an outcome…</option>
                      {statusRows.map(([s, c]) => (
                        <option key={s} value={s}>{s} — {c}</option>
                      ))}
                    </Select>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {statusRows.slice(0, 8).map(([s, c]) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPickedStatus(s)}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                            pickedStatus === s
                              ? statusColorClasses(s)
                              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                          )}
                        >
                          {s} · {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <ModeRow
                  active={mode === 'mandal'}
                  onClick={() => setMode('mandal')}
                  title="Only one mandal"
                  hint="One mandal finished its round ahead of the others."
                  count={mode === 'mandal' && pickedMandal ? n : null}
                />
                {mode === 'mandal' && (
                  <div className="pl-3">
                    <Select value={pickedMandal} onChange={(e) => setPickedMandal(e.target.value)}>
                      <option value="">Pick a mandal…</option>
                      {mandalRows.map(([m, c]) => (
                        <option key={m} value={m}>{m} — {c} called</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* ── Options ────────────────────────────────────────────────── */}
            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <CheckRow
                checked={clearCallCount}
                onChange={setClearCallCount}
                label="Also reset call counts to zero"
                hint="The “3 calls” chip on the calling screen starts again. Every logged call stays in the audit trail."
              />
              <CheckRow
                checked={keepNotes}
                onChange={setKeepNotes}
                label="Keep the reference notes"
                hint="Recommended — “after his exams” is usually the most useful thing to carry into the next call."
              />
            </div>

            {/* ── What is about to happen ────────────────────────────────── */}
            <div className={cn(
              'rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed',
              n ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-500',
            )}>
              {n ? (
                <>
                  <p className="font-semibold">
                    {n} outcome{n === 1 ? '' : 's'} will be cleared
                    {clearCallCount ? ', along with their call counts' : ''}
                    {keepNotes ? '. Notes are kept' : ' and their notes'}.
                  </p>
                  <p className="mt-1">
                    Kept either way: every logged call, every sabha attendance, the frozen result of the last
                    round, and the contact records themselves. Each clearance is written to the audit trail.
                  </p>
                  <p className="mt-1 tabular-nums opacity-80">
                    ≈{writes.toLocaleString()} writes of the {DAILY_WRITE_LIMIT.toLocaleString()}/day free limit
                    {writes > DAILY_WRITE_LIMIT / 2 && ' — that is a big share of today’s budget'}.
                  </p>
                </>
              ) : (
                <p>Pick {mode === 'status' ? 'an outcome' : 'a mandal'} above to see what would be cleared.</p>
              )}
            </div>

            {progress && (
              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-orange-500 transition-all"
                    style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-slate-400">
                  Cleared {progress.done} of {progress.total}… leave this open until it finishes.
                </p>
              </div>
            )}

            {/* Two deliberate taps rather than a typed phrase: this screen is
                used on a phone, and "type DELETE ALL" on a phone keyboard is
                friction that gets worked around, not respected. */}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose} disabled={running} className="sm:w-auto">
                Cancel
              </Button>
              <Button
                variant={armed ? 'dangerSolid' : 'danger'}
                onClick={handleReset}
                disabled={!n || running}
                className="sm:w-auto"
              >
                {running
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Clearing…</>
                  : armed
                    ? <><AlertTriangle className="h-4 w-4" /> Tap again — this cannot be undone</>
                    : <><RotateCcw className="h-4 w-4" /> Clear {n} outcome{n === 1 ? '' : 's'}</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ModeRow({ active, onClick, title, hint, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition',
        active ? 'border-orange-300 bg-orange-50/60' : 'border-slate-200 bg-white hover:bg-slate-50',
      )}
    >
      <span className={cn(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
        active ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-300',
      )}>
        {active && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-slate-800">{title}</span>
          {count != null && (
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500">{count}</span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{hint}</span>
      </span>
    </button>
  );
}

function CheckRow({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-orange-600 focus:ring-orange-400"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-700">{label}</span>
        <span className="block text-[11px] leading-snug text-slate-400">{hint}</span>
      </span>
    </label>
  );
}
