// src/components/sampark/BatchList.jsx
// PHASE 20 — the batch roster: assign, unassign, rename, delete, and per-batch
// call progress. Ported from Sevak Call's admin batch table, rebuilt as cards so
// it works on a phone (the legacy version was a 9-column sheet-style table).
//
// Progress numbers need each contact's status, which lives on the individuals
// documents. Rather than subscribing to all ~1240 individuals for the lifetime
// of this screen, statuses are fetched once on demand in documentId() `in`
// chunks and refreshed by an explicit button. An admin looking at batch progress
// does not need it live to the second, and a permanent full-collection listener
// on an admin screen is the kind of cost that only shows up on the bill.
//
// PHASE 25 — the `batches` listener moved UP to BatchesPage. This component used
// to open its own, which meant every hop between the Batches and Generate tabs
// re-read every batch document. `batches` now arrives as a prop.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, documentId, query, where } from 'firebase/firestore';
import { RefreshCw, UserPlus, UserMinus, Trash2, Pencil, Check, X, AlertTriangle } from 'lucide-react';
import { db } from '../../lib/firebase';
// Metered (src/lib/fsMetered.js): the status join below is a real read of up to
// every contact in the roster, and the quota tile in Admin Tools has to see it.
import { getDocs } from '../../lib/fsMetered';
import { chunk } from '../../lib/firestoreHelpers';
import {
  assignBatch, unassignBatch, deleteBatch, renameBatch, computeBatchStats,
  filterBatchesByScope, canEditBatch,
} from '../../services/batchService';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { describeScope } from '../../lib/scope';
import { Select } from '../ui/Input';
import { Card } from '../ui/Card';
import { cn } from '../../lib/cn';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'assigned', label: 'Assigned' },
];

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tracking-tight', tone || 'text-slate-900')}>{value}</p>
    </div>
  );
}

/**
 * Does this volunteer's own assignment cover the batch? Used only to order the
 * assign dropdown — never to prevent an assignment, because covering for someone
 * outside your own mandal is a normal Sunday-morning event.
 */
function volunteerFitsBatch(v, batch) {
  const areas = Array.isArray(v.assignedAreas) ? v.assignedAreas : [];
  const mandals = Array.isArray(v.assignedMandals) ? v.assignedMandals : [];
  const areaOk = !batch.area || areas.includes(batch.area);
  const mandalOk = !batch.mandal || mandals.includes(batch.mandal);
  return areaOk && mandalOk && (areas.length > 0 || mandals.length > 0);
}

/**
 * Why a card is read-only, in the words a karyakarta would use. Two distinct
 * causes, and they call for different action:
 *   • a null area or mandal spans EVERYTHING, so it is wider than any scope —
 *     every pre-Phase-21 batch is in this bucket, and it needs an admin;
 *   • both set, neither in scope — this only reaches the screen at all because a
 *     batch assigned to you personally is always shown (see filterBatchesByScope).
 */
function readOnlyReason(batch) {
  const wide = [!batch.area && 'every area', !batch.mandal && 'every mandal'].filter(Boolean);
  if (wide.length) return `it covers ${wide.join(' and ')}, which is wider than your own scope`;
  return `${batch.area} · ${batch.mandal} sits outside your scope`;
}

