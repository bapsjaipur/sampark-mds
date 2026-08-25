// src/components/admin-tools/FirestoreUsageTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — "how much of today's free quota have we used?"
//
// The Spark plan allows 50,000 document reads, 20,000 writes and 20,000 deletes a
// day. When that runs out the app simply stops answering, which is a very bad way
// to find out. Firebase has no API that reports the live figure — the console reads
// it from the billing pipeline, which a client cannot see — so this screen adds up
// what the app itself asked for.
//
// Two numbers, and they mean different things:
//
//   THIS DEVICE  — live, exact, updated as you click. Counted by src/lib/usageMeter
//                  from the instrumented queries.
//   THE TEAM     — every volunteer's own tally, which their heartbeat writes onto
//                  their volunteer document every ten minutes. So it lags by up to
//                  ten minutes per person, and someone who closed the app mid-cycle
//                  is short by whatever they spent after their last beat.
//
// Both are a FLOOR, not the truth: only instrumented paths are counted, and the
// tally is per-browser (a clear of site data resets it). The Firebase console
// remains the authority. What this screen is genuinely good for is proportion —
// which screens are expensive, and whether today is heading for the ceiling.
//
// The day boundary is midnight America/Los_Angeles, because that is when Google
// resets the quota. Counting by Indian local date would look like a fresh 50,000 at
// 12:30 pm IST while the real allowance was nearly spent.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Activity, RotateCcw, Info, Gauge } from 'lucide-react';
import {
  FREE_TIER, quotaDay, getUsage, subscribeUsage, usagePct, resetUsage,
} from '../../lib/usageMeter';
import { sharedStores } from '../../lib/sharedQuery';
import { useVolunteers } from '../../hooks/useVolunteers';
import { useAuth } from '../../hooks/usePermissions';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../../lib/cn';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

/** Green under half, amber past 70%, red past 90% — the colour IS the warning. */
function barTone(pct) {
  if (pct >= 90) return { bar: 'bg-rose-500', text: 'text-rose-600' };
  if (pct >= 70) return { bar: 'bg-amber-500', text: 'text-amber-600' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-600' };
}

function QuotaBar({ label, used, limit, hint }) {
  const pct = usagePct(used, limit);
  const tone = barTone(pct);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-slate-700">{label}</p>
        <p className="text-[13px] text-slate-500">
          <span className={cn('font-semibold', tone.text)}>{fmt(used)}</span>
          <span className="text-slate-400"> / {fmt(limit)}</span>
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full transition-all', tone.bar)} style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-400">{pct}% of today&apos;s free allowance{hint ? ` · ${hint}` : ''}</p>
    </div>
  );
}

