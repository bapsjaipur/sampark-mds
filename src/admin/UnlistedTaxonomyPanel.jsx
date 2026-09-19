// src/admin/UnlistedTaxonomyPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 26 — "Unlisted mandals / areas", the other half of Merge.
//
//   "i think earlier i import excel i think from there some new mandal also
//    added, i am thinking of merging that mandal to one add a feature so data is
//    organized."
//
// WHY MERGE ALONE COULD NOT DO THIS
//
// MergeTaxonomyPanel picks both sides from `rows` — the mandals/areas
// COLLECTION. Nothing in the import path ever writes to those collections: the
// importer sets individuals.mandal to whatever text the spreadsheet column
// held, and the only two writes that create a mandal document are the admin's
// own "Add" box and the DEFAULT_MANDALS seed. So a mandal introduced by an
// import exists purely as a string on contact records. It is:
//
//   • absent from every dropdown, so nobody can pick it again or correct it;
//   • absent from Merge, so it cannot be folded into the real mandal;
//   • absent from role scoping, so a karyakarta can never be assigned to it
//     (firestore.rules matches assignedMandals[] by exact string);
//   • invisible — the contacts are there, they just quietly belong to nothing.
//
// This panel finds those strings and offers the only two sane fixes:
//
//   Merge into …   the usual case — it is a typo or a variant spelling of a
//                  mandal that already exists. Rewrites every record onto the
//                  real name. No document is deleted, because there was never
//                  one to delete; that is precisely why the existing Merge
//                  panel cannot do this.
//   Add to list    it is a genuine new mandal that the import brought in.
//                  Creating the document puts it back in the dropdowns and
//                  makes it assignable, without touching a single record.
//
// WHY THE SCAN IS A BUTTON, NOT AN EFFECT
//
// Firestore has no DISTINCT. The only way to learn which mandal names exist on
// records is to read the records. That is one read per contact — around 1,400
// documents across the collections involved. Fine as a deliberate admin action
// against a 50k/day budget; indefensible on every mount of the Areas & Mandals
// screen. So it runs when asked, reports what it cost, and the result stays on
// screen until dismissed.
//
// The scan doubles as the preview: it already counted every record per
// collection, so the merge confirmation needs no second pass. The merge itself
// re-reads (planTaxonomyChange), so a contact added between the scan and the
// merge is still caught — the number on screen can only ever be an
// underestimate, never a miss.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import {
  AlertTriangle, CheckCircle2, GitMerge, Loader2, Plus, RefreshCw, Search,
} from 'lucide-react';
// Metered drop-ins: this is the single most expensive read in the app, so it
// had better show up on the usage dashboard.
import { getDocs, addDoc } from '../lib/fsMetered';
import { auth, db } from '../lib/firebase';
import { confirmDialog } from '../components/ui/ConfirmHost';
import { logActivity } from '../lib/activityLog';
import {
  TAXONOMY_TARGETS, describeTaxonomyError, describeUsage, renameTaxonomyValue,
} from '../services/taxonomyService';
import { FULL_MEMBER_FIELDS } from '../lib/areaMandalCodes';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

const COPY = {
  area: {
    title: 'Unlisted areas',
    collectionName: 'areas',
    one: 'area',
    many: 'areas',
    blurb: 'Area names that records carry but the list above does not offer — '
      + 'almost always brought in by a spreadsheet import. They are invisible '
      + 'everywhere else in the app: no dropdown offers them, and no karyakarta '
      + 'can be assigned to them.',
  },
  mandal: {
    title: 'Unlisted mandals',
    collectionName: 'mandals',
    one: 'mandal',
    many: 'mandals',
    blurb: 'Mandal names that contacts carry but the list above does not offer — '
      + 'almost always brought in by a spreadsheet import. They are invisible '
      + 'everywhere else in the app: no dropdown offers them, and no karyakarta '
      + 'can be assigned to them.',
  },
};

// Case and spacing only. Two names that normalise the same are the same name
// typed twice — never a genuine second mandal — so that case is treated as
// certain rather than as a suggestion.
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Deliberately weaker than `norm`: "Balak" and "Bal Mandal" are the real-world
// pair this was written for, and no amount of whitespace normalising connects
// them. Dropping the trailing "mandal"/"area" and comparing the first few
// letters does — but so does "Bal Mandal" vs "Balika Mandal", which must NOT be
// merged. Hence a hint the admin reads, never a default the admin inherits.
function similarNames(value, rows) {
  const strip = (s) => norm(s).replace(/\s*(mandal|area)$/i, '').trim();
  const a = strip(value);
  if (a.length < 3) return [];
  return rows
    .filter((r) => {
      const b = strip(r.name);
      if (b.length < 3 || a === b) return false;
      const short = Math.min(a.length, b.length);
      let shared = 0;
      while (shared < short && a[shared] === b[shared]) shared += 1;
      return shared >= 3;
    })
    .map((r) => r.name);
}

