/**
 * functions/lib/pdfReport.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 20 — PDF attachments for the reports.
 *
 * The legacy app built these with DocumentApp and converted to PDF; jsPDF is the
 * equivalent that runs in Cloud Functions.
 *
 * ASCII ONLY. jsPDF's built-in Helvetica is a standard PDF Type1 font with a
 * single-byte encoding — it has no glyphs for Devanagari, Gujarati, emoji, or
 * even a typographic dash. Passing any of those produces garbage or a blank
 * cell, silently. Every string that reaches the document therefore goes through
 * ascii(), which transliterates the punctuation we actually generate and drops
 * the rest. That is also why the emoji in the HTML templates are not reused here.
 *
 * Embedding a Devanagari TTF would fix it properly, but it means shipping a
 * ~400KB font in the functions bundle and calling addFileToVFS on every cold
 * start. Not worth it for a report that is read in English.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { jsPDF } = require('jspdf');
require('jspdf-autotable');

const ORANGE = [234, 88, 12];
const SLATE = [15, 23, 42];
const MUTED = [100, 116, 139];

/** Transliterate to printable ASCII. Anything without a mapping is dropped. */
function ascii(value) {
  return String(value == null ? '' : value)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—‒]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[•·]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim();
}

/**
 * A name that survives ascii(). A record whose name is written entirely in
 * Devanagari or Gujarati transliterates to the empty string, and a nameless row
 * on a call list is a row nobody can act on — the reader cannot tell whether the
 * PDF is broken or the record is. So fall back to the number, which is the thing
 * the call actually needs, and say where the real spelling is.
 *
 * Only a PDF problem: the HTML and plain-text bodies are UTF-8 and show the name
 * correctly, which is what "see the email" points at.
 */
function pdfName(name, mobile) {
  const safe = ascii(name);
  if (safe) return safe;
  const digits = String(mobile || '').replace(/\D/g, '');
  return digits ? `(name in Hindi) ${digits}` : '(name in Hindi - see the email)';
}

function header(doc, title, subtitle) {
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, 210, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(ascii(title), 14, 11);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(ascii(subtitle), 14, 17);
  }
  doc.setTextColor(...SLATE);
}

function footer(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('BAPS Jaipur MDS', 14, 290);
    doc.text(`Page ${i} of ${pages}`, 196, 290, { align: 'right' });
  }
}

/** A row of label/value pairs under the header. Returns the next free Y. */
function summaryLine(doc, pairs, y) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...SLATE);
  doc.text(ascii(pairs.map((p) => `${p.label}: ${p.value}`).join('   |   ')), 14, y);
  return y + 8;
}

function autoTable(doc, head, body, startY) {
  doc.autoTable({
    startY,
    head: [head.map(ascii)],
    body: body.map((r) => r.map(ascii)),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, textColor: SLATE },
    headStyles: { fillColor: [241, 245, 249], textColor: MUTED, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 251] },
    margin: { left: 14, right: 14, bottom: 20 },
  });
  return doc.lastAutoTable.finalY + 8;
}

/**
 * A Firestore document is capped at 1,048,576 bytes, and the Trigger Email
 * extension carries attachments as base64 INSIDE the mail/{id} document. base64
 * inflates by 4/3, so a 600KB PDF becomes 800KB of field value and the mail
 * write fails outright with INVALID_ARGUMENT — which for the post-sabha job
 * means the claim is released, retried three times and then abandoned, so the
 * report is lost rather than merely unattached.
 *
 * 512KB of base64 (~384KB of PDF) is the cap. That leaves well over 400KB for
 * the HTML body, the plain-text alternative and the recipient list, and no report
 * generated here comes close: the largest realistic case is a 400-name sabha
 * attendance table, which is ~90KB of PDF. Anything above the cap is a runaway,
 * and the failure posture for a PDF is already "send the email without it" —
 * the same numbers are in the HTML body.
 */
const MAX_ATTACHMENT_BASE64_BYTES = 512 * 1024;

