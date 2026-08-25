// src/lib/volunteerExports.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 25 — the karyakarta roster as a CSV and as a printable PDF directory.
//
// WHY THIS EXISTS. Until now the volunteer list lived only on screen. Every
// offline use of it — handing a sanchalak the list of area heads, checking who
// has never signed in, printing a phone list for a padhramani weekend — meant
// copying names out by hand. And the one question this data answers that nothing
// else can, "which area has nobody assigned to it", was invisible: the screen
// lists volunteers, so an area with zero of them simply doesn't appear.
// computeVolunteerStats() therefore takes the full areas/mandals lists and
// reports the GAPS, not just the tallies.
//
// The PDF has two layers for this on purpose. The bar charts near the top are
// capped at five rows and answer "where are most karyakartas" at a glance. The
// "Coverage by area" and "Coverage by mandal" tables that follow are complete —
// every area with its sub-areas indented beneath it, every mandal, staffed or
// not, with the holders named. A capped list is useless for the question those
// tables exist for, because the row you need is the one that got cut.
//
// The look deliberately matches src/lib/eventExports.js — navy band, gold
// hairline, stat cards, zebra table — because these two are the documents that
// leave the app, and they should read as coming from the same place. Its two
// hard-won constraints apply here unchanged:
//
//   • jsPDF's built-in Helvetica is CP1252 only, so every string goes through
//     toLatin(); a Devanagari name would otherwise render as blank boxes.
//   • The CSV carries a UTF-8 BOM, or Excel on Windows reads it as CP1252.
//
// LANDSCAPE, unlike the event report. A roster row is name + mobile + roles +
// areas + mandals + access + last login; on portrait A4 the areas column ends up
// about 25 mm wide and wraps every multi-area assignment onto four lines.
// ─────────────────────────────────────────────────────────────────────────────
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toLatin } from './pdfText';
import { resolveScope, describeScope, SCOPE_KINDS, SCOPE_KIND_META } from './scope';
import { expandLegacyPermissions } from '../constants/permissions';
import { isSantoRole } from '../constants/roleTemplates';

const NAVY = [15, 23, 42];
const NAVY_SOFT = [30, 41, 59];
const GOLD = [217, 164, 65];
const ORANGE = [234, 88, 12];
const INK = [51, 65, 85];
const MUTED = [148, 163, 184];
const PAPER = [248, 250, 252];
const EMERALD = [16, 185, 129];
const ROSE = [244, 63, 94];

const PAGE_W = 297; // A4 landscape
const PAGE_H = 210;
const M = 12;
const INNER_W = PAGE_W - M * 2;
// First safe baseline on a continuation page — clear of the 13.7mm slim band.
const TOP_SLIM = 19;

const DAY = 86400000;

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Firestore Timestamp | Date | string | null → Date | null */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Anything outside CP1252 becomes '?' — see the header note. Lives in
 *  pdfText.js so this and the event report can't drift apart on it. */

