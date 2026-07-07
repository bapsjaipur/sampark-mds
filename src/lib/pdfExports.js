// src/lib/pdfExports.js
// Reusable PDF export functions used by PadhramaniPage and HouseholdsPage.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

const ORANGE = [234, 88, 12];

function fmtDateLong(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return isNaN(d) ? str : d.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

async function fetchMembersByHousehold(householdIds) {
  const map = {};
  if (!householdIds.length) return map;
  // Firestore 'in' limit is 30; batch in groups of 10 to be safe
  for (let i = 0; i < householdIds.length; i += 10) {
    const batch = householdIds.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(db, 'individuals'), where('householdId', 'in', batch))
    );
    snap.docs.forEach((d) => {
      const ind = { id: d.id, ...d.data() };
      if (!map[ind.householdId]) map[ind.householdId] = [];
      map[ind.householdId].push(ind);
    });
  }
  return map;
}

// ── 9.1 — Padhramani day schedule PDF ────────────────────────────────────────
// Fetches individuals for all households in the event, then builds a landscape
// A4 PDF with: header (date/area/karyakarta/santo), table (Time | Household |
// Address | Family Members | Sampark Karyakarta | Remarks), and break rows.
export async function exportPadhramaniDayPdf(event, breaks = []) {
  const householdIds = (event.households || [])
    .map((h) => h.householdId)
    .filter(Boolean);
  const membersMap = await fetchMembersByHousehold(householdIds);

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // ── Header bar ──────────────────────────────────────────────────────────────
  pdf.setFillColor(...ORANGE);
  pdf.rect(0, 0, 297, 18, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text('BAPS Jaipur MDS — Padhramani Day Schedule', 12, 12);

  // ── Info lines ──────────────────────────────────────────────────────────────
  pdf.setTextColor(40, 40, 40);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);

  const santo1 = event.secondVolunteerName || '';
  const santo2 = event.santo2Name || '';
  const santoStr = [santo1, santo2].filter(Boolean).join(', ') || '—';

  let y = 25;
  pdf.text(`Date: ${fmtDateLong(event.scheduledDate)}`, 12, y);
  pdf.text(`Area: ${event.area || '—'}`, 162, y);
  y += 6;
  pdf.text(`Karyakarta: ${event.assignedVolunteerName || '—'}`, 12, y);
  pdf.text(`Santo: ${santoStr}`, 162, y);
  y += 4;
  if (event.notes) {
    pdf.setTextColor(110, 110, 110);
    pdf.setFontSize(8);
    pdf.text(`Notes: ${event.notes}`, 12, y + 2);
    pdf.setTextColor(40, 40, 40);
    pdf.setFontSize(9);
    y += 6;
  }
  y += 3;

  // ── Build table rows (visits interleaved with breaks by order index) ────────
  const visits = (event.households || []).map((hh, i) => ({
    type: 'visit', order: i, hh,
  }));
  const breakItems = (breaks || []).map((b) => ({
    type: 'break', order: b.afterIndex ?? b.order ?? 0, b,
  }));
  const allItems = [...visits, ...breakItems].sort((a, b) => a.order - b.order);

  const body = allItems.map((item) => {
    if (item.type === 'break') {
      return [{
        content: `☕  ${item.b.label || 'Break'}${item.b.time ? '  \xb7  ' + item.b.time : ''}`,
        colSpan: 6,
        styles: {
          fontStyle: 'bold',
          fillColor: [254, 243, 199],
          textColor: [146, 64, 14],
          halign: 'center',
        },
      }];
    }
    const { hh } = item;
    const members = (membersMap[hh.householdId] || []).sort(
      (a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || (a.name || '').localeCompare(b.name || '')
    );
    const nameList = members.map((m) => (m.isPrimary ? `★ ${m.name}` : m.name)).join('\n') || '—';
    const primary = members.find((m) => m.isPrimary) || members[0];
    const samparkName = primary?.samparkKaryakartaName || '—';
    return ['', hh.primaryName || '—', hh.address || '—', nameList, samparkName, ''];
  });

  autoTable(pdf, {
    startY: y,
    head: [['Time', 'Household', 'Address', 'Family Members', 'Sampark Karyakarta', 'Remarks']],
    body,
    styles: { fontSize: 8, valign: 'top', cellPadding: 2 },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { cellWidth: 40 },
      2: { cellWidth: 52 },
      3: { cellWidth: 62 },
      4: { cellWidth: 42 },
      5: { cellWidth: 'auto' },
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
  });

  // ── Footer on every page ────────────────────────────────────────────────────
  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFontSize(7);
    pdf.setTextColor(160, 160, 160);
    pdf.text(
      `BAPS Jaipur MDS  \xb7  Generated ${new Date().toLocaleString('en-IN')}  \xb7  Page ${p} of ${pageCount}`,
      12, pdf.internal.pageSize.height - 5
    );
  }

  const safeName = (event.name || event.area || 'padhramani')
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
  pdf.save(`${safeName}-${event.scheduledDate || 'schedule'}.pdf`);
}