export default function BatchList({ volunteers, batches = [], loading = false }) {
  const { volunteer, scope } = useAuth();
  const { showToast } = useToast();

  const [statuses, setStatuses] = useState({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [volunteerFilter, setVolunteerFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [mandalFilter, setMandalFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [resetOnAssign, setResetOnAssign] = useState(false);

  // PHASE 21 — a moderator sees the batches for their own territory plus any
  // batch handed to them personally. Applied before the stats so the tiles at
  // the top count what this person is responsible for, not the whole city.
  const scopedBatches = useMemo(
    () => filterBatchesByScope(batches, scope, volunteer?.id),
    [batches, scope, volunteer?.id],
  );

  const allIds = useMemo(() => {
    const set = new Set();
    scopedBatches.forEach((b) => (b.individualIds || []).forEach((id) => set.add(id)));
    return [...set];
  }, [scopedBatches]);

  const loadStatuses = useCallback(async (ids) => {
    if (ids.length === 0) { setStatuses({}); return; }
    setStatsLoading(true);
    try {
      const map = {};
      // documentId() `in` is capped at 30 like any other `in` query.
      for (const c of chunk(ids, 30)) {
        const snap = await getDocs(query(collection(db, 'individuals'), where(documentId(), 'in', c)));
        snap.forEach((d) => { map[d.id] = { status: d.data().status || '' }; });
      }
      setStatuses(map);
    } catch (err) {
      showToast({ type: 'error', message: `Couldn't load call progress — ${err.message}` });
    } finally {
      setStatsLoading(false);
    }
  }, [showToast]);

  // Fetch once when the id set first becomes available (and whenever batches are
  // created/deleted, which changes the joined key).
  useEffect(() => { loadStatuses(allIds); }, [allIds.join(','), loadStatuses]); // eslint-disable-line react-hooks/exhaustive-deps

  const volunteerName = useCallback(
    (id) => volunteers.find((v) => v.id === id)?.name || (id ? 'Unknown volunteer' : null),
    [volunteers],
  );

  const { perBatch, totals } = useMemo(() => computeBatchStats(scopedBatches, statuses), [scopedBatches, statuses]);

  // Only values actually present are offered, so the filters can never produce
  // an empty list for a value that doesn't exist in this person's batches.
  const areaOptions = useMemo(
    () => [...new Set(scopedBatches.map((b) => b.area).filter(Boolean))].sort(),
    [scopedBatches],
  );
  const mandalOptions = useMemo(
    () => [...new Set(scopedBatches.map((b) => b.mandal).filter(Boolean))].sort(),
    [scopedBatches],
  );

  const visible = useMemo(() => perBatch.filter((b) => {
    if (filter === 'unassigned' && b.assignedVolunteerId) return false;
    if (filter === 'assigned' && !b.assignedVolunteerId) return false;
    if (volunteerFilter && b.assignedVolunteerId !== volunteerFilter) return false;
    if (areaFilter && b.area !== areaFilter) return false;
    if (mandalFilter && b.mandal !== mandalFilter) return false;
    return true;
  }), [perBatch, filter, volunteerFilter, areaFilter, mandalFilter]);

  async function handleAssign(batch, volunteerId) {
    if (!volunteerId) return;
    if (resetOnAssign && !window.confirm(
      `"Clear call history" is on.\n\nAssigning "${batch.name}" to ${volunteerName(volunteerId)} will ERASE the status and reference of all ${batch.total} contacts in it. This cannot be undone.\n\nContinue?`
    )) return;

    setBusyId(batch.id);
    try {
      const res = await assignBatch({
        batchId: batch.id, volunteerId, assignedBy: volunteer?.id, resetStatuses: resetOnAssign,
      });
      showToast({
        type: 'success',
        message: res.reset
          ? `Assigned to ${volunteerName(volunteerId)} · cleared ${res.reset} statuses.`
          : `Assigned to ${volunteerName(volunteerId)}.`,
      });
      if (res.reset) loadStatuses(allIds);
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnassign(batch) {
    setBusyId(batch.id);
    try {
      await unassignBatch({ batchId: batch.id });
      showToast({ type: 'success', message: `"${batch.name}" is now unassigned.` });
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(batch) {
    if (!window.confirm(
      `Delete "${batch.name}"?\n\nThe ${batch.total} contacts in it keep their status and history — only the assignment is removed.`
    )) return;
    setBusyId(batch.id);
    try {
      await deleteBatch(batch.id);
      showToast({ type: 'success', message: 'Batch deleted.' });
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function commitRename(batch) {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name || name === batch.name) return;
    try {
      await renameBatch({ batchId: batch.id, name });
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading batches…</p>;

  if (batches.length === 0) {
    return (
      <Card className="px-4 py-10 text-center">
        <p className="text-sm font-medium text-slate-600">No batches yet</p>
        <p className="mt-1 text-xs text-slate-400">Use the Generate tab to split an area into batches.</p>
      </Card>
    );
  }

  // Batches exist but none are in this person's territory. Saying so explicitly
  // matters — an empty list otherwise reads as "generation failed".
  if (scopedBatches.length === 0) {
    return (
      <Card className="px-4 py-10 text-center">
        <p className="text-sm font-medium text-slate-600">No batches in your area or mandal</p>
        <p className="mt-1 text-xs text-slate-400">
          There are {batches.length} batches in total, none of them for {describeScope(scope)}.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!scope?.unrestricted && (
        <p className="rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2 text-[11px] text-sky-800">
          Showing the batches for <strong>{describeScope(scope)}</strong> plus any batch assigned to you.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Batches" value={totals.batches} />
        <Tile label="Unassigned" value={totals.unassigned} tone={totals.unassigned ? 'text-amber-600' : 'text-slate-900'} />
        <Tile label="Contacts" value={totals.contacts} />
        <Tile label="Called" value={`${totals.progressPct}%`} tone="text-emerald-600" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Full width on a phone, then the selects get a two-up grid of their
            own below. Sharing one flex line, the segmented control took 200px
            of 343 and left the dropdowns ~45px each — both read just "Any". */}
        <div className="flex w-full rounded-lg border border-slate-200 p-0.5 sm:w-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none',
                filter === f.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-1 sm:items-center">
          {areaOptions.length > 1 && (
            <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="min-w-0 sm:w-40">
              <option value="">Any area</option>
              {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          )}

          {mandalOptions.length > 1 && (
            <Select value={mandalFilter} onChange={(e) => setMandalFilter(e.target.value)} className="min-w-0 sm:w-40">
              <option value="">Any mandal</option>
              {mandalOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          )}

          <Select value={volunteerFilter} onChange={(e) => setVolunteerFilter(e.target.value)} className="min-w-0 sm:w-44">
            <option value="">Any volunteer</option>
            {volunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </div>

        <button
          onClick={() => loadStatuses(allIds)}
          disabled={statsLoading}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', statsLoading && 'animate-spin')} />
          {statsLoading ? 'Refreshing…' : 'Refresh progress'}
        </button>
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <input
          type="checkbox"
          checked={resetOnAssign}
          onChange={(e) => setResetOnAssign(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300 accent-amber-600"
        />
        <span>
          <strong className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Clear call history when assigning</strong>
          <span className="mt-0.5 block text-amber-800">
            Off by default. The old Sevak Call app always did this and it silently destroyed the status
            and notes of everyone in a batch each time it changed hands. Only switch it on for a genuinely
            fresh calling round.
          </span>
        </span>
      </label>

      <div className="space-y-2">
        {visible.map((b) => {
          const assignedName = volunteerName(b.assignedVolunteerId);
          const busy = busyId === b.id;
          // Shown but not writable: see canEditBatch. A batch that spans every
          // area or every mandal is broader than a scoped moderator's territory,
          // so firestore.rules refuses the write. Better a disabled button with
          // a reason than a live one that fails.
          const editable = canEditBatch(b, scope);
          return (
            <Card key={b.id} className={cn('p-3.5', busy && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {renaming === b.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(b); if (e.key === 'Escape') setRenaming(null); }}
                        className="h-8 min-w-0 flex-1 rounded border border-slate-200 px-2 text-sm"
                      />
                      <button onClick={() => commitRename(b)} aria-label="Save name" className="rounded p-1 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setRenaming(null)} aria-label="Cancel" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-slate-900">{b.name}</p>
                      {editable && (
                        <button
                          onClick={() => { setRenaming(b.id); setRenameValue(b.name || ''); }}
                          aria-label="Rename batch"
                          className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-400">
                    <span>{b.area || 'All areas'}</span>
                    {b.mandal && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{b.mandal}</span>
                    )}
                    <span>· {b.total} contact{b.total === 1 ? '' : 's'}</span>
                    {b.missing > 0 && <span>· {b.missing} unknown</span>}
                  </p>
                </div>

                {editable && (
                  <button onClick={() => handleDelete(b)} aria-label="Delete batch" className="shrink-0 rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-2.5">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{b.called} called · {b.pending} pending</span>
                  <span className="font-medium">{b.progressPct}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${b.progressPct}%` }} />
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                {b.assignedVolunteerId ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                      <UserPlus className="h-3 w-3" /> {assignedName}
                    </span>
                    {editable && (
                      <button
                        onClick={() => handleUnassign(b)}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50 sm:ml-auto"
                      >
                        <UserMinus className="h-3.5 w-3.5" /> Unassign
                      </button>
                    )}
                  </>
                ) : !editable ? null : (() => {
                  // Volunteers whose own area/mandal covers this batch first, in
                  // a labelled group. With 22 volunteers and 8 mandals, scanning
                  // one flat alphabetical list is how a batch ends up with the
                  // wrong caller.
                  const active = volunteers.filter((v) => v.isActive !== false);
                  const fits = active.filter((v) => volunteerFitsBatch(v, b));
                  const rest = active.filter((v) => !fits.includes(v));
                  return (
                    <Select
                      value=""
                      disabled={busy}
                      onChange={(e) => { const v = e.target.value; e.target.value = ''; handleAssign(b, v); }}
                      className="sm:w-64"
                    >
                      <option value="">Assign to a volunteer…</option>
                      {fits.length > 0 && (
                        <optgroup label="Assigned to this area / mandal">
                          {fits.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </optgroup>
                      )}
                      {rest.length > 0 && (
                        <optgroup label={fits.length > 0 ? 'Other volunteers' : 'All volunteers'}>
                          {rest.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </optgroup>
                      )}
                    </Select>
                  );
                })()}
              </div>

              {!editable && (
                <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                  <span>Read-only for you — {readOnlyReason(b)}. An admin can assign, rename or delete it.</span>
                </p>
              )}
            </Card>
          );
        })}

        {visible.length === 0 && (
          <p className="rounded-lg border border-slate-100 px-4 py-8 text-center text-sm text-slate-400">
            No batches match these filters.
          </p>
        )}
      </div>
    </div>
  );
}
