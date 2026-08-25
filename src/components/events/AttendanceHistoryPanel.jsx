// src/components/events/AttendanceHistoryPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// "Last / previous sabha attendance" for one contact.
//
// Two renderings of the same data:
//   variant="full"    — the card on the contact's profile: rate, streak-ish
//                       summary, then every sabha they were marked at.
//   variant="compact" — a single line for the calling screen, where the useful
//                       question is "did they come last time?" and there is no
//                       room for a list.
//
// The data comes back live (useAttendanceHistory), so marking someone present
// on the events screen updates this without a reload.
// ─────────────────────────────────────────────────────────────────────────────
import { CalendarCheck, CalendarX, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useAttendanceHistory } from '../../hooks/useAttendanceHistory';
import { cn } from '../../lib/cn';

function fmt(dateStr, opts) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-IN', opts);
}

function rateTone(rate) {
  if (rate === null) return 'bg-slate-100 text-slate-600 border-slate-200';
  if (rate >= 70) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (rate >= 40) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

export default function AttendanceHistoryPanel({ individualId, individual, variant = 'full', className }) {
  const { history, last, total, eligibleCount, attendedEligible, rate, loading } =
    useAttendanceHistory(individualId, individual);
  const [expanded, setExpanded] = useState(false);

  // ── Compact: one line for the calling screen ──────────────────────────────
  if (variant === 'compact') {
    if (loading) {
      return <div className={cn('h-7 w-40 animate-pulse rounded-full bg-slate-100', className)} />;
    }
    if (total === 0) {
      return (
        <span className={cn('inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500', className)}>
          <CalendarX className="h-3 w-3" /> No sabha attendance recorded
        </span>
      );
    }
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium', rateTone(rate), className)}>
        <CalendarCheck className="h-3 w-3" />
        Last sabha {fmt(last?.date, { day: 'numeric', month: 'short' })} · {total} attended
        {rate !== null && ` · ${rate}%`}
      </span>
    );
  }

  // ── Full: profile card ────────────────────────────────────────────────────
  const visible = expanded ? history : history.slice(0, 5);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <CalendarCheck className="h-4 w-4 text-slate-400" /> Sabha attendance
        </h2>
        {!loading && (
          <span className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', rateTone(rate))}>
            {rate === null ? 'No past sabhas yet' : `${rate}% · ${attendedEligible} of ${eligibleCount}`}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      ) : total === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-400">
          Never marked present at a sabha.
          {eligibleCount > 0 && ` ${eligibleCount} past sabha${eligibleCount === 1 ? '' : 's'} they could have attended.`}
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-400">
            Attendance is only recorded when someone marks it — a sabha missing from this list may simply never have been
            marked, rather than having been missed.
          </p>
          <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100">
            {visible.map((row, idx) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  idx === 0 && !expanded ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
                )}>
                  {row.date ? fmt(row.date, { day: 'numeric' }) : '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{row.title}</p>
                  <p className="truncate text-xs text-slate-400">
                    {fmt(row.date, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {row.time && ` · ${row.time}`}
                    {row.mandal && ` · ${row.mandal}`}
                  </p>
                </div>
                {idx === 0 && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Latest</span>}
              </li>
            ))}
          </ul>
          {history.length > 5 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline"
            >
              {expanded
                ? <>Show less <ChevronUp className="h-3 w-3" /></>
                : <>Show all {history.length} <ChevronDown className="h-3 w-3" /></>}
            </button>
          )}
        </>
      )}
    </div>
  );
}