// ── 9.2 — Blank offline data-entry form PDF ───────────────────────────────────
// Portrait A4 with: title bar, Household section (address/area/mandal/level/
// SK name+mobile/remark), then 6× Member blocks (name/mobile, dob/anniversary/
// relation checkboxes, photo-pending checkbox).  No Firestore calls needed.
export function exportBlankFormPdf() {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const M = 12; // left/right margin
  const W = 186; // inner width (210 - 2*12)
  let y = 0;

  function sectionHeader(text) {
    pdf.setFillColor(...ORANGE);
    pdf.rect(M, y, W, 7, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.text(text, M + 3, y + 5);
    pdf.setTextColor(40, 40, 40);
    pdf.setFont('helvetica', 'normal');
    y += 10;
  }

  // ── Title bar ───────────────────────────────────────────────────────────────
  pdf.setFillColor(...ORANGE);
  pdf.rect(0, 0, 210, 16, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text('BAPS Jaipur MDS — Household Registration Form', M, 11);
  pdf.setTextColor(40, 40, 40);
  pdf.setFont('helvetica', 'normal');
  y = 20;

  // ── Household Details ───────────────────────────────────────────────────────
  sectionHeader('Household Details');

  pdf.setFontSize(8);
  pdf.setDrawColor(160, 160, 160);

  // Address (two writing lines)
  pdf.text('Address:', M, y);
  pdf.line(M + 20, y, M + W, y);
  y += 6;
  pdf.line(M, y, M + W, y);
  y += 8;

  // Area / Mandal / Level
  pdf.text('Area:', M, y);
  pdf.line(M + 12, y, M + 58, y);
  pdf.text('Mandal:', M + 62, y);
  pdf.line(M + 62 + 16, y, M + 120, y);
  pdf.text('Level:', M + 124, y);
  pdf.line(M + 124 + 13, y, M + W, y);
  y += 8;

  // Sampark Karyakarta name / mobile
  pdf.text('SK Name:', M, y);
  pdf.line(M + 18, y, M + 92, y);
  pdf.text('SK Mobile:', M + 96, y);
  pdf.line(M + 96 + 20, y, M + W, y);
  y += 8;

  // Remark
  pdf.text('Remark:', M, y);
  pdf.line(M + 17, y, M + W, y);
  y += 10;

  // ── Member blocks (6×) ──────────────────────────────────────────────────────
  for (let m = 1; m <= 6; m++) {
    if (y + 34 > 280) {
      pdf.addPage();
      y = 14;
    }
    sectionHeader(`Member ${m}`);

    pdf.setFontSize(8);
    pdf.setDrawColor(160, 160, 160);

    // Name / Mobile
    pdf.text('Name:', M, y);
    pdf.line(M + 13, y, M + 90, y);
    pdf.text('Mobile:', M + 94, y);
    pdf.line(M + 94 + 16, y, M + W, y);
    y += 7;

    // DOB / Anniversary / Relation checkboxes
    pdf.text('DOB:', M, y);
    pdf.line(M + 10, y, M + 54, y);
    pdf.text('Anniversary:', M + 58, y);
    pdf.line(M + 58 + 24, y, M + 112, y);
    pdf.text('Relation:', M + 116, y);
    const relations = ['Head', 'Spouse', 'Member'];
    let rx = M + 116 + 20;
    relations.forEach((rel) => {
      pdf.setDrawColor(120, 120, 120);
      pdf.rect(rx, y - 3.5, 3.5, 3.5);
      pdf.setDrawColor(160, 160, 160);
      pdf.setFontSize(7.5);
      pdf.text(rel, rx + 4.5, y);
      pdf.setFontSize(8);
      rx += rel.length * 1.85 + 7;
    });
    y += 7;

    // Photo-pending checkbox
    pdf.setDrawColor(120, 120, 120);
    pdf.rect(M, y - 3.5, 3.5, 3.5);
    pdf.setDrawColor(160, 160, 160);
    pdf.setFontSize(8);
    pdf.text('Photo — add later', M + 5, y);
    y += 8;
  }

  // ── Footer on every page ────────────────────────────────────────────────────
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFontSize(7);
    pdf.setTextColor(150, 150, 150);
    pdf.text(
      'BAPS Jaipur MDS  \xb7  SK = Sampark Karyakarta  \xb7  Fill and hand to data entry volunteer',
      M, 290
    );
  }

  pdf.save('padhramani-blank-form.pdf');
}
