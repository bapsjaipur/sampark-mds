// src/components/events/AllAreaSabhas.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 33 — "All Area Sabhas". The third view on the Events page, next to
// Season stats.
//
// "automatically sabha creation will help in seeing track record which area and
//  which day sabha not happen. so easy to fallow up there Volunteer."
//
// So this screen is TWO things stacked, in the order they matter:
//
//   1. THE TRACK RECORD — one row per schedule, one column per week, coloured by
//      what happened. Red is the answer to "which area and which day sabha not
//      happen", and the follow-up list underneath is the phone list that falls
//      out of it: any schedule that has missed two or more in a row.
//   2. THE SETTINGS — the recurrence rules themselves, and the button that
//      materialises the next four weeks of sabhas.
//
// COST. Every number here is derived in memory from the `events` and
// `attendance` subscriptions EventsPage already holds; the only new listener is
// `sabhaSchedules`, which is tens of documents behind useSharedCollection. So
// the whole screen is effectively free to open, the same bargain SabhaAnalytics
// struck. Generation writes one document per missing sabha and nothing else —
// running it twice writes nothing, because the ids are derived.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import {
  CalendarClock, Plus, Pencil, Trash2, Wand2, PhoneCall, Loader2, Pause, Play,
  AlertTriangle, CheckCircle2, CircleDashed, HelpCircle,
} from 'lucide-react';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import SabhaScheduleForm from './SabhaScheduleForm';
import { useSabhaSchedules } from '../../hooks/useSabhaSchedules';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import {
  createSchedule, updateSchedule, deleteSchedule, setScheduleActive, generateMissingEvents,
} from '../../services/sabhaScheduleService';
import {
  buildSabhaCoverage, pendingOccurrences, describeSchedule, formatOccurrenceDate,
  SABHA_STATUS, DEFAULT_WEEKS_AHEAD,
} from '../../lib/sabhaSchedule';
import { matchesScope, writableAreas, writableMandals } from '../../lib/scope';
import { cn } from '../../lib/cn';

// The grid's colour key. Deliberately strong on red — a missed sabha is the one
// cell anybody is scanning for, and a pastel would lose it in the noise.
const CELL_STYLE = {
  held: 'bg-emerald-500 text-white',
  unmarked: 'bg-amber-400 text-white',
  missed: 'bg-rose-500 text-white',
  upcoming: 'bg-sky-200 text-sky-800',
  pending: 'bg-slate-100 text-slate-400',
};

const CELL_GLYPH = { held: '✓', unmarked: '!', missed: '✕', upcoming: '·', pending: '·' };

function Tile({ icon: Icon, label, value, sub, tone = 'slate' }) {
  const TONES = {
    slate: 'bg-slate-50 text-slate-600 ring-slate-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
    rose: 'bg-rose-50 text-rose-600 ring-rose-100',
    sky: 'bg-sky-50 text-sky-600 ring-sky-100',
  };
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className={cn('mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1', TONES[tone])}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-lg font-bold leading-none tracking-tight text-slate-900 sm:text-xl">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{sub}</p>}
    </div>
  );
}

