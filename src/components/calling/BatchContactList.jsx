// src/components/calling/BatchContactList.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 39 — THE WHOLE BATCH, ON ONE SCREEN.
//
// /calling has only ever shown one contact at a time. That is the right shape for
// the calling itself — a 56px outcome grid and nothing else competing for the
// thumb — but it is the wrong shape for every question a karyakarta asks AROUND
// the calling:
//
//   "how many are left?"             → only by tapping Next forty times
//   "did I already ring Mahesh?"     → search finds him, and loses your place
//   "who in Vaishali Nagar is left?" → not answerable at all
//   "I marked someone wrong — who?"  → not answerable at all
//
// So this is a second VIEW of the same queue, not a second screen and not a second
// query. It renders `contacts` exactly as useMyBatchQueue already streamed them,
// which is why the toggle is free: no route, no listener, NO EXTRA READ. Tapping a
// row hands the index back to the card view, so the list is a way IN to calling
// rather than a parallel place to do it — one outcome-writing surface, one audit
// trail.
//
// It honours the active filter for the same reason the header counters do (see the
// Phase 38 note in CallingFlowPage): a list showing 84 names while the chip says
// "Call Back · 6" is the confusion the filter was added to remove.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import { Phone, Check, ChevronRight, Users } from 'lucide-react';
import { cn } from '../../lib/cn';
import { buildTelUrl } from '../../lib/whatsapp';

/**
 * @param {Array}    contacts      rows to show, in queue order (already filtered)
 * @param {Array}    allContacts   the FULL queue — row taps return an index into this
 * @param {number}   currentIdx    which full-queue index the card view is on
 * @param {Function} onPick        (fullQueueIndex) => void
 * @param {Function} onCall        (contact) => void — counts the call, same as the card
 * @param {Function} label         (status) => display label   ─┐ straight from
 * @param {Function} emoji         (status) => emoji or ''      ├─ useCallOutcomes,
 * @param {Function} statusClasses (status) => chip classes    ─┘ so admin renames apply
 * @param {string}   [filterLabel] name of the active filter, if any
 * @param {Map|null} [roundById]   id → { emoji, short, chip } post-sabha verdict,
 *                                 or null before the register is marked. Renders a
 *                                 badge per row so the list doubles as the "who was
 *                                 present / who said yes but didn't come" view.
 */
export default function BatchContactList({
  contacts = [],
  allContacts = [],
  currentIdx = 0,
  onPick,
  onCall,
  label = (v) => v,
  emoji = () => '',
  statusClasses = () => '',
  filterLabel = null,
  roundById = null,
}) {
  // A row tap must jump the card view to the right person, and the card view
  // indexes the FULL queue — so each visible row needs its full-queue position,
  // not its position in the filtered list. Built once per render rather than an
  // indexOf per row: a 100-name batch would otherwise be 100 linear scans.
  const indexById = useMemo(() => {
    const m = new Map();
    allContacts.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [allContacts]);

  // Grouped by mandal, because that is how a karyakarta's evening is actually
  // organised — they ring one mandal's families together, and "who in Vaishali
  // Nagar is left" is the question a flat list of 84 cannot answer. Insertion
  // order is queue order, so the groups come out in the order they'll be called.
  const groups = useMemo(() => {
    const byMandal = new Map();
    for (const c of contacts) {
      const key = c.mandal || 'No Mandal';
      if (!byMandal.has(key)) byMandal.set(key, []);
      byMandal.get(key).push(c);
    }
    return [...byMandal.entries()].map(([mandal, rows]) => ({
      mandal,
      rows,
      done: rows.filter((r) => r.status).length,
    }));
  }, [contacts]);

  if (contacts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <Users className="h-6 w-6 text-slate-300" />
        <p className="mt-3 text-sm text-slate-500">
          {filterLabel ? `Nothing left in ${filterLabel}.` : 'No contacts in your list.'}
        </p>
      </div>
    );
  }

  const currentId = allContacts[currentIdx]?.id;

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      {groups.map((g) => (
        <section key={g.mandal}>
          {/* Sticky, so the mandal you are scrolling through is always named. */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-y border-slate-100 bg-slate-50/95 px-3 py-1.5 backdrop-blur">
            <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {g.mandal}
            </p>
            <p className="shrink-0 text-[11px] tabular-nums text-slate-400">
              {g.done}/{g.rows.length} done
            </p>
          </div>

          <ul className="divide-y divide-slate-100">
            {g.rows.map((c) => {
              const isCurrent = c.id === currentId;
              const fullIdx = indexById.get(c.id) ?? 0;
              const tel = buildTelUrl(c.mobile);
              const rv = roundById?.get(c.id) || null;
              return (
                <li key={c.id} className={cn('flex items-stretch', isCurrent && 'bg-orange-50/60')}>
                  <button
                    type="button"
                    onClick={() => onPick?.(fullIdx)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left active:bg-slate-50"
                  >
                    {/* Done / not done at a glance, before any label is read. */}
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                        c.status
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-600'
                          : 'border-slate-200 bg-white',
                      )}
                    >
                      {c.status && <Check className="h-3 w-3" />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium text-slate-900">
                          {c.name || 'Unnamed contact'}
                        </span>
                        {isCurrent && (
                          <span className="shrink-0 rounded bg-orange-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700">
                            here
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span className="tabular-nums">{c.mobile || 'no number'}</span>
                        {c.callCount > 0 && <span>· {c.callCount} call{c.callCount === 1 ? '' : 's'}</span>}
                      </span>
                      {/* PHASE 46 — the post-sabha verdict, once the register is
                          marked: 🟢/🎉 came, 🔴 said yes but stayed away. This is
                          what turns the list into an attendance status list. */}
                      {rv && (
                        <span className="mt-1 block">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                              rv.chip,
                            )}
                          >
                            <span aria-hidden="true">{rv.emoji}</span> {rv.short}
                          </span>
                        </span>
                      )}
                      {/* The note, when there is one. This is the field a karyakarta
                          most often wants to re-read before dialling again, and
                          hunting for it one card at a time is why the list exists. */}
                      {c.reference && (
                        <span className="mt-0.5 block truncate text-[11px] italic text-slate-400">
                          “{c.reference}”
                        </span>
                      )}
                    </span>

                    {c.status ? (
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                          statusClasses(c.status),
                        )}
                      >
                        {emoji(c.status)} {label(c.status)}
                      </span>
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                    )}
                  </button>

                  {/* Dial without leaving the list. Goes through onCall so the call
                      is counted and logged exactly as it is from the card — a bare
                      tel: link would quietly under-report every karyakarta who
                      preferred this view. */}
                  {tel && (
                    <a
                      href={tel}
                      onClick={() => onCall?.(c)}
                      aria-label={`Call ${c.name || 'this contact'}`}
                      className="flex w-12 shrink-0 items-center justify-center border-l border-slate-100 text-emerald-600 active:bg-emerald-50"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
