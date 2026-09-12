/**
 * functions/lib/volunteerScope.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 33 — "which of these rows are YOURS?", server side.
 *
 * A transcription of the parts of src/lib/scope.js that the weekly sabha digest
 * needs, so that the per-mandal-head copy of the report contains exactly the
 * schedules that person can see on the All Area Sabhas screen. Getting this
 * wrong is not a crash — it is a Vaishali Nagar sanchalak receiving a list of
 * Malviya Nagar's missed sabhas and being asked to follow them up.
 *
 * It mirrors, function for function:
 *   MANDAL_GROUPS / expandMandalGroups   Bal Mandal ⇄ Sishu Mandal
 *   inferScopeKind                        the shape implied by an assignment
 *   roleStatedScopeKind / statedScopeKind the Phase 23b UNION discount
 *   resolveScope                          volunteer + roles → one scope object
 *   matchesScope / eventInScope           the contact and the sabha predicates
 *
 * firestore.rules mirrors the same logic a third time (ctx(), scopeAllows()).
 * Three copies is not an accident of laziness — the client filters, the rules
 * enforce, and this file addresses an envelope — but they must move together.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SCOPE_KINDS = {
  GLOBAL: 'global',
  AREA: 'area',
  MANDAL: 'mandal',
  INTERSECT: 'intersect',
  UNION: 'union',
  NONE: 'none',
};

/** Mandals worked by the same set of volunteers — holding either grants both. */
const MANDAL_GROUPS = [
  ['Bal Mandal', 'Sishu Mandal'],
];

const SCOPE_WIDTH = {
  [SCOPE_KINDS.GLOBAL]: 5,
  [SCOPE_KINDS.UNION]: 4,
  [SCOPE_KINDS.AREA]: 3,
  [SCOPE_KINDS.MANDAL]: 3,
  [SCOPE_KINDS.INTERSECT]: 2,
  [SCOPE_KINDS.NONE]: 1,
};

function expandMandalGroups(mandals) {
  const out = [];
  const seen = new Set();
  const push = (m) => { if (m && !seen.has(m)) { seen.add(m); out.push(m); } };
  (mandals || []).forEach(push);
  for (const group of MANDAL_GROUPS) {
    if (group.some((m) => seen.has(m))) group.forEach(push);
  }
  return out;
}

/**
 * The shape implied by the assignment when no role states one. INTERSECT for
 * "an area AND a mandal" is the narrowest reading and deliberately so — a scope
 * that turns out too tight shows up as "somebody is missing from my list", while
 * one that is too wide goes unnoticed for a year.
 */
function inferScopeKind(areas, mandals) {
  const hasAreas = Array.isArray(areas) && areas.length > 0;
  const hasMandals = Array.isArray(mandals) && mandals.length > 0;
  if (hasAreas && hasMandals) return SCOPE_KINDS.INTERSECT;
  if (hasAreas) return SCOPE_KINDS.AREA;
  if (hasMandals) return SCOPE_KINDS.MANDAL;
  return SCOPE_KINDS.UNION;
}

function widestScopeKind(kinds) {
  const valid = (kinds || []).filter((k) => k && SCOPE_WIDTH[k]);
  if (!valid.length) return SCOPE_KINDS.UNION;
  // AREA and MANDAL tie at width 3 but are different shapes; holding both means
  // "my areas OR my mandals", which is UNION.
  if (valid.includes(SCOPE_KINDS.AREA) && valid.includes(SCOPE_KINDS.MANDAL)) return SCOPE_KINDS.UNION;
  return valid.reduce((best, k) => (SCOPE_WIDTH[k] > SCOPE_WIDTH[best] ? k : best), valid[0]);
}

function statedScopeKind(kinds) {
  const valid = (kinds || []).filter((k) => k && SCOPE_WIDTH[k]);
  return valid.length ? widestScopeKind(valid) : null;
}

/**
 * PHASE 23b — a stored 'union' on a ROLE is only trusted when the role also
 * carries `scopeKindChosen`. Older builds re-stamped scopeKind on every save
 * from a helper that reported an unset shape as 'union', so roles nobody had
 * ever scoped look identical to a deliberate choice. Every other shape is
 * honoured either way: union is the only value ever written by accident.
 */
function roleStatedScopeKind(role) {
  const kind = role && role.scopeKind;
  if (!kind || !SCOPE_WIDTH[kind]) return null;
  if (kind === SCOPE_KINDS.UNION && !(role && role.scopeKindChosen)) return null;
  return kind;
}