export default function AllAreaSabhas({ events = [], counts = {}, onOpenEvent }) {
  const { volunteer, permissions, scope } = useAuth();
  const { showToast } = useToast();
  const { schedules: allSchedules, loading, error } = useSabhaSchedules();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  const canManage = permissions.includes('manage_events');
  const allowedMandals = writableMandals(scope);
  const allowedAreas = writableAreas(scope);

  // Same client-side scoping the events subscription applies. A schedule always
  // carries both axes, so this is exact rather than best-effort.
  const schedules = useMemo(
    () => allSchedules.filter((s) => matchesScope(scope, { area: s.area, mandal: s.mandal })),
    [allSchedules, scope],
  );

  const coverage = useMemo(
    () => buildSabhaCoverage({ schedules, events, counts }),
    [schedules, events, counts],
  );

  const due = useMemo(
    () => pendingOccurrences({ schedules, events, weeksAhead: DEFAULT_WEEKS_AHEAD }),
    [schedules, events],
  );

  const followUps = coverage.rows.filter((r) => r.needsFollowUp);

  async function handleCreate(data) {
    try {
      await createSchedule({ ...data, createdBy: volunteer?.id || null });
      showToast({ type: 'success', message: 'Schedule created. Generate to fill the calendar.' });
      return true;
    } catch {
      showToast({ type: 'error', message: 'Couldn’t save the schedule.' });
      return false;
    }
  }

  async function handleUpdate(data) {
    try {
      await updateSchedule(editing.id, data);
      // Editing the rule does NOT rewrite sabhas already on the calendar. Those
      // are ordinary events somebody may have edited or already marked, and
      // silently overwriting them would be the one thing this feature must never
      // do. Say so, rather than letting the change look like it didn't apply.
      showToast({ type: 'success', message: 'Schedule updated. Sabhas already created keep their own details.' });
      return true;
    } catch {
      showToast({ type: 'error', message: 'Couldn’t save the schedule.' });
      return false;
    }
  }

  async function handleDelete(schedule) {
    const ok = window.confirm(
      `Delete the ${schedule.mandal} schedule for ${schedule.area}?\n\n`
      + 'Sabhas it already created stay on the calendar with their attendance. '
      + 'Only the recurring rule is removed, so no new ones appear.',
    );
    if (!ok) return;
    try {
      await deleteSchedule(schedule.id);
      showToast({ type: 'success', message: 'Schedule removed.' });
    } catch {
      showToast({ type: 'error', message: 'Couldn’t remove the schedule.' });
    }
  }

  async function handleToggle(schedule) {
    try {
      await setScheduleActive(schedule.id, schedule.active === false);
    } catch {
      showToast({ type: 'error', message: 'Couldn’t change the schedule.' });
    }
  }

  async function handleGenerate() {
    if (!due.length || generating) return;
    setGenerating(true);
    try {
      const res = await generateMissingEvents({
        schedules, existingEvents: events, createdBy: volunteer?.id || null,
      });
      if (res.failed.length) {
        showToast({
          type: res.created ? 'success' : 'error',
          message: res.created
            ? `${res.created} sabha${res.created === 1 ? '' : 's'} created, ${res.failed.length} refused (${res.failed[0].error}).`
            : `Firestore refused all ${res.failed.length} (${res.failed[0].error}).`,
        });
      } else {
        showToast({ type: 'success', message: `${res.created} sabha${res.created === 1 ? '' : 's'} added to the calendar.` });
      }
    } catch {
      showToast({ type: 'error', message: 'Generation failed.' });
    } finally {
      setGenerating(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-4 text-sm text-rose-700">
        <p className="font-medium">Couldn’t load the sabha schedules.</p>
        <p className="mt-1 text-xs text-rose-600">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Summary ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile
          icon={CalendarClock} tone="slate" label="Schedules"
          value={schedules.length}
          sub={`${schedules.filter((s) => s.active !== false).length} active`}
        />
        <Tile
          icon={CheckCircle2} tone="emerald" label="Held"
          value={coverage.totals.held}
          sub="last 8 weeks, attendance marked"
        />
        <Tile
          icon={AlertTriangle} tone="rose" label="Not held"
          value={coverage.totals.missed}
          sub={`${coverage.totals.unmarked} held but never marked`}
        />
        <Tile
          icon={PhoneCall} tone="amber" label="Need follow-up"
          value={followUps.length}
          sub="2+ sabhas missed in a row"
        />
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Track record — last 8 weeks and next 3
          </p>
          <button
            onClick={() => setLegendOpen((v) => !v)}
            className="text-slate-400 hover:text-slate-600"
            aria-label="What the colours mean"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={due.length ? 'accent' : 'secondary'}
              size="sm"
              onClick={handleGenerate}
              disabled={!due.length || generating}
              title={due.length
                ? `Creates ${due.length} sabha${due.length === 1 ? '' : 's'} over the next ${DEFAULT_WEEKS_AHEAD} weeks`
                : 'Every sabha for the next few weeks already exists'}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {due.length ? `Generate next ${DEFAULT_WEEKS_AHEAD} weeks (${due.length})` : 'Calendar up to date'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> New schedule
            </Button>
          </div>
        )}
      </div>

      {legendOpen && (
        <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-3">
          {Object.values(SABHA_STATUS).map((s) => (
            <div key={s.key} className="flex items-start gap-2">
              <span className={cn('mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold', CELL_STYLE[s.key])}>
                {CELL_GLYPH[s.key]}
              </span>
              <span className="text-[11px] leading-snug text-slate-500">
                <span className="font-medium text-slate-700">{s.label}</span> — {s.blurb}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── The grid ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : schedules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <CalendarClock className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">No recurring sabhas set up yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
            Add one rule per area — “Sanganer, Bal Mandal, every Sunday at 17:00” — and the sabhas
            appear on the calendar by themselves. Each one can still be edited afterwards, and this
            grid then shows which areas are meeting and which have quietly stopped.
          </p>
          {canManage && (
            <Button variant="accent" size="sm" className="mt-4" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Add the first schedule
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white [scrollbar-width:thin]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Area · Mandal
                </th>
                {coverage.weeks.map((w) => (
                  <th
                    key={w.start}
                    className={cn(
                      'px-1 py-2 text-center text-[10px] font-medium',
                      w.isCurrent ? 'text-orange-600' : w.isFuture ? 'text-slate-300' : 'text-slate-400',
                    )}
                    title={`Week of ${w.label}`}
                  >
                    {w.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverage.rows.map((row) => (
                <tr key={row.schedule.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="sticky left-0 z-10 min-w-[190px] bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-medium text-slate-800">{row.schedule.area}</p>
                      {row.schedule.active === false && <Badge tone="slate">Paused</Badge>}
                      {row.needsFollowUp && <Badge tone="red">{row.missStreak} missed</Badge>}
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      {row.schedule.mandal} · {describeSchedule(row.schedule)}
                    </p>
                  </td>
                  {row.cells.map((cell, i) => (
                    <td key={coverage.weeks[i].start} className="px-1 py-2 text-center">
                      {cell ? (
                        <button
                          type="button"
                          onClick={() => cell.eventId && onOpenEvent?.(cell.eventId)}
                          disabled={!cell.eventId}
                          title={`${formatOccurrenceDate(cell.date)} — ${SABHA_STATUS[cell.status].label}`
                            + (cell.status === 'held' ? ` · ${cell.present} present` : '')}
                          className={cn(
                            'inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold leading-none transition',
                            CELL_STYLE[cell.status],
                            cell.eventId ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                          )}
                        >
                          {cell.status === 'held' ? cell.present : CELL_GLYPH[cell.status]}
                        </button>
                      ) : (
                        <span className="inline-block h-6 w-6" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Follow-up list ─────────────────────────────────────────────────── */}
      {followUps.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 sm:p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            <PhoneCall className="h-3.5 w-3.5" /> Follow up with these areas
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-700/70">
            Two or more scheduled sabhas in a row with nothing recorded. Either the sabha stopped
            happening, or it happened and nobody marked attendance — both are worth one phone call.
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {followUps.map((row) => (
              <li key={row.schedule.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-2">
                <span className="text-[13px] font-medium text-slate-800">
                  {row.schedule.area} · {row.schedule.mandal}
                </span>
                <span className="text-[11px] text-slate-400">
                  {row.missStreak} in a row ·{' '}
                  {row.lastHeld ? `last held ${formatOccurrenceDate(row.lastHeld)}` : 'never recorded'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── The rules themselves ───────────────────────────────────────────── */}
      {schedules.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Recurring settings ({schedules.length})
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {schedules.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-slate-800">
                    {s.area} · {s.mandal}
                    {s.active === false && <Badge tone="slate">Paused</Badge>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{describeSchedule(s)}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {s.durationMinutes || 120} min
                    {s.speaker ? ` · ${s.speaker}` : ''}
                    {s.endDate ? ` · until ${formatOccurrenceDate(s.endDate)}` : ''}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost" size="icon" onClick={() => handleToggle(s)}
                      aria-label={s.active === false ? 'Resume schedule' : 'Pause schedule'}
                      title={s.active === false ? 'Resume' : 'Pause'}
                    >
                      {s.active === false ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(s); setFormOpen(true); }} aria-label="Edit schedule">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(s)} aria-label="Delete schedule" className="hover:text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What the button is about to do, spelled out — a write to the shared
          calendar should never be a surprise. */}
      {canManage && due.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
          <CircleDashed className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {due.length} sabha{due.length === 1 ? '' : 's'} due and not yet on the calendar, up to{' '}
            {formatOccurrenceDate(due[due.length - 1].date)}. Generating creates them with the
            schedule’s time and speaker; each can be edited afterwards. Running it again does nothing —
            sabhas that already exist are left exactly as they are.
          </span>
        </p>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit recurring sabha' : 'New recurring sabha'}
        size="lg"
      >
        <SabhaScheduleForm
          schedule={editing}
          allowedMandals={allowedMandals}
          allowedAreas={allowedAreas}
          onSubmit={editing ? handleUpdate : handleCreate}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>
    </div>
  );
}