function dateLabel(date) {
  if (!date) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3d ago" / "just now" — the same vocabulary the roster shows on screen. */
function agoLabel(date) {
  if (!date) return '';
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return dateLabel(date);
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

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

// ── Row + stat building ──────────────────────────────────────────────────────

/** roleRefs[] is authoritative; roleRef is the pre-Phase-21 single-role field. */
function roleIdsOf(v) {
  const many = Array.isArray(v?.roleRefs) ? v.roleRefs.filter(Boolean) : [];
  if (many.length) return [...new Set(many)];
  return v?.roleRef ? [v.roleRef] : [];
}

/**
 * One flat row per volunteer, with everything both exports need already resolved
 * — so the CSV and the PDF can never disagree about who holds what.
 *
 * The access column comes from resolveScope(), the same function the app itself
 * scopes queries with, rather than from the `scopeKind` stamped on the volunteer:
 * a stale stamp is exactly the thing an admin reads this report to find.
 *
 * @param {object} p
 * @param {Array}  p.volunteers
 * @param {object} p.rolesById   id → role document
 */
export function buildVolunteerRows({ volunteers = [], rolesById = {} }) {
  return volunteers
    .map((v) => {
      const roles = roleIdsOf(v).map((id) => rolesById[id]).filter(Boolean);
      const rankOf = (r) => (Number.isFinite(r?.rank) ? r.rank : 50);
      const ordered = [...roles].sort((a, b) => rankOf(b) - rankOf(a));
      const permissions = expandLegacyPermissions(
        [...new Set(ordered.flatMap((r) => (Array.isArray(r.permissions) ? r.permissions : [])))],
      );
      const scope = resolveScope({ roles: ordered, volunteer: v, permissions });

      const lastLogin = toDate(v.lastLoginAt);
      const lastSeen = toDate(v.lastSeenAt);

      return {
        id: v.id,
        name: v.name || 'Unnamed',
        mobile: v.mobile || '',
        reportEmail: v.reportEmail || '',
        roles: ordered.map((r) => r.name).filter(Boolean),
        roleLabel: ordered.map((r) => r.name).filter(Boolean).join(' + ') || 'No role',
        areas: Array.isArray(v.assignedAreas) ? v.assignedAreas.filter(Boolean) : [],
        mandals: Array.isArray(v.assignedMandals) ? v.assignedMandals.filter(Boolean) : [],
        accessShort: SCOPE_KIND_META[scope.kind]?.short || scope.kind,
        accessLong: describeScope(scope),
        // "Configured to see nothing" and "misconfigured, so sees nothing by
        // accident" both come back as scope.empty, and only the second is a
        // problem. A Santo's NONE scope is the whole point of that role — flagging
        // it made the warning banner cry wolf on every Santo account.
        scopeEmpty: scope.empty && !scope.unrestricted && scope.kind !== SCOPE_KINDS.NONE,
        noAccessByDesign: scope.kind === SCOPE_KINDS.NONE,
        // A Santo is city-wide, like an Admin — not a karyakarta with no
        // territory. Every count and table in this file keys off this flag; see
        // isSantoRole() for why it isn't decided by the role's name.
        isSanto: isSantoRole({
          scopeKind: scope.kind === SCOPE_KINDS.NONE ? SCOPE_KINDS.NONE : null,
          permissions,
        }),
        isActive: v.isActive !== false,
        lastLogin,
        lastLoginLabel: lastLogin ? agoLabel(lastLogin) : 'Never',
        lastLoginExact: lastLogin ? lastLogin.toLocaleString('en-IN') : '',
        lastSeen,
        // Same 5-minute window the roster uses for its green dot, so the report
        // and the screen never disagree about who is online.
        isLive: Boolean(lastSeen) && (Date.now() - lastSeen.getTime()) < 5 * 60 * 1000,
        linkedIndividualId: v.linkedIndividualId || '',
      };
    })
    // Active first, then A→Z. NOT "most recently seen first", tempting as that is:
    // the roster on screen renders from these same rows and is mostly used to find
    // one named person, which a list that reorders itself as people log in makes
    // needlessly hard. Disabled logins sink to the bottom rather than disappearing.
    .sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || a.name.localeCompare(b.name));
}

/**
 * Accepts area/mandal DOCUMENTS — `{ name, code, subAreas: [{name, code}] }` —
 * or bare name strings, because the two callers historically passed names and the
 * sub-area listing needs the documents. Normalising here means neither caller has
 * to care which it holds.
 */
function toTaxonomyList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      if (typeof item === 'string') return { name: item, code: '', subAreas: [] };
      return {
        name: item?.name || '',
        code: item?.code || '',
        subAreas: (Array.isArray(item?.subAreas) ? item.subAreas : [])
          .map((s) => (typeof s === 'string' ? { name: s, code: '' } : { name: s?.name || '', code: s?.code || '' }))
          .filter((s) => s.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .filter((t) => t.name);
}

/**
 * Summary numbers, plus the two coverage gaps that only this data can show.
 *
 * @param {object} p
 * @param {Array}  p.rows     from buildVolunteerRows() — the set being reported on
 * @param {Array}  p.areas    every area — documents (preferred) or names
 * @param {Array}  p.mandals  every mandal — documents (preferred) or names
 * @param {Array}  [p.coverageRows] the WHOLE roster, when `rows` is a filtered
 *   subset. Coverage has to be measured against everyone: filtered to "Area:
 *   Sanganer", `rows` holds only Sanganer's karyakartas, so measuring gaps from it
 *   would report all 16 other areas as unstaffed. Defaults to `rows`.
 *
 * SANTOS ARE NOT COUNTED. Every number below describes karyakartas only. A Santo
 * is city-wide, like an Admin, and holds no area or mandal by design — counting
 * them added one person to "N with no area assigned" for every Santo on the
 * roster, which is a gap that cannot be closed and therefore noise. `santo`
 * reports how many were set aside so nothing disappears silently.
 */
export function computeVolunteerStats({ rows = [], areas = [], mandals = [], coverageRows = null }) {
  const areaList = toTaxonomyList(areas);
  const mandalList = toTaxonomyList(mandals);

  const karyakartas = rows.filter((r) => !r.isSanto);
  const coverageBase = (coverageRows || rows).filter((r) => !r.isSanto);

  const tally = (pick) => {
    const map = {};
    karyakartas.forEach((r) => {
      const values = pick(r);
      if (!values.length) { map['— none assigned —'] = (map['— none assigned —'] || 0) + 1; return; }
      values.forEach((v) => { map[v] = (map[v] || 0) + 1; });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  /**
   * One entry per taxonomy value THAT EXISTS, staffed or not, carrying the names
   * of who holds it — which is the difference between a chart and something an
   * admin can act on. tally() above can't be reused: it only ever sees values
   * someone is assigned to, so a completely unstaffed area is absent from it, and
   * that absence is the single most important thing this report has to say.
   *
   * Built from the WHOLE roster, never the filter. Filtered to "Area: Sanganer",
   * `rows` holds only Sanganer's karyakartas — measuring coverage from it would
   * print all 18 other areas as unstaffed, which is the same trap `coverageRows`
   * was added for. Coverage is a fact about the organisation, not about what you
   * are currently looking at.
   *
   * `count` counts ACTIVE holders only, so a zero here means exactly the same
   * thing as membership in uncoveredAreas/uncoveredMandals — the two can't
   * contradict each other. A disabled holder still appears by name, tagged, so
   * "0 — Ramesh Patel (disabled)" tells the whole story on one line.
   */
  const buildCoverage = (taxonomy, pick) => {
    const base = coverageBase;
    const holders = new Map();
    base.forEach((r) => {
      pick(r).forEach((v) => {
        if (!holders.has(v)) holders.set(v, []);
        holders.get(v).push(r);
      });
    });
    const held = (name) => holders.get(name) || [];
    const describe = (list) => list.map((r) => (r.isActive ? r.name : `${r.name} (disabled)`));

    const known = new Set(taxonomy.map((t) => t.name));
    const entries = taxonomy.map((t) => ({
      ...t,
      count: held(t.name).filter((r) => r.isActive).length,
      names: describe(held(t.name)),
      orphan: false,
    }));

    // A value stamped on a volunteer that the taxonomy no longer contains — a
    // rename that didn't cascade, or a deleted area. It gets a row of its own
    // rather than being dropped: dropping it is how it stays broken, invisibly.
    [...holders.keys()]
      .filter((name) => !known.has(name))
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        entries.push({
          name,
          code: '',
          subAreas: [],
          count: held(name).filter((r) => r.isActive).length,
          names: describe(held(name)),
          orphan: true,
        });
      });

    const stray = base.filter((r) => !pick(r).length);
    return {
      entries: entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      unassigned: { count: stray.length, names: describe(stray) },
      // True when the numbers here describe more people than the table above them.
      wholeRoster: base.length !== karyakartas.length,
    };
  };

  const active = karyakartas.filter((r) => r.isActive);
  const activeEverywhere = coverageBase.filter((r) => r.isActive);
  const uncovered = (list, pick) => {
    // Only ACTIVE volunteers count as coverage — an area whose only karyakarta has
    // a disabled login is uncovered in every sense that matters.
    const held = new Set(activeEverywhere.flatMap(pick));
    return list.filter((t) => !held.has(t.name)).map((t) => t.name);
  };

  return {
    total: karyakartas.length,
    active: active.length,
    disabled: karyakartas.length - active.length,
    live: karyakartas.filter((r) => r.isLive).length,
    never: karyakartas.filter((r) => !r.lastLogin).length,
    week: karyakartas.filter((r) => r.lastLogin && Date.now() - r.lastLogin.getTime() < 7 * DAY).length,
    month: karyakartas.filter((r) => r.lastLogin && Date.now() - r.lastLogin.getTime() < 30 * DAY).length,
    // A scoped volunteer with no territory can see nothing at all, which looks to
    // them like the app being broken. Worth a number of its own.
    stranded: karyakartas.filter((r) => r.isActive && r.scopeEmpty).length,
    // Set aside, not lost. Printed as a one-liner wherever `total` is shown so a
    // roster of 22 logins reading "19 karyakartas" is explained rather than odd.
    santo: rows.length - karyakartas.length,
    santoEverywhere: (coverageRows || rows).length - coverageBase.length,
    byRole: tally((r) => r.roles),
    byArea: tally((r) => r.areas),
    byMandal: tally((r) => r.mandals),
    areaCoverage: buildCoverage(areaList, (r) => r.areas),
    mandalCoverage: buildCoverage(mandalList, (r) => r.mandals),
    subAreaTotal: areaList.reduce((n, a) => n + a.subAreas.length, 0),
    uncoveredAreas: uncovered(areaList, (r) => r.areas),
    uncoveredMandals: uncovered(mandalList, (r) => r.mandals),
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'reportEmail', label: 'Report Email' },
  { key: 'roleLabel', label: 'Roles' },
  { key: 'accessShort', label: 'Access Shape' },
  { key: 'accessLong', label: 'Access Covers' },
  { key: 'areasLabel', label: 'Assigned Areas' },
  { key: 'mandalsLabel', label: 'Assigned Mandals' },
  { key: 'statusLabel', label: 'Login Status' },
  { key: 'lastLoginLabel', label: 'Last Login' },
  { key: 'lastLoginExact', label: 'Last Login (exact)' },
  { key: 'linkedIndividualId', label: 'Linked Contact ID' },
];

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** Areas/mandals are joined with "; " — a comma inside a quoted CSV cell is
 *  legal but every hand-written parser downstream gets it wrong. */
function csvRow(r) {
  return {
    ...r,
    areasLabel: r.areas.join('; '),
    mandalsLabel: r.mandals.join('; '),
    statusLabel: r.isActive ? (r.isLive ? 'Active (online now)' : 'Active') : 'Disabled',
  };
}

export function buildVolunteerCsv({ rows = [], stats, filterLabel = '' }) {
  // Santos are excluded here for the same reason as in the PDF: this is a
  // karyakarta roster with Assigned Areas / Assigned Mandals columns, and a Santo
  // has neither by design. The meta block says so rather than leaving the reader
  // to wonder why three logins they know about are missing.
  const roster = rows.filter((r) => !r.isSanto);
  const santoCount = rows.length - roster.length;

  const meta = [
    ['Report', 'BAPS Jaipur MDS — Karyakarta roster'],
    ['Rows', String(roster.length)],
    ['Filter', filterLabel || 'None (all volunteers)'],
    ['Active', String(stats?.active ?? '')],
    ['Disabled', String(stats?.disabled ?? '')],
    ['Never signed in', String(stats?.never ?? '')],
    ['Santo logins excluded', santoCount ? `${santoCount} (city-wide, hold no area or mandal)` : 'None'],
    ['Areas with nobody assigned', (stats?.uncoveredAreas || []).join('; ') || 'None'],
    ['Mandals with nobody assigned', (stats?.uncoveredMandals || []).join('; ') || 'None'],
    ['Generated', new Date().toLocaleString('en-IN')],
  ].map(([k, v]) => `${csvCell(k)},${csvCell(v)}`);

  const header = CSV_COLUMNS.map((c) => csvCell(c.label)).join(',');
  const body = roster.map(csvRow).map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(','));

  // Meta block, blank line, then the table — Excel and Sheets both import this
  // cleanly and the reader gets the context without trusting the filename.
  return [...meta, '', header, ...body].join('\r\n');
}

export function exportVolunteerCsv({ rows, stats, filterLabel }) {
  // ﻿ = UTF-8 BOM. See the header note on Excel.
  downloadBlob(
    `﻿${buildVolunteerCsv({ rows, stats, filterLabel })}`,
    `volunteers-${stamp()}.csv`,
    'text/csv;charset=utf-8',
  );
}

// ── PDF ──────────────────────────────────────────────────────────────────────

function drawHeroHeader(pdf, stats, filterLabel) {
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, PAGE_W, 40, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 40, PAGE_W, 1.1, 'F');

  pdf.setTextColor(...GOLD);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('BAPS JAIPUR MDS  ·  KARYAKARTA ROSTER', M, 12);

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(19);
  pdf.text('Volunteers & Access', M, 24, { maxWidth: INNER_W - 60 });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(203, 213, 225);
  const line = [
    filterLabel || 'All volunteers',
    `${stats.active} active`,
    stats.disabled ? `${stats.disabled} disabled` : null,
    new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
  ].filter(Boolean).join('   ·   ');
  pdf.text(toLatin(line), M, 32, { maxWidth: INNER_W - 60 });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(30);
  pdf.setTextColor(255, 255, 255);
  pdf.text(String(stats.total), PAGE_W - M, 25, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GOLD);
  pdf.text('KARYAKARTAS', PAGE_W - M, 31, { align: 'right' });
}

function drawSlimHeader(pdf) {
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, PAGE_W, 13, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 13, PAGE_W, 0.7, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('Volunteers & Access', M, 8.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...GOLD);
  pdf.text('BAPS Jaipur MDS', PAGE_W - M, 8.5, { align: 'right' });
}

function drawStatCard(pdf, x, y, w, h, label, value, sub, accent) {
  pdf.setFillColor(...PAPER);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(x, y, w, h, 1.8, 1.8, 'FD');
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
    pdf.text(toLatin(sub), x + 4.5, y + 19, { maxWidth: w - 7 });
  }
}

