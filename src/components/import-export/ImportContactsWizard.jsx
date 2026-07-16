// src/components/import-export/ImportContactsWizard.jsx — Attio redesign.
// ADDED: `mode` prop ('household' | 'standalone'). 'household' (default,
// used on the Households page) creates one household-of-one per row, same
// as before. 'standalone' (used on the All Contacts page) creates bare
// individuals with no household at all — Area/Mandal are stored directly
// on the individual (using Phase 16's new individual.area field) instead
// of on a household doc.
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { FolderOpen, ListChecks, Eye, CheckCircle2 } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../ui/Modal';
import { Select } from '../ui/Input';
import { Button } from '../ui/Button';

const IMPORT_FIELDS = ['Name', 'Phone', 'Area', 'Mandal', 'DOB', 'Study', 'Profession', 'Skill', 'Complete_Address', 'Note'];
const REQUIRED_FIELDS = ['Name'];

export default function ImportContactsWizard({ open, onClose, mode = 'household' }) {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  function reset() { setStep(1); setHeaders([]); setRawRows([]); setMapping({}); setPreviewRows([]); setResult(null); }
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
        setHeaders(Object.keys(rows[0]));
        setRawRows(rows);
        const autoMap = {};
        IMPORT_FIELDS.forEach((f) => {
          const match = Object.keys(rows[0]).find((h) => h.toLowerCase() === f.toLowerCase());
          if (match) autoMap[f] = match;
        });
        setMapping(autoMap);
        setStep(2);
      } catch (err) {
        showToast({ type: 'error', message: 'Couldn’t read that file. Make sure it’s a valid CSV or XLSX.' });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function buildPreview() {
    if (!mapping.Name) { showToast({ type: 'error', message: 'Map at least the Name column.' }); return; }
    const rows = rawRows.map((r) => {
      const out = {};
      IMPORT_FIELDS.forEach((f) => { out[f] = mapping[f] ? String(r[mapping[f]] ?? '').trim() : ''; });
      return out;
    });
    setPreviewRows(rows);
    setStep(3);
  }

  async function runImport() {
    setRunning(true);
    const validRows = previewRows.filter((r) => r.Name);
    let batch = writeBatch(db);
    let opCount = 0;
    const commitIfNeeded = async () => { opCount++; if (opCount >= 400) { await batch.commit(); batch = writeBatch(db); opCount = 0; } };

    try {
      for (const r of validRows) {
        const mobile = String(r.Phone || '').replace(/\D/g, '');

        if (mode === 'standalone') {
          // No household created — Area/Mandal live directly on the individual.
          const indRef = doc(collection(db, 'individuals'));
          batch.set(indRef, {
            householdId: null, name: r.Name, mobile: mobile.length === 10 ? mobile : null,
            dob: null, dobMonthDay: null, anniversary: null, anniversaryMonthDay: null,
            mandal: r.Mandal || null, area: r.Area || null, relation: 'head', isPrimary: true, profilePhotoURL: null,
            status: '', reference: '', callCount: 0,
            legacyExtra: { study: r.Study || null, profession: r.Profession || null, skill: r.Skill || null, note: r.Note || null, address: r.Complete_Address || null },
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          await commitIfNeeded();
        } else {
          const hhRef = doc(collection(db, 'households'));
          batch.set(hhRef, { address: r.Complete_Address || '', area: r.Area || '', level: null, totalFamilyMembers: 1, samparkKaryakartaName: null, samparkKaryakartaNumber: null, remark: r.Note || '', legacyId: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          await commitIfNeeded();

          const indRef = doc(collection(db, 'individuals'));
          batch.set(indRef, {
            householdId: hhRef.id, name: r.Name, mobile: mobile.length === 10 ? mobile : null,
            dob: null, dobMonthDay: null, anniversary: null, anniversaryMonthDay: null,
            mandal: r.Mandal || null, relation: 'head', isPrimary: true, profilePhotoURL: null,
            status: '', reference: '', callCount: 0,
            legacyExtra: { study: r.Study || null, profession: r.Profession || null, skill: r.Skill || null },
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          await commitIfNeeded();
        }
      }
      if (opCount > 0) await batch.commit();
      setResult({ imported: validRows.length, skipped: previewRows.length - validRows.length });
      setStep(4);
    } catch (err) {
      showToast({ type: 'error', message: 'Import failed partway through — check your permissions and try again.' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import Contacts" size="lg">
      {step === 1 && (
        <div>
          <p className="mb-3 text-sm text-slate-500">Supports <strong>CSV</strong> and <strong>XLSX</strong>. First row must be a header row.</p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-slate-600 hover:border-orange-300 hover:bg-orange-50/40">
            <FolderOpen className="h-8 w-8 text-slate-400" />
            <span className="font-semibold">Click to choose file</span>
            <span className="text-xs text-slate-400">.csv or .xlsx</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChosen} />
          </label>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800"><ListChecks className="h-4 w-4 text-slate-400" /> Map your columns</p>
          <p className="mb-4 text-sm text-slate-400">Match each field to a column in your file. Leave blank to skip.</p>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>{IMPORT_FIELDS.map((f) => <th key={f} className="px-2 py-1.5 text-left font-medium text-slate-600">{f}</th>)}</tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {IMPORT_FIELDS.map((f) => <td key={f} className="px-2 py-1.5 text-slate-700">{r[f]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="accent" className="mt-4 w-full" onClick={runImport} disabled={running}>
            {running ? 'Importing…' : `Confirm & Import ${previewRows.length} rows`}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setStep(2)}>← Back to mapper</Button>
        </div>
      )}

      {step === 4 && result && (
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 text-lg font-semibold text-slate-900">Import Complete</p>
          <p className="mt-1 text-sm text-slate-400">{result.imported} contacts imported{result.skipped ? `, ${result.skipped} skipped (no name)` : ''}.</p>
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
