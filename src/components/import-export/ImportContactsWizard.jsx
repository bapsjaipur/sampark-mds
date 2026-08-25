// src/components/import-export/ImportContactsWizard.jsx — Attio redesign.
// `mode` prop ('household' | 'standalone'). 'household' (default, used on the
// Households page) creates one household-of-one per row, same as before.
// 'standalone' (used on the All Contacts page) creates bare individuals with no
// household at all — Area/Mandal are stored directly on the individual (using
// Phase 16's individual.area field) instead of on a household doc.
//
// PHASE 25 — four things this quietly got wrong before.
//
//   1. AUTO-MAPPING was an exact lower-case header match, so a sheet whose column
//      says "Mobile" or "WhatsApp No" left Phone unmapped. The admin then either
//      noticed and fixed it, or imported 400 contacts with no phone numbers —
//      which also means no way to match them next time. Now it matches on the
//      alias list in src/lib/importTemplates.js.
//   2. DOB WAS HARD-CODED `null`, even when the column was mapped and previewed.
//      You could map it, see it in the preview, import, and it was never written.
//      Birthdays are the whole point of the Reminders tab.
//   3. NO DUPLICATE CHECK. Importing the same list twice made two of everybody.
//      Now the phone numbers in the file are looked up before writing (chunked,
//      so it costs one read per matching contact rather than a full scan) and
//      existing rows are skipped by default.
//   4. Sub Area, Anniversary, Status and Reference had nowhere to go.
//
// The column contract, the guide and the sample template all come from
// src/lib/importTemplates.js, so this screen and the file people are told to
// prepare cannot drift apart.
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { collection, doc, query, serverTimestamp, where } from 'firebase/firestore';
import {
  FolderOpen, ListChecks, Eye, CheckCircle2, Loader2, CopyX,
} from 'lucide-react';
// Metered drop-ins (Phase 24). An import is the single biggest thing a volunteer
// can do to the day's quota; it should show up in the usage dashboard.
import { getDocs, writeBatch } from '../../lib/fsMetered';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { chunk } from '../../lib/firestoreHelpers';
import { toMonthDay } from '../../lib/dateHelpers';
import { CONTACT_COLUMNS } from '../../lib/importTemplates';
import { normalizeMobile, parseSheetDate } from '../../services/historyImportService';
import ImportGuide from './ImportGuide';
import Modal from '../ui/Modal';
import { Select } from '../ui/Input';
import { Button } from '../ui/Button';

const IMPORT_FIELDS = CONTACT_COLUMNS.map((c) => c.name);
const REQUIRED_FIELDS = CONTACT_COLUMNS.filter((c) => c.required).map((c) => c.name);
const DATE_FIELDS = ['DOB', 'Anniversary'];
// Firestore caps an `in` filter at 30 values.
const IN_LIMIT = 30;

/** Alias-based auto-mapping: "Mobile", "WhatsApp No" and "Phone" all find Phone. */
function autoMap(headers) {
  const out = {};
  const taken = new Set();
  CONTACT_COLUMNS.forEach((col) => {
    const wanted = [col.name.toLowerCase(), ...(col.aliases || [])];
    const hit = headers.find(
      (h) => !taken.has(h) && wanted.includes(String(h).trim().toLowerCase()),
    );
    if (hit) { out[col.name] = hit; taken.add(hit); }
  });
  return out;
}

