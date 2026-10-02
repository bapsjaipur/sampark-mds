// src/components/sampark/BatchNotesReview.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 48 — READING WHAT CAME BACK FROM THE CALLS, AND ACTING ON IT.
//
// The request, verbatim: "when volunteers call assigned batch then they will mark
// something outcomes and sometimes some free text note below it ... there is no
// option of read those notes which will written by volunteer and take decision
// like deleting that contact, and removing it from followed up calling list in
// future ... it should be sub tab under Batches ... list of contacts according to
// filter Area or Mandal, or Batch wise whichever easy and efficient."
//
// A volunteer records two things per call: an OUTCOME (individuals/{id}.status)
// and, when there is something to say, a free-text NOTE (.reference). Both are
// written from the calling flow and, until now, read only from the calling flow —
// one contact at a time, by the person who wrote them. Nobody could sit above a
// batch and see the notes TOGETHER to decide "this one is a wrong number, delete
// it" or "this one asked never to be called again, drop them from the list".
//
// So this is a REVIEW surface, not a second calling screen. It loads a batch's
// contacts once, on demand (getIndividualsByIds — ~40 reads, NO listener), keeps
// only those carrying an outcome or a note, and offers the two decisions the
// request names:
//   • Remove from the follow-up calling list  → callingPool:false (reversible)
//   • Delete the contact outright             → deleteIndividual()  (permanent)
// each gated on its own permission, so a moderator who may edit but not delete
// sees only the button they can use.
//
// WHY BATCH-FIRST. Picking a batch is the cheapest possible read — the page
// already streams every batch document, so "review this batch" costs only its own
// ~40 individuals. Area / mandal is offered as a second mode for notes whose batch
// has since been deleted or re-cut, and reuses getIndividualsForTarget().
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import {
  MessageSquare, Trash2, PhoneOff, RotateCcw, Loader2, AlertTriangle, Filter, Recycle,
} from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { useCallOutcomes } from '../../hooks/useCallOutcomes';
import { useToast } from '../../contexts/ToastContext';
import { PERMISSIONS } from '../../constants/permissions';
import {
  getIndividualsByIds, getIndividualsForTarget, filterBatchesByScope,
} from '../../services/batchService';
import { deleteIndividual } from '../../services/contactService';
import {
  addToCallingPool, removeFromCallingPool, isInCallingPool,
} from '../../services/callingPoolService';
import { confirmDialog } from '../ui/ConfirmHost';
import { Select } from '../ui/Input';
import SearchableSelect from '../ui/SearchableSelect';
import { cn } from '../../lib/cn';

const MODES = [
  { key: 'batch', label: 'By batch' },
  { key: 'target', label: 'By area / mandal' },
];

// PHASE 49 — two lenses over the same loaded contacts: the NOTES volunteers wrote,
// and the contacts worth RECYCLING out of the pool. One fetch, two questions.
const VIEWS = [
  { key: 'notes', label: 'Notes' },
  { key: 'recycle', label: 'Recycle' },
];

// A recycle candidate has been called several times and STILL carries no outcome —
// rung and rung with nothing to show. Dropping those dead numbers from the pool is
// how the next round's effort goes somewhere live instead of down the same hole.
const RECYCLE_CALLS = 3;
function recyclable(c) {
  return Number(c.callCount || 0) >= RECYCLE_CALLS && !String(c.status || '').trim();
}

/**
 * A contact belongs on this screen ONLY when a volunteer typed a free-text note
 * (individuals/{id}.reference). An outcome (status) on its own is not enough — most
 * called contacts carry a status, and listing all of them buries the handful that
 * actually have something written to read and act on. The note is the filter.
 */
function hasNote(c) {
  return Boolean(String(c.reference || '').trim());
}

