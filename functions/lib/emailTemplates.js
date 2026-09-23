/**
 * functions/lib/emailTemplates.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 20 — HTML bodies for the automated reports. Ports buildEmailHtml_(),
 * statusPill_() and the birthday-summary markup from Sevak Call's Code.gs.
 *
 * Email HTML is not web HTML. Everything here is deliberately old-fashioned:
 *   • tables for layout, not flex or grid (Outlook's Word renderer)
 *   • inline styles only, no <style> block and no classes (Gmail strips them)
 *   • no external images, no webfonts
 * Resist the urge to tidy any of that up.
 *
 * Every builder also returns a plain-text alternative. Some karyakars read mail
 * in clients that show text-only, and a text part materially improves the odds
 * of not landing in spam.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ORANGE = '#ea580c';
const SLATE = '#0f172a';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';

/**
 * The legacy app displayed 'Not Interested' as 'Not Joining' in emails — the
 * softer wording was a deliberate choice for reports that circulate among
 * karyakars, and it is kept. The stored value is unchanged.
 */
const STATUS_DISPLAY = {
  'Not Interested': 'Not Joining',
};

const STATUS_COLORS = {
  'Interested': { bg: '#dcfce7', fg: '#166534' },
  'Not Interested': { bg: '#fee2e2', fg: '#991b1b' },
  'Call Back Later': { bg: '#fef9c3', fg: '#854d0e' },
  'No Answer': { bg: '#dbeafe', fg: '#1e40af' },
  'Already Volunteer': { bg: '#d1fae5', fg: '#065f46' },
  'Donated': { bg: '#f3e8ff', fg: '#6b21a8' },
  'Follow Up': { bg: '#fef9c3', fg: '#854d0e' },
};

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusLabel(status) {
  const s = String(status || '').trim();
  return STATUS_DISPLAY[s] || s || 'No status';
}

/** Rounded status chip. Ports statusPill_(). */
function statusPill(status) {
  const s = String(status || '').trim();
  const c = STATUS_COLORS[s] || { bg: '#f1f5f9', fg: MUTED };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;`
    + `background:${c.bg};color:${c.fg};font-size:12px;font-weight:600;white-space:nowrap;">`
    + `${esc(statusLabel(s))}</span>`;
}

function shell({ title, subtitle, bodyHtml, footerNote }) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8fafc;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="background:${ORANGE};padding:18px 22px;">
        <div style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-0.2px;">${esc(title)}</div>
        ${subtitle ? `<div style="color:#ffe4d5;font-size:13px;margin-top:3px;">${esc(subtitle)}</div>` : ''}
      </td></tr>
      <tr><td style="padding:22px;">${bodyHtml}</td></tr>
      <tr><td style="border-top:1px solid ${BORDER};padding:14px 22px;background:#f8fafc;color:${MUTED};font-size:11px;line-height:1.5;">
        ${footerNote ? `${esc(footerNote)}<br>` : ''}
        Sent automatically by BAPS Jaipur MDS. Reply to this address if a number looks wrong.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** A row of stat tiles. `stats` = [{label, value, tone?}] */
