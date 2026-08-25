// src/admin/MergeTaxonomyPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 22 — "merge these two Areas into one".
//
// The practical reason this exists: the same locality gets typed in twice over
// the years ("Vaishali Nagar" / "Vaishali Ngr"), or two small areas are put
// under one karyakarta. Before this screen the only way to fix that was to open
// every household and re-pick the Area by hand, and anything missed stayed
// invisible — the records still matched the old string, which no dropdown
// offered any more.
//
// A merge here rewrites the name on every record that carries it (see
// taxonomyService for the full list of collections, including the karyakarta
// assignment arrays that firestore.rules matches by exact string) and only then
// deletes the source Area. If the run fails halfway, both names are still live
// options and re-running finishes the rest — no record is ever left pointing at
// a deleted Area.
//
// The preview is mandatory: the merge button stays disabled until the counts
// have been fetched, because "merge 6 areas" reads very differently once you can
// see it is about to rewrite 1,400 households.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, ArrowRight, GitMerge, Loader2 } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { logActivity } from '../lib/activityLog';
import {
  applyTaxonomyChange, countTaxonomyUsage, describeTaxonomyError, describeUsage,
  mergeSubAreaLists, planTaxonomyChange,
} from '../services/taxonomyService';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

const COPY = {
  area: {
    title: 'Merge areas',
    collectionName: 'areas',
    one: 'area',
    many: 'areas',
    blurb: 'Moves every household, contact, calling batch, event and karyakarta '
      + 'assignment off the areas you pick and onto the one you keep, then deletes '
      + 'the empty ones. Sub-areas come along with them.',
  },
  mandal: {
    title: 'Merge mandals',
    collectionName: 'mandals',
    one: 'mandal',
    many: 'mandals',
    blurb: 'Moves every contact, calling batch, event and karyakarta assignment off '
      + 'the mandals you pick and onto the one you keep, then deletes the empty ones.',
  },
};

