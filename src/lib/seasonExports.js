// src/lib/seasonExports.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 26 — the Season stats PDF. "in events tab there is Season stats there
// should be PDF export of all details according to what filter is selected."
//
// Season stats had a CSV only, and a CSV is the wrong artefact for the thing this
// screen is used for: a sanchalak takes the season summary into a meeting or
// forwards it on WhatsApp. That wants a page, not a spreadsheet.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
//   1. IT PRINTS WHAT IS ON SCREEN. Everything is drawn from the same
//      `buildSabhaAnalytics()` object the component is already rendering, so the
//      window / mandal / area filters are honoured by construction — there is no
//      second query that could disagree with the view. The chosen filters are
//      printed in the header band and repeated in the filename, so a PDF that
//      has been forwarded twice can still be identified.
//
//   2. NOTHING IS SILENTLY DROPPED. The per-sabha table, every mandal, every
//      area, the full retention series and all five follow-up lists go in,
//      paginating as far as they need to. The on-screen lists page at 50 for
//      performance; a printed report that stopped at 50 names would be a report
//      you cannot act on. Where a list IS capped (see PEOPLE_CAP) the cap is
//      stated on the page next to the count it was cut from.
//
// The palette and the header/stat-card/bar-chart primitives are imported from
// eventExports.js — the per-sabha report is the design this matches, and sharing
// the functions is what stops the two drifting apart. See the note there.
// ─────────────────────────────────────────────────────────────────────────────
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toLatin } from './pdfText';
import {
  NAVY, NAVY_SOFT, GOLD, ORANGE, INK, MUTED, PAPER, LINE, PAGE,
  drawSlimHeader, drawStatCard, drawBreakdown, drawFooters, formatEventDate,
} from './eventExports';
import { RATE_BANDS, LAPSE_MISSES } from './eventAnalytics';

const { W: PAGE_W, M, INNER_W } = PAGE;

// A follow-up list is a call sheet. Past a few hundred names it stops being one
// and the CSV is the right tool — but the cap is printed rather than assumed, so
// nobody reads a truncated list as a complete one.
const PEOPLE_CAP = 300;

const BAND_RGB = {
  regular: [16, 185, 129],
  occasional: [14, 165, 233],
  rare: [245, 158, 11],
  dormant: [203, 213, 225],
};

function shortDate(dateStr) {
  return formatEventDate(dateStr, { day: 'numeric', month: 'short' });
}

