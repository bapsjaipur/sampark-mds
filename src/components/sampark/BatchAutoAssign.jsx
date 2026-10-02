// src/components/sampark/BatchAutoAssign.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 49 — AUTO-ASSIGN. After a Generate run there are a dozen unassigned
// batches and, today, the only way to hand them out is to open each one and pick a
// name from the dropdown. For a weekly round of ~11 batches across ~6 callers that
// is eleven separate decisions that amount to "share these out evenly".
//
// The request, verbatim: "auto assign after generating batches, then when click
// auto assign then there is list of volunteers who is calling, then selection of
// volunteers checkbox then, auto assigned. sometimes 2 batch to one volunteer then
// also apply that thing."
//
// So: tick the callers who are on this week, and the unassigned batches are dealt
// among them — evenly by contact count, which is why some get two batches when
// batches outnumber callers. The split is shown BEFORE anything is written
// (planAutoAssign is a pure planner), and the commit is just the ordinary
// assignBatch() once per batch, so the scope rules and the assignedAt stamp are the
// same ones a manual assign goes through. Nothing new on the server.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { assignBatch, planAutoAssign } from '../../services/batchService';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';

/**
 * Does this volunteer's own area/mandal cover at least one of the batches being
 * dealt? Only used to pre-tick the likely callers and badge them — never to stop
 * anyone being ticked, because covering for another mandal is a routine Sunday act.
 */
function fitsAny(v, pool) {
  const areas = Array.isArray(v.assignedAreas) ? v.assignedAreas : [];
  const mandals = Array.isArray(v.assignedMandals) ? v.assignedMandals : [];
  if (!areas.length && !mandals.length) return false;
  return pool.some((b) => {
    const areaOk = !b.area || areas.includes(b.area);
    const mandalOk = !b.mandal || mandals.includes(b.mandal);
    return areaOk && mandalOk;
  });
}

export default function BatchAutoAssign({
  open, onClose, pool = [], volunteers = [], assignedBy = null, heldCountById = {}, onAssigned,
}) {
  const { showToast } = useToast();
  const active = useMemo(() => volunteers.filter((v) => v.isActive !== false), [volunteers]);
  const fitters = useMemo(
    () => new Set(active.filter((v) => fitsAny(v, pool)).map((v) => v.id)),
    [active, pool],
  );

  const [checked, setChecked] = useState(() => new Set());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);

  // Reset the ticks each time the dialog opens: default to the callers whose own
  // territory covers these batches, falling back to everyone active when none do
  // (a cross-mandal cover week), so the admin starts from a sensible set.
  useEffect(() => {
    if (!open) return;
    setChecked(new Set(fitters.size ? fitters : active.map((v) => v.id)));
    setDone(0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const sizeById = useMemo(() => {
    const m = new Map();
    pool.forEach((b) => m.set(b.id, (b.individualIds || []).length));
    return m;
  }, [pool]);

  const plan = useMemo(
    () => planAutoAssign({ batches: pool, volunteerIds: [...checked] }),
    [pool, checked],
  );

  // Per-volunteer tally of the deal, so the admin sees "Rakesh: 2 batches · 68
  // contacts" before committing rather than discovering it afterwards.
  const perVol = useMemo(() => {
    const m = new Map();
    for (const p of plan) {
      const cur = m.get(p.volunteerId) || { batches: 0, contacts: 0 };
      cur.batches += 1;
      cur.contacts += sizeById.get(p.batchId) || 0;
      m.set(p.volunteerId, cur);
    }
    return m;
  }, [plan, sizeById]);

  async function handleAssign() {
    if (!plan.length) return;
    setRunning(true);
    setDone(0);
    let ok = 0;
    const failures = [];
    // Sequential, not Promise.all: one failing batch (an out-of-scope write the
    // rules refuse) must not abort the rest, and the progress counter has to be
    // honest about how far it got.
    for (const p of plan) {
      try {
        await assignBatch({ batchId: p.batchId, volunteerId: p.volunteerId, assignedBy });
        ok += 1;
      } catch (err) {
        failures.push(err?.message || 'a batch could not be assigned');
      }
      setDone((n) => n + 1);
    }
    setRunning(false);
    if (ok) {
      showToast({
        type: 'success',
        message: `Assigned ${ok} batch${ok === 1 ? '' : 'es'} across ${perVol.size} volunteer${perVol.size === 1 ? '' : 's'}.`,
      });
    }
    if (failures.length) {
      showToast({
        type: 'error',
        message: `${failures.length} batch${failures.length === 1 ? '' : 'es'} could not be assigned — ${failures[0]}`,
      });
    }
    onAssigned?.();
    onClose?.();
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Auto-assign batches" size="lg">
      <p className="text-[12px] text-slate-500">
        Tick the volunteers calling this week. The <strong className="text-slate-700">{pool.length}</strong>{' '}
        unassigned batch{pool.length === 1 ? '' : 'es'} in view will be shared among them evenly by contact
        count — some may get two when there are more batches than callers.
      </p>

      <div className="mt-3 max-h-[44vh] space-y-1 overflow-y-auto pr-0.5">
        {active.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
            No active volunteers to assign to.
          </p>
        )}
        {active.map((v) => {
          const on = checked.has(v.id);
          const tally = perVol.get(v.id);
          const held = heldCountById[v.id] || 0;
          return (
            <label
              key={v.id}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                on ? 'border-orange-200 bg-orange-50/60' : 'border-slate-100 hover:bg-slate-50',
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(v.id)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 accent-orange-600"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-slate-800">{v.name}</span>
                  {fitters.has(v.id) && (
                    <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">fits</span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {held > 0 ? `holds ${held} batch${held === 1 ? '' : 'es'} now` : 'free'}
                </span>
              </span>
              {tally && (
                <span className="shrink-0 text-right text-[11px] font-semibold text-orange-700">
                  +{tally.batches} batch{tally.batches === 1 ? '' : 'es'}
                  <span className="block text-[10px] font-normal text-slate-400">{tally.contacts} contacts</span>
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2.5 border-t border-slate-100 pt-3.5 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-[11px] text-slate-500">
          {checked.size === 0
            ? 'Tick at least one volunteer.'
            : <>{plan.length} batch{plan.length === 1 ? '' : 'es'} → {perVol.size} volunteer{perVol.size === 1 ? '' : 's'}</>}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={running}>Cancel</Button>
          <Button onClick={handleAssign} disabled={running || plan.length === 0}>
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Assigning {done}/{plan.length}…</>
              : <><Zap className="h-4 w-4" /> Assign {plan.length} batch{plan.length === 1 ? '' : 'es'}</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