export default function BatchNotesReview({ batches = [], volunteers = [], areas = [], mandals = [] }) {
  const { volunteer, scope, hasPermission } = usePermissions();
  const { showToast } = useToast();
  const outcome = useCallOutcomes();

  const canEdit = hasPermission(PERMISSIONS.EDIT_CONTACTS);
  const canDelete = hasPermission(PERMISSIONS.DELETE_CONTACTS);

  const [mode, setMode] = useState('batch');
  const [view, setView] = useState('notes');
  const [batchId, setBatchId] = useState('');
  const [selArea, setSelArea] = useState('');
  const [selMandal, setSelMandal] = useState('');

  const [rows, setRows] = useState(null);        // null = nothing loaded yet
  const [loadedLabel, setLoadedLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Only the batches this person may see — their territory plus anything handed to
  // them personally, exactly as the Batches tab narrows the roster.
  const scopedBatches = useMemo(
    () => filterBatchesByScope(batches, scope, volunteer?.id),
    [batches, scope, volunteer?.id],
  );

  const batchOptions = useMemo(
    () => scopedBatches.map((b) => {
      const vname = volunteers.find((v) => v.id === b.assignedVolunteerId)?.name;
      return { value: b.id, label: vname ? `${b.name} · ${vname}` : b.name };
    }),
    [scopedBatches, volunteers],
  );

  // Who wrote a note, and in which batch — the two things the request asks to surface
  // so a reviewer can "narrow down" whose words these are. A note stamps its author on
  // the contact (referenceBy) when it is saved, so when that is present it names the
  // exact volunteer; for a note written before that stamp existed, fall back to the
  // volunteer the batch is assigned to — the person who worked the list. The batch
  // roster and the volunteer names are already in memory, so this adds no read.
  const volunteerName = (id) => (id ? volunteers.find((v) => v.id === id)?.name || '' : '');

  const batchByIndividual = useMemo(() => {
    const m = new Map();
    for (const b of batches) {
      for (const id of b.individualIds || []) {
        if (!m.has(id)) m.set(id, b); // a contact normally sits in just one batch
      }
    }
    return m;
  }, [batches]);

  // In batch mode every row belongs to the batch that was picked, so name it directly
  // rather than guessing from the map (a contact can sit in more than one batch).
  const pickedBatch = useMemo(
    () => (mode === 'batch' && batchId ? scopedBatches.find((b) => b.id === batchId) : null),
    [mode, batchId, scopedBatches],
  );

  function noteAuthor(c) {
    const b = pickedBatch || batchByIndividual.get(c.id);
    return {
      name: volunteerName(c.referenceBy) || volunteerName(b?.assignedVolunteerId),
      batchName: b?.name || '',
    };
  }

  // One read, on demand. A thrown query (e.g. an out-of-scope target refused by the
  // rules) surfaces as a message rather than an empty list that reads as "done".
  async function runLoad(fetcher, label) {
    setLoading(true);
    setError(null);
    try {
      const list = await fetcher();
      setRows(list);
      setLoadedLabel(label);
    } catch (err) {
      setError(err.message || 'Could not load contacts.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function handlePickBatch(id) {
    setBatchId(id);
    if (!id) { setRows(null); setLoadedLabel(''); return; }
    const batch = scopedBatches.find((b) => b.id === id);
    if (!batch) return;
    runLoad(() => getIndividualsByIds(batch.individualIds || []), batch.name || 'this batch');
  }

  function handleLoadTarget() {
    if (!selArea && !selMandal) { setError('Pick an area or a mandal first.'); return; }
    runLoad(
      () => getIndividualsForTarget({ areas: selArea ? [selArea] : [], mandals: selMandal ? [selMandal] : [] }),
      [selArea, selMandal].filter(Boolean).join(' · '),
    );
  }

  function switchMode(next) {
    setMode(next);
    setRows(null);
    setLoadedLabel('');
    setError(null);
    setBatchId('');
    setSelArea('');
    setSelMandal('');
  }

  async function togglePool(c) {
    const inPool = isInCallingPool(c);
    setBusyId(c.id);
    try {
      if (inPool) await removeFromCallingPool([c.id], { by: volunteer?.id });
      else await addToCallingPool([c.id], { by: volunteer?.id });
      // Reflect it locally — the row carries no listener, so without this the chip
      // and the button label would lie until the next reload.
      setRows((prev) => (prev || []).map((r) => (r.id === c.id ? { ...r, callingPool: !inPool } : r)));
      showToast({
        type: 'success',
        message: inPool
          ? `${c.name || 'Contact'} removed from future calling.`
          : `${c.name || 'Contact'} is back on the calling list.`,
      });
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(c) {
    const ok = await confirmDialog({
      title: `Delete ${c.name || 'this contact'}?`,
      message: 'This permanently removes the contact and their call history from the roster and cannot be undone. '
        + 'To simply stop calling them without losing the record, use "Remove from calling list" instead.',
      confirmText: 'Delete contact',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(c.id);
    try {
      const done = await deleteIndividual({ individualId: c.id, volunteerId: volunteer?.id });
      if (done) {
        setRows((prev) => (prev || []).filter((r) => r.id !== c.id));
        showToast({ type: 'success', message: `${c.name || 'Contact'} deleted.` });
      } else {
        showToast({ type: 'error', message: "Couldn't delete the contact — you may not have permission." });
      }
    } finally {
      setBusyId(null);
    }
  }

  // Narrow the loaded contacts to the active lens — notes to read, or dead numbers
  // to recycle — then group by mandal, the same shape the calling list uses.
  const matched = useMemo(
    () => (rows || []).filter(view === 'recycle' ? recyclable : hasNote),
    [rows, view],
  );
  const groups = useMemo(() => {
    const byMandal = new Map();
    for (const c of matched) {
      const key = c.mandal || 'No mandal';
      if (!byMandal.has(key)) byMandal.set(key, []);
      byMandal.get(key).push(c);
    }
    return [...byMandal.entries()].map(([mandal, rs]) => ({ mandal, rows: rs }));
  }, [matched]);

  const showActions = canEdit || canDelete;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-[12px] text-sky-800">
        {view === 'recycle'
          ? <Recycle className="mt-0.5 h-4 w-4 shrink-0" />
          : <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {view === 'recycle'
            ? <>Contacts called {RECYCLE_CALLS} times or more with no outcome recorded — rung repeatedly with nothing to show. Drop the dead numbers from future calling, or delete a wrong one.</>
            : <>The free-text notes your volunteers left while calling. Read what they wrote, then drop someone from future calling or remove a wrong or duplicate contact.</>}
        </span>
      </p>

      {/* Mode: a batch is the cheap read (its ids are already in memory); area /
          mandal is the fallback for notes whose batch was deleted or re-cut. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-full rounded-lg border border-slate-200 p-0.5 sm:w-auto">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => switchMode(m.key)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none',
                mode === m.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'batch' ? (
          <SearchableSelect
            value={batchId}
            onChange={handlePickBatch}
            placeholder="Pick a batch to review…"
            searchPlaceholder="Search batches…"
            options={batchOptions}
            className="w-full sm:w-80"
          />
        ) : (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <Select value={selArea} onChange={(e) => setSelArea(e.target.value)} className="min-w-0 sm:w-44">
              <option value="">Any area</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
            <Select value={selMandal} onChange={(e) => setSelMandal(e.target.value)} className="min-w-0 sm:w-44">
              <option value="">Any mandal</option>
              {mandals.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
            <button
              onClick={handleLoadTarget}
              disabled={loading || (!selArea && !selMandal)}
              className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-1"
            >
              <Filter className="h-3.5 w-3.5" /> Show notes
            </button>
          </div>
        )}
      </div>

      {mode === 'batch' && batchOptions.length === 0 && (
        <p className="rounded-lg border border-slate-100 px-4 py-8 text-center text-sm text-slate-400">
          No batches in your area or mandal yet. Switch to <strong>By area / mandal</strong> to review
          notes that aren’t tied to a current batch.
        </p>
      )}

      {/* Lens toggle — only once something is loaded, because it reshapes those
          rows (notes to read vs dead numbers to recycle), it doesn't fetch. */}
      {!loading && !error && rows && (
        <div className="flex w-full rounded-lg border border-slate-200 p-0.5 sm:inline-flex sm:w-auto">
          {VIEWS.map((vw) => (
            <button
              key={vw.key}
              onClick={() => setView(vw.key)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none',
                view === vw.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {vw.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {loading && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
        </p>
      )}

      {!loading && error && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!loading && !error && rows === null && (
        <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
          {mode === 'batch'
            ? 'Pick a batch above to see the outcomes and notes your volunteers recorded.'
            : 'Pick an area or mandal, then press Show notes.'}
        </p>
      )}

      {!loading && !error && rows && matched.length === 0 && (
        <p className="rounded-lg border border-slate-100 px-4 py-10 text-center text-sm text-slate-400">
          {view === 'recycle'
            ? <>Nothing to recycle in <strong className="text-slate-600">{loadedLabel}</strong> — no contact has been called {RECYCLE_CALLS}+ times without an outcome.</>
            : <>No written notes yet in <strong className="text-slate-600">{loadedLabel}</strong> — none of its {rows.length} contact{rows.length === 1 ? '' : 's'} were given a free-text note while calling.</>}
        </p>
      )}

      {!loading && !error && matched.length > 0 && (
        <>
          <p className="text-[11px] text-slate-400">
            <strong className="font-semibold text-slate-600">{matched.length}</strong> of {rows.length} contact
            {rows.length === 1 ? '' : 's'} in <strong className="text-slate-600">{loadedLabel}</strong>
            {view === 'recycle' ? ' to recycle' : ' have a note'}
          </p>

          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.mandal} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
                  <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {g.mandal}
                  </p>
                  <p className="shrink-0 text-[11px] tabular-nums text-slate-400">{g.rows.length}</p>
                </div>

                <div className="space-y-1.5">
                  {g.rows.map((c) => {
                    const busy = busyId === c.id;
                    const area = c._area || c.area;
                    const inPool = isInCallingPool(c);
                    const author = noteAuthor(c);
                    return (
                      <div
                        key={c.id}
                        className={cn('rounded-lg border border-slate-100 bg-white px-3 py-2.5', busy && 'opacity-60')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900">{c.name || 'Unnamed contact'}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                              <span className="tabular-nums">{c.mobile || 'no number'}</span>
                              {c.callCount > 0 && <span>· {c.callCount} call{c.callCount === 1 ? '' : 's'}</span>}
                              {area && <span>· {area}</span>}
                            </p>
                          </div>
                          {c.status && (
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                outcome.colorClasses(c.status),
                              )}
                            >
                              {outcome.emoji(c.status) && <span aria-hidden="true">{outcome.emoji(c.status)} </span>}
                              {outcome.label(c.status)}
                            </span>
                          )}
                        </div>

                        {/* The note is the whole reason this screen exists — shown in
                            full, not truncated the way the calling-flow list shows it. */}
                        {c.reference && (
                          <p className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-[12px] italic text-slate-600">
                            “{c.reference}”
                          </p>
                        )}

                        {/* Who left it, and in which batch — "show the volunteer name
                            with batch", so the reviewer can place the note at a glance. */}
                        {(author.name || author.batchName) && (
                          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 pl-0.5 text-[10.5px] text-slate-400">
                            {author.name && (
                              <span>
                                Noted by <span className="font-medium text-slate-600">{author.name}</span>
                              </span>
                            )}
                            {author.batchName && <span className="text-slate-300">· {author.batchName}</span>}
                          </p>
                        )}

                        {showActions && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {!inPool && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                Off the calling list
                              </span>
                            )}
                            {canEdit && (
                              <button
                                onClick={() => togglePool(c)}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {inPool
                                  ? <><PhoneOff className="h-3.5 w-3.5" /> Remove from calling list</>
                                  : <><RotateCcw className="h-3.5 w-3.5" /> Put back on calling list</>}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(c)}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete contact
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