function longDate(dateStr) {
  return formatEventDate(dateStr, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Last 12 sabhas · Yuvak Mandal · Vaishali Nagar" — the filter, in words. */
export function describeSeasonScope({ windowSize, mandal, area }) {
  return [
    windowSize > 0 ? `Last ${windowSize} sabhas` : 'All time',
    mandal || 'All mandals',
    area || 'All areas',
  ].join('   ·   ');
}

export function seasonFileSlug({ mandal, area, from, to }) {
  const scope = [mandal, area].filter(Boolean).join('-') || 'all';
  return `sabha-season-${scope}-${from || 'start'}-to-${to || 'end'}`
    .replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').toLowerCase();
}

// ── Page 1 header ────────────────────────────────────────────────────────────

function drawSeasonHeader(pdf, a, filters) {
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, PAGE_W, 46, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 46, PAGE_W, 1.1, 'F');

  pdf.setTextColor(...GOLD);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('BAPS JAIPUR MDS  ·  SABHA SEASON REPORT', M, 13);

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(19);
  pdf.text(
    toLatin(filters.mandal || filters.area
      ? [filters.mandal, filters.area].filter(Boolean).join('  ·  ')
      : 'All mandals and areas'),
    M, 25, { maxWidth: INNER_W - 46 },
  );

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(203, 213, 225);
  pdf.text(
    toLatin(`${a.totals.sabhas} sabha${a.totals.sabhas === 1 ? '' : 's'}   ·   ${longDate(a.window.from)}  to  ${longDate(a.window.to)}`),
    M, 33, { maxWidth: INNER_W - 46 },
  );
  pdf.setFontSize(8.5);
  // The filter, spelled out. A report headed "All mandals" that was actually cut
  // to one is the failure mode this line exists to make impossible.
  pdf.text(toLatin(describeSeasonScope(filters)), M, 39.5, { maxWidth: INNER_W - 46 });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(30);
  pdf.setTextColor(255, 255, 255);
  pdf.text(String(a.totals.avgPresent), PAGE_W - M, 28, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GOLD);
  pdf.text('AVG PRESENT', PAGE_W - M, 34, { align: 'right' });
}

// ── The stacked band bar ─────────────────────────────────────────────────────

/**
 * "How often each of the N attends", as one stacked bar with a legend — the same
 * shape as the on-screen block, because the numbers underneath it are the same
 * four bands and a reader who has seen the screen should recognise the page.
 */
function drawBandBar(pdf, x, y, w, segments, eligible) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...NAVY);
  pdf.text(toLatin(`How often each of the ${eligible} attends`), x, y);

  const barY = y + 3;
  const barH = 4;
  pdf.setFillColor(...LINE);
  pdf.roundedRect(x, barY, w, barH, 1, 1, 'F');

  let cursor = x;
  RATE_BANDS.forEach((b) => {
    const count = segments[b.key]?.length || 0;
    if (!count || !eligible) return;
    const seg = (count / eligible) * w;
    pdf.setFillColor(...BAND_RGB[b.key]);
    pdf.rect(cursor, barY, seg, barH, 'F');
    cursor += seg;
  });

  let legendY = barY + barH + 5;
  let lx = x;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.4);
  RATE_BANDS.forEach((b) => {
    const count = segments[b.key]?.length || 0;
    const label = `${b.label} ${count}`;
    const wLabel = pdf.getTextWidth(toLatin(label)) + 9;
    if (lx + wLabel > x + w) { lx = x; legendY += 5; }
    pdf.setFillColor(...BAND_RGB[b.key]);
    pdf.circle(lx + 1.4, legendY - 1.2, 1.4, 'F');
    pdf.setTextColor(...INK);
    pdf.text(toLatin(label), lx + 4.4, legendY);
    lx += wLabel;
  });

  return legendY + 3;
}

// ── Tables ───────────────────────────────────────────────────────────────────

const TABLE_STYLE = {
  styles: { fontSize: 8.2, cellPadding: 2, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
  headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
  footStyles: { fillColor: PAPER, textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
  alternateRowStyles: { fillColor: PAPER },
};

/** Section heading, with the page break handled before it rather than after. */
function sectionTitle(pdf, y, text, sub, headerNote) {
  let cursor = y;
  if (cursor > 250) {
    pdf.addPage();
    drawSlimHeader(pdf, { title: headerNote.title }, headerNote.sub);
    cursor = 22;
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(...NAVY);
  pdf.text(toLatin(text), M, cursor);
  if (sub) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.2);
    pdf.setTextColor(...MUTED);
    pdf.text(toLatin(sub), M, cursor + 3.8);
    return cursor + 6;
  }
  return cursor + 2;
}

function drawSabhaTable(pdf, a, y, headerNote) {
  const cursor = sectionTitle(pdf, y, 'Sabha by sabha',
    'Present counts the people inside the current filter. Outside counts marks from other mandals or areas at the same sabha.',
    headerNote);

  autoTable(pdf, {
    ...TABLE_STYLE,
    startY: cursor + 3,
    margin: { top: 22, left: M, right: M, bottom: 16 },
    head: [['Date', 'Sabha', 'Present', 'Turnout', 'New', 'Outside', 'Change']],
    body: a.sabhas.map((s) => [
      shortDate(s.date),
      toLatin(s.title || '-'),
      String(s.present),
      `${s.pct}%`,
      s.newFaces ? `+${s.newFaces}` : '-',
      s.outside ? String(s.outside) : '-',
      s.delta == null ? '-' : `${s.delta > 0 ? '+' : ''}${s.delta}`,
    ]),
    foot: [[
      'Average', '', String(a.totals.avgPresent), `${a.totals.avgTurnout}%`,
      String(a.totals.newFaces), '', a.totals.momentum == null ? '-' : `${a.totals.momentum > 0 ? '+' : ''}${a.totals.momentum}`,
    ]],
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 'auto', fontStyle: 'bold' },
      2: { cellWidth: 18, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 14, halign: 'right', textColor: [16, 185, 129] },
      5: { cellWidth: 18, halign: 'right', textColor: MUTED },
      6: { cellWidth: 18, halign: 'right' },
    },
    didParseCell: (data) => {
      // Colour the change column at parse time — autoTable owns the cell text by
      // the time it draws, so this is the only place the sign is still legible.
      if (data.section === 'body' && data.column.index === 6) {
        const v = data.cell.text[0] || '';
        if (v.startsWith('+')) data.cell.styles.textColor = [16, 185, 129];
        else if (v.startsWith('-') && v.length > 1) data.cell.styles.textColor = [225, 29, 72];
      }
    },
    didDrawPage: () => drawSlimHeader(pdf, { title: headerNote.title }, headerNote.sub),
  });
  return pdf.lastAutoTable.finalY + 7;
}