export function MergeTaxonomyPanel({ kind, rows, onDone }) {
  const copy = COPY[kind];
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [sourceIds, setSourceIds] = useState([]);
  const [preview, setPreview] = useState(null);   // { items: [{row, usage}], total }
  const [counting, setCounting] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null); // { label, done, total }
  const [error, setError] = useState(null);

  const target = rows.find((r) => r.id === targetId) || null;
  const sources = sourceIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean);

  // Any edit to the selection invalidates the counts it was measured against.
  useEffect(() => { setPreview(null); }, [targetId, sourceIds]);

  function toggleSource(id) {
    setSourceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function loadPreview() {
    setError(null);
    setCounting(true);
    try {
      const items = [];
      for (const row of sources) {
        // Only the counts are kept. The plan behind them holds every matching
        // document snapshot, and the merge re-reads anyway — a record added
        // between the preview and the merge has to be caught, so reusing the
        // preview's document list would quietly leave it on the old name.
        const { total, rows: usageRows } = await countTaxonomyUsage(kind, row.name);
        items.push({ row, usage: { total, rows: usageRows } });
      }
      setPreview({ items, total: items.reduce((s, i) => s + i.usage.total, 0) });
    } catch (err) {
      setError(describeTaxonomyError(err, kind));
    } finally {
      setCounting(false);
    }
  }

  async function runMerge() {
    if (!target || !sources.length) return;
    setError(null);
    setRunning(true);
    let rewritten = 0;
    const merged = [];
    const carriedSubAreas = [];
    try {
      for (const source of sources) {
        setProgress({ label: source.name, done: 0, total: 0 });

        // 1. Records first. Everything keeps resolving to a live dropdown option
        //    for as long as this is running.
        const plan = await planTaxonomyChange(kind, source.name);
        const res = await applyTaxonomyChange(plan, target.name, {
          onProgress: ({ done, total }) => setProgress({ label: source.name, done, total }),
        });
        rewritten += res.total;

        // 2. Carry the sub-areas across, or the households just moved would hold
        //    a subArea string the target area does not offer.
        if (kind === 'area') {
          const { subAreas, added } = mergeSubAreaLists(target.subAreas || [], source.subAreas || []);
          if (added.length) {
            await updateDoc(doc(db, 'areas', target.id), { subAreas });
            target.subAreas = subAreas;   // keep the running merge consistent
            carriedSubAreas.push(...added);
          }
        }

        // 3. The source option goes last.
        await deleteDoc(doc(db, copy.collectionName, source.id));
        merged.push(source.name);
      }

      logActivity({
        volunteerId: auth.currentUser?.uid || null,
        action: kind === 'area' ? 'merge_areas' : 'merge_mandals',
        details: {
          merged: merged.join(', '),
          into: target.name,
          recordsUpdated: rewritten,
          ...(carriedSubAreas.length ? { subAreasMoved: carriedSubAreas.join(', ') } : {}),
        },
      });

      onDone?.(
        `Merged ${merged.length} ${merged.length === 1 ? copy.one : copy.many} `
        + `(${merged.join(', ')}) into “${target.name}”. `
        + `${rewritten} record(s) updated.`
        + (carriedSubAreas.length ? ` Sub-areas moved across: ${carriedSubAreas.join(', ')}.` : ''),
      );
      setSourceIds([]);
      setTargetId('');
      setPreview(null);
      setOpen(false);
    } catch (err) {
      setError(
        `${describeTaxonomyError(err, kind)}`
        + (merged.length ? ` Already merged before the failure: ${merged.join(', ')}.` : '')
        + ' Nothing was deleted for the one that failed, so re-running the same merge'
        + ' picks up where it stopped.',
      );
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const canPreview = Boolean(target) && sources.length > 0 && !counting && !running;
  const canMerge = Boolean(preview) && Boolean(target) && sources.length > 0 && !running;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <GitMerge className="h-4 w-4 text-slate-400" /> {copy.title}
          </h2>
          {open && <p className="mt-1 text-xs text-slate-400">{copy.blurb}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} disabled={running}>
          {open ? 'Close' : 'Merge'}
        </Button>
      </div>

      {!open ? null : rows.length < 2 ? (
        <p className="mt-3 text-sm text-slate-400">
          You need at least two {copy.many} before anything can be merged.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}

          {/* Keep */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Keep this {copy.one}
            </label>
            <select
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); setSourceIds((prev) => prev.filter((id) => id !== e.target.value)); }}
              disabled={running}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
            >
              <option value="">Select the {copy.one} to keep…</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.code ? ` (${r.code})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Fold in */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Fold these into it <span className="text-slate-400">— they will be deleted</span>
            </label>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
              {rows.filter((r) => r.id !== targetId).map((r) => (
                <label key={r.id} className="flex items-center gap-2 px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50/60">
                  <input
                    type="checkbox"
                    checked={sourceIds.includes(r.id)}
                    onChange={() => toggleSource(r.id)}
                    disabled={running}
                    className="h-3.5 w-3.5 rounded accent-orange-600"
                  />
                  <span className="truncate">{r.name}</span>
                  {r.code && <span className="text-xs text-slate-400">{r.code}</span>}
                </label>
              ))}
            </div>
          </div>

          {/* Summary line */}
          {target && sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-600">
              <span className="truncate max-w-full rounded bg-slate-100 px-1.5 py-0.5">{sources.map((s) => s.name).join(', ')}</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              <span className="rounded bg-orange-50 px-1.5 py-0.5 font-medium text-orange-700">{target.name}</span>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="rounded-lg border border-slate-100">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm divide-y divide-slate-100">
                  <thead className="bg-slate-50/60">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Moving from</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Records that will be rewritten</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {preview.items.map(({ row, usage }) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 align-top text-slate-800 whitespace-nowrap">{row.name}</td>
                        <td className="px-3 py-2 text-slate-600">{describeUsage(usage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                <strong className="tabular-nums">{preview.total}</strong> record(s) in total will be
                changed to “{target?.name}”, then {sources.length} {sources.length === 1 ? copy.one : copy.many} will
                be deleted. This cannot be undone.
              </p>
              {preview.items.some(({ usage }) => usage.rows.some((r) => r.collection === 'volunteers' && r.count > 0)) && (
                <p className="mx-3 mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Karyakartas assigned to the {copy.many} being folded in will be moved onto
                    “{target?.name}”, which widens what they can see to everything in it. Check the
                    Volunteers screen afterwards.
                  </span>
                </p>
              )}
            </div>
          )}

          {progress && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Moving “{progress.label}”
              {progress.total ? ` — ${progress.done} of ${progress.total} record(s)` : '…'}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={loadPreview} disabled={!canPreview}>
              {counting ? 'Counting…' : preview ? 'Re-check counts' : 'Preview changes'}
            </Button>
            <Button variant="dangerSolid" size="sm" onClick={runMerge} disabled={!canMerge}>
              {running
                ? 'Merging…'
                : sources.length
                  ? `Merge ${sources.length} ${sources.length === 1 ? copy.one : copy.many}`
                  : `Merge ${copy.many}`}
            </Button>
          </div>
          {!preview && target && sources.length > 0 && (
            <p className="text-xs text-slate-400">Run the preview first — it shows how many records will change.</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default MergeTaxonomyPanel;