export default function ImportContactsWizard({ open, onClose, mode = 'household' }) {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [dupes, setDupes] = useState(null);   // { existing:Set, inFile:Set, reads:number }
  const [skipDupes, setSkipDupes] = useState(true);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  function reset() {
    setStep(1); setHeaders([]); setRawRows([]); setMapping({}); setPreviewRows([]);
    setDupes(null); setSkipDupes(true); setResult(null);
  }
  function handleClose() { reset(); onClose(); }

  function onFileChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (rows.length === 0) { showToast({ type: 'error', message: 'No rows found in that file.' }); return; }
        const hdrs = Object.keys(rows[0]);
        setHeaders(hdrs);
        setRawRows(rows);
        setMapping(autoMap(hdrs));
        setStep(2);
      } catch (err) {
        showToast({ type: 'error', message: 'Couldn’t read that file. Make sure it’s a valid CSV or XLSX.' });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * Builds the preview AND checks the phone numbers against what is already in
   * Firestore, because "will this create duplicates?" is the one question you
   * cannot answer by looking at the file.
   *
   * Chunked `where('mobile','in',…)`, not a full read of `individuals`: the cost
   * is one read per contact that actually matches, so importing 50 rows costs at
   * most 50 reads whether the database holds 400 contacts or 40,000.
   */
  async function buildPreview() {
    if (!mapping.Name) { showToast({ type: 'error', message: 'Map at least the Name column.' }); return; }

    const rows = rawRows.map((r) => {
      const out = {};
      IMPORT_FIELDS.forEach((f) => {
        const raw = mapping[f] ? r[mapping[f]] : '';
        if (DATE_FIELDS.includes(f)) {
          // Kept as a real date, not text. Excel hands dates over as Date objects
          // or as serial numbers (46025), and String()-ing either one produces
          // something no parser will take later.
          const iso = raw === '' || raw == null ? '' : parseSheetDate(raw);
          out[f] = iso || '';
          // Remember what was in the cell when it would not parse, so the preview
          // can show the admin the actual offending value.
          out[`_bad${f}`] = !iso && raw !== '' && raw != null ? String(raw).trim() : '';
        } else {
          out[f] = String(raw ?? '').trim();
        }
      });
      out._mobile = normalizeMobile(out.Phone);
      return out;
    });
    setPreviewRows(rows);
    setStep(3);

    // ── Duplicate check ──────────────────────────────────────────────
    const seen = new Set();
    const inFile = new Set();
    rows.forEach((r) => {
      if (!r.Name || !r._mobile) return;
      if (seen.has(r._mobile)) inFile.add(r._mobile);
      seen.add(r._mobile);
    });

    const numbers = [...seen];
    if (!numbers.length) { setDupes({ existing: new Set(), inFile, reads: 0 }); return; }

    setChecking(true);
    try {
      const snaps = await Promise.all(
        chunk(numbers, IN_LIMIT).map((slice) => getDocs(
          query(collection(db, 'individuals'), where('mobile', 'in', slice)),
        )),
      );
      const existing = new Set();
      let reads = 0;
      snaps.forEach((snap) => {
        reads += snap.size;
        snap.docs.forEach((d) => {
          const m = normalizeMobile(d.data().mobile);
          if (m) existing.add(m);
        });
      });
      setDupes({ existing, inFile, reads });
    } catch (err) {
      // A failed check must not block the import — it only means the admin
      // decides without it. Silent would be wrong, though: they would think a
      // clean report meant no duplicates.
      setDupes(null);
      showToast({
        type: 'error',
        message: 'Couldn’t check for existing contacts, so duplicates can’t be flagged. The import itself still works.',
      });
    } finally {
      setChecking(false);
    }
  }

  /** Rows that will actually be written, given the skip-duplicates choice. */
  function rowsToWrite() {
    return previewRows.filter((r) => {
      if (!r.Name) return false;
      if (!skipDupes || !dupes) return true;
      return !(r._mobile && dupes.existing.has(r._mobile));
    });
  }

  async function runImport() {
    setRunning(true);
    const validRows = rowsToWrite();
    let batch = writeBatch(db);
    let opCount = 0;
    const commitIfNeeded = async () => { opCount++; if (opCount >= 400) { await batch.commit(); batch = writeBatch(db); opCount = 0; } };

    try {
      for (const r of validRows) {
        const mobile = r._mobile;
        const dob = r.DOB || null;
        const anniversary = r.Anniversary || null;
        const shared = {
          name: r.Name,
          mobile: mobile || null,
          dob,
          dobMonthDay: dob ? toMonthDay(dob) : null,
          anniversary,
          anniversaryMonthDay: anniversary ? toMonthDay(anniversary) : null,
          mandal: r.Mandal || null,
          subArea: r['Sub Area'] || null,
          relation: 'head',
          isPrimary: true,
          profilePhotoURL: null,
          // Carried across when the sheet has them — a contact that was already
          // called does not need calling again. Stored verbatim; a value matching
          // no chip on Admin Tools → Call Outcomes still shows as plain text.
          status: r.Status || '',
          reference: r.Reference || '',
          callCount: 0,
          importedBy: volunteer?.id || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        if (mode === 'standalone') {
          // No household created — Area/Mandal live directly on the individual.
          const indRef = doc(collection(db, 'individuals'));
          batch.set(indRef, {
            ...shared,
            householdId: null,
            area: r.Area || null,
            legacyExtra: {
              study: r.Study || null,
              profession: r.Profession || null,
              skill: r.Skill || null,
              note: r.Note || null,
              address: r.Complete_Address || null,
            },
          });
          await commitIfNeeded();
        } else {
          const hhRef = doc(collection(db, 'households'));
          batch.set(hhRef, {
            address: r.Complete_Address || '',
            area: r.Area || '',
            level: null,
            totalFamilyMembers: 1,
            samparkKaryakartaName: null,
            samparkKaryakartaNumber: null,
            remark: r.Note || '',
            legacyId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await commitIfNeeded();

          const indRef = doc(collection(db, 'individuals'));
          batch.set(indRef, {
            ...shared,
            householdId: hhRef.id,
            // area is denormalised from the household by contactService on edit;
            // set here too so scoped roles can see the contact immediately.
            area: r.Area || null,
            legacyExtra: {
              study: r.Study || null,
              profession: r.Profession || null,
              skill: r.Skill || null,
            },
          });
          await commitIfNeeded();
        }
      }
      if (opCount > 0) await batch.commit();
      setResult({
        imported: validRows.length,
        noName: previewRows.filter((r) => !r.Name).length,
        skippedDupes: previewRows.length - validRows.length - previewRows.filter((r) => !r.Name).length,
      });
      setStep(4);
    } catch (err) {
      showToast({ type: 'error', message: 'Import failed partway through — check your permissions and try again.' });
    } finally {
      setRunning(false);
    }
  }

  // Only the mapped columns are worth showing in the preview: fourteen columns
  // of mostly-blank cells is not a preview of anything.
  const shownFields = IMPORT_FIELDS.filter((f) => mapping[f]);
  const existingCount = dupes
    ? previewRows.filter((r) => r.Name && r._mobile && dupes.existing.has(r._mobile)).length
    : 0;
  const badDates = previewRows.filter((r) => DATE_FIELDS.some((f) => r[`_bad${f}`])).length;
  const willWrite = rowsToWrite().length;

  return (
    <Modal open={open} onClose={handleClose} title="Import Contacts" size="lg">
      {step === 1 && (
        <div className="space-y-3">
          <ImportGuide variant="contacts" />
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-slate-600 hover:border-orange-300 hover:bg-orange-50/40">
            <FolderOpen className="h-8 w-8 text-slate-400" />
            <span className="font-semibold">Click to choose file</span>
            <span className="text-xs text-slate-400">.csv or .xlsx · first row must be the header row</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChosen} />
          </label>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800"><ListChecks className="h-4 w-4 text-slate-400" /> Map your columns</p>
          <p className="mb-4 text-sm text-slate-400">
            Matched by name where we could — check them, then set anything left on “skip”.
            Phone is worth filling in: it is how we tell an existing contact from a new one.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <div key={f}>
                <label className="mb-1 block text-xs font-medium text-slate-600">{f} {REQUIRED_FIELDS.includes(f) && <span className="text-orange-500">*</span>}</label>
                <Select value={mapping[f] || ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                  <option value="">— skip —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </div>
            ))}
          </div>
          <Button variant="accent" className="mt-4 w-full" onClick={buildPreview}><Eye className="h-4 w-4" /> Preview Import</Button>
        </div>
      )}

      {step === 3 && (
        <div>
          <p className="mb-3 font-semibold text-slate-800">Preview (first 10 of {previewRows.length})</p>

          {/* ── Duplicate report ─────────────────────────────────────── */}
          {checking && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking these phone numbers against your contacts…
            </p>
          )}
          {!checking && dupes && (existingCount > 0 || dupes.inFile.size > 0) && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <p className="flex items-center gap-1.5 font-medium">
                <CopyX className="h-4 w-4 shrink-0" />
                {existingCount > 0 && <>{existingCount} row{existingCount === 1 ? '' : 's'} already in MDS</>}
                {existingCount > 0 && dupes.inFile.size > 0 && ' · '}
                {dupes.inFile.size > 0 && <>{dupes.inFile.size} number{dupes.inFile.size === 1 ? '' : 's'} repeated inside the file</>}
              </p>
              {existingCount > 0 && (
                <label className="mt-2 flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={skipDupes}
                    onChange={(e) => setSkipDupes(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span className="text-xs">
                    Skip the {existingCount} that already exist.
                    <span className="mt-0.5 block text-amber-700">
                      Untick to import them anyway — you will have two records for each of those people, which
                      splits their attendance and call history in half.
                    </span>
                  </span>
                </label>
              )}
              {dupes.inFile.size > 0 && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Repeats inside the file are imported as-is — fix them in the sheet if they are the same person.
                </p>
              )}
            </div>
          )}
          {!checking && dupes && existingCount === 0 && dupes.inFile.size === 0 && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> No duplicates found
              {dupes.reads > 0 && <span className="text-slate-400">· {dupes.reads} contacts checked</span>}
            </p>
          )}
          {badDates > 0 && (
            <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {badDates} row{badDates === 1 ? '' : 's'} had a date that could not be read — those are shown in red
              below and will be imported blank. Use YYYY-MM-DD, or format the column as a real date in Excel.
            </p>
          )}

          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-16 px-2 py-1.5 text-left font-medium text-slate-600">Status</th>
                  {shownFields.map((f) => <th key={f} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-600">{f}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 10).map((r, i) => {
                  const isDupe = Boolean(dupes && r._mobile && dupes.existing.has(r._mobile));
                  return (
                    <tr key={i} className={`border-t border-slate-100 ${isDupe && skipDupes ? 'bg-slate-50/80 text-slate-400' : ''}`}>
                      <td className="px-2 py-1.5">
                        {!r.Name
                          ? <span className="text-rose-600">no name</span>
                          : isDupe
                            ? <span className="text-amber-700">{skipDupes ? 'skip' : 'dupe'}</span>
                            : <span className="text-emerald-700">new</span>}
                      </td>
                      {shownFields.map((f) => (
                        <td key={f} className="px-2 py-1.5 text-slate-700">
                          {r[`_bad${f}`]
                            ? <span className="text-rose-600 line-through">{r[`_bad${f}`]}</span>
                            : r[f]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button variant="accent" className="mt-4 w-full" onClick={runImport} disabled={running || checking}>
            {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : `Confirm & Import ${willWrite} contact${willWrite === 1 ? '' : 's'}`}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setStep(2)} disabled={running}>← Back to mapper</Button>
        </div>
      )}

      {step === 4 && result && (
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 text-lg font-semibold text-slate-900">Import Complete</p>
          <p className="mt-1 text-sm text-slate-400">
            {result.imported} contact{result.imported === 1 ? '' : 's'} imported
            {result.skippedDupes > 0 && `, ${result.skippedDupes} skipped as already present`}
            {result.noName > 0 && `, ${result.noName} skipped with no name`}.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {mode === 'standalone'
              ? 'Imported as standalone contacts — no households were created.'
              : 'Each became its own household — use Search & link to merge into real families.'}
          </p>
          <Button variant="accent" className="mt-4" onClick={handleClose}>Done</Button>
        </div>
      )}
    </Modal>
  );
}
