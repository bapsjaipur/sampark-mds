// src/components/events/EventExportButtons.jsx
// ─────────────────────────────────────────────────────────────────────────────
// CSV + PDF download for one event's attendance.
//
// Purely presentational: the rows and stats are computed once by whoever owns
// the attendance subscription and passed in, so what you download is exactly
// what's on screen. Building them here would mean a second read of the same
// data and a chance of the two disagreeing.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { exportEventCsv, exportEventPdf } from '../../lib/eventExports';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/cn';

export default function EventExportButtons({ event, rows, stats, className, compact = false }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(null);
  const empty = !rows?.length;

  async function run(kind) {
    setBusy(kind);
    try {
      // jsPDF builds the whole document synchronously and can hold the main
      // thread for a moment on a long list; yielding a frame first lets the
      // spinner actually paint instead of appearing after the work is done.
      await new Promise((r) => requestAnimationFrame(r));
      if (kind === 'csv') exportEventCsv({ event, rows });
      else exportEventPdf({ event, rows, stats });
      showToast({ type: 'success', message: `${kind.toUpperCase()} downloaded.` });
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: `Couldn’t build the ${kind.toUpperCase()}. ${err.message}` });
    } finally {
      setBusy(null);
    }
  }

  const base = cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium transition',
    compact ? 'h-8 px-2.5' : 'h-9 px-3',
    'disabled:cursor-not-allowed disabled:opacity-40',
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        onClick={() => run('csv')}
        disabled={empty || busy !== null}
        title={empty ? 'Nobody is marked present yet' : 'Download as a spreadsheet'}
        className={cn(base, 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100')}
      >
        {busy === 'csv' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
        CSV
      </button>
      <button
        type="button"
        onClick={() => run('pdf')}
        disabled={empty || busy !== null}
        title={empty ? 'Nobody is marked present yet' : 'Download a printable report'}
        className={cn(base, 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100')}
      >
        {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        PDF
      </button>
      {!compact && (
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
          <Download className="h-3 w-3" />
          {empty ? 'Nothing to export yet' : `${rows.length} attendee${rows.length === 1 ? '' : 's'}`}
        </span>
      )}
    </div>
  );
}
