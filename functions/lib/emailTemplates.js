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
 * The X/Y column is the legacy app's 12-month attendance ratio: how many of the
 * last 12 months' sabhas this person attended, out of how many were held. It is
 * the number the sanchalak actually looks at, so it stays in the first table.
 */
function buildPostSabhaReport(report, opts = {}) {
  const solo = opts.forVolunteer || null;
  const heading = `${report.event.title} — attendance`;
  const parts = [];

  parts.push(tiles([
    { label: 'Present', value: report.present.length, tone: '#16a34a' },
    { label: 'Expected', value: report.expected, tone: SLATE },
    { label: 'Turnout', value: `${report.turnoutPct}%`, tone: ORANGE },
    { label: 'First timers', value: report.firstTimers.length },
  ]));

  parts.push(`<div style="color:${MUTED};font-size:13px;margin-bottom:4px;">`
    + `${esc(report.event.dateLabel)}${report.event.time ? ` at ${esc(report.event.time)}` : ''}`
    + `${report.event.mandal ? ` · ${esc(report.event.mandal)}` : ''}`
    + `${report.event.area ? ` · ${esc(report.event.area)}` : ''}`
    + `${report.event.speaker ? `<br>Speaker: ${esc(report.event.speaker)}` : ''}`
    + `</div>`);

  parts.push(sectionTitle(`Present (${report.present.length})`));
  parts.push(table(['Name', 'Mandal', 'Last 12 months'],
    report.present.map((p) => [
      esc(p.name) + (p.isFirstTimer ? ` <span style="color:${ORANGE};font-size:11px;font-weight:700;">NEW</span>` : ''),
      esc(p.mandal || '-'),
      `${p.attended}/${p.held}`,
    ])));

  if (report.regularsAbsent.length) {
    parts.push(sectionTitle(`Regulars who did not come (${report.regularsAbsent.length})`));
    parts.push(`<div style="color:${MUTED};font-size:12px;margin-bottom:6px;">Attended at least half of the last 12 months' sabhas but were not marked present today — worth a call.</div>`);
    parts.push(table(['Name', 'Mandal', 'Last 12 months'],
      report.regularsAbsent.map((p) => [esc(p.name), esc(p.mandal || '-'), `${p.attended}/${p.held}`])));
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
    `Present: ${report.present.length} of ${report.expected} expected (${report.turnoutPct}%).`,
    '',
    ...report.present.map((p) => `  ${p.name} (${p.attended}/${p.held})`),
  ].join('\n');

  return { subject: heading, html, text };
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
function buildBirthdayReport(data) {
  const heading = `Birthdays & anniversaries — ${data.dateLabel}`;
  const parts = [];

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
    subtitle: 'Jai Swaminarayan',
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

  return { subject: heading, html, text };
}

module.exports = {
  buildDailyReport,
  buildPostSabhaReport,
  buildBirthdayReport,
  statusPill,
  statusLabel,
  STATUS_DISPLAY,
  esc,
  shell,
};