function tiles(stats) {
  const cells = stats.map((s) => `
    <td width="${Math.floor(100 / stats.length)}%" style="padding:4px;" valign="top">
      <div style="border:1px solid ${BORDER};border-radius:8px;padding:10px 12px;">
        <div style="color:${MUTED};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${esc(s.label)}</div>
        <div style="color:${s.tone || SLATE};font-size:20px;font-weight:700;margin-top:2px;">${esc(s.value)}</div>
      </div>
    </td>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -4px 16px;"><tr>${cells}</tr></table>`;
}

function sectionTitle(text) {
  return `<div style="color:${SLATE};font-size:13px;font-weight:700;margin:18px 0 8px;">${esc(text)}</div>`;
}

function table(headers, rows) {
  if (!rows.length) {
    return `<div style="color:${MUTED};font-size:13px;padding:14px;border:1px dashed ${BORDER};border-radius:8px;text-align:center;">Nothing to show.</div>`;
  }
  const head = headers.map((h, i) => `<th align="${i === 0 ? 'left' : 'right'}" style="padding:7px 10px;border-bottom:1px solid ${BORDER};color:${MUTED};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">${esc(h)}</th>`).join('');
  const body = rows.map((cols) => `<tr>${cols.map((c, i) => `<td align="${i === 0 ? 'left' : 'right'}" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:${SLATE};font-size:13px;">${c}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;border-collapse:separate;overflow:hidden;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── Daily calling report ────────────────────────────────────────────────────

/**
 * buildDailyReport(stats) — the 10pm digest. Ports buildDailyVolunteerStats_'s
 * output plus the admin summary the legacy app mailed alongside it.
 *
 * @param {object} stats from reportData.buildDailyStats()
 * @param {object} [opts] { forVolunteer: {id,name} } renders the single-volunteer
 *   variant instead of the org-wide leaderboard.
 */
function buildDailyReport(stats, opts = {}) {
  const solo = opts.forVolunteer || null;
  const mine = solo ? (stats.perVolunteer.find((v) => v.volunteerId === solo.id) || null) : null;

  const heading = solo ? `Your calling summary — ${stats.dateLabel}` : `Daily calling report — ${stats.dateLabel}`;
  const parts = [];

  if (solo) {
    parts.push(tiles([
      { label: 'Contacts updated', value: mine ? mine.contacts : 0, tone: ORANGE },
      { label: 'Calls logged', value: mine ? mine.calls : 0 },
      { label: 'Interested', value: mine ? (mine.statusCounts['Interested'] || 0) : 0, tone: '#16a34a' },
      { label: 'Follow up', value: mine ? mine.followUps : 0, tone: '#ca8a04' },
    ]));

    if (!mine) {
      parts.push(`<div style="color:${MUTED};font-size:13px;">No calls recorded against your name today. If you did call, check that the status was saved on each contact.</div>`);
    } else {
      parts.push(sectionTitle('How the day broke down'));
      parts.push(table(['Status', 'Contacts'], Object.entries(mine.statusCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => [statusPill(s), String(n)])));
    }

    parts.push(sectionTitle('Across all volunteers'));
    parts.push(`<div style="color:${MUTED};font-size:13px;">${stats.totals.contacts} contacts updated by ${stats.perVolunteer.length} volunteer(s) today.</div>`);
  } else {
    parts.push(tiles([
      { label: 'Contacts updated', value: stats.totals.contacts, tone: ORANGE },
      { label: 'Calls logged', value: stats.totals.calls },
      { label: 'Volunteers active', value: stats.perVolunteer.length },
      { label: 'Interested', value: stats.totals.statusCounts['Interested'] || 0, tone: '#16a34a' },
    ]));

    parts.push(sectionTitle('By volunteer'));
    parts.push(table(['Volunteer', 'Contacts', 'Calls', 'Interested', 'Follow up'],
      stats.perVolunteer.map((v) => [
        esc(v.name),
        String(v.contacts),
        String(v.calls),
        String(v.statusCounts['Interested'] || 0),
        String(v.followUps),
      ])));

    parts.push(sectionTitle('Status breakdown'));
    parts.push(table(['Status', 'Contacts'], Object.entries(stats.totals.statusCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => [statusPill(s), String(n)])));

    if (stats.pending.total > 0) {
      parts.push(sectionTitle('Still to call'));
      parts.push(`<div style="color:${MUTED};font-size:13px;">`
        + `<strong style="color:${SLATE};">${stats.pending.total}</strong> contacts in assigned batches have no status yet`
        + `${stats.pending.unassignedBatches ? `, and ${stats.pending.unassignedBatches} batch(es) are not assigned to anyone` : ''}.`
        + `</div>`);
    }
  }

  const html = shell({
    title: heading,
    subtitle: solo ? esc(solo.name) : 'Sampark calling activity',
    bodyHtml: parts.join(''),
    footerNote: stats.totals.contacts === 0 ? 'No calling activity was recorded today.' : '',
  });

  const text = [
    heading,
    '',
    solo
      ? `You: ${mine ? mine.contacts : 0} contacts, ${mine ? mine.calls : 0} calls logged.`
      : `Total: ${stats.totals.contacts} contacts updated, ${stats.totals.calls} calls logged, ${stats.perVolunteer.length} volunteers active.`,
    '',
    ...(solo ? [] : stats.perVolunteer.map((v) => `  ${v.name}: ${v.contacts} contacts / ${v.calls} calls`)),
  ].join('\n');

  return { subject: heading, html, text };
}

// ── Post-sabha attendance report ────────────────────────────────────────────

/**
 * buildPostSabhaReport(report) — mailed once, shortly after an event ends.
 *
 * The BODY is stats only. "in body i do no want the list of present contacts. i
 * want that list in pdf" — so the who-attended list (with the sevak who called
 * each person and the 12-month ratio) lives in the attached PDF, and the email
 * carries the headline numbers, the present breakdown per mandal and per area,
 * and the batch follow-up: of the contacts a karyakarta rang, how many came.
 */
function buildPostSabhaReport(report, opts = {}) {
  const solo = opts.forVolunteer || null;
  const heading = `${report.event.title} — attendance`;
  const parts = [];

  parts.push(tiles([
    { label: 'Present', value: report.present.length, tone: '#16a34a' },
    { label: report.event.mandal ? 'Mandal contacts' : 'Expected', value: report.expected, tone: SLATE },
    { label: 'Turnout', value: `${report.turnoutPct}%`, tone: ORANGE },
    { label: 'Absent', value: report.absent, tone: report.absent ? '#dc2626' : SLATE },
  ]));

  parts.push(`<div style="color:${MUTED};font-size:13px;margin-bottom:4px;">`
    + `${esc(report.event.dateLabel)}${report.event.time ? ` at ${esc(report.event.time)}` : ''}`
    + `${report.event.mandal ? ` · ${esc(report.event.mandal)}` : ''}`
    + `${report.event.area ? ` · ${esc(report.event.area)}` : ''}`
    + `${report.event.speaker ? `<br>Speaker: ${esc(report.event.speaker)}` : ''}`
    + `</div>`);

  parts.push(`<div style="color:${MUTED};font-size:12px;margin:4px 0 8px;">`
    + 'The full list of who attended — with the sevak who called each person — is in the attached PDF.'
    + '</div>');

  const byMandal = report.byMandal || [];
  if (byMandal.length) {
    parts.push(sectionTitle('Present by mandal'));
    parts.push(table(['Mandal', 'Present'], byMandal.map((m) => [esc(m.mandal), String(m.count)])));
  }

  const byArea = report.byArea || [];
  if (byArea.length) {
    parts.push(sectionTitle('Present by area'));
    parts.push(table(['Area', 'Present'], byArea.map((a) => [esc(a.area), String(a.count)])));
  }

  // Batch follow-up — the "stats also followed up contacts the batches generated"
  // angle: of the contacts we rang for this sabha, how many turned up, and who
  // brought them.
  const bs = report.batchStats || {};
  const contribution = report.volunteerContribution || [];
  if (bs.called) {
    parts.push(sectionTitle('Batch follow-up'));
    parts.push(`<div style="color:${MUTED};font-size:13px;margin-bottom:8px;">`
      + `<strong style="color:${SLATE};">${bs.called}</strong> contact${bs.called === 1 ? '' : 's'} were followed up across `
      + `<strong style="color:${SLATE};">${bs.batches}</strong> batch${bs.batches === 1 ? '' : 'es'} for this sabha — `
      + `<strong style="color:#16a34a;">${bs.present}</strong> came `
      + `(<strong style="color:${ORANGE};">${bs.followUpRate}%</strong>).`
      + '</div>');
    if (contribution.length) {
      parts.push(table(['Sevak', 'Contacts present'], contribution.map((v) => [esc(v.name), String(v.count)])));
    }
  } else if (contribution.length) {
    parts.push(sectionTitle('Volunteer contribution'));
    parts.push(table(['Sevak', 'Contacts present'], contribution.map((v) => [esc(v.name), String(v.count)])));
  }

  if (report.regularsAbsent.length) {
    parts.push(`<div style="color:${MUTED};font-size:12px;margin-top:14px;">`
      + `<strong style="color:${SLATE};">${report.regularsAbsent.length}</strong> regular attendee`
      + `${report.regularsAbsent.length === 1 ? '' : 's'} did not come today — the list is in the attached PDF.`
      + '</div>');
  }

  const html = shell({
    title: heading,
    subtitle: solo ? esc(solo.name) : 'Sabha attendance',
    bodyHtml: parts.join(''),
    footerNote: `Attendance was taken by ${report.markedByNames.join(', ') || 'unknown'}.`,
  });

  const text = [
    heading,
    report.event.dateLabel,
    '',
    `Present: ${report.present.length} of ${report.expected} (${report.turnoutPct}%). Absent: ${report.absent}.`,
    '',
    'Present by mandal:',
    ...byMandal.map((m) => `  ${m.mandal}: ${m.count}`),
    ...(bs.called ? [
      '',
      `Batch follow-up: ${bs.present} of ${bs.called} rang came (${bs.followUpRate}%) across ${bs.batches} batch(es).`,
      '',
      'Volunteer contribution:',
      ...contribution.map((v) => `  ${v.name}: ${v.count}`),
    ] : []),
    '',
    'The full attendee list (with the sevak who called each person) is in the attached PDF.',
  ].join('\n');

  return { subject: heading, html, text };
}

// ── Per-karyakarta post-sabha follow-up list ────────────────────────────────

/**
 * PHASE 38 — buildSkBatchReport(report, groupDefs)
 *
 * The email that carries lib/pdfReport.skBatchPdf. Same principle as the PDF: the
 * people to ring come first and the people who came come last, because this is a
 * task and not a summary.
 *
 * The body deliberately DUPLICATES the chase lists rather than saying "see the
 * attachment". A karyakarta reads this on a phone, and the mobile numbers are
 * tel: links here — which is the whole point, since the next thing they do is
 * call somebody. The PDF exists so the list survives being scrolled past.
 *
 * @param {object} report one entry from lib/skReport.buildSkBatchReports()
 * @param {Array}  groupDefs ROUND_GROUPS from lib/roundClassify — labels and
 *   precedence live there, not here.
 */
function buildSkBatchReport(report, groupDefs) {
  const heading = `Your calling list — ${report.event.title}`;
  const subject = report.chaseCount
    ? `${heading} · ${report.chaseCount} to call back`
    : `${heading} · nothing to chase`;

  const parts = [];

  parts.push(`<div style="color:${SLATE};font-size:14px;margin-bottom:14px;">`
    + `Jai Swaminarayan ${esc(report.volunteerName)},`
    + `</div>`);

  parts.push(`<div style="color:${MUTED};font-size:13px;line-height:1.6;margin-bottom:14px;">`
    + `This is only the ${report.called} contact${report.called === 1 ? '' : 's'} in your own `
    + `batch${report.batchNames.length === 1 ? '' : 'es'} for `
    + `<strong style="color:${SLATE};">${esc(report.event.title)}</strong> on ${esc(report.event.dateLabel)}`
    + `${report.event.mandal ? ` · ${esc(report.event.mandal)}` : ''}. `
    + 'Nobody else\'s contacts are in here.'
    + '</div>');

  parts.push(tiles([
    { label: 'You called', value: report.called, tone: SLATE },
    { label: 'Came', value: report.attended, tone: '#16a34a' },
    { label: 'Did not come', value: report.absent, tone: report.absent ? '#dc2626' : SLATE },
    { label: 'To call back', value: report.chaseCount, tone: report.chaseCount ? ORANGE : SLATE },
  ]));

  if (report.promiseKept !== null) {
    parts.push(`<div style="color:${MUTED};font-size:13px;margin:-6px 0 4px;">`
      + `<strong style="color:${SLATE};">${report.promised}</strong> told you they would come and `
      + `<strong style="color:${SLATE};">${report.counts.kept}</strong> of them did — `
      + `<strong style="color:${report.promiseKept >= 70 ? '#16a34a' : ORANGE};">${report.promiseKept}%</strong>.`
      + '</div>');
  }

  const chase = groupDefs.filter((g) => g.chase && (report.groups[g.key] || []).length);
  const tally = groupDefs.filter((g) => !g.chase && (report.groups[g.key] || []).length);

  if (!chase.length) {
    parts.push(`<div style="margin-top:16px;color:#166534;font-size:13px;padding:12px 14px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;">`
      + 'Everyone you reached did what they said they would. Nothing to call back about this week.'
      + '</div>');
  }

  for (const g of chase) {
    const rows = report.groups[g.key];
    parts.push(sectionTitle(`${g.label} (${rows.length})`));
    parts.push(`<div style="color:${MUTED};font-size:12px;margin:-4px 0 8px;">${esc(g.hint)}</div>`);
    parts.push(table(['Name', 'Mandal · Area', 'What they said', 'Call'],
      rows.map((r) => [
        esc(r.name),
        esc([r.mandal, r.area].filter(Boolean).join(' · ') || '-'),
        r.said ? statusPill(r.said) : `<span style="color:#94a3b8;font-size:12px;">nothing recorded</span>`,
        r.mobile
          ? `<a href="tel:${esc(r.mobile)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap;">${esc(r.mobile)}</a>`
          : '<span style="color:#94a3b8;font-size:12px;">no number</span>',
      ])));
  }

  for (const g of tally) {
    const rows = report.groups[g.key];
    parts.push(sectionTitle(`${g.label} (${rows.length})`));
    parts.push(table(['Name', 'Mandal · Area', 'What they said'],
      rows.map((r) => [
        esc(r.name),
        esc([r.mandal, r.area].filter(Boolean).join(' · ') || '-'),
        r.said ? statusPill(r.said) : `<span style="color:#94a3b8;font-size:12px;">nothing recorded</span>`,
      ])));
  }

  if (report.truncated) {
    parts.push(`<div style="margin-top:12px;color:#854d0e;font-size:12px;padding:10px 12px;border:1px solid #fde68a;background:#fefce8;border-radius:8px;">`
      + `${report.truncated} more contact${report.truncated === 1 ? '' : 's'} could not fit in this email. `
      + 'Open My Calling in BAPS Jaipur MDS for the complete list.'
      + '</div>');
  }

  const html = shell({
    title: heading,
    subtitle: `${report.event.dateLabel}${report.event.time ? ` · ${report.event.time}` : ''}`,
    bodyHtml: parts.join(''),
    footerNote: `Your batch${report.batchNames.length === 1 ? '' : 'es'}: ${report.batchNames.join(', ')}. `
      + 'You are receiving this because these contacts are assigned to you.',
  });

  const textLines = [
    heading,
    `${report.event.title} · ${report.event.dateLabel}`,
    '',
    `You called ${report.called} · came ${report.attended} · did not come ${report.absent} · to call back ${report.chaseCount}`,
    '',
  ];
  for (const g of groupDefs) {
    const rows = report.groups[g.key] || [];
    if (!rows.length) continue;
    textLines.push(`${g.label.toUpperCase()} (${rows.length})`);
    rows.forEach((r) => {
      textLines.push(`  ${r.name} ${r.mobile || '(no number)'}`
        + `${r.mandal ? ` · ${r.mandal}` : ''}${r.area ? ` · ${r.area}` : ''}`
        + ` — said "${r.said || 'nothing'}"`);
    });
    textLines.push('');
  }

  return { subject, html, text: textLines.join('\n') };
}

// ── Birthday / anniversary summary ──────────────────────────────────────────

function waButton(url, label) {
  return `<a href="${esc(url)}" style="display:inline-block;background:#128C7E;color:#ffffff;text-decoration:none;`
    + `padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;">${esc(label)}</a>`;
}

/**
 * buildBirthdayReport(data) — the morning "wish them today" list.
 *
 * Each row carries a real wa.me link so a karyakar can send the wish straight
 * from the email on a phone. The legacy version listed names only and left
 * everyone to look the number up in the sheet.
 */
function buildBirthdayReport(data, opts = {}) {
  const solo = opts.forVolunteer || null;
  const heading = `Birthdays & anniversaries — ${data.dateLabel}`;
  const parts = [];

  if (solo) {
    parts.push(`<div style="color:${MUTED};font-size:13px;margin-bottom:4px;">`
      + `Birthdays and anniversaries of contacts in your assigned area and mandal today — please send them your wishes.`
      + `</div>`);
  }

  parts.push(tiles([
    { label: 'Birthdays', value: data.birthdays.length, tone: ORANGE },
    { label: 'Anniversaries', value: data.anniversaries.length, tone: '#7c3aed' },
    { label: 'Total to wish', value: data.birthdays.length + data.anniversaries.length },
  ]));

  if (data.birthdays.length) {
    parts.push(sectionTitle(`Birthdays (${data.birthdays.length})`));
    parts.push(table(['Name', 'Turning', 'Mandal', 'Wish'],
      data.birthdays.map((p) => [
        esc(p.name) + (p.mobile ? `<div style="color:${MUTED};font-size:11px;">${esc(p.mobile)}</div>` : ''),
        p.age != null ? String(p.age) : '-',
        esc(p.mandal || '-'),
        p.waUrl ? waButton(p.waUrl, 'WhatsApp') : '<span style="color:#94a3b8;font-size:12px;">no number</span>',
      ])));
  }

  if (data.anniversaries.length) {
    parts.push(sectionTitle(`Anniversaries (${data.anniversaries.length})`));
    parts.push(table(['Name', 'Years', 'Mandal', 'Wish'],
      data.anniversaries.map((p) => [
        esc(p.name) + (p.mobile ? `<div style="color:${MUTED};font-size:11px;">${esc(p.mobile)}</div>` : ''),
        p.years != null ? String(p.years) : '-',
        esc(p.mandal || '-'),
        p.waUrl ? waButton(p.waUrl, 'WhatsApp') : '<span style="color:#94a3b8;font-size:12px;">no number</span>',
      ])));
  }

  if (!data.birthdays.length && !data.anniversaries.length) {
    parts.push(`<div style="color:${MUTED};font-size:13px;">Nobody to wish today.</div>`);
  }

  const html = shell({
    title: heading,
    subtitle: solo ? esc(solo.name) : 'Jai Swaminarayan',
    bodyHtml: parts.join(''),
  });

  const text = [
    heading,
    '',
    'Birthdays:',
    ...(data.birthdays.length ? data.birthdays.map((p) => `  ${p.name}${p.age != null ? ` (turning ${p.age})` : ''} ${p.mobile || ''}`) : ['  none']),
    '',
    'Anniversaries:',
    ...(data.anniversaries.length ? data.anniversaries.map((p) => `  ${p.name}${p.years != null ? ` (${p.years} years)` : ''} ${p.mobile || ''}`) : ['  none']),
  ].join('\n');

  const subject = solo ? `Your birthdays & anniversaries to wish — ${data.dateLabel}` : heading;
  return { subject, html, text };
}

// ── Weekly sabha coverage digest ────────────────────────────────────────────

/**
 * PHASE 33 — the track record, as an email.
 *
 * "automatically sabha creation will help in seeing track record which area and
 *  which day sabha not happen. so easy to fallow up there Volunteer."
 *
 * The All Area Sabhas screen answers that for whoever opens it; this answers it
 * for the people who never do. Which is why the follow-up list comes FIRST and
 * the full grid second: a report that opens with a wall of green teaches its
 * readers that there is nothing in it for them, and by the time a mandal has
 * genuinely stopped meeting nobody is reading it any more.
 */
const COVERAGE_COLORS = {
  held: '#16a34a',
  unmarked: '#f59e0b',
  missed: '#dc2626',
  none: '#eef2f6',
};

const COVERAGE_LABELS = {
  held: 'Held',
  unmarked: 'No attendance marked',
  missed: 'No sabha',
};

/** One coverage row as a strip of coloured week cells. Table cells, not spans —
 *  Outlook's Word renderer drops the height on an inline-block.
 *
 *  The `title` is set only on weeks that went wrong. A tooltip nobody hovers is
 *  worth ~40 bytes on every cell, and in a city-sized grid that is most of the
 *  message; on a red or amber cell it is the one place the exact date survives
 *  for a screen reader, so those keep it. */
function coverageStrip(cells) {
  const tds = cells.map((c) => {
    const bg = c ? COVERAGE_COLORS[c.status] : COVERAGE_COLORS.none;
    const title = c && c.status !== 'held'
      ? ` title="${esc(`${c.date}: ${COVERAGE_LABELS[c.status]}`)}"`
      : '';
    return `<td width="16"${title} style="width:16px;padding:0 2px 0 0;">`
      + `<div style="height:16px;border-radius:3px;background:${bg};font-size:1px;line-height:16px;">&nbsp;</div></td>`;
  }).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${tds}</tr></table>`;
}

/**
 * How many schedules the week-by-week grid will draw.
 *
 * Gmail clips a message over 102 KB behind a "View entire message" link, and a
 * clipped report looks broken in exactly the way that stops people opening the
 * next one. Each grid row costs ~1.5 KB, so an unbounded grid breaks somewhere
 * around sixty schedules — which BAPS Jaipur will pass.
 *
 * The grid is reference material; the follow-up table above it is the task, and
 * that one is never truncated. Rows arrive sorted worst-first, so what falls off
 * the end is always the healthiest. The plain-text alternative keeps every row.
 */
const GRID_ROW_LIMIT = 30;

function coverageLegend() {
  const item = (color, label) => `<span style="white-space:nowrap;margin-right:12px;">`
    + `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};"></span>`
    + `<span style="color:${MUTED};font-size:11px;">&nbsp;${esc(label)}</span></span>`;
  return `<div style="margin:8px 0 0;">
    ${item(COVERAGE_COLORS.held, 'Held')}
    ${item(COVERAGE_COLORS.unmarked, 'Not marked')}
    ${item(COVERAGE_COLORS.missed, 'No sabha')}
    ${item(COVERAGE_COLORS.none, 'None due')}
  </div>`;
}

function lastHeldLabel(row, fmt) {
  if (row.lastHeld) return fmt(row.lastHeld);
  return row.dueTotal ? 'not once' : '—';
}

/**
 * buildSabhaCoverageReport(data, opts)
 *
 * @param {object} data from lib/sabhaCoverage.loadSabhaCoverage()
 * @param {object} [opts]
 * @param {object} [opts.forVolunteer] {id, name} — renders the narrowed copy for
 *   one mandal head instead of the org-wide digest.
 * @param {function} [opts.formatDate] 'YYYY-MM-DD' → '13 Sep'
 */
function buildSabhaCoverageReport(data, opts = {}) {
  const solo = opts.forVolunteer || null;
  const fmt = opts.formatDate || ((d) => String(d || '—'));
  const rows = data.rows || [];
  const followUps = rows.filter((r) => r.needsFollowUp);
  const totals = data.totals || {};

  const heading = solo
    ? `Your sabhas — ${data.periodLabel}`
    : `Sabha coverage — ${data.periodLabel}`;
  const subject = followUps.length
    ? `${heading} · ${followUps.length} need${followUps.length === 1 ? 's' : ''} a call`
    : heading;

  const parts = [];

  parts.push(`<div style="color:${MUTED};font-size:13px;line-height:1.6;margin-bottom:14px;">`
    + `The last ${data.weeksBack} completed weeks, ${esc(data.periodLabel)}. `
    + (solo
      ? 'Only the sabhas you are responsible for. '
      : 'Every recurring sabha in the city. ')
    + 'This week is not included — it has not finished yet.'
    + '</div>');

  parts.push(tiles([
    { label: 'Sabhas due', value: totals.due || 0 },
    { label: 'Held', value: totals.held || 0, tone: COVERAGE_COLORS.held },
    { label: 'Not held', value: (totals.missed || 0) + (totals.unmarked || 0), tone: COVERAGE_COLORS.missed },
    { label: 'Need a call', value: followUps.length, tone: followUps.length ? ORANGE : SLATE },
  ]));

  if (!rows.length) {
    parts.push(`<div style="color:${MUTED};font-size:13px;padding:14px;border:1px dashed ${BORDER};border-radius:8px;text-align:center;">`
      + 'No recurring sabhas are set up yet. Add one under Events → All Area Sabhas.'
      + '</div>');
  } else {
    // ── The follow-up list, first, because it is the only part that is a task.
    if (followUps.length) {
      parts.push(sectionTitle(solo ? 'Chase these' : 'Needs a call'));
      parts.push(`<div style="color:${MUTED};font-size:12px;margin:-4px 0 8px;">`
        + 'Two or more scheduled sabhas in a row with nothing recorded. Either the sabha stopped, or it happened and nobody marked attendance — both are worth one phone call.'
        + '</div>');
      parts.push(table(
        ['Area', 'Mandal', 'Missed in a row', 'Last held'],
        followUps.map((r) => [
          esc(r.area),
          esc(r.mandal),
          `<strong style="color:${COVERAGE_COLORS.missed}">${r.missStreak}</strong>`,
          esc(lastHeldLabel(r, fmt)),
        ]),
      ));
    } else {
      parts.push(sectionTitle('Nothing to chase'));
      parts.push(`<div style="color:#166534;font-size:13px;padding:12px 14px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;">`
        + 'Every recurring sabha met, or missed at most one week. Nothing needs following up.'
        + '</div>');
    }

    // ── The grid.
    parts.push(sectionTitle(`Week by week`));
    const gridHead = `<tr>
      <th align="left" style="padding:7px 10px;border-bottom:1px solid ${BORDER};color:${MUTED};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Sabha</th>
      <th align="left" style="padding:7px 10px;border-bottom:1px solid ${BORDER};color:${MUTED};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">${esc(data.weeks.length ? `${data.weeks[0].label} → ${data.weeks[data.weeks.length - 1].label}` : '')}</th>
      <th align="right" style="padding:7px 10px;border-bottom:1px solid ${BORDER};color:${MUTED};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Held</th>
    </tr>`;
    const gridRows = rows.slice(0, GRID_ROW_LIMIT);
    const gridBody = gridRows.map((r) => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:${SLATE};font-size:13px;">
        <div style="font-weight:600;">${esc(r.area)}${r.paused ? ` <span style="color:${MUTED};font-weight:400;font-size:11px;">(paused)</span>` : ''}</div>
        <div style="color:${MUTED};font-size:11px;">${esc(r.mandal)} · ${esc(r.cadence)}</div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;">${coverageStrip(r.cells)}</td>
      <td align="right" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:${SLATE};font-size:13px;white-space:nowrap;">
        ${r.held}<span style="color:${MUTED};">/${r.dueTotal}</span>
      </td>
    </tr>`).join('');
    parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;border-collapse:separate;overflow:hidden;"><thead>${gridHead}</thead><tbody>${gridBody}</tbody></table>`);
    parts.push(coverageLegend());

    const hidden = rows.length - gridRows.length;
    if (hidden > 0) {
      parts.push(`<div style="margin-top:8px;color:${MUTED};font-size:12px;">`
        + `Showing the ${gridRows.length} sabhas needing the most attention. `
        + `${hidden} more ${hidden === 1 ? 'is' : 'are'} further down the list — open Events → All Area Sabhas for the full grid.`
        + '</div>');
    }

    if (!data.attendanceKnown) {
      parts.push(`<div style="margin-top:10px;color:#854d0e;font-size:12px;padding:10px 12px;border:1px solid #fde68a;background:#fefce8;border-radius:8px;">`
        + 'There were too many sabhas in this window to check attendance on each one, so a green week here means the sabha existed — not that anybody was marked present.'
        + '</div>');
    }

    // ── What is coming, so the email is also a nudge and not only a scolding.
    const upcoming = rows.filter((r) => r.nextDate).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
    if (upcoming.length) {
      parts.push(sectionTitle('Next up'));
      parts.push(table(
        ['Area', 'Mandal', 'When'],
        upcoming.slice(0, 20).map((r) => [
          esc(r.area),
          esc(r.mandal),
          `${esc(fmt(r.nextDate))}${r.time ? esc(` · ${r.time}`) : ''}`,
        ]),
      ));
    }

    if (totals.paused) {
      parts.push(`<div style="margin-top:12px;color:${MUTED};font-size:12px;">`
        + `${totals.paused} schedule${totals.paused === 1 ? ' is' : 's are'} paused. Paused sabhas keep their history but create nothing new, and are never counted as needing a call.`
        + '</div>');
    }
  }

  const html = shell({
    title: heading,
    subtitle: 'Jai Swaminarayan',
    bodyHtml: parts.join(''),
    footerNote: solo
      ? 'You are receiving this because you manage these sabhas.'
      : null,
  });

  const textLines = [
    heading,
    '',
    `Due ${totals.due || 0} · held ${totals.held || 0} · not held ${(totals.missed || 0) + (totals.unmarked || 0)} · need a call ${followUps.length}`,
    '',
  ];
  if (followUps.length) {
    textLines.push('NEEDS A CALL');
    followUps.forEach((r) => {
      textLines.push(`  ${r.area} · ${r.mandal} — ${r.missStreak} in a row, last held ${lastHeldLabel(r, fmt)}`);
    });
    textLines.push('');
  }
  textLines.push('EVERY SABHA');
  rows.forEach((r) => {
    textLines.push(`  ${r.area} · ${r.mandal} (${r.cadence})${r.paused ? ' [paused]' : ''} — held ${r.held}/${r.dueTotal}, last ${lastHeldLabel(r, fmt)}`);
  });
  if (!rows.length) textLines.push('  no recurring sabhas set up yet');

  return { subject, html, text: textLines.join('\n') };
}

module.exports = {
  buildDailyReport,
  buildPostSabhaReport,
  buildSkBatchReport,
  buildBirthdayReport,
  buildSabhaCoverageReport,
  statusPill,
  statusLabel,
  STATUS_DISPLAY,
  esc,
  shell,
};