function drawGroupTable(pdf, rows, subject, y, headerNote) {
  if (!rows.length) return y;
  const cursor = sectionTitle(pdf, y, `${subject} by ${subject.toLowerCase()}`,
    `Roster is the contacts in this ${subject.toLowerCase()}. Reach is the share of them who came at least once. Lapsed attended, then missed the last ${LAPSE_MISSES} in a row.`,
    headerNote);

  autoTable(pdf, {
    ...TABLE_STYLE,
    startY: cursor + 3,
    margin: { top: 22, left: M, right: M, bottom: 16 },
    head: [[subject, 'Roster', 'Avg', 'Turnout', 'Reach', 'Regulars', 'Lapsed', 'Last', 'Prev']],
    body: rows.map((r) => [
      toLatin(r.name),
      String(r.eligible),
      String(r.avgPresent),
      `${r.avgTurnout}%`,
      `${r.reach}%`,
      String(r.regulars),
      String(r.lapsed),
      String(r.last),
      r.prev == null ? '-' : String(r.prev),
    ]),
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 17, halign: 'right' },
      2: { cellWidth: 15, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 16, halign: 'right' },
      5: { cellWidth: 20, halign: 'right', textColor: [4, 120, 87] },
      6: { cellWidth: 16, halign: 'right' },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 14, halign: 'right', textColor: MUTED },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6 && data.cell.text[0] !== '0') {
        data.cell.styles.textColor = [225, 29, 72];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: () => drawSlimHeader(pdf, { title: headerNote.title }, headerNote.sub),
  });
  return pdf.lastAutoTable.finalY + 7;
}

/**
 * One follow-up list as a call sheet: name, mobile, mandal, area, attendance and
 * when they were last seen. The mobile column is the reason this is a table and
 * not a paragraph — the sheet is meant to be worked down with a phone in hand.
 */
function drawPeopleTable(pdf, { title, blurb, people, extraCol }, y, headerNote) {
  const shown = people.slice(0, PEOPLE_CAP);
  const cut = people.length - shown.length;
  const cursor = sectionTitle(
    pdf, y,
    `${title}  (${people.length})`,
    cut > 0
      ? `${blurb}  —  first ${PEOPLE_CAP} of ${people.length} listed here; the CSV has all of them.`
      : blurb,
    headerNote,
  );

  if (!people.length) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text('Nobody in this list.', M, cursor + 4);
    return cursor + 9;
  }

  autoTable(pdf, {
    ...TABLE_STYLE,
    startY: cursor + 3,
    margin: { top: 22, left: M, right: M, bottom: 16 },
    head: [['#', 'Name', 'Mobile', 'Mandal', 'Area', 'Came', extraCol.label, 'Call list']],
    body: shown.map((p, i) => [
      String(i + 1),
      toLatin(p.name),
      toLatin(p.mobile || '-'),
      toLatin(p.mandal || '-'),
      toLatin(p.area || '-'),
      `${p.attended}/${p.of}`,
      toLatin(extraCol.value(p)),
      p.onCallList ? 'Yes' : 'No',
    ]),
    columnStyles: {
      0: { cellWidth: 9, halign: 'right', textColor: MUTED },
      1: { cellWidth: 44, fontStyle: 'bold' },
      2: { cellWidth: 24 },
      3: { cellWidth: 28 },
      4: { cellWidth: 26 },
      5: { cellWidth: 15, halign: 'right' },
      6: { cellWidth: 'auto' },
      7: { cellWidth: 16, halign: 'center', textColor: MUTED },
    },
    didDrawPage: () => drawSlimHeader(pdf, { title: headerNote.title }, headerNote.sub),
  });
  return pdf.lastAutoTable.finalY + 7;
}