// Same convention as the Area table's own suggestion box ("GN" from "Govind
// Nagar"), then de-duped against the codes already in use — a clashing code is
// rejected by the add guards on the tables above, and being bounced for a code
// you never typed is baffling.
function suggestCode(name, rows) {
  const words = String(name || '').trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const base = !words.length
    ? 'X'
    : words.length === 1
      ? words[0].slice(0, 3).toUpperCase()
      : words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  const taken = new Set(rows.map((r) => String(r.code || '').toUpperCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  }
  return base;
}

export function UnlistedTaxonomyPanel({ kind, rows = [], onDone }) {
  const copy = COPY[kind];
  const targets = TAXONOMY_TARGETS[kind] || [];

  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState(null);      // { found, blanks, docsRead, unreadable }
  const [error, setError] = useState(null);
  // One row at a time: the value being worked on, so only its own buttons spin.
  const [busyValue, setBusyValue] = useState('');
  const [progress, setProgress] = useState(null);   // { done, total }
  // value → chosen merge target name, and value → code for "Add to list".
  const [mergeInto, setMergeInto] = useState({});
  const [codes, setCodes] = useState({});

  const knownExact = useMemo(() => new Set(rows.map((r) => r.name)), [rows]);
  const knownNorm = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (!m.has(norm(r.name))) m.set(norm(r.name), r.name); });
    return m;
  }, [rows]);

  // Re-derived from `rows` rather than frozen into the scan result: adding one
  // orphan to the list changes what the others are duplicates of, and the parent
  // is already live-subscribed to the collection.
  const orphans = useMemo(() => {
    if (!scan) return [];
    return scan.found
      .filter((f) => !knownExact.has(f.value))
      .map((f) => ({
        ...f,
        sameAs: knownNorm.get(norm(f.value)) || null,
        similar: similarNames(f.value, rows),
      }));
  }, [scan, knownExact, knownNorm, rows]);

  async function runScan() {
    setError(null);
    setScanning(true);
    setScan(null);
    try {
      const tally = new Map();       // exact string → Map(targetKey → count)
      const blanks = new Map();      // targetKey → count
      const unreadable = [];
      let docsRead = 0;

      for (const t of targets) {
        const key = `${t.collection}.${t.field}`;
        let snap;
        try {
          snap = await getDocs(collection(db, t.collection));
        } catch (err) {
          // One refused collection must not sink the scan. A missing
          // padhramaniEvents read still leaves the contact counts worth acting
          // on — it is named in the result so nobody mistakes it for a zero.
          unreadable.push(t.collection);
          continue;
        }
        docsRead += snap.size;
        snap.docs.forEach((d) => {
          const raw = d.data()[t.field];
          const values = t.array ? (Array.isArray(raw) ? raw : []) : [raw];
          let found = 0;
          values.forEach((v) => {
            if (typeof v !== 'string' || !v.trim()) return;
            found += 1;
            const per = tally.get(v) || new Map();
            per.set(key, (per.get(key) || 0) + 1);
            tally.set(v, per);
          });
          // An empty assignedMandals[] means "every mandal", not "no mandal",
          // so array targets are never counted as blanks.
          if (!t.array && found === 0) blanks.set(key, (blanks.get(key) || 0) + 1);
        });
      }

      const usageRows = (per) => targets
        .map((t) => ({
          collection: t.collection,
          label: t.label,
          plural: t.plural,
          count: per.get(`${t.collection}.${t.field}`) || 0,
        }))
        .filter((r) => r.count > 0);

      const found = [...tally.entries()]
        .map(([value, per]) => {
          const rowsForValue = usageRows(per);
          return {
            value,
            total: rowsForValue.reduce((s, r) => s + r.count, 0),
            rows: rowsForValue,
          };
        })
        .sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));

      const blankRows = usageRows(blanks);
      setScan({
        found,
        blanks: { total: blankRows.reduce((s, r) => s + r.count, 0), rows: blankRows },
        docsRead,
        unreadable,
      });
    } catch (err) {
      setError(describeTaxonomyError(err, kind));
    } finally {
      setScanning(false);
    }
  }

  // Drops a value out of the scan result once it has been dealt with. Cheaper
  // and less startling than re-scanning 1,400 documents to prove one row left.
  function forget(value) {
    setScan((prev) => (prev ? { ...prev, found: prev.found.filter((f) => f.value !== value) } : prev));
  }

  async function handleAdd(orphan) {
    const name = orphan.value.trim();
    const code = String(codes[orphan.value] ?? suggestCode(name, rows)).trim().toUpperCase();
    if (!code) { setError('A short code is required.'); return; }
    if (rows.some((r) => String(r.code || '').toUpperCase() === code)) {
      setError(`Code “${code}” is already used by another ${copy.one}.`);
      return;
    }
    setError(null);
    setBusyValue(orphan.value);
    try {
      // The record text is used verbatim — trimmed only. Inventing a tidier
      // spelling here would create a document that matches none of the records
      // it was created for, which is the whole problem this panel exists to fix.
      await addDoc(
        collection(db, copy.collectionName),
        kind === 'area'
          ? { name, code, subAreas: [] }
          : { name, code, gender: '', fields: FULL_MEMBER_FIELDS },
      );
      logActivity({
        volunteerId: auth.currentUser?.uid || null,
        action: kind === 'area' ? 'create_area' : 'create_mandal',
        details: { name, code, source: 'unlisted scan', records: orphan.total },
      });
      forget(orphan.value);
      onDone?.(
        `Added ${copy.one} “${name}” (${code}) to the list. `
        + `The ${orphan.total} record(s) already carrying that name now resolve to it — nothing was rewritten.`,
      );
    } catch (err) {
      setError(describeTaxonomyError(err, kind));
    } finally {
      setBusyValue('');
    }
  }

  async function handleMerge(orphan) {
    const target = mergeInto[orphan.value] || orphan.sameAs || '';
    if (!target) return;
    const go = await confirmDialog({
      title: `Move every record from “${orphan.value}” onto ${copy.one} “${target}”?`,
      message:
        `This rewrites ${describeUsage(orphan)}.\n\n`
        + `“${orphan.value}” is not in the ${copy.one} list, so there is nothing to delete — `
        + `once the records are moved the name simply stops existing.\n\n`
        + 'This cannot be undone. Leave this page open until it finishes.',
      confirmText: 'Move records',
      tone: 'danger',
    });
    if (!go) return;

    setError(null);
    setBusyValue(orphan.value);
    setProgress({ done: 0, total: orphan.total });
    try {
      const res = await renameTaxonomyValue(kind, orphan.value, target, {
        onProgress: setProgress,
      });
      logActivity({
        volunteerId: auth.currentUser?.uid || null,
        action: kind === 'area' ? 'merge_areas' : 'merge_mandals',
        details: {
          merged: orphan.value,
          into: target,
          recordsUpdated: res.total,
          note: `unlisted ${copy.one} — no ${copy.one} document existed`,
        },
      });
      forget(orphan.value);
      onDone?.(
        `Moved ${res.total} record(s) from “${orphan.value}” onto “${target}”. `
        + `“${orphan.value}” no longer appears on any record.`,
      );
    } catch (err) {
      setError(
        `${describeTaxonomyError(err, kind)} Records already moved stay moved, and`
        + ' re-running the same merge finishes the rest.',
      );
    } finally {
      setBusyValue('');
      setProgress(null);
    }
  }

  const busy = scanning || Boolean(busyValue);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Search className="h-4 w-4 text-slate-400" /> {copy.title}
          </h2>
          {open && <p className="mt-1 text-xs text-slate-400">{copy.blurb}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} disabled={busy}>
          {open ? 'Close' : 'Check'}
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}

          {!scan ? (
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="text-xs text-slate-500">
                Finding these means reading every record once — Firestore cannot list the
                distinct values on its own. Roughly one read per contact, so run it when you
                need it rather than on every visit.
              </p>
              <Button variant="secondary" size="sm" className="mt-2.5" onClick={runScan} disabled={scanning}>
                {scanning ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning records…</>
                ) : (
                  <><Search className="h-3.5 w-3.5" /> Scan records</>
                )}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Read <strong className="tabular-nums text-slate-700">{scan.docsRead}</strong> document(s) ·{' '}
                  <strong className="tabular-nums text-slate-700">{scan.found.length}</strong> distinct{' '}
                  {copy.one} name(s) on records ·{' '}
                  <strong className="tabular-nums text-slate-700">{orphans.length}</strong> not in the list
                </span>
                <Button variant="ghost" size="sm" onClick={runScan} disabled={busy}>
                  <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} /> Re-scan
                </Button>
              </div>

              {scan.unreadable.length > 0 && (
                <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Could not read {scan.unreadable.join(', ')} — the counts below leave those out.
                    A merge still rewrites them if your role can write there.
                  </span>
                </p>
              )}

              {orphans.length === 0 ? (
                <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Every {copy.one} on a record is in the list above. Nothing orphaned.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {orphans.map((o) => {
                    const rowBusy = busyValue === o.value;
                    const target = mergeInto[o.value] ?? o.sameAs ?? '';
                    const code = codes[o.value] ?? suggestCode(o.value, rows);
                    return (
                      <li key={o.value} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{o.value}</p>
                          <span className="shrink-0 text-xs tabular-nums text-slate-500">
                            {o.total} record{o.total === 1 ? '' : 's'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{describeUsage(o)}</p>

                        {o.sameAs && (
                          <p className="mt-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              Same as “{o.sameAs}” apart from capitalisation or spacing — the records
                              just spell it differently. Merge it; adding it would put two
                              near-identical options in every dropdown.
                            </span>
                          </p>
                        )}
                        {!o.sameAs && o.similar.length > 0 && (
                          <p className="mt-2 text-xs text-slate-500">
                            Starts like {o.similar.map((s) => `“${s}”`).join(', ')} — check which it
                            really is before merging.
                          </p>
                        )}

                        {/* Merge — the usual answer, so it comes first. */}
                        <div className="mt-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                          <select
                            value={target}
                            onChange={(e) => setMergeInto((p) => ({ ...p, [o.value]: e.target.value }))}
                            disabled={rowBusy || rows.length === 0}
                            className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300 disabled:bg-slate-50"
                          >
                            <option value="">
                              {rows.length ? `Merge into an existing ${copy.one}…` : `No ${copy.many} in the list yet`}
                            </option>
                            {rows.map((r) => (
                              <option key={r.id} value={r.name}>{r.name}{r.code ? ` (${r.code})` : ''}</option>
                            ))}
                          </select>
                          <Button
                            variant="dangerSolid"
                            size="sm"
                            className="shrink-0"
                            onClick={() => handleMerge(o)}
                            disabled={!target || rowBusy || busy}
                          >
                            {rowBusy && progress ? (
                              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Moving…</>
                            ) : (
                              <><GitMerge className="h-3.5 w-3.5" /> Merge</>
                            )}
                          </Button>
                        </div>

                        {/* Or keep it — one document, no records touched. */}
                        <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                          <p className="flex-1 text-[11px] leading-snug text-slate-400">
                            {o.sameAs
                              ? `Adding it as its own ${copy.one} would leave two spellings of the same name.`
                              : `Or keep it as a real ${copy.one} — puts it back in the dropdowns and lets a karyakarta be assigned to it. No record changes.`}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Input
                              value={code}
                              onChange={(e) => setCodes((p) => ({ ...p, [o.value]: e.target.value.toUpperCase() }))}
                              disabled={rowBusy || Boolean(o.sameAs)}
                              maxLength={6}
                              aria-label={`Short code for ${o.value}`}
                              className="h-9 w-20"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleAdd(o)}
                              disabled={rowBusy || busy || Boolean(o.sameAs)}
                              title={o.sameAs ? `Merge it into “${o.sameAs}” instead.` : undefined}
                            >
                              {rowBusy && !progress ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</>
                              ) : (
                                <><Plus className="h-3.5 w-3.5" /> Add to list</>
                              )}
                            </Button>
                          </div>
                        </div>

                        {rowBusy && progress?.total > 0 && (
                          <p className="mt-2 text-[11px] text-slate-500 tabular-nums">
                            {progress.done} of {progress.total} record(s) moved
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {scan.blanks.total > 0 && (
                <p className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs text-slate-500">
                  <strong className="tabular-nums text-slate-700">{scan.blanks.total}</strong> record(s)
                  have no {copy.one} at all ({describeUsage(scan.blanks)}). Nothing can be merged for
                  them — there is no name to move — but they will not appear in any {copy.one}-filtered
                  list, including batch generation.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export default UnlistedTaxonomyPanel;
