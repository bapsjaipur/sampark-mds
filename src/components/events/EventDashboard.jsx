// src/components/events/EventDashboard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The admin read of one sabha — current or past.
//
// Everything here is derived from data the events screen already holds, so this
// adds no reads. It answers the four questions an admin actually asks after a
// sabha: how many came, how that compares to the last few, which Mandals showed
// up, and — the one the marking screen can't answer — who in scope didn't come.
//
// "Absent" is a soft claim: attendance is only recorded when someone marks it,
// so an unmarked person may simply have been missed. The copy says so rather
// than presenting the list as fact.
//
// PHASE 27 — one exception to "no reads": RoundReviewPanel asks for the batches
// tagged to this sabha (one indexed equality query, ~20 documents) so it can
// cross what people promised on the phone against who actually turned up. It is
// mounted only once the sabha has started, so browsing next week's sabha is
// still free.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import {
  Users, TrendingUp, TrendingDown, Minus, Clock, MapPin, PieChart,
  UserX, ChevronDown, ChevronUp, Percent,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatEventDate, formatEventTime } from '../../lib/eventExports';
import RoundReviewPanel from './RoundReviewPanel';
import { Avatar } from '../ui/Avatar';
import { cn } from '../../lib/cn';
import { eventAreas, areaLabel } from '../../lib/scope';

