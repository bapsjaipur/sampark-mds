// src/lib/eventExports.js
// ─────────────────────────────────────────────────────────────────────────────
// Per-event attendance exports: CSV for spreadsheets, PDF for printing and
// forwarding on WhatsApp.
//
// The legacy Sevak Call "beautiful PDF" was not a PDF at all — it opened a
// window, document.write()'d an HTML page with CSS gradients and called
// win.print(), so what came out depended on the browser's print dialog and it
// silently produced nothing on a phone with popups blocked. This builds a real
// PDF with jsPDF, and reproduces the look deliberately: navy header band, gold
// hairline, stat cards, zebra table, page footer.
//
// Two constraints worth knowing before editing:
//
//   • jsPDF's built-in Helvetica is CP1252 only. Devanagari/Gujarati names and
//     emoji render as blank boxes. Every string that reaches the PDF goes through
//     toLatin() from ./pdfText, shared with the volunteer roster so the two can't
//     drift apart: it transliterates our own typographic punctuation and falls
//     back to '?' only for a name the font genuinely cannot draw. Names in this
//     database are Latin today; if that changes, the fix is embedding a
//     Devanagari TTF via pdf.addFont, not patching this file.
//
//   • The CSV carries a UTF-8 BOM. Excel on Windows reads a BOM-less UTF-8 file
//     as CP1252 and mangles every accented character; the repo's generic
//     ExportButtons omits it, which is why "Patél" comes out as "PatÃ©l" there.
//
// PHASE 26 — this file is also the app's PDF DESIGN KIT. The palette, the slim
// page header, the stat card and the bar-chart breakdown are exported so
// seasonExports.js (the Season stats report) draws with the same pen instead of
// growing a second, slowly diverging set of the same five functions. They stayed
// here rather than moving to a new module because drawSlimHeader needs
// formatEventDate, which lives here — splitting them would mean a circular
// import or a duplicated date formatter.
// ─────────────────────────────────────────────────────────────────────────────
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toLatin } from './pdfText';

export const NAVY = [15, 23, 42];
export const NAVY_SOFT = [30, 41, 59];
export const GOLD = [217, 164, 65];
export const ORANGE = [234, 88, 12];
export const INK = [51, 65, 85];
export const MUTED = [148, 163, 184];
export const PAPER = [248, 250, 252];
export const LINE = [226, 232, 240];

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Firestore Timestamp | Date | string | null → Date | null */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatEventDate(dateStr, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-IN', opts);
}