function drawBreakdown(pdf, x, y, w, title, entries, total, limit = 5, moreNote = null) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...NAVY);
  pdf.text(toLatin(title), x, y);

  let cursor = y + 4.8;
  const shown = entries.slice(0, limit);
  shown.forEach(([name, count]) => {
    const share = total ? count / total : 0;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.6);
    pdf.setTextColor(...INK);
    pdf.text(toLatin(name), x, cursor, { maxWidth: w * 0.5 });
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(count), x + w, cursor, { align: 'right' });

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

  if (!shown.length) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(7);
    pdf.setTextColor(...MUTED);
    pdf.text('Nothing assigned yet', x, cursor);
    cursor += 5;
  } else if (entries.length > shown.length) {
    // This top-5 exists to be glanced at, so it stays capped — but a bare
    // "+14 more" reads as "the rest is not in this document". It is: the note
    // says which section carries every single row.
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(6.8);
    pdf.setTextColor(...MUTED);
    const text = `+ ${entries.length - shown.length} more${moreNote ? ` — ${moreNote}` : ''}`;
    const wrapped = pdf.splitTextToSize(toLatin(text), w);
    pdf.text(wrapped, x, cursor);
    cursor += wrapped.length * 3.4 + 1;
  }
  return cursor;
}

/** The coverage gap, as prose rather than a bar chart — it is a list of names an
 *  admin has to act on, and zero of them is the good case worth stating. */