function StatTile({ icon: Icon, label, value, sub, tone = 'slate' }) {
  const TONES = {
    slate: 'bg-slate-50 text-slate-600 ring-slate-100',
    orange: 'bg-orange-50 text-orange-600 ring-orange-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    sky: 'bg-sky-50 text-sky-600 ring-sky-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  };
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 sm:p-4">
      <div className={cn('mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1', TONES[tone])}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-xl font-bold leading-none tracking-tight text-slate-900 sm:text-2xl">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function BarList({ title, entries, total, emptyText }) {
  return (
    <div>
      {title && <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>}
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([name, count]) => {
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <li key={name} className="flex items-center gap-2.5">
                <span className="w-24 shrink-0 truncate text-xs text-slate-600 sm:w-32" title={name}>{name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
                <span className="w-14 shrink-0 text-right text-xs font-semibold text-slate-700">
                  {count} <span className="font-normal text-slate-400">{pct}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Arrivals bucketed into 15-minute slots — shows whether people trickled in or
 *  arrived together, which is what decides when to start the sabha. */
function ArrivalTimeline({ rows }) {
  const buckets = useMemo(() => {
    const times = rows.map((r) => r.markedAt).filter(Boolean).sort((a, b) => a - b);
    if (times.length < 2) return [];
    const SLOT = 15 * 60 * 1000;
    const start = Math.floor(times[0].getTime() / SLOT) * SLOT;
    const end = Math.ceil(times[times.length - 1].getTime() / SLOT) * SLOT;
    const count = Math.min(Math.max((end - start) / SLOT, 1), 24);
    const out = Array.from({ length: count }, (_, i) => ({ at: new Date(start + i * SLOT), n: 0 }));
    times.forEach((t) => {
      const idx = Math.min(Math.floor((t.getTime() - start) / SLOT), count - 1);
      out[idx].n += 1;
    });
    return out;
  }, [rows]);

  if (buckets.length === 0) return null;
  const peak = Math.max(...buckets.map((b) => b.n), 1);

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Arrivals · 15-minute slots
      </p>
      <div className="flex h-24 items-end gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {buckets.map((b, i) => (
          <div key={i} className="flex min-w-[18px] flex-1 flex-col items-center gap-1">
            <span className="text-[9px] font-semibold text-slate-500">{b.n || ''}</span>
            <div
              className={cn('w-full rounded-t transition-all', b.n === peak ? 'bg-orange-500' : 'bg-orange-200')}
              style={{ height: `${Math.max((b.n / peak) * 100, b.n ? 6 : 1)}%` }}
              title={`${b.n} at ${b.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`}
            />
            <span className="whitespace-nowrap text-[8px] text-slate-400">
              {b.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Present counts for the surrounding sabhas, so one number has context. */
function TrendStrip({ trend, currentId }) {
  if (trend.length < 2) return null;
  const peak = Math.max(...trend.map((t) => t.count), 1);
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Recent sabhas
      </p>
      <div className="flex h-28 items-end gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {trend.map((t) => {
          const isCurrent = t.event.id === currentId;
          return (
            <div key={t.event.id} className="flex min-w-[38px] flex-1 flex-col items-center gap-1">
              <span className={cn('text-[10px] font-semibold', isCurrent ? 'text-orange-600' : 'text-slate-500')}>{t.count}</span>
              <div
                className={cn('w-full rounded-t transition-all', isCurrent ? 'bg-orange-500' : 'bg-slate-200')}
                style={{ height: `${Math.max((t.count / peak) * 100, t.count ? 6 : 1)}%` }}
                title={`${t.event.title} — ${t.count} present`}
              />
              <span className={cn('whitespace-nowrap text-[9px]', isCurrent ? 'font-semibold text-orange-600' : 'text-slate-400')}>
                {formatEventDate(t.event.date, { day: 'numeric', month: 'short' })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EventDashboard({ event, rows = [], stats, individuals = [], trend = [] }) {
  const [showAllAbsent, setShowAllAbsent] = useState(false);

  // In-scope contacts with no attendance row for this event.
  const absent = useMemo(() => {
    // Phase 34: a joint sabha lists several areas (city-wide is []); an in-scope
    // contact is one in ANY listed area, or everyone when the list is empty —
    // the same widening computeEventStats applies to the "in scope" denominator.
    const areas = eventAreas(event);
    const presentIds = new Set(rows.map((r) => r.id));
    return individuals
      .filter((p) => {
        if (event?.mandal && p.mandal !== event.mandal) return false;
        if (areas.length && !areas.includes(p.area)) return false;
        return !presentIds.has(p.id);
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rows, individuals, event]);

  // Change against the previous sabha in the trend, not the average — "up or
  // down since last time" is the question that gets asked.
  const delta = useMemo(() => {
    const idx = trend.findIndex((t) => t.event.id === event?.id);
    if (idx < 1) return null;
    const prev = trend[idx - 1].count;
    if (!prev) return null;
    return { abs: stats.present - prev, pct: Math.round(((stats.present - prev) / prev) * 100), prev };
  }, [trend, event?.id, stats.present]);

  const DeltaIcon = !delta || delta.abs === 0 ? Minus : delta.abs > 0 ? TrendingUp : TrendingDown;
  const visibleAbsent = showAllAbsent ? absent : absent.slice(0, 8);
  // Date-only rather than isEventPast(): an admin marking the register while the
  // sabha is still running should see the follow-up numbers build up live.
  const hasStarted = Boolean(event?.date && event.date <= new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-6">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl bg-slate-900 p-4 text-white sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-400">Sabha report</p>
        <h3 className="mt-1 text-lg font-semibold leading-tight sm:text-2xl">{event?.title}</h3>
        <p className="mt-1 text-xs text-slate-300 sm:text-sm">
          {[
            formatEventDate(event?.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),
            formatEventTime(event?.time),
            event?.durationMinutes ? `${event.durationMinutes} min` : null,
            event?.speaker ? `Speaker: ${event.speaker}` : null,
            event?.mandal || 'All Mandals',
            areaLabel(event) || 'All Areas',
          ].filter(Boolean).join(' · ')}
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="text-4xl font-bold leading-none tracking-tight sm:text-5xl">{stats.present}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-amber-400">present</p>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span>Turnout</span>
              <span className="font-semibold text-white">
                {stats.pct === null ? '—' : `${stats.pct}%`} of {stats.eligible} in scope
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${Math.min(stats.pct || 0, 100)}%` }}
              />
            </div>
            {delta && (
              <p className={cn(
                'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                delta.abs > 0 ? 'bg-emerald-500/20 text-emerald-300'
                  : delta.abs < 0 ? 'bg-rose-500/20 text-rose-300'
                    : 'bg-white/10 text-slate-300',
              )}>
                <DeltaIcon className="h-3 w-3" />
                {delta.abs > 0 ? '+' : ''}{delta.abs} vs last sabha ({delta.prev})
                {delta.pct !== 0 && ` · ${delta.pct > 0 ? '+' : ''}${delta.pct}%`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Tiles ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Users} label="Present" value={stats.present} sub="marked at this sabha" tone="orange" />
        <StatTile icon={Percent} label="Turnout" value={stats.pct === null ? '—' : `${stats.pct}%`} sub={`of ${stats.eligible} in scope`} tone="emerald" />
        <StatTile
          icon={Clock}
          label="Marking window"
          value={stats.firstMarked ? stats.firstMarked.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'}
          sub={stats.lastMarked ? `last at ${stats.lastMarked.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'nothing marked yet'}
          tone="sky"
        />
        <StatTile icon={MapPin} label="Mandals seen" value={stats.byMandal.length} sub={`${stats.byArea.length} area${stats.byArea.length === 1 ? '' : 's'}`} tone="amber" />
      </div>

      {/* ── Did the calling work? ─────────────────────────────────────────────
          PHASE 27. Only once the sabha has started: before that there is no
          register to cross the promises against, and the panel would be five
          zeros. It fetches its own batches, so an upcoming sabha costs nothing. */}
      {hasStarted && <RoundReviewPanel event={event} rows={rows} individuals={individuals} />}

      {/* ── Breakdowns ────────────────────────────────────────────────────── */}
      <div className="grid gap-6 rounded-xl border border-slate-100 p-4 sm:p-5 lg:grid-cols-2">
        <BarList title="By Mandal" entries={stats.byMandal} total={stats.present} emptyText="Nobody marked present yet." />
        <BarList title="By Area" entries={stats.byArea} total={stats.present} emptyText="Nobody marked present yet." />
      </div>

      {(rows.length >= 2 || trend.length >= 2) && (
        <div className="grid gap-6 rounded-xl border border-slate-100 p-4 sm:p-5 lg:grid-cols-2">
          <ArrivalTimeline rows={rows} />
          <TrendStrip trend={trend} currentId={event?.id} />
        </div>
      )}

      {/* ── Sampark status mix ────────────────────────────────────────────── */}
      {stats.byStatus.length > 0 && (
        <div className="rounded-xl border border-slate-100 p-4 sm:p-5">
          <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <PieChart className="h-3.5 w-3.5" /> Sampark status of who came
          </p>
          <BarList title="" entries={stats.byStatus} total={stats.present} emptyText="—" />
        </div>
      )}

      {/* ── Not marked present ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-100 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <UserX className="h-3.5 w-3.5" /> Not marked present ({absent.length})
          </p>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          In scope for this sabha with no attendance row. Attendance is only recorded when someone marks it, so treat
          this as a follow-up list rather than a record of who was absent.
        </p>
        {absent.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/50 py-4 text-center text-sm text-emerald-700">
            Everyone in scope was marked present.
          </p>
        ) : (
          <>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {/* min-w-0 on the <li>: without it the grid item's automatic
                  minimum is the min-content of the row inside — avatar + the
                  longest full name + mobile, ~333px — which widened the whole
                  dashboard column and pushed the page 42px past a 375px
                  viewport. The name is already set up to truncate; it just
                  needed to be allowed to. */}
              {visibleAbsent.map((p) => (
                <li key={p.id} className="min-w-0">
                  <Link
                    to={`/contacts/${p.id}`}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-2.5 py-2 hover:border-slate-200 hover:bg-slate-50"
                  >
                    <Avatar src={p.profilePhotoURL} name={p.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{p.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{p.mobile}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {absent.length > 8 && (
              <button
                onClick={() => setShowAllAbsent((s) => !s)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline"
              >
                {showAllAbsent
                  ? <>Show fewer <ChevronUp className="h-3 w-3" /></>
                  : <>Show all {absent.length} <ChevronDown className="h-3 w-3" /></>}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