function toAttachment(doc, filename) {
  const buffer = Buffer.from(doc.output('arraybuffer'));
  const content = buffer.toString('base64');
  if (content.length > MAX_ATTACHMENT_BASE64_BYTES) {
    console.error(
      `[pdfReport] ${filename} is ${Math.round(buffer.length / 1024)}KB `
      + `(${Math.round(content.length / 1024)}KB base64), over the ${MAX_ATTACHMENT_BASE64_BYTES / 1024}KB `
      + 'cap for a Firestore mail document. Sending the email without the attachment.',
    );
    return null;
  }
  return { filename, content, encoding: 'base64' };
}

/**
 * dailyReportPdf(stats) → attachment object for the Trigger Email extension.
 * Returns null on failure: a broken PDF must not stop the email going out, since
 * the numbers are already in the HTML body.
 */
function dailyReportPdf(stats) {
  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    header(doc, 'Daily Calling Report', stats.dateLabel);

    let y = summaryLine(doc, [
      { label: 'Contacts updated', value: stats.totals.contacts },
      { label: 'Calls logged', value: stats.totals.calls },
      { label: 'Volunteers active', value: stats.perVolunteer.length },
    ], 32);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('By volunteer', 14, y);
    y += 3;

    y = autoTable(doc,
      ['Volunteer', 'Contacts', 'Calls', 'Interested', 'Follow up'],
      stats.perVolunteer.map((v) => [
        v.name,
        String(v.contacts),
        String(v.calls),
        String(v.statusCounts['Interested'] || 0),
        String(v.followUps),
      ]),
      y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Status breakdown', 14, y);
    y += 3;

    autoTable(doc,
      ['Status', 'Contacts'],
      Object.entries(stats.totals.statusCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => [s, String(n)]),
      y);

    footer(doc);
    return toAttachment(doc, `daily-calling-report-${stats.dateKey}.pdf`);
  } catch (err) {
    console.error('[pdfReport] daily PDF failed, sending email without it:', err.message);
    return null;
  }
}

