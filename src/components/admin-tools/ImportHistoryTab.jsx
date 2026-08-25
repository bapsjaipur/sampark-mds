// src/components/admin-tools/ImportHistoryTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 21 — "currently there is Google sheets of my Yuvak Mandal Data which
// have till date data, how can I add that data in MDS with their everything from
// all time present to now".
//
// The wide sheet (one column per sabha) is pivoted into MDS's long-format
// attendance collection. All of the pivoting and matching lives in
// services/historyImportService.js; this screen exists to make the two genuinely
// ambiguous decisions VISIBLE before anything is written:
//
//   • which columns are sabha dates — proposed by parsing the header, editable
//   • which cell marks mean "present" — every distinct mark in the file is
//     listed with a count, and the admin ticks the ones that mean attended
//
// Then a dry run reports the exact write count. Nothing touches Firestore until
// the last button. Re-running is safe by design (see the service header).
//
// PHASE 25 — THE WORKBOOK, NOT JUST ITS FIRST SHEET.
//
// This used to read wb.SheetNames[0] and nothing else, which is fine for a CSV
// and wrong for the actual export: the Sevak Call workbook has nineteen sheets,
// and the one that names the sabha columns is not the first. So there is now a
// sheet picker, and the `Events` sheet is joined to the sabha columns on its
// `ColumnName` key — which is the difference between importing a sabha called
// "Going" and one called "Going Beyond Resolution", 7:00 pm, 120 minutes,
// Pu. Aanandswarup Swami Ji.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FolderOpen, ListChecks, CalendarDays, CheckCircle2, AlertTriangle, Play, Loader2,
  Sheet, ChevronDown, ChevronUp, Link2, Database, RotateCcw, History, Trash2,
} from 'lucide-react';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { useAreasAndMandals } from '../../hooks/useAreasAndMandals';
import { PERMISSIONS, hasPermission } from '../../constants/permissions';
import { friendlyFirestoreError } from '../../lib/firestoreErrorMessage';
import {
  parseSheetDate, proposeDateColumns, proposeFieldMapping, countCellValues,
  analyzeHistoryImport, runHistoryImport, readImportWorkbook, buildEventMetaIndex,
  listImportRuns, analyzeHistoryImportUndo, undoHistoryImport,
  DEFAULT_PRESENT_TOKENS,
} from '../../services/historyImportService';
import ImportGuide from '../import-export/ImportGuide';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Select, Input } from '../ui/Input';

// Always-visible mapping dropdowns — the ones that decide whether the import
// works at all, or which lists a contact lands in.
const CORE_FIELDS = ['Name', 'Phone', 'Area', 'SubArea', 'Mandal', 'DOB'];
// Everything else the sheet may carry. Folded away by default so the screen is
// six dropdowns rather than fourteen, and opened automatically when the
// auto-mapper found any of them.
const EXTRA_FIELDS = [
  'Anniversary', 'Study', 'Profession', 'Skill', 'Address', 'Note', 'Status', 'Reference',
];
const FIELD_LABELS = { SubArea: 'Sub Area' };