function drawGaps(pdf, x, y, w, stats) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...NAVY);
  pdf.text('Coverage gaps', x, y);

  let cursor = y + 4.8;
  const lines = [
    ['Areas with nobody assigned', stats.uncoveredAreas],
    ['Mandals with nobody assigned', stats.uncoveredMandals],
  ];

  lines.forEach(([label, list]) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.2);
    pdf.setTextColor(...MUTED);
    pdf.text(toLatin(`${label} (${list.length})`), x, cursor);
    cursor += 3.8;
    pdf.setFontSize(7.6);
    pdf.setTextColor(...(list.length ? ROSE : EMERALD));
    const text = list.length ? list.join(', ') : 'All covered';
    const wrapped = pdf.splitTextToSize(toLatin(text), w);
    // Capped at three lines so the two gap lists and the stranded warning all fit
    // beside the bar charts. When it bites, the count in the label above already
    // says how many there are and the tables below name every one of them — but
    // say so, because a list that just stops looks complete.
    const shown = wrapped.slice(0, 3);
    if (wrapped.length > 3) shown[2] = `${shown[2].replace(/,?\s*$/, '')} ...`;
    pdf.text(shown, x, cursor);
    cursor += shown.length * 3.6;
    if (wrapped.length > 3) {
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(6.8);
      pdf.setTextColor(...MUTED);
      pdf.text('all of them are flagged in the tables below', x, cursor + 0.6);
      cursor += 3.4;
    }
    cursor += 2.4;
  });

  if (stats.stranded) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.4);
    pdf.setTextColor(...ROSE);
    pdf.text(
      toLatin(`${stats.stranded} active karyakarta(s) have a scoped role but no area/mandal — they can see nothing.`),
      x, cursor, { maxWidth: w },
    );
  }
  return cursor;
}