/** postSabhaPdf(report) → attachment object, or null on failure. */
function postSabhaPdf(report) {
  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    header(doc, ascii(report.event.title) || 'Sabha Attendance', report.event.dateLabel);

    let y = summaryLine(doc, [
      { label: 'Present', value: report.present.length },
      { label: 'Expected', value: report.expected },
      { label: 'Turnout', value: `${report.turnoutPct}%` },
      { label: 'First timers', value: report.firstTimers.length },
    ], 32);

    if (report.event.mandal || report.event.speaker) {
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.text(ascii([
        report.event.mandal && `Mandal: ${report.event.mandal}`,
        report.event.area && `Area: ${report.event.area}`,
        report.event.speaker && `Speaker: ${report.event.speaker}`,
      ].filter(Boolean).join('   |   ')), 14, y);
      doc.setTextColor(...SLATE);
      y += 8;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Present (${report.present.length})`, 14, y);
    y += 3;

    y = autoTable(doc,
      ['#', 'Name', 'Mandal', 'Mobile', 'Last 12 months'],
      report.present.map((p, i) => [
        String(i + 1),
        pdfName(p.name, p.mobile) + (p.isFirstTimer ? ' (new)' : ''),
        p.mandal || '-',
        p.mobile || '-',
        `${p.attended}/${p.held}`,
      ]),
      y);

    if (report.regularsAbsent.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`Regulars who did not come (${report.regularsAbsent.length})`, 14, y);
      y += 3;
      autoTable(doc,
        ['#', 'Name', 'Mandal', 'Mobile', 'Last 12 months'],
        report.regularsAbsent.map((p, i) => [
          String(i + 1), pdfName(p.name, p.mobile), p.mandal || '-', p.mobile || '-', `${p.attended}/${p.held}`,
        ]),
        y);
    }

    footer(doc);
    const safe = ascii(report.event.title).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return toAttachment(doc, `attendance-${safe || 'sabha'}-${report.event.date}.pdf`);
  } catch (err) {
    console.error('[pdfReport] post-sabha PDF failed, sending email without it:', err.message);
    return null;
  }
}

/**
 * PHASE 38 — one karyakarta's post-sabha follow-up list.
 *
 * skBatchPdf(report) → attachment object, or null on failure.
 *
 * THE ORDER OF THE TABLES IS THE FEATURE. "who not come in sabha then he again
 * call those numbers and ask there reason" — so the people to ring come first,
 * grouped by what they had said, and the people who came come last as a record.
 * A PDF that opens with a page of names who already turned up teaches its reader
 * that there is nothing in it for them.
 *
 * "What they said" is printed against every absent name because it is the opener
 * for the call: "you said you would come" is a different conversation from
 * "I could not reach you last week".
 *
 * @param {object} report one entry from lib/skReport.buildSkBatchReports()
 * @param {Array}  groupDefs ROUND_GROUPS from lib/roundClassify, so the labels
 *   and the precedence live in exactly one place.
 */
function skBatchPdf(report, groupDefs) {
  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    header(doc, `${report.volunteerName} - your calling list`,
      `${report.event.title} - ${report.event.dateLabel}`);

    let y = summaryLine(doc, [
      { label: 'You called', value: report.called },
      { label: 'Came', value: report.attended },
      { label: 'Did not come', value: report.absent },
      { label: 'To call back', value: report.chaseCount },
    ], 32);

    if (report.promiseKept !== null) {
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.text(ascii(
        `${report.promised} said they would come, ${report.counts.kept} of them did `
        + `(${report.promiseKept}%).   Batches: ${report.batchNames.join(', ')}`,
      ), 14, y);
      doc.setTextColor(...SLATE);
      y += 8;
    }

    // The three chase groups first, then the two tally groups. groupDefs already
    // holds them in that order.
    for (const g of groupDefs) {
      const rows = report.groups[g.key] || [];
      if (!rows.length) continue;

      // A new group is worth nothing at the very bottom of a page.
      if (y > 250) { doc.addPage(); y = 20; }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(ascii(`${g.pdfLabel} (${rows.length})`), 14, y);
      y += 4;

      if (g.chase) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(ascii(g.hint), 14, y);
        doc.setTextColor(...SLATE);
        y += 3;
      }

      y = autoTable(doc,
        ['#', 'Name', 'Mobile', 'Mandal', 'Area', 'What they said'],
        rows.map((r, i) => [
          String(i + 1),
          pdfName(r.name, r.mobile),
          r.mobile || '-',
          r.mandal || '-',
          r.area || '-',
          r.said || 'nothing recorded',
        ]),
        y);
    }

    if (report.truncated) {
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(ascii(`${report.truncated} more contact(s) are not listed - open My Calling for the full list.`), 14, y);
      doc.setTextColor(...SLATE);
    }

    footer(doc);
    const safe = ascii(report.volunteerName).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return toAttachment(doc, `my-calling-list-${safe || 'karyakarta'}-${report.event.date}.pdf`);
  } catch (err) {
    console.error('[pdfReport] SK batch PDF failed, sending email without it:', err.message);
    return null;
  }
}

/** birthdayPdf(data) → attachment object, or null on failure. */
function birthdayPdf(data) {
  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    header(doc, 'Birthdays & Anniversaries', data.dateLabel);

    let y = summaryLine(doc, [
      { label: 'Birthdays', value: data.birthdays.length },
      { label: 'Anniversaries', value: data.anniversaries.length },
    ], 32);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Birthdays (${data.birthdays.length})`, 14, y);
    y += 3;
    y = autoTable(doc,
      ['Name', 'Turning', 'Mandal', 'Mobile'],
      data.birthdays.map((p) => [pdfName(p.name, p.mobile), p.age != null ? String(p.age) : '-', p.mandal || '-', p.mobile || '-']),
      y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Anniversaries (${data.anniversaries.length})`, 14, y);
    y += 3;
    autoTable(doc,
      ['Name', 'Years', 'Mandal', 'Mobile'],
      data.anniversaries.map((p) => [pdfName(p.name, p.mobile), p.years != null ? String(p.years) : '-', p.mandal || '-', p.mobile || '-']),
      y);

    footer(doc);
    return toAttachment(doc, `birthdays-${data.dateKey}.pdf`);
  } catch (err) {
    console.error('[pdfReport] birthday PDF failed, sending email without it:', err.message);
    return null;
  }
}

module.exports = { dailyReportPdf, postSabhaPdf, skBatchPdf, birthdayPdf, ascii, pdfName };