export default function FirestoreUsageTab() {
  const [usage, setUsage] = useState(getUsage);
  const [stores, setStores] = useState(() => sharedStores());
  const { volunteers } = useVolunteers();
  const { volunteer } = useAuth();
  const myId = volunteer?.id || null;

  useEffect(() => subscribeUsage(setUsage), []);

  // The listener table is a live diagnostic, so it is polled rather than pushed —
  // subscribing to the store map would mean plumbing an event bus through
  // sharedQuery for a panel almost nobody has open.
  useEffect(() => {
    const t = setInterval(() => setStores(sharedStores()), 2000);
    return () => clearInterval(t);
  }, []);

  const today = quotaDay();

  // Everyone whose last heartbeat was stamped inside TODAY's quota day. A stale
  // tally from yesterday must not be added in — it would inflate the total and
  // make the day look lost before it started.
  const team = useMemo(() => {
    const rows = volunteers
      .map((v) => ({ id: v.id, name: v.name || v.mobile || v.id, u: v.usage }))
      .filter((r) => (r.id === myId) || (r.u && r.u.day === today))
      .map((r) => {
        // This device's own row comes from the live meter rather than from its last
        // heartbeat, which can be up to ten minutes old.
        const src = r.id === myId ? usage : r.u;
        return {
          id: r.id,
          name: r.id === myId ? `${r.name} (this device)` : r.name,
          reads: Number(src.reads) || 0,
          writes: Number(src.writes) || 0,
          deletes: Number(src.deletes) || 0,
          at: r.id === myId ? Date.now() : (Number(r.u?.at) || 0),
        };
      })
      .sort((a, b) => b.reads - a.reads);
    return {
      rows,
      reads: rows.reduce((s, r) => s + r.reads, 0),
      writes: rows.reduce((s, r) => s + r.writes, 0),
      deletes: rows.reduce((s, r) => s + r.deletes, 0),
      reporting: rows.length,
      silent: Math.max(0, volunteers.length - rows.length),
    };
  }, [volunteers, today, myId, usage]);

  const sources = useMemo(() => Object.entries(usage.bySource || {})
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.reads + b.writes) - (a.reads + a.writes))
    .slice(0, 12), [usage.bySource]);

  const liveStores = stores.filter((s) => !s.idle);
  const idleStores = stores.filter((s) => s.idle);

  return (
    <div className="space-y-5">
      {/* ── This device ───────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
            <div>
              <p className="text-sm font-semibold text-slate-900">This device, today</p>
              <p className="text-xs text-slate-400">
                Quota day {today} (resets midnight US Pacific · about 12:30 pm IST)
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (window.confirm('Reset this device’s counter to zero? It only clears the local tally — it does not give you more quota.')) resetUsage();
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset counter
          </Button>
        </div>

        <div className="space-y-4">
          <QuotaBar label="Document reads" used={usage.reads} limit={FREE_TIER.reads} />
          <QuotaBar label="Document writes" used={usage.writes} limit={FREE_TIER.writes} />
          <QuotaBar label="Document deletes" used={usage.deletes} limit={FREE_TIER.deletes} />
        </div>
      </Card>

      {/* ── Everyone ──────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="mb-1 flex items-start gap-2.5">
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Everyone, today</p>
            <p className="text-xs text-slate-400">
              {team.reporting} {team.reporting === 1 ? 'person has' : 'people have'} reported in today
              {team.silent > 0 && ` · ${team.silent} not seen today`} · each figure is up to 10 minutes behind
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <QuotaBar label="Document reads" used={team.reads} limit={FREE_TIER.reads} hint="sum of every device that checked in" />
          <QuotaBar label="Document writes" used={team.writes} limit={FREE_TIER.writes} />
        </div>

        {team.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-medium">Volunteer</th>
                  <th className="py-2 pr-3 text-right font-medium">Reads</th>
                  <th className="py-2 pr-3 text-right font-medium">Writes</th>
                  <th className="py-2 text-right font-medium">Last check-in</th>
                </tr>
              </thead>
              <tbody>
                {team.rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-3 text-slate-700">{r.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{fmt(r.reads)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{fmt(r.writes)}</td>
                    <td className="py-2 text-right text-xs text-slate-400">
                      {r.at ? new Date(r.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Where the reads went ──────────────────────────────────────────── */}
      <Card className="p-5">
        <p className="text-sm font-semibold text-slate-900">Where this device&apos;s reads went</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Highest first. A big number next to one list is the place to look when a day runs short.
        </p>
        {sources.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Nothing counted yet this session.</p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {sources.map((s) => (
              <div key={s.name} className="flex items-baseline justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{s.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {s.reads > 0 && <>{fmt(s.reads)} reads</>}
                  {s.reads > 0 && (s.writes > 0 || s.deletes > 0) && ' · '}
                  {s.writes > 0 && <>{fmt(s.writes)} writes</>}
                  {s.writes > 0 && s.deletes > 0 && ' · '}
                  {s.deletes > 0 && <>{fmt(s.deletes)} deletes</>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Open listeners ───────────────────────────────────────────────── */}
      <Card className="p-5">
        <p className="text-sm font-semibold text-slate-900">Open listeners right now</p>
        <p className="mt-0.5 text-xs text-slate-400">
          One per query for the whole app, shared between every screen that asked for it.
          &ldquo;Idle&rdquo; means nothing is watching it any more and it closes shortly.
        </p>
        {stores.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">None open.</p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {[...liveStores, ...idleStores].map((s) => (
              <div key={s.key} className="flex items-baseline justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600">{s.key}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {fmt(s.docs)} docs · {s.watchers} watching
                  {s.idle && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-400">idle</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 p-4 text-xs text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <p>
          These are estimates from the app&apos;s own instrumented queries, kept per browser — treat
          them as a floor and Firebase&apos;s own Usage page as the truth. Reads served from the
          on-device cache are correctly counted as free, which is why a reload usually adds almost
          nothing. If a number here climbs fast, the &ldquo;where the reads went&rdquo; list above
          names the screen responsible.
        </p>
      </div>
    </div>
  );
}