/** "18:30" → "6:30 PM". Returns the input unchanged if it isn't HH:MM. */
export function formatEventTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = String(timeStr).split(':');
  const hour = Number(h);
  if (Number.isNaN(hour)) return timeStr;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${m ?? '00'} ${suffix}`;
}

function formatClock(date) {
  if (!date) return '';
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function eventFileSlug(event) {
  const base = [event?.title, event?.date].filter(Boolean).join('-') || 'sabha';
  return base.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sabha';
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Row + stat building ──────────────────────────────────────────────────────

/**
 * Joins the attendance rows for one event against the contact records.
 *
 * @param {object}   event
 * @param {Array}    attendance        rows from subscribeToAttendance(eventId)
 * @param {Map|object} individualsById id → individual (Map or plain object)
 * @param {Map|object} [volunteersById] id → volunteer, for the "Marked by" column
 * @param {string} [unknownLabel] name to show when the individual is not in
 *   `individualsById`. For an admin that means the contact was deleted, which is
 *   the default. A SCOPED volunteer only holds their own people, so somebody
 *   else's mark on a shared sabha is not missing — it is simply outside their
 *   list, and saying "deleted" would be a lie (see EventsPage).
 * @returns {Array} one row per person, sorted by name
 */
export function buildEventAttendanceRows({
  event, attendance = [], individualsById, volunteersById, unknownLabel = '(contact deleted)',
}) {
  const lookup = (src, id) => {
    if (!src || !id) return null;
    return typeof src.get === 'function' ? src.get(id) : src[id];
  };

  return attendance
    .map((row) => {
      const person = lookup(individualsById, row.individualId);
      const marker = lookup(volunteersById, row.markedBy);
      const markedAt = toDate(row.markedAt);
      return {
        id: row.individualId,
        name: person?.name || unknownLabel,
        mobile: person?.mobile || '',
        mandal: person?.mandal || '',
        area: person?.area || '',
        subArea: person?.subArea || '',
        status: person?.status || '',
        profilePhotoURL: person?.profilePhotoURL || '',
        markedAt,
        markedAtLabel: markedAt ? markedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '',
        markedBy: marker?.name || '',
        _missing: !person,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Summary numbers for one event.
 *
 * `eligible` counts contacts the event was aimed at — everyone when the event
 * has no Mandal/Area set, otherwise just that Mandal/Area. Without this the
 * percentage on a single-Mandal sabha is measured against the whole database
 * and always reads ~2%.
 */
export function computeEventStats({ event, rows = [], individuals = [] }) {
  const eligible = individuals.filter((p) => {
    if (event?.mandal && p.mandal !== event.mandal) return false;
    if (event?.area && p.area !== event.area) return false;
    return true;
  });

  const tally = (key) => {
    const map = {};
    rows.forEach((r) => {
      const k = r[key] || 'Not set';
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  const times = rows.map((r) => r.markedAt).filter(Boolean).sort((a, b) => a - b);
  const withPhoto = rows.filter((r) => r.profilePhotoURL).length;

  return {
    present: rows.length,
    eligible: eligible.length,
    pct: eligible.length ? Math.round((rows.length / eligible.length) * 100) : null,
    byMandal: tally('mandal'),
    byArea: tally('area'),
    byStatus: tally('status'),
    firstMarked: times[0] || null,
    lastMarked: times[times.length - 1] || null,
    withPhoto,
    newContacts: rows.filter((r) => !r.mobile).length,
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

// The first five headers are byte-identical to the legacy Sevak Call export so
// any spreadsheet or Apps Script keyed on them keeps working; the rest are new.
const CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'mobile', label: 'Phone' },
  { key: 'mandal', label: 'Mandal' },
  { key: 'area', label: 'Area' },
  { key: 'subArea', label: 'Sub Area' },
  { key: 'status', label: 'Sampark Status' },
  { key: 'markedAtLabel', label: 'Marked At' },
  { key: 'markedBy', label: 'Marked By' },
];

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildEventCsv({ event, rows }) {
  const meta = [
    ['Event', event?.title || ''],
    ['Date', formatEventDate(event?.date)],
    ['Time', formatEventTime(event?.time)],
    ['Mandal', event?.mandal || 'All Mandals'],
    ['Area', event?.area || 'All Areas'],
    ['Speaker', event?.speaker || ''],
    ['Present', String(rows.length)],
    ['Generated', new Date().toLocaleString('en-IN')],
  ].map(([k, v]) => `${csvCell(k)},${csvCell(v)}`);

  const header = CSV_COLUMNS.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(','));

  // A leading meta block then a blank line then the table: Excel and Sheets both
  // import this cleanly, and the reader gets the event context without having to
  // trust the filename.
  return [...meta, '', header, ...body].join('\r\n');
}

export function exportEventCsv({ event, rows }) {
  // ﻿ = UTF-8 BOM. See the header note on Excel.
  downloadBlob(`﻿${buildEventCsv({ event, rows })}`, `sabha-attendance-${eventFileSlug(event)}.csv`, 'text/csv;charset=utf-8');
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;              // page margin
const INNER_W = PAGE_W - M * 2;

export const PAGE = { W: PAGE_W, H: PAGE_H, M, INNER_W };

function drawHeroHeader(pdf, event, stats) {
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, PAGE_W, 46, 'F');
  // Gold hairline under the band — the one detail that made the legacy print
  // look designed rather than generated.
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 46, PAGE_W, 1.1, 'F');

  pdf.setTextColor(...GOLD);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('BAPS JAIPUR MDS  ·  SABHA ATTENDANCE', M, 13);

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(19);
  pdf.text(toLatin(event?.title || 'Sabha'), M, 25, { maxWidth: INNER_W - 46 });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  const line = [
    formatEventDate(event?.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),
    formatEventTime(event?.time),
    event?.mandal || 'All Mandals',
    event?.area || 'All Areas',
  ].filter(Boolean).join('   ·   ');
  pdf.setTextColor(203, 213, 225);
  pdf.text(toLatin(line), M, 33, { maxWidth: INNER_W - 46 });
  if (event?.speaker) {
    pdf.setFontSize(8.5);
    pdf.text(toLatin(`Speaker: ${event.speaker}`), M, 39.5, { maxWidth: INNER_W - 46 });
  }

  // Big present count, right-aligned inside the band.
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(30);
  pdf.setTextColor(255, 255, 255);
  pdf.text(String(stats.present), PAGE_W - M, 28, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GOLD);
  pdf.text('PRESENT', PAGE_W - M, 34, { align: 'right' });
}

/**
 * The narrow band that tops every page after the first.
 *
 * `subtitle` overrides the right-hand text — the season report puts its date
 * RANGE there, where a single-event report puts the sabha's own date.
 */
export function drawSlimHeader(pdf, event, subtitle = null) {
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, PAGE_W, 14, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 14, PAGE_W, 0.7, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text(toLatin(event?.title || 'Sabha'), M, 9, { maxWidth: INNER_W - 60 });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...GOLD);
  pdf.text(
    toLatin(subtitle ?? formatEventDate(event?.date, { day: 'numeric', month: 'short', year: 'numeric' })),
    PAGE_W - M, 9, { align: 'right' },
  );
}

export function drawStatCard(pdf, x, y, w, h, label, value, sub, accent) {
  pdf.setFillColor(...PAPER);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(x, y, w, h, 1.8, 1.8, 'FD');
  // Accent stripe down the left edge.
  pdf.setFillColor(...accent);
  pdf.rect(x, y + 1.6, 1.4, h - 3.2, 'F');

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(...MUTED);
  pdf.text(toLatin(label.toUpperCase()), x + 4.5, y + 6);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(...NAVY);
  pdf.text(toLatin(value), x + 4.5, y + 14.2);

  if (sub) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.setTextColor(...MUTED);
    pdf.text(toLatin(sub), x + 4.5, y + 19);
  }
}

/**
 * The bar-chart breakdown block.
 *
 * Only as many rows as fit beside the stat cards are drawn here — the rest are
 * returned so the caller can put them in the full "Complete breakdown" table at
 * the end. Nothing is silently dropped: a "+ N more" line here always has a
 * matching table further on, because a report that hides half the areas is worse
 * than one that runs to a second page.
 */
export function drawBreakdown(pdf, x, y, w, title, entries, total, maxRows = Infinity) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...NAVY);
  pdf.text(toLatin(title), x, y);

  let cursor = y + 4.5;
  const shown = entries.slice(0, maxRows);
  const rest = entries.slice(shown.length);
  shown.forEach(([name, count]) => {
    const share = total ? count / total : 0;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.6);
    pdf.setTextColor(...INK);
    pdf.text(toLatin(name), x, cursor, { maxWidth: w * 0.5 });
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(count), x + w, cursor, { align: 'right' });

    // Track + fill bar between the label and the count.
    const barX = x + w * 0.52;
    const barW = w * 0.36;
    pdf.setFillColor(226, 232, 240);
    pdf.roundedRect(barX, cursor - 2.2, barW, 2.2, 1, 1, 'F');
    if (share > 0) {
      pdf.setFillColor(...ORANGE);
      pdf.roundedRect(barX, cursor - 2.2, Math.max(barW * share, 1), 2.2, 1, 1, 'F');
    }
    cursor += 5.6;
  });

  if (rest.length) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(6.8);
    pdf.setTextColor(...MUTED);
    pdf.text(toLatin(`+ ${rest.length} more — listed in full at the end`), x, cursor);
    cursor += 4;
  }
  return { end: cursor, rest };
}

/**
 * Every mandal and every area, in full, as a paginating table. This is where the
 * long tail lands: on a city-wide sabha the area list runs past twenty, and the
 * bar chart beside the stat cards has room for a dozen.
 */
function drawFullBreakdownTables(pdf, event, groups, present) {
  const live = groups.filter((g) => g.entries.length);
  if (!live.length) return;

  pdf.addPage();
  drawSlimHeader(pdf, event);

  let y = 20;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text('Complete breakdown', M, y);
  y += 3;

  live.forEach((g) => {
    autoTable(pdf, {
      startY: y + 3,
      margin: { top: 20, left: M, right: M, bottom: 16 },
      head: [[g.label, 'Present', 'Share']],
      body: g.entries.map(([name, count]) => [
        toLatin(name || '—'),
        String(count),
        present ? `${Math.round((count / present) * 100)}%` : '—',
      ]),
      foot: [[
        'Total',
        String(g.entries.reduce((a, [, c]) => a + c, 0)),
        present ? '100%' : '—',
      ]],
      styles: { fontSize: 8.2, cellPadding: 2, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: PAPER, textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: PAPER },
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 24, halign: 'right' },
        2: { cellWidth: 24, halign: 'right', textColor: MUTED },
      },
      didDrawPage: () => drawSlimHeader(pdf, event),
    });
    y = pdf.lastAutoTable.finalY + 4;
  });
}

/**
 * "BAPS Jaipur MDS · Generated … / Page n of m" on every page. Called last,
 * because it needs the final page count.
 */
export function drawFooters(pdf, note = '') {
  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.setTextColor(...MUTED);
    pdf.text(
      toLatin([`BAPS Jaipur MDS  ·  Generated ${new Date().toLocaleString('en-IN')}`, note]
        .filter(Boolean).join('  ·  ')),
      M, PAGE_H - 7,
    );
    pdf.text(`Page ${p} of ${pageCount}`, PAGE_W - M, PAGE_H - 7, { align: 'right' });
  }
}

/**
 * @param {object} event
 * @param {Array}  rows   from buildEventAttendanceRows()
 * @param {object} stats  from computeEventStats()
 */
export function exportEventPdf({ event, rows, stats }) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  drawHeroHeader(pdf, event, stats);

  // ── Stat cards ─────────────────────────────────────────────────────────────
  const gap = 4;
  const cardW = (INNER_W - gap * 3) / 4;
  const cardY = 54;
  const cardH = 23;
  drawStatCard(pdf, M, cardY, cardW, cardH, 'Present', String(stats.present), 'marked at this sabha', ORANGE);
  drawStatCard(pdf, M + (cardW + gap), cardY, cardW, cardH, 'In scope', String(stats.eligible),
    event?.mandal || event?.area ? 'matching contacts' : 'all contacts', NAVY_SOFT);
  drawStatCard(pdf, M + (cardW + gap) * 2, cardY, cardW, cardH, 'Turnout',
    stats.pct === null ? '—' : `${stats.pct}%`, 'of contacts in scope', GOLD);
  drawStatCard(pdf, M + (cardW + gap) * 3, cardY, cardW, cardH, 'Marking window',
    stats.firstMarked ? formatClock(stats.firstMarked) : '—',
    stats.lastMarked ? `last at ${formatClock(stats.lastMarked)}` : 'nothing marked yet', [100, 116, 139]);

  // ── Breakdowns, side by side ───────────────────────────────────────────────
  // A dozen bars is what fits above the attendee table. Anything past that goes
  // to the full tables at the end rather than being thrown away.
  const BARS_ON_PAGE_ONE = 12;
  let y = cardY + cardH + 10;
  const colW = (INNER_W - 10) / 2;
  const left = stats.byMandal.length
    ? drawBreakdown(pdf, M, y, colW, 'By Mandal', stats.byMandal, stats.present, BARS_ON_PAGE_ONE)
    : { end: y, rest: [] };
  const right = stats.byArea.length
    ? drawBreakdown(pdf, M + colW + 10, y, colW, 'By Area', stats.byArea, stats.present, BARS_ON_PAGE_ONE)
    : { end: y, rest: [] };
  y = Math.max(left.end, right.end) + 4;
  const needsFullTables = left.rest.length > 0 || right.rest.length > 0;

  // ── Attendee table ─────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text(`Attendees (${stats.present})`, M, y);
  y += 3;

  let pageCounter = 1;
  autoTable(pdf, {
    startY: y,
    margin: { top: 20, left: M, right: M, bottom: 16 },
    head: [['#', 'Name', 'Mobile', 'Mandal', 'Area', 'Marked at']],
    body: rows.length
      ? rows.map((r, i) => [
          i + 1,
          toLatin(r.name),
          toLatin(r.mobile),
          toLatin(r.mandal),
          toLatin(r.area),
          toLatin(r.markedAtLabel),
        ])
      : [[{ content: 'Nobody was marked present at this sabha.', colSpan: 6, styles: { halign: 'center', fontStyle: 'italic', textColor: MUTED } }]],
    styles: { fontSize: 8.2, cellPadding: 2, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: PAPER },
    columnStyles: {
      0: { cellWidth: 10, halign: 'right', textColor: MUTED },
      1: { cellWidth: 52, fontStyle: 'bold' },
      2: { cellWidth: 26 },
      3: { cellWidth: 34 },
      4: { cellWidth: 30 },
      5: { cellWidth: 'auto' },
    },
    // Pages after the first get the slim band instead of the full hero, so the
    // table doesn't restart 50mm down the page.
    didDrawPage: () => {
      pageCounter += 1;
      if (pageCounter > 2) drawSlimHeader(pdf, event);
    },
  });

  // ── The long tail, in full ─────────────────────────────────────────────────
  if (needsFullTables) {
    drawFullBreakdownTables(pdf, event, [
      { label: 'Mandal', entries: stats.byMandal },
      { label: 'Area', entries: stats.byArea },
    ], stats.present);
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  drawFooters(pdf);

  pdf.save(`sabha-attendance-${eventFileSlug(event)}.pdf`);
}