/**
 * The COMPLETE taxonomy — every area with its sub-areas indented beneath it, or
 * every mandal — deliberately untruncated.
 *
 * WHY A TABLE AND NOT A FOURTH BAR CHART. The bar lists above answer "where are
 * most karyakartas", and capping them at five is right for that. This section
 * answers two different questions — "who covers Vaishali Nagar?" and "which of
 * our 19 areas has nobody?" — and neither survives a "+14 more": the row you
 * need is, by definition, the one you can't see. So every row is here, with the
 * holders named, and a page break is the acceptable cost.
 *
 * SUB-AREAS INHERIT. Karyakartas are assigned to an area, never to a sub-area, so
 * a sub-area's count is its parent's. The rows are indented and the count is
 * greyed to say so without a legend; the note under the title spells it out.
 *
 * @returns {number} the y to continue drawing at
 */
function drawCoverageTable(pdf, {
  title, note, unitLabel, coverage, startY, headPage, withSubAreas = false,
}) {
  let y = startY;
  // Title + note + header + one row ≈ 26mm. A title stranded at the foot of a
  // page with its table overleaf is worse than an early break.
  if (y + 26 > PAGE_H - 14) { pdf.addPage(); headPage(); y = TOP_SLIM; }

  const { entries, unassigned, wholeRoster } = coverage;
  const staffed = entries.filter((e) => e.count > 0).length;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text(toLatin(`${title} (${entries.length})`), M, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.4);
  pdf.setTextColor(...MUTED);
  pdf.text(
    toLatin(`${staffed} staffed  ·  ${entries.length - staffed} with nobody assigned`),
    PAGE_W - M, y, { align: 'right' },
  );
  y += 4.2;

  // The whole-roster caveat can't be left implied. On a filtered report this
  // section counts people the roster table below doesn't list, and an admin
  // comparing the two numbers would otherwise conclude one of them is wrong.
  const fullNote = [
    note,
    wholeRoster ? 'Counts cover the whole roster, not the filter on this report.' : null,
  ].filter(Boolean).join(' ');

  if (fullNote) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(6.9);
    pdf.setTextColor(...MUTED);
    const wrapped = pdf.splitTextToSize(toLatin(fullNote), INNER_W);
    pdf.text(wrapped, M, y);
    y += wrapped.length * 3.2 + 0.6;
  }

  // meta[] runs parallel to body[] so didParseCell can style a row by what it is
  // — autoTable hands back an index, not the source object.
  const meta = [];
  const body = [];

  entries.forEach((e, i) => {
    meta.push({ sub: false, zero: e.count === 0, orphan: e.orphan });
    body.push([
      i + 1,
      toLatin(e.name) + (e.orphan ? '   (not in the list)' : ''),
      toLatin(e.code || '-'),
      String(e.count),
      toLatin(e.names.join(', ') || 'Nobody assigned'),
    ]);
    if (withSubAreas) {
      e.subAreas.forEach((s) => {
        meta.push({ sub: true, zero: e.count === 0, orphan: false });
        // » is CP1252 0xBB, so it survives toLatin — an ASCII-safe indent marker.
        body.push(['', toLatin(`     » ${s.name}`), toLatin(s.code || '-'), String(e.count), '']);
      });
    }
  });

  if (unassigned.count > 0) {
    meta.push({ sub: false, zero: false, orphan: false, stray: true });
    body.push([
      '',
      toLatin(`No ${unitLabel} assigned`),
      '-',
      String(unassigned.count),
      toLatin(unassigned.names.join(', ')),
    ]);
  }

  autoTable(pdf, {
    startY: y,
    margin: { top: TOP_SLIM, left: M, right: M, bottom: 14 },
    head: [['#', withSubAreas ? 'Area / sub-area' : 'Mandal', 'Code', 'Karyakartas', 'Assigned to']],
    body: body.length
      ? body
      : [[{ content: `No ${unitLabel}s configured yet.`, colSpan: 5, styles: { halign: 'center', fontStyle: 'italic', textColor: MUTED } }]],
    styles: { fontSize: 7.8, cellPadding: 1.6, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.6 },
    alternateRowStyles: { fillColor: PAPER },
    columnStyles: {
      0: { cellWidth: 9, halign: 'right', textColor: MUTED },
      1: { cellWidth: 62, fontStyle: 'bold' },
      2: { cellWidth: 16, fontSize: 7.2, textColor: MUTED },
      3: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 'auto', fontSize: 7.2 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const m = meta[data.row.index];
      if (!m) return;
      if (m.sub) {
        // Indented, un-bolded, greyed: a sub-area is a child of the row above,
        // and its number is borrowed rather than its own.
        data.cell.styles.fontStyle = 'normal';
        data.cell.styles.textColor = MUTED;
        data.cell.styles.fontSize = 7.2;
      }
      if (m.stray) {
        data.cell.styles.fontStyle = data.column.index === 1 ? 'italic' : 'normal';
        data.cell.styles.textColor = data.column.index === 3 ? ROSE : MUTED;
      }
      if (m.orphan && data.column.index === 1) data.cell.styles.textColor = ROSE;
      // The whole point of printing every row: an unstaffed one has to be
      // impossible to skim past.
      if (m.zero && !m.sub && data.column.index === 3) {
        data.cell.styles.textColor = ROSE;
      }
      if (m.zero && !m.sub && data.column.index === 4) {
        data.cell.styles.textColor = ROSE;
        data.cell.styles.fontStyle = 'italic';
      }
    },
    didDrawPage: headPage,
  });

  return pdf.lastAutoTable.finalY + 7;
}


