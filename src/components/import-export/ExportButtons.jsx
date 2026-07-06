// src/components/import-export/ExportButtons.jsx — Attio redesign.
import { useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download } from 'lucide-react';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';

const ALL_COLUMNS = [
  { key: 'name', label: 'Name', default: true }, { key: 'mobile', label: 'Phone', default: true },
  { key: 'mandal', label: 'Mandal', default: true }, { key: 'area', label: 'Area', default: true },
  { key: 'address', label: 'Address', default: false }, { key: 'level', label: 'Level', default: false },
  { key: 'status', label: 'Status', default: true }, { key: 'reference', label: 'Reference', default: false },
  { key: 'callCount', label: 'Call Count', default: false }, { key: 'dob', label: 'DOB', default: false },
  { key: 'samparkKaryakartaName', label: 'Sampark Karyakarta', default: false }, { key: 'remark', label: 'Remark', default: false },
  { key: 'legacyId', label: 'Legacy ID', default: false },
];

function toCSV(rows, columns) {
  const header = columns.map((c) => c.label).join(',');
  const lines = rows.map((r) => columns.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','));
  return [header, ...lines].join('\n');
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportButtons({ rows, label = 'contacts' }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState(null);
  const [selected, setSelected] = useState(() => new Set(ALL_COLUMNS.filter((c) => c.default).map((c) => c.key)));
  const [busy, setBusy] = useState(false);

  function openPicker(fmt) { setFormat(fmt); setOpen(true); }

  function toggleColumn(key) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }

  function runExport() {
    const columns = ALL_COLUMNS.filter((c) => selected.has(c.key));
    if (columns.length === 0) return;
    setBusy(true);
    try {
      if (format === 'csv') {
        downloadBlob(toCSV(rows, columns), `${label}-${Date.now()}.csv`, 'text/csv;charset=utf-8');
      } else {
        const pdf = new jsPDF({ orientation: 'landscape' });
        pdf.setFontSize(14);
        pdf.text(`BAPS Jaipur MDS \u2014 ${label}`, 14, 15);
        pdf.setFontSize(9);
        pdf.text(new Date().toLocaleString('en-IN'), 14, 21);
        autoTable(pdf, { startY: 26, head: [columns.map((c) => c.label)], body: rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))), styles: { fontSize: 8 }, headStyles: { fillColor: [234, 88, 12] } });
        pdf.save(`${label}-${Date.now()}.pdf`);
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => openPicker('csv')} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> CSV</Button>
        <Button variant="secondary" size="sm" onClick={() => openPicker('pdf')} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> PDF</Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Export as ${format?.toUpperCase()}`} size="sm">
        <p className="mb-3 text-sm text-slate-500">Choose which columns to include:</p>
        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
          {ALL_COLUMNS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggleColumn(c.key)} className="h-4 w-4 rounded accent-orange-600" />
              {c.label}
            </label>
          ))}
        </div>
        <Button variant="accent" className="mt-4 w-full" onClick={runExport} disabled={busy || selected.size === 0}>
          {busy ? 'Preparing\u2026' : `Export ${rows.length} rows`}
        </Button>
      </Modal>
    </>
  );
}