function Stat({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    orange: 'text-orange-700',
    rose: 'text-rose-700',
  };
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className={`text-lg font-semibold ${tones[tone]}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

/** Does this sheet look like the Events metadata sheet? */
function looksLikeEventsSheet(headers) {
  return headers.some((h) => /^column.?name$/i.test(String(h).trim()));
}

export default function ImportHistoryTab() {
  const { volunteer, permissions } = useAuth();
  const { showToast } = useToast();
  const { areas, mandals } = useAreasAndMandals();
  const canImport = hasPermission(permissions, PERMISSIONS.IMPORT_DATA);

  // PHASE 25 — this used to warn that the role was missing Manage Events and
  // Mark Attendance, because firestore.rules gated the three collections an
  // import writes to on three different permissions. They now all accept
  // import_data (a role allowed to import contacts was being refused on the
  // sabhas those contacts attended), so the only gap left is the tab's own gate
  // below. The warning is gone rather than reworded: it named permissions that
  // are no longer required and sent people to the Roles tab to fix nothing.

  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [book, setBook] = useState(null);            // readImportWorkbook() handle
  const [sheets, setSheets] = useState({ contacts: '', events: '' });
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [eventMeta, setEventMeta] = useState(null);  // Map(ColumnName → {...})
  const [mapping, setMapping] = useState({});
  const [showExtra, setShowExtra] = useState(false);
  const [dateCols, setDateCols] = useState([]);       // [{ header, date, title, include }]
  const [tokens, setTokens] = useState(DEFAULT_PRESENT_TOKENS);
  const [defaults, setDefaults] = useState({ mandal: '', area: '', time: '19:00' });
  const [matchByName, setMatchByName] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const includedCols = useMemo(() => dateCols.filter((c) => c.include), [dateCols]);

  // Dates carrying more than one selected column — a morning and an evening
  // sitting, or a sabha plus a shibir. Each becomes its own event, which is
  // right, but it is worth saying out loud: it is equally often a sign that one
  // of the two columns is a duplicate the admin meant to untick.
  const sharedDates = useMemo(() => {
    const byDate = new Map();
    includedCols.forEach((c) => byDate.set(c.date, (byDate.get(c.date) || 0) + 1));
    return [...byDate.entries()].filter(([, n]) => n > 1).map(([d]) => d);
  }, [includedCols]);

  // Every distinct mark in the included columns. Recomputed as columns are
  // toggled, because a "Total" column excluded from the dates should also stop
  // contributing its numbers to this list.
  const cellValues = useMemo(
    () => (rows.length ? countCellValues(rows, includedCols.map((c) => c.header)) : []),
    [rows, includedCols],
  );

  function reset() {
    setStep(1); setFileName(''); setBook(null); setSheets({ contacts: '', events: '' });
    setHeaders([]); setRows([]); setEventMeta(null); setMapping({}); setShowExtra(false);
    setDateCols([]); setTokens(DEFAULT_PRESENT_TOKENS); setMatchByName(false);
    setAnalysis(null); setResult(null); setProgress(null);
  }

  /**
   * (Re)reads a chosen pair of sheets and rebuilds everything downstream of them.
   * Called on file open and whenever either sheet is changed, because the mapping
   * and the sabha columns are both derived from the sheets and a stale mapping
   * pointing at columns from a different sheet is worse than no mapping.
   */
  function applySheets(handle, contactsSheet, eventsSheet) {
    const parsed = handle.rowsOf(contactsSheet);
    if (!parsed.length) {
      showToast({ type: 'error', message: `“${contactsSheet}” has no rows in it.` });
      return;
    }
    // Object.keys, not headersOf: these are the keys the row objects are actually
    // indexed by, so mapping against them can never miss. (XLSX renames a
    // duplicated header to Header_1; headersOf reports the raw text, which then
    // would not resolve.)
    const hdrs = Object.keys(parsed[0]);
    const meta = eventsSheet ? buildEventMetaIndex(handle.rowsOf(eventsSheet)) : null;
    const { dates } = proposeDateColumns(hdrs, meta);
    const proposed = proposeFieldMapping(hdrs);

    setSheets({ contacts: contactsSheet, events: eventsSheet || '' });
    setHeaders(hdrs);
    setRows(parsed);
    setEventMeta(meta);
    setMapping(proposed);
    setShowExtra(EXTRA_FIELDS.some((f) => proposed[f]));
    setDateCols(dates.map((d) => ({ ...d, include: true })));
  }

  function onFileChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const handle = readImportWorkbook(XLSX, evt.target.result);
        if (!handle.sheetNames.length) {
          showToast({ type: 'error', message: 'That file has no sheets in it.' });
          return;
        }
        // Guess the pair. A sheet actually named Contacts wins; otherwise the
        // first sheet, which is what a CSV always is.
        const contactsSheet = handle.sheetNames.find((n) => /contact/i.test(n))
          || handle.sheetNames[0];
        const eventsSheet = handle.sheetNames.find(
          (n) => n !== contactsSheet && looksLikeEventsSheet(handle.headersOf(n)),
        ) || '';

        setFileName(file.name);
        setBook(handle);
        applySheets(handle, contactsSheet, eventsSheet);
        setStep(2);
      } catch (err) {
        showToast({ type: 'error', message: 'Couldn’t read that file. Make sure it’s a valid CSV or XLSX.' });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function toggleCol(header) {
    setDateCols((cs) => cs.map((c) => (c.header === header ? { ...c, include: !c.include } : c)));
  }

  function setAllCols(include) {
    setDateCols((cs) => cs.map((c) => ({ ...c, include })));
  }

  /** Promote a column the parser didn't recognise, e.g. "Sabha 5" with the date
   *  typed in by hand. Without this a sheet whose headers are labels rather than
   *  dates could not be imported at all. */
  function addManualColumn(header, date) {
    const parsed = parseSheetDate(date);
    if (!parsed) {
      showToast({ type: 'error', message: 'Enter the date as YYYY-MM-DD or DD/MM/YYYY.' });
      return;
    }
    const meta = eventMeta?.get(header) || null;
    setDateCols((cs) => [
      ...cs.filter((c) => c.header !== header),
      {
        header,
        date: parsed,
        include: true,
        title: meta?.title || null,
        titleFromEvents: Boolean(meta?.title),
        time: meta?.time || null,
        durationMinutes: meta?.durationMinutes || null,
        speaker: meta?.speaker || null,
      },
    ].sort((a, b) => (a.date < b.date ? -1 : 1)));
  }

  function toggleToken(value) {
    const v = value.trim().toLowerCase();
    setTokens((t) => (t.includes(v) ? t.filter((x) => x !== v) : [...t, v]));
  }

  async function handleAnalyze() {
    if (!mapping.Name) { showToast({ type: 'error', message: 'Map the Name column first.' }); return; }
    if (!includedCols.length) { showToast({ type: 'error', message: 'Include at least one sabha date column.' }); return; }
    setBusy(true);
    try {
      const a = await analyzeHistoryImport({
        rows, mapping, dateColumns: includedCols, presentTokens: tokens, matchByName,
      });
      setAnalysis(a);
      setStep(3);
    } catch (err) {
      showToast({ type: 'error', message: friendlyFirestoreError(err, 'contacts and events') });
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    setBusy(true);
    setProgress({ done: 0, total: analysis.stats.writes });
    try {
      const res = await runHistoryImport({
        analysis, mapping, dateColumns: includedCols,
        volunteerId: volunteer?.id, defaults, fileName,
        onProgress: setProgress,
      });
      setResult(res);
      setStep(4);
    } catch (err) {
      // Write errors, not read errors, so friendlyFirestoreError's "couldn't
      // load" wording would be wrong. The partial-write warning matters: the
      // batches already committed are not rolled back — but re-running is safe,
      // so the fix is to press the button again.
      //
      // The permission-denied text names the deploy FIRST on purpose. Until
      // Phase 25 the rules had `allow update: if false` on attendance, which
      // refused every re-import (the importer set()s a deterministic ID so a
      // second run overwrites rather than duplicates, and Firestore reads that
      // as an update). The old wording blamed the role, so the obvious response
      // was to go and edit a role that was never the problem.
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Firestore refused the write. Most likely the rules on this project are older than the app — run: firebase deploy --only firestore:rules. If they are current, your role needs Import Contacts & History, and a role limited to an Area or Mandal can only import contacts inside it.'
          : `Import stopped partway (${err?.code || err?.message || 'unknown error'}). Nothing is duplicated if you run it again.`,
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!canImport) {
    return (
      <p className="text-sm text-slate-500">
        You need the <strong>Import Contacts &amp; History (CSV)</strong> permission to use this tab.
      </p>
    );
  }

  const namedSabhas = includedCols.filter((c) => c.titleFromEvents).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">Import Sabha History</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          Bring a Yuvak Mandal sheet in — contacts and every sabha column in it — as real attendance records.
          Safe to run twice: contacts match on mobile number and each mark is written once.
        </p>
      </div>

      <UndoPanel showToast={showToast} />

      {/* ── 1. File ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <ImportGuide variant="history" />
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-slate-600 hover:border-orange-300 hover:bg-orange-50/40">
            <FolderOpen className="h-8 w-8 text-slate-400" />
            <span className="font-semibold">Click to choose your sheet</span>
            <span className="text-center text-xs text-slate-400">
              .csv or .xlsx · one row per person, one column per sabha
            </span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChosen} />
          </label>
        </>
      )}

      {/* ── 2. Map + confirm ────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">{fileName} · {rows.length} rows · {headers.length} columns</p>

          {/* Sheet picker. Only shown when there is a choice to make — a CSV has
              exactly one sheet and this would be a dropdown with one option. */}
          {book && book.sheetNames.length > 1 && (
            <Card className="p-4">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Sheet className="h-4 w-4 text-slate-400" /> Which sheet is which
              </p>
              <p className="mb-3 text-xs text-slate-400">
                This workbook has {book.sheetNames.length} sheets. The Events sheet is optional, but it is what
                gives each sabha its real name, time, duration and speaker instead of the five characters that
                fit in a column header.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    People &amp; attendance <span className="text-orange-500">*</span>
                  </label>
                  <Select
                    value={sheets.contacts}
                    onChange={(e) => applySheets(book, e.target.value, sheets.events)}
                  >
                    {book.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Events (sabha names)</label>
                  <Select
                    value={sheets.events}
                    onChange={(e) => applySheets(book, sheets.contacts, e.target.value)}
                  >
                    <option value="">— none, use the column headers —</option>
                    {book.sheetNames
                      .filter((n) => n !== sheets.contacts)
                      .map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </div>
              </div>
              {sheets.events && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
                  <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>
                    {eventMeta?.size || 0} rows on “{sheets.events}” read.{' '}
                    <strong className="font-medium text-slate-700">{namedSabhas} of {includedCols.length}</strong>{' '}
                    sabha columns matched a name.
                    {namedSabhas < includedCols.length && (
                      <> The rest fall back to their column header — check that <code>ColumnName</code> matches
                        the header exactly.</>
                    )}
                  </span>
                </p>
              )}
            </Card>
          )}

          <Card className="p-4">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <ListChecks className="h-4 w-4 text-slate-400" /> Which column is what
            </p>
            <p className="mb-3 text-xs text-slate-400">Name is required. Mobile number is how a row is matched to a contact you already have.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CORE_FIELDS.map((f) => (
                <div key={f}>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    {FIELD_LABELS[f] || f} {f === 'Name' && <span className="text-orange-500">*</span>}
                  </label>
                  <Select value={mapping[f] || ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                    <option value="">— skip —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowExtra((s) => !s)}
              className="mt-3 flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline"
            >
              {showExtra ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showExtra ? 'Hide' : 'Show'} {EXTRA_FIELDS.length} more fields
              {!showExtra && EXTRA_FIELDS.some((f) => mapping[f]) && (
                <span className="text-slate-400">
                  ({EXTRA_FIELDS.filter((f) => mapping[f]).length} already matched)
                </span>
              )}
            </button>

            {showExtra && (
              <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
                {EXTRA_FIELDS.map((f) => (
                  <div key={f}>
                    <label className="mb-1 block text-xs font-medium text-slate-600">{FIELD_LABELS[f] || f}</label>
                    <Select value={mapping[f] || ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                      <option value="">— skip —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <CalendarDays className="h-4 w-4 text-slate-400" /> Sabha date columns ({includedCols.length} of {dateCols.length})
              </p>
              {dateCols.length > 1 && (
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setAllCols(true)}>All</Button>
                  <Button variant="ghost" size="sm" onClick={() => setAllCols(false)}>None</Button>
                </div>
              )}
            </div>
            <p className="mb-3 text-xs text-slate-400">
              Each one becomes an event on the Events tab. Untick anything that isn’t a sabha (a total, a remark).
              Dates like 09/06/24 are read day-first.
            </p>
            {dateCols.length === 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No column header looked like a date. Add them by hand below.
              </p>
            )}
            {sharedDates.length > 0 && (
              <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <span className="font-semibold">Two sabhas on one day:</span>{' '}
                {sharedDates.join(', ')} — each column becomes its own event, so both sittings are
                kept apart. If one of them is a duplicate column, untick it here.
              </p>
            )}
            {/* A list rather than chips: with the Events sheet joined there is a
                real title to show, and 35 rows of "date — title" is the closest
                thing to a preview of what the Events tab will look like. */}
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {dateCols.map((c) => (
                <button
                  key={c.header}
                  type="button"
                  onClick={() => toggleCol(c.header)}
                  className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                    c.include
                      ? 'border-orange-200 bg-orange-50/70 text-orange-900'
                      : 'border-slate-200 bg-white text-slate-400'
                  }`}
                  title={`Column: ${c.header}`}
                >
                  <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                    c.include ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-300 bg-white'
                  }`}
                  >
                    {c.include && <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span className="w-[5.5rem] shrink-0 font-mono tabular-nums">{c.date}</span>
                  <span className={`min-w-0 flex-1 truncate font-medium ${c.include ? '' : 'line-through'}`}>
                    {c.title || <span className="font-normal italic text-slate-400">no title</span>}
                  </span>
                  {c.titleFromEvents
                    ? <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Events</span>
                    : <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">header</span>}
                </button>
              ))}
            </div>
            <ManualColumnAdder
              headers={headers.filter((h) => !dateCols.some((c) => c.header === h))}
              onAdd={addManualColumn}
            />
          </Card>

          <Card className="p-4">
            <p className="mb-1 text-sm font-semibold text-slate-800">Which marks mean present?</p>
            <p className="mb-3 text-xs text-slate-400">
              Every mark found in the columns above is listed with how often it appears. Tick the ones that mean
              attended — anything left unticked is treated as absent and writes nothing.
            </p>
            {cellValues.length === 0 && <p className="text-xs text-slate-400">No marks found in the selected columns.</p>}
            <div className="flex flex-wrap gap-1.5">
              {cellValues.slice(0, 40).map(({ value, count }) => {
                const on = tokens.includes(value.trim().toLowerCase());
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleToken(value)}
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      on
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-medium">{value}</span>
                    <span className={on ? 'text-emerald-600' : 'text-slate-400'}> · {count}</span>
                  </button>
                );
              })}
            </div>
            {cellValues.length > 40 && (
              <p className="mt-2 text-xs text-slate-400">
                Showing the 40 most common of {cellValues.length} distinct marks. Rarer ones count as absent.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-1 text-sm font-semibold text-slate-800">Defaults for what gets created</p>
            <p className="mb-3 text-xs text-slate-400">
              Used for the events, and for any contact whose row has no Area/Mandal of its own.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Mandal</label>
                <Select value={defaults.mandal} onChange={(e) => setDefaults((d) => ({ ...d, mandal: e.target.value }))}>
                  <option value="">— all mandals —</option>
                  {mandals.map((m) => <option key={m.id || m.name} value={m.name}>{m.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Area</label>
                <Select value={defaults.area} onChange={(e) => setDefaults((d) => ({ ...d, area: e.target.value }))}>
                  <option value="">— all areas —</option>
                  {areas.map((a) => <option key={a.id || a.name} value={a.name}>{a.name}</option>)}
                </Select>
              </div>
              <div>
                {/* The sheet records the date but never the hour — unless the
                    Events sheet does, in which case each sabha keeps its own and
                    this is only the fallback. */}
                <label className="mb-1 block text-xs font-medium text-slate-600">Sabha time</label>
                <Input type="time" value={defaults.time} onChange={(e) => setDefaults((d) => ({ ...d, time: e.target.value }))} />
              </div>
            </div>
          </Card>

          {/* Read cost. On the free tier the dry run is not free either, and the
              old version of this screen quietly read every contact in the
              database each time it was pressed. */}
          <Card className="p-4">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <Database className="h-4 w-4 text-slate-400" /> How hard the check looks
            </p>
            <label className="mt-2 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={matchByName}
                onChange={(e) => setMatchByName(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
              />
              <span className="text-xs text-slate-600">
                <strong className="font-medium text-slate-800">Also match on name</strong>, for rows with no phone
                number.
                <span className="mt-0.5 block text-slate-400">
                  Off by default. Matching on mobile number only needs the {rows.length} numbers in this sheet;
                  matching on name needs <em>every</em> contact in the database, which on the free plan is the
                  single most expensive thing this screen can do. It also merges two different people who happen
                  to share a name.
                </span>
              </span>
            </label>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={handleAnalyze} disabled={busy}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</> : <>Dry run</>}
            </Button>
            <Button variant="ghost" onClick={reset}>Start over</Button>
          </div>
        </div>
      )}

      {/* ── 3. Dry run ──────────────────────────────────────────────── */}
      {step === 3 && analysis && (
        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">Dry run — nothing has been saved yet</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Sabhas" value={analysis.stats.sabhas} />
              <Stat label="New events" value={analysis.stats.newEvents} tone="orange" />
              <Stat label="Reused events" value={analysis.stats.reusedEvents} />
              <Stat label="Present marks" value={analysis.stats.presentMarks} tone="emerald" />
              <Stat label="Matched by mobile" value={analysis.stats.matchedByMobile} />
              <Stat label="Matched by name" value={analysis.stats.matchedByName} tone="orange" />
              <Stat label="New contacts" value={analysis.stats.toCreate} tone="orange" />
              <Stat label="Rows skipped" value={analysis.stats.skipped} tone={analysis.stats.skipped ? 'rose' : 'slate'} />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {analysis.stats.writes.toLocaleString('en-IN')} documents will be written.
              {' '}This check read {analysis.stats.reads.toLocaleString('en-IN')}.
              {analysis.stats.skipped > 0 && ' Skipped rows had no name.'}
            </p>
          </Card>

          {analysis.stats.matchedByName > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {analysis.stats.matchedByName} rows matched an existing contact by <strong>name only</strong> —
                no mobile number to confirm it. Two people with the same name will be merged into one.
                Check those rows in the sheet if that matters.
              </p>
            </div>
          )}

          {!analysis.stats.matchByName && analysis.stats.rowsWithoutPhone > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <p>
                {analysis.stats.rowsWithoutPhone} rows have no phone number, so they could not be checked against
                your existing contacts and will be created fresh. Tick “Also match on name” on the previous step
                if some of them are already in MDS.
              </p>
            </div>
          )}

          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold text-slate-800">First 10 rows</p>
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-slate-600">Name</th>
                    <th className="px-2 py-1.5 text-left font-medium text-slate-600">Mobile</th>
                    <th className="px-2 py-1.5 text-left font-medium text-slate-600">Match</th>
                    <th className="px-2 py-1.5 text-left font-medium text-slate-600">Sabhas present</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.plan.slice(0, 10).map((p) => (
                    <tr key={p.index} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-700">{p.name}</td>
                      <td className="px-2 py-1.5 text-slate-500">{p.mobile || '—'}</td>
                      <td className="px-2 py-1.5">
                        {p.existingId
                          ? <span className="text-emerald-700">existing</span>
                          : <span className="text-orange-700">new</span>}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">{p.columns.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={handleRun} disabled={busy}>
              {busy
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing {progress ? `${progress.done}/${progress.total}` : ''}</>
                : <><Play className="h-4 w-4" /> Import {analysis.stats.writes.toLocaleString('en-IN')} records</>}
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>← Back to mapping</Button>
          </div>
        </div>
      )}

      {/* ── 4. Done ─────────────────────────────────────────────────── */}
      {step === 4 && result && (
        <Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 text-lg font-semibold text-slate-900">History imported</p>
          <p className="mt-1 text-sm text-slate-500">
            {result.newEvents} new sabha{result.newEvents === 1 ? '' : 's'} · {result.contactsCreated} new contacts
            · {result.contactsMatched} matched · {result.marks.toLocaleString('en-IN')} attendance marks.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            The sabhas are on the Events tab and each person’s record now shows their full history.
          </p>
          <Button variant="accent" className="mt-4" onClick={reset}>Import another sheet</Button>
          {/* The moment somebody notices they imported the wrong sheet is the
              moment they are reading this card, so it points at the way out. */}
          <p className="mt-3 text-[11px] text-slate-400">
            Wrong sheet? Use <strong>Undo an import</strong> at the top of this tab —
            this run is the newest one in the list.
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * Reversing an import.
 *
 * Why this had to exist rather than "delete the wrong contacts by hand": a
 * refused write rejects a whole 450-operation WriteBatch atomically, so a failed
 * import leaves PART of itself committed — some sabhas, some contacts, some marks
 * — and everything after the refusal never attempted. Picking those out by eye
 * across three collections is not realistic, and the half-imported sabhas look
 * exactly like real ones on the Events tab.
 *
 * Two ways in, because the run marker arrived after the first imports did:
 *   • a run from the list — precise, reverses only that attempt;
 *   • "everything ever imported" — the fallback for anything written before
 *     importRunId existed, which includes the half import that prompted this.
 *
 * Collapsed by default: opening it costs a read of importRuns, and this is not a
 * screen anyone should land on by accident.
 */
function UndoPanel({ showToast }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState(null);       // null until first load
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(null); // { runId, label, counts }
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setRuns(await listImportRuns());
    } catch (err) {
      // A refused read must NOT read as "no imports have happened" — that is the
      // difference between "nothing to undo" and "I cannot see what there is to
      // undo", and on undeployed rules importRuns is default-denied, so this is
      // the common case rather than the rare one.
      setRuns([]);
      setLoadError(err?.code === 'permission-denied'
        ? 'Can’t read the import history — the rules for it are not deployed yet (firebase deploy --only firestore:rules). The sweep below still works.'
        : friendlyFirestoreError(err, 'import history'));
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && runs === null) load();
  }

  /** Count first, always. Deleting thousands of rows on a guess is not an undo. */
  async function preview(runId, label) {
    setBusy(true);
    try {
      const counts = await analyzeHistoryImportUndo({ runId });
      setPending({ runId, label, counts });
    } catch (err) {
      showToast({ type: 'error', message: friendlyFirestoreError(err, 'the imported records') });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setPhase('attendance');
    try {
      const counts = await undoHistoryImport({
        runId: pending.runId,
        onProgress: (p) => setPhase(p.phase),
      });
      showToast({
        type: 'success',
        message: `Undone — removed ${counts.marks.toLocaleString('en-IN')} attendance marks, `
          + `${counts.contacts} imported contacts and ${counts.events} imported sabhas.`,
      });
      setPending(null);
      await load();
    } catch (err) {
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Firestore refused the delete. Deploy the rules first: firebase deploy --only firestore:rules'
          : `Undo stopped partway (${err?.code || err?.message || 'unknown'}). Press Undo again — it deletes by query, so a second pass just finds fewer rows.`,
      });
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  const statusTone = {
    complete: 'bg-emerald-50 text-emerald-700',
    failed: 'bg-rose-50 text-rose-700',
    running: 'bg-amber-50 text-amber-700',
    undone: 'bg-slate-100 text-slate-500',
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <History className="h-4 w-4 text-slate-400" /> Undo an import
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">
            Removes only what an import created — the sabhas, the contacts it added, and its
            attendance marks. Contacts it matched on their mobile number, and sabhas that already
            existed, are left exactly as they were.
          </p>
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              One thing it cannot put back: if somebody was marked present by hand in the app and
              an import later wrote over that mark, undo removes it — the earlier version is gone,
              so those few people return to “not marked” rather than to what they were.
            </span>
          </p>

          {loading && (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading import history…
            </p>
          )}

          {runs?.length > 0 && (
            <ul className="mt-3 space-y-2">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <span className="truncate">{r.fileName || 'Sabha history'}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${statusTone[r.status] || 'bg-slate-100 text-slate-500'}`}>
                        {r.status}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {r.startedAt?.toDate
                        ? r.startedAt.toDate().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                        : 'just now'}
                      {' · '}{r.events} sabhas · {r.contacts} contacts
                      {' · '}{(r.marks || 0).toLocaleString('en-IN')} marks
                      {r.error ? ` · stopped on ${r.error}` : ''}
                    </p>
                  </div>
                  {r.status === 'undone' ? (
                    <span className="text-[11px] text-slate-400">Already reversed</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => preview(r.id, r.fileName || 'this import')}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Undo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {runs && runs.length === 0 && !loading && (
            loadError
              ? (
                <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{loadError}</span>
                </p>
              )
              : (
                <p className="mt-3 text-sm text-slate-400">
                  No import runs on record. Runs have only been tracked since this version — use the
                  option below for anything imported before that.
                </p>
              )
          )}

          {/* The legacy sweep. Deliberately last, deliberately red: it reverses
              EVERY history import ever made, which is right for a database whose
              only import is the broken one and wrong for anything else. */}
          <div className="mt-4 rounded-lg border border-rose-100 bg-rose-50/50 p-3">
            <p className="text-xs font-semibold text-rose-800">Everything ever imported</p>
            <p className="mt-1 text-[11px] text-rose-700/80">
              Reverses every sabha-history import, including ones made before runs were tracked.
              Use this to clear a half import from an earlier version — but not if you have good
              imports you want to keep, because it takes those too.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={() => preview(null, 'every history import ever made')}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Count what this would remove
            </Button>
          </div>

          {pending && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-900">
                Undo {pending.label}?
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Stat label="Sabhas" value={pending.counts.events} tone="rose" />
                <Stat label="Contacts" value={pending.counts.contacts} tone="rose" />
                <Stat label="Marks" value={pending.counts.marks.toLocaleString('en-IN')} tone="rose" />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {pending.counts.total.toLocaleString('en-IN')} documents will be deleted, in that
                order — marks first, so an interrupted undo never leaves attendance pointing at a
                sabha that no longer exists. This cannot be reversed.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="dangerSolid" size="sm" onClick={confirm} disabled={busy || pending.counts.total === 0}>
                  {busy
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Deleting {phase}…</>
                    : <><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Yes, delete {pending.counts.total.toLocaleString('en-IN')}</>}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
              </div>
              {pending.counts.total === 0 && (
                <p className="mt-2 text-[11px] text-slate-400">
                  Nothing to remove — this import left no documents behind.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Lets an admin point a non-date column at a date they type in. */
function ManualColumnAdder({ headers, onAdd }) {
  const [header, setHeader] = useState('');
  const [date, setDate] = useState('');
  if (!headers.length) return null;
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-2 text-xs font-medium text-slate-600">Add a column the parser missed</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <Select value={header} onChange={(e) => setHeader(e.target.value)}>
            <option value="">— choose column —</option>
            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </Select>
        </div>
        <div className="w-36">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { if (header && date) { onAdd(header, date); setHeader(''); setDate(''); } }}
          disabled={!header || !date}
        >
          Add as sabha
        </Button>
      </div>
    </div>
  );
}