/**
 * resolveScope({ volunteer, roles, permissions }) → scope
 *
 * The volunteer's own `scopeKind` wins when present: with several roles the app
 * honours the WIDEST of their shapes and stamps the result onto the volunteer
 * (VolunteerEditor.handleSave), which is also the only shape firestore.rules can
 * read. Falling back the other way would make this file narrower than the
 * database, and a mandal head would silently stop receiving their own report.
 */
function resolveScope({ volunteer = null, roles = [], permissions = [] } = {}) {
  const areas = Array.isArray(volunteer && volunteer.assignedAreas)
    ? volunteer.assignedAreas.filter(Boolean) : [];
  const mandals = expandMandalGroups(
    Array.isArray(volunteer && volunteer.assignedMandals)
      ? volunteer.assignedMandals.filter(Boolean) : [],
  );

  // view_all_contacts has always meant "ignore scoping", and firestore.rules
  // short-circuits on it too.
  if (Array.isArray(permissions) && permissions.includes('view_all_contacts')) {
    return { kind: SCOPE_KINDS.GLOBAL, areas, mandals, unrestricted: true, empty: false };
  }

  const own = volunteer && typeof volunteer.scopeKind === 'string' && SCOPE_WIDTH[volunteer.scopeKind]
    ? volunteer.scopeKind
    : null;
  const stated = own || statedScopeKind((roles || []).map(roleStatedScopeKind));
  const kind = stated || inferScopeKind(areas, mandals);

  if (kind === SCOPE_KINDS.GLOBAL) return { kind, areas, mandals, unrestricted: true, empty: false };
  if (kind === SCOPE_KINDS.NONE) return { kind, areas: [], mandals: [], unrestricted: false, empty: true };

  const needsAreas = kind === SCOPE_KINDS.AREA || kind === SCOPE_KINDS.INTERSECT;
  const needsMandals = kind === SCOPE_KINDS.MANDAL || kind === SCOPE_KINDS.INTERSECT;
  const empty = (needsAreas && !areas.length)
    || (needsMandals && !mandals.length)
    || (kind === SCOPE_KINDS.UNION && !areas.length && !mandals.length);

  return { kind, areas, mandals, unrestricted: false, empty };
}

/** The one predicate. `area` and `mandal` may each be null. */
function matchesScope(scope, { area = null, mandal = null } = {}) {
  if (!scope || scope.unrestricted) return true;
  if (scope.kind === SCOPE_KINDS.NONE) return false;

  const inArea = Boolean(area) && scope.areas.includes(area);
  const inMandal = Boolean(mandal) && scope.mandals.includes(mandal);

  switch (scope.kind) {
    case SCOPE_KINDS.AREA: return inArea;
    case SCOPE_KINDS.MANDAL: return inMandal;
    case SCOPE_KINDS.INTERSECT: return inArea && inMandal;
    case SCOPE_KINDS.UNION:
    default: return inArea || inMandal;
  }
}

/** The areas an event/schedule spans; `[]` means city-wide. Mirrors eventAreas()
 *  in src/lib/scope.js. */
function eventAreas(doc) {
  if (Array.isArray(doc && doc.areas)) return doc.areas.filter(Boolean);
  return doc && doc.area ? [doc.area] : [];
}

/**
 * eventInScope(scope, doc) — the events/schedules twin of matchesScope().
 *
 * PHASE 34 — a sabha now lists several areas (or none). It is in an AREA viewer's
 * territory when ANY listed area is theirs, and a city-wide sabha (empty list)
 * belongs to everyone; the mandal axis is unchanged. This is what keeps the
 * weekly digest's per-head copy showing exactly the schedules that head sees on
 * the All Area Sabhas screen — both now decide membership the same way. Mirrors
 * eventInScope() in src/lib/scope.js.
 */
function eventInScope(scope, doc) {
  if (!scope || scope.unrestricted) return true;
  if (scope.kind === SCOPE_KINDS.NONE) return false;

  const areas = eventAreas(doc);
  const inArea = areas.length === 0 || areas.some((a) => scope.areas.includes(a));
  const inMandal = Boolean(doc && doc.mandal) && scope.mandals.includes(doc.mandal);

  switch (scope.kind) {
    case SCOPE_KINDS.AREA: return inArea;
    case SCOPE_KINDS.MANDAL: return inMandal;
    case SCOPE_KINDS.INTERSECT: return inArea && inMandal;
    case SCOPE_KINDS.UNION:
    default: return inArea || inMandal;
  }
}

module.exports = {
  SCOPE_KINDS,
  MANDAL_GROUPS,
  expandMandalGroups,
  inferScopeKind,
  widestScopeKind,
  statedScopeKind,
  roleStatedScopeKind,
  resolveScope,
  matchesScope,
  eventAreas,
  eventInScope,
};