/**
 * @param {object} p
 * @param {Array}  p.rows        from buildVolunteerRows()
 * @param {object} p.stats       from computeVolunteerStats()
 * @param {string} [p.filterLabel] what the reader is looking at ("Area: Sanganer")
 */
export function exportVolunteerPdf({ rows = [], stats, filterLabel = '' }) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // The roster lists karyakartas. Santos hold a login but no territory — they are
  // city-wide like an Admin — so printing them in a table whose subject is "who
  // covers which area" made a correctly configured Santo read as a volunteer
  // somebody forgot to assign. Excluded here and counted on the line under the
  // title; see isSantoRole() for why this isn't decided by the role's name.
  const roster = rows.filter((r) => !r.isSanto);
  const santoCount = rows.length - roster.length;

  // Page 1 carries the tall hero band; every page after it gets the slim one.
  // Keyed on the page NUMBER rather than a counter because autoTable fires
  // didDrawPage for the page a table merely starts on as well as ones it creates
  // — with three tables in the document, a counter double-counts and the band
  // lands on the hero page. Nothing here ever revisits an earlier page, so the
  // last page is always the current one.
  const headed = new Set([1]);
  const headPage = () => {
    const page = pdf.getNumberOfPages();
    if (headed.has(page)) return;
    headed.add(page);
    drawSlimHeader(pdf);
  };

  drawHeroHeader(pdf, stats, filterLabel);

  // ── Stat cards ─────────────────────────────────────────────────────────────
  const gap = 4;
  const cardW = (INNER_W - gap * 4) / 5;
  const cardY = 48;
  const cardH = 23;
  const cardX = (i) => M + (cardW + gap) * i;
  drawStatCard(pdf, cardX(0), cardY, cardW, cardH, 'Karyakartas', String(stats.total), 'on the roster', NAVY_SOFT);
  drawStatCard(pdf, cardX(1), cardY, cardW, cardH, 'Active logins', String(stats.active),
    stats.disabled ? `${stats.disabled} disabled` : 'none disabled', EMERALD);
  drawStatCard(pdf, cardX(2), cardY, cardW, cardH, 'Signed in this week', String(stats.week),
    `${stats.month} in the last 30 days`, ORANGE);
  drawStatCard(pdf, cardX(3), cardY, cardW, cardH, 'Never signed in', String(stats.never),
    stats.never ? 'password never used' : 'everyone has logged in', stats.never ? ROSE : EMERALD);
  drawStatCard(pdf, cardX(4), cardY, cardW, cardH, 'Online now', String(stats.live), 'active in last 5 min', GOLD);

  // ── Breakdowns, three across ───────────────────────────────────────────────
  let y = cardY + cardH + 9;
  const colW = (INNER_W - 16) / 3;
  const ends = [
    drawBreakdown(pdf, M, y, colW, 'By role', stats.byRole, stats.total),
    drawBreakdown(pdf, M + colW + 8, y, colW, 'By area', stats.byArea, stats.total, 5, 'every area is listed below'),
    drawGaps(pdf, M + (colW + 8) * 2, y, colW, stats),
  ];
  y = Math.max(...ends) + 6;

  // ── Full coverage: every area, then every mandal ───────────────────────────
  // These come BEFORE the roster on purpose. The roster runs to as many pages as
  // there are karyakartas, so anything after it is a page-flip away; "which area
  // has nobody" is a question asked far more often than "what is row 63".
  const areaCoverage = stats.areaCoverage || { entries: [], unassigned: { count: 0, names: [] } };
  const mandalCoverage = stats.mandalCoverage || { entries: [], unassigned: { count: 0, names: [] } };

  y = drawCoverageTable(pdf, {
    title: 'Coverage by area',
    note: stats.subAreaTotal
      ? `All areas, with their ${stats.subAreaTotal} sub-areas indented beneath. Karyakartas are assigned to an area, not to a single sub-area, so a sub-area is covered by whoever holds its parent — shown greyed.`
      : 'Every area, staffed or not. No sub-areas have been defined yet.',
    unitLabel: 'area',
    coverage: areaCoverage,
    startY: y,
    headPage,
    withSubAreas: true,
  });

  y = drawCoverageTable(pdf, {
    title: 'Coverage by mandal',
    note: 'Every mandal, staffed or not. Mandal and area are independent — a karyakarta can hold either, both, or neither.',
    unitLabel: 'mandal',
    coverage: mandalCoverage,
    startY: y,
    headPage,
  });

  // ── Roster table ───────────────────────────────────────────────────────────
  if (y + 26 > PAGE_H - 14) { pdf.addPage(); headPage(); y = TOP_SLIM; }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text(`Roster (${roster.length})`, M, y);
  y += 3;

  // Said out loud, without names: a reader who knows there are 22 logins should
  // not have to guess why 19 rows follow.
  if (santoCount) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(7);
    pdf.setTextColor(...MUTED);
    pdf.text(
      toLatin(`${santoCount} Santo ${santoCount === 1 ? 'account is' : 'accounts are'} not listed — city-wide like Admin, with no area or mandal assigned.`),
      M, y + 2.6,
    );
    y += 4.4;
  }

  autoTable(pdf, {
    startY: y,
    margin: { top: TOP_SLIM, left: M, right: M, bottom: 14 },
    head: [['#', 'Name', 'Mobile', 'Roles', 'Access', 'Areas', 'Mandals', 'Login', 'Last seen']],
    body: roster.length
      ? roster.map((r, i) => [
          i + 1,
          toLatin(r.name),
          toLatin(r.mobile),
          toLatin(r.roleLabel),
          toLatin(r.accessShort),
          toLatin(r.areas.join(', ') || '—'),
          toLatin(r.mandals.join(', ') || '—'),
          r.isActive ? 'Active' : 'Disabled',
          toLatin(r.lastLoginLabel),
        ])
      : [[{ content: 'No volunteers match this filter.', colSpan: 9, styles: { halign: 'center', fontStyle: 'italic', textColor: MUTED } }]],
    styles: { fontSize: 8, cellPadding: 1.9, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8 },
    alternateRowStyles: { fillColor: PAPER },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right', textColor: MUTED },
      1: { cellWidth: 42, fontStyle: 'bold' },
      2: { cellWidth: 23 },
      3: { cellWidth: 40 },
      4: { cellWidth: 22, fontSize: 7.4, textColor: MUTED },
      5: { cellWidth: 44 },
      6: { cellWidth: 40 },
      7: { cellWidth: 18, fontSize: 7.4 },
      8: { cellWidth: 'auto', fontSize: 7.4, textColor: MUTED },
    },
    // A disabled login is greyed rather than dropped: "who used to have access"
    // is half the reason anyone prints this.
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const row = roster[data.row.index];
      if (!row) return;
      if (!row.isActive) data.cell.styles.textColor = MUTED;
      if (data.column.index === 7) {
        data.cell.styles.textColor = row.isActive ? EMERALD : ROSE;
        data.cell.styles.fontStyle = 'bold';
      }
      // "Never" is the actionable one — an account that was created and then
      // never used usually means the password never reached the person.
      if (data.column.index === 8 && !row.lastLogin) {
        data.cell.styles.textColor = ROSE;
      }
    },
    didDrawPage: headPage,
  });

  // ── Footer on every page ───────────────────────────────────────────────────
  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.setTextColor(...MUTED);
    pdf.text(
      toLatin(`BAPS Jaipur MDS  ·  Karyakarta roster  ·  Generated ${new Date().toLocaleString('en-IN')}`),
      M, PAGE_H - 6,
    );
    pdf.text(`Page ${p} of ${pageCount}`, PAGE_W - M, PAGE_H - 6, { align: 'right' });
  }

  pdf.save(`volunteers-${stamp()}.pdf`);
}