function drawRetentionTable(pdf, a, y, headerNote) {
  if (!a.retention.length) return y;
  const cursor = sectionTitle(pdf, y, 'Week-on-week retention',
    'Of the people at one sabha, how many were at the next one. Newest last.',
    headerNote);

  autoTable(pdf, {
    ...TABLE_STYLE,
    startY: cursor + 3,
    margin: { top: 22, left: M, right: M, bottom: 16 },
    head: [['From', 'To', 'At the first', 'Came back', 'Did not', 'Retention']],
    body: a.retention.map((r) => [
      shortDate(r.from), shortDate(r.to),
      String(r.base), String(r.kept), String(r.lost), `${r.pct}%`,
    ]),
    foot: [['', 'Average', '', '', '', `${a.totals.avgRetention}%`]],
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 26 },
      2: { cellWidth: 'auto', halign: 'right' },
      3: { cellWidth: 26, halign: 'right', textColor: [4, 120, 87] },
      4: { cellWidth: 24, halign: 'right', textColor: [225, 29, 72] },
      5: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
    },
    didDrawPage: () => drawSlimHeader(pdf, { title: headerNote.title }, headerNote.sub),
  });
  return pdf.lastAutoTable.finalY + 7;
}

// ── The export ───────────────────────────────────────────────────────────────

/**
 * exportSeasonPdf({ analytics, filters })
 *
 * @param {object} analytics  the object buildSabhaAnalytics() returned for the
 *   filters currently on screen. Passed in rather than rebuilt so the PDF cannot
 *   disagree with the view.
 * @param {object} filters    { windowSize, mandal, area } — printed, not applied.
 */
