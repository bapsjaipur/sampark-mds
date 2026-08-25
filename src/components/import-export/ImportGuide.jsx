// src/components/import-export/ImportGuide.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 25 — the guide and template panel that sits above every file drop zone.
//
// Collapsed by default. Someone importing their fifth sheet does not need the
// instructions again, and a wall of help above the button is what makes people
// stop reading help. Open it once and the choice sticks (localStorage), because
// the first import is the one that goes wrong.
//
// Everything it shows comes from src/lib/importTemplates.js, which is also what
// generates the downloadable file — so the guide cannot describe a column the
// template does not have.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import {
  BookOpen, Download, ChevronDown, ChevronUp, FileSpreadsheet, AlertCircle, Table2,
} from 'lucide-react';
import {
  CONTACT_COLUMNS, EVENT_COLUMNS, CONTACT_GUIDE_STEPS, HISTORY_GUIDE_STEPS,
  IMPORT_GOTCHAS, PRESENT_MARK,
  downloadContactsTemplate, downloadContactsCsvTemplate, downloadSabhaHistoryTemplate,
} from '../../lib/importTemplates';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';

const STORAGE_KEY = 'mds_import_guide_open';

function ColumnTable({ columns }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Column</th>
            <th className="hidden px-2.5 py-1.5 font-medium sm:table-cell">Need it?</th>
            <th className="px-2.5 py-1.5 font-medium">What goes in it</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name} className="border-t border-slate-100 align-top">
              <td className="whitespace-nowrap px-2.5 py-1.5">
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] font-medium text-slate-700">{c.name}</code>
              </td>
              <td className="hidden whitespace-nowrap px-2.5 py-1.5 sm:table-cell">
                {c.required
                  ? <span className="font-medium text-orange-700">Required</span>
                  : <span className="text-slate-400">Optional</span>}
              </td>
              <td className="px-2.5 py-1.5 text-slate-600">
                {c.what}
                {c.examples?.[0] ? (
                  <span className="block text-[11px] text-slate-400">e.g. {c.examples[0]}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * @param {'contacts'|'history'} variant  which importer this sits above
 */
export default function ImportGuide({ variant = 'contacts' }) {
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');
  const history = variant === 'history';

  function toggle() {
    setOpen((o) => {
      localStorage.setItem(STORAGE_KEY, o ? '0' : '1');
      return !o;
    });
  }

  const steps = history ? HISTORY_GUIDE_STEPS : CONTACT_GUIDE_STEPS;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {/* Header row — always visible, and the template download lives here so it
          can be taken without expanding anything. */}
      <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 ring-1 ring-orange-100">
            <BookOpen className="h-3.5 w-3.5 text-orange-600" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              {history ? 'How the sabha-history sheet must look' : 'How your file must look'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {history
                ? 'One row per person, one column per sabha, plus an Events sheet naming those columns.'
                : 'One row per person. First row is the header. Only Name is required.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button
            variant="accent"
            size="sm"
            onClick={history ? downloadSabhaHistoryTemplate : downloadContactsTemplate}
          >
            <Download className="h-3.5 w-3.5" /> Sample template
          </Button>
          {!history && (
            <Button variant="secondary" size="sm" onClick={downloadContactsCsvTemplate}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open}>
            {open ? <>Hide guide <ChevronUp className="h-3.5 w-3.5" /></> : <>Read guide <ChevronDown className="h-3.5 w-3.5" /></>}
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-5 border-t border-slate-100 p-3 sm:p-4">
          {/* ── Steps ───────────────────────────────────────────────────── */}
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-xs text-slate-600">
                <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>

          {/* ── The wide shape, drawn ───────────────────────────────────── */}
          {history && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Table2 className="h-3.5 w-3.5" /> What “one column per sabha” looks like
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[30rem] text-left text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Name</th>
                      <th className="px-2 py-1.5 font-medium">Phone</th>
                      <th className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">Sabha_2026-01-03_Going</th>
                      <th className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">Sabha_2026-08-23_YuvaP</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    <tr className="border-t border-slate-100">
                      <td className="px-2 py-1.5">Aashish Shukla</td>
                      <td className="px-2 py-1.5">9680314755</td>
                      <td className="px-2 py-1.5 font-medium text-emerald-700">{PRESENT_MARK}</td>
                      <td className="px-2 py-1.5 font-medium text-emerald-700">{PRESENT_MARK}</td>
                    </tr>
                    <tr className="border-t border-slate-100">
                      <td className="px-2 py-1.5">Rahul Patel</td>
                      <td className="px-2 py-1.5">9829012345</td>
                      <td className="px-2 py-1.5 text-slate-300">(blank)</td>
                      <td className="px-2 py-1.5 font-medium text-emerald-700">{PRESENT_MARK}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Blank means “not marked present”. There is no Absent value — nothing is written for a blank cell.
              </p>
            </div>
          )}

          {/* ── Column contract ─────────────────────────────────────────── */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {history ? 'Contact columns' : 'Columns'}
            </p>
            <ColumnTable columns={CONTACT_COLUMNS} />
          </div>

          {history && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                The Events sheet
              </p>
              <ColumnTable columns={EVENT_COLUMNS} />
            </div>
          )}

          {/* ── Gotchas ─────────────────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <AlertCircle className="h-3.5 w-3.5" /> Worth reading once
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {IMPORT_GOTCHAS.map((g) => (
                <li key={g.title} className={cn('rounded-lg border border-amber-100 bg-amber-50/60 px-2.5 py-2')}>
                  <p className="text-[12px] font-medium text-amber-900">{g.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">{g.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
