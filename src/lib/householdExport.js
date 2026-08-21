// src/lib/householdExport.js
// Flattens a household + its members into ONE export row, so the Households tab
// CSV/PDF has a single line per household instead of a line per family member.
// Column labels for these keys live in HOUSEHOLD_COLUMNS (ExportButtons.jsx).

function fmtDate(ts) {
  const d = ts?.toDate?.() ?? (ts instanceof Date ? ts : null);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// Primary member first, then alphabetical — matches the on-screen ordering.
function sortMembers(members) {
  return [...members].sort(
    (a, b) =>
      (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) ||
      (a.name || '').localeCompare(b.name || '')
  );
}

export function buildHouseholdExportRow(household, members = []) {
  const sorted = sortMembers(members);
  const primary = sorted.find((m) => m.isPrimary) || sorted[0] || null;

  return {
    primaryName: primary?.name || household.address || 'Unnamed household',
    // Actual loaded members win; fall back to the manually entered count for
    // households whose members were never added individually.
    familyMemberCount: sorted.length || Number(household.totalFamilyMembers) || 0,
    mobile: primary?.mobile || '',
    address: household.address || '',
    area: household.area || '',
    subArea: household.subArea || '',
    mandal: household.mandal || primary?.mandal || '',
    level: household.level || '',
    familyMembers: sorted.map((m) => m.name).filter(Boolean).join('; '),
    samparkKaryakartaName:
      household.samparkKaryakartaName || primary?.samparkKaryakartaName || '',
    samparkKaryakartaNumber:
      household.samparkKaryakartaNumber || primary?.samparkKaryakartaNumber || '',
    remark: household.remark || '',
    createdAt: fmtDate(household.createdAt),
  };
}

// households: array of household docs; membersByHousehold: Map<householdId, members[]>
export function buildHouseholdExportRows(households, membersByHousehold) {
  return households.map((h) =>
    buildHouseholdExportRow(h, membersByHousehold.get(h.id) || [])
  );
}