export function exportSeasonPdf({ analytics: a, filters }) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  // The band on pages 2+ carries the scope, so a page torn out of the middle of
  // the report still says which mandal and which window it belongs to.
  const headerNote = {
    title: [filters.mandal, filters.area].filter(Boolean).join(' · ') || 'Sabha season',
    sub: `${shortDate(a.window.from)} – ${shortDate(a.window.to)}  ·  ${a.totals.sabhas} sabhas`,
  };

  drawSeasonHeader(pdf, a, filters);

  // ── Stat cards, two rows of four ───────────────────────────────────────────
  const gap = 4;
  const cardW = (INNER_W - gap * 3) / 4;
  const cardH = 23;
  const row1 = 54;
  const row2 = row1 + cardH + gap;

  const cards = [
    ['Average present', String(a.totals.avgPresent), `median ${a.totals.medianPresent} · best ${a.totals.bestSabha?.present ?? 0}`, ORANGE],
    ['Turnout', `${a.totals.avgTurnout}%`, `of ${a.totals.eligible} on the roster`, NAVY_SOFT],
    ['Reach', `${a.totals.reach}%`, `${a.totals.uniqueAttendees} came at least once`, [14, 165, 233]],
    ['Momentum', a.totals.momentum == null ? '—' : `${a.totals.momentum > 0 ? '+' : ''}${a.totals.momentum}`,
      a.totals.momentum == null ? 'needs 4+ sabhas' : 'recent half vs earlier', GOLD],
    ['Week-on-week', `${a.totals.avgRetention}%`, 'came back the next sabha', [14, 165, 233]],
    ['Regulars', String(a.totals.regulars), 'at 7 in 10 sabhas or more', [16, 185, 129]],
    ['New faces', String(a.totals.newFaces), 'first ever sabha in window', [16, 185, 129]],
    ['Lapsed', String(a.totals.lapsed), `missed the last ${LAPSE_MISSES} in a row`, [225, 29, 72]],
  ];
  cards.forEach(([label, value, sub, accent], i) => {
    const x = M + (cardW + gap) * (i % 4);
    const yy = i < 4 ? row1 : row2;
    drawStatCard(pdf, x, yy, cardW, cardH, label, value, sub, accent);
  });

  let y = row2 + cardH + 9;

  // ── Roster split + the two headline breakdowns ─────────────────────────────
  y = drawBandBar(pdf, M, y, INNER_W, a.segments, a.totals.eligible) + 4;

  // Top ten each, with the full tables further down — the bars are for shape, the
  // tables are the record.
  const colW = (INNER_W - 10) / 2;
  const BARS = 8;
  const left = a.byMandal.length
    ? drawBreakdown(pdf, M, y, colW, 'Top mandals — avg present',
      a.byMandal.map((r) => [r.name, r.avgPresent]),
      a.byMandal[0]?.avgPresent || 0, BARS)
    : { end: y };
  const right = a.byArea.length
    ? drawBreakdown(pdf, M + colW + 10, y, colW, 'Top areas — avg present',
      a.byArea.map((r) => [r.name, r.avgPresent]),
      a.byArea[0]?.avgPresent || 0, BARS)
    : { end: y };
  y = Math.max(left.end, right.end) + 5;

  // ── Which day fills the hall ───────────────────────────────────────────────
  if (a.byWeekday.length > 1) {
    const bd = drawBreakdown(pdf, M, y, INNER_W * 0.6, 'Which day fills the hall',
      a.byWeekday.map((d) => [`${d.label}  (${d.sabhas} sabha${d.sabhas === 1 ? '' : 's'})`, d.avg]),
      a.byWeekday[0]?.avg || 0);
    y = bd.end + 5;
  }

  // ── Everything in full, paginating ─────────────────────────────────────────
  // Page 1 is the dashboard and is deliberately the whole story on its own — it
  // is the page that gets screenshotted and forwarded. The detail starts on a
  // fresh page rather than beginning three rows above a page break.
  pdf.addPage();
  drawSlimHeader(pdf, { title: headerNote.title }, headerNote.sub);
  y = 22;

  y = drawSabhaTable(pdf, a, y, headerNote);
  y = drawGroupTable(pdf, a.byMandal, 'Mandal', y, headerNote);
  y = drawGroupTable(pdf, a.byArea, 'Area', y, headerNote);
  y = drawRetentionTable(pdf, a, y, headerNote);

  // ── The follow-up lists — the point of the whole report ────────────────────
  const lists = [
    {
      title: 'Stopped coming',
      blurb: `Attended earlier in this window, then missed the last ${LAPSE_MISSES} sabhas or more. Longest absence first. This is the call list.`,
      people: a.segments.lapsed,
      extraCol: { label: 'Last seen', value: (p) => (p.lastEver ? longDate(p.lastEver) : '-') },
    },
    {
      title: 'New faces',
      blurb: 'Their first ever recorded sabha falls inside this window. Worth a welcome call.',
      people: a.segments.newFaces,
      extraCol: { label: 'First sabha', value: (p) => (p.firstEver ? longDate(p.firstEver) : '-') },
    },
    {
      title: 'Regulars',
      blurb: 'At 7 in 10 sabhas or more. The people to lean on for seva.',
      people: a.segments.regular,
      extraCol: { label: 'Run of sabhas', value: (p) => (p.streak ? `${p.streak} in a row` : '-') },
    },
    {
      title: 'Drifted away',
      blurb: 'Came to a sabha at some point, but not one in this window. Most recently seen first.',
      people: a.segments.driftedAway,
      extraCol: { label: 'Last seen', value: (p) => (p.lastEver ? longDate(p.lastEver) : '-') },
    },
    {
      title: 'Never at a sabha',
      blurb: 'On the roster, never marked present at any sabha on record. Some may simply never have been marked.',
      people: a.segments.neverEver,
      extraCol: { label: 'Total sabhas ever', value: () => '0' },
    },
  ];
  lists.forEach((list) => { y = drawPeopleTable(pdf, list, y, headerNote); });

  drawFooters(pdf, toLatin(describeSeasonScope(filters)));
  pdf.save(`${seasonFileSlug({ ...filters, from: a.window.from, to: a.window.to })}.pdf`);
}
