// src/lib/scope.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 21 — the single definition of "what can this volunteer see".
//
// THE THING TO UNDERSTAND FIRST: Area and Mandal are not a hierarchy.
//
//   • `area` lives on the HOUSEHOLD   (Vaishali Nagar, Mansarovar, … — geography)
//   • `mandal` lives on the INDIVIDUAL (Yuvak, Mahila, Bal, … — which group they
//                                       belong to)
//
// They are two independent axes of the same grid. "Yuvak Mandal" is not inside
// "Vaishali Nagar" and Vaishali Nagar is not inside Yuvak Mandal — they
// intersect. Every real role is a different shape cut out of that grid:
//
//                 Yuvak   Mahila   Bal   Yuvati  …
//   Vaishali        ■       ■       ■      ■        ← Area Moderator: one row
//   Mansarovar      ■       ■       ■      ■
//   Jhotwara        ■       ■       ■      ■
//                   ↑
//        Super Moderator: one column, every area
//
//   Karyakarta: a single CELL — Yuvak Mandal in Vaishali Nagar only.
//
// Before Phase 21 the only available shape was the UNION: `assignedAreas` OR
// `assignedMandals`. That is correct for the row and the column, but it makes
// the single cell impossible to express — a volunteer given
// areas=[Vaishali], mandals=[Yuvak] could see all of Vaishali AND every Yuvak
// Mandal member in the city, which is the opposite of what "assigned to Yuvak
// Mandal in Vaishali" means. That is why SCOPE_KINDS exists.
//
// The shape is a property of the ROLE (scopeKind), the values are a property of
// the VOLUNTEER (assignedAreas / assignedMandals). Same role, different people,
// different territory — which is exactly how a real hierarchy works.
//
// PHASE 23 — WHAT AN UNSET scopeKind MEANS.
//
// A role document only carries `scopeKind` if it has been saved through the
// Roles tab since Phase 21. Every older role has none, and the fallback used to
// be a flat UNION for all of them. That is the widest shape there is short of
// global, and it produced exactly the complaint this phase exists to fix: a
// karyakarta given Vaishali Nagar AND Yuvak Mandal saw all of Vaishali Nagar
// PLUS every Yuvak in the city — the opposite of "my area and my mandal".
//
// So an unset scopeKind is now INFERRED from what the volunteer actually holds
// (inferScopeKind below), because the assignment already states the intent:
// giving someone both an area and a mandal means the cell where they cross.
// UNION remains available, but only when an admin picks it on purpose — and
// roleStatedScopeKind() explains how "picked on purpose" is told apart from the
// UNION that older builds stamped on every role they touched.
//
// firestore.rules mirrors every function here — including the inference. If you
// change the semantics, change the rules in the same commit or the UI and the
// database will disagree (and the database wins, silently, by returning empty
// lists).
// ─────────────────────────────────────────────────────────────────────────────

export const SCOPE_KINDS = {
  // Ignores assignedAreas/assignedMandals entirely. Admin.
  GLOBAL: 'global',
  // Every mandal within the assigned areas. Area Moderator — one row.
  AREA: 'area',
  // The assigned mandals across every area. Super Moderator — one column.
  MANDAL: 'mandal',
  // The intersection: only contacts matching BOTH an assigned area AND an
  // assigned mandal. Karyakarta — one cell.
  INTERSECT: 'intersect',
  // The historical behaviour: area OR mandal. Kept as the default so existing
  // volunteer/role documents keep working byte-for-byte until an admin
  // deliberately picks a narrower shape.
  UNION: 'union',
  // No contact access at all. Santo.
  NONE: 'none',
};

export const SCOPE_KIND_META = {
  [SCOPE_KINDS.GLOBAL]: {
    label: 'Everything',
    short: 'All Jaipur',
    help: 'Sees every contact regardless of the areas or mandals assigned to them.',
    uses: [],
  },
  [SCOPE_KINDS.AREA]: {
    label: 'Their areas — all mandals',
    short: 'By area',
    help: 'Every contact whose household sits in one of their assigned areas, no matter which mandal. This is the Area head.',
    uses: ['areas'],
  },
  [SCOPE_KINDS.MANDAL]: {
    label: 'Their mandals — all areas',
    short: 'By mandal',
    help: 'Every member of their assigned mandals across the whole city. This is the Mandal head.',
    uses: ['mandals'],
  },
  [SCOPE_KINDS.INTERSECT]: {
    label: 'Their area AND mandal',
    short: 'Area × mandal',
    help: 'Only contacts matching both — e.g. Yuvak Mandal members in Vaishali Nagar, and nobody else. The narrowest scope.',
    uses: ['areas', 'mandals'],
  },
  [SCOPE_KINDS.UNION]: {
    label: 'Their area OR mandal',
    short: 'Area + mandal',
    help: 'Contacts in their areas, plus all members of their mandals anywhere. Wider than most people expect — it is no longer what an unset scope falls back to, and should only be picked deliberately.',
    uses: ['areas', 'mandals'],
  },
  [SCOPE_KINDS.NONE]: {
    label: 'No contact access',
    short: 'None',
    help: 'Cannot read contacts at all. For Santo accounts that only need their own schedule.',
    uses: [],
  },
};

export const ALL_SCOPE_KINDS = Object.values(SCOPE_KINDS);

/**
 * inferScopeKind({ areas, mandals })
 *
 * The shape to use when NO role states one. Read straight off the assignment,
 * because the assignment already says what was meant:
 *
 *   area + mandal  → INTERSECT   "Yuvak Mandal in Vaishali Nagar" — one cell
 *   area only      → AREA        an area head — one row
 *   mandal only    → MANDAL      a mandal head — one column
 *   neither        → UNION       matches nothing anyway (scope.empty is true),
 *                                so this only decides the label
 *
 * INTERSECT for "both" is the whole point: it is the narrowest reading, and a
 * scope that turns out to be too tight shows up immediately as "someone is
 * missing from my list". Defaulting wide fails the other way — people see
 * contacts that are not theirs and nobody notices for a year.
 */
export function inferScopeKind({ areas = [], mandals = [] } = {}) {
  const hasAreas = Array.isArray(areas) && areas.length > 0;
  const hasMandals = Array.isArray(mandals) && mandals.length > 0;
  if (hasAreas && hasMandals) return SCOPE_KINDS.INTERSECT;
  if (hasAreas) return SCOPE_KINDS.AREA;
  if (hasMandals) return SCOPE_KINDS.MANDAL;
  return SCOPE_KINDS.UNION;
}

/**
 * The widest shape actually STATED by these roles, or null if none of them says
 * anything. Separate from widestScopeKind(), which answers UNION for an empty
 * list — that is the right answer for the admin screens that are picking a value
 * to store, and the wrong one here, where "nobody said" has to be
 * distinguishable from "somebody said union".
 */
export function statedScopeKind(kinds = []) {
  const valid = (kinds || []).filter((k) => k && SCOPE_WIDTH[k]);
  return valid.length ? widestScopeKind(valid) : null;
}

/**
 * roleStatedScopeKind(role) — what this ROLE DOCUMENT says its shape is, or null
 * for "nobody has said".
 *
 * PHASE 23b — A STORED 'union' IS NOT NECESSARILY A DECISION.
 *
 * Until Phase 23, every save on the Roles tab wrote `scopeKind: <current value>`,
 * and the current value of an unset scope was reported as UNION. So renaming a
 * role, or ticking one unrelated checkbox, silently stamped "their area OR
 * mandal" — the widest shape short of global — onto roles nobody had ever
 * scoped. Those documents now look identical to a deliberate choice, and they
 * beat the inference added in Phase 23: the symptom is a karyakarta with one area
 * and two mandals still seeing every mandal member in every area.
 *
 * The two cases ARE distinguishable. `scopeKindChosen` is written ONLY by a save
 * that actually states a shape — the Scope picker, a preset, or a merge resolving
 * two roles (see scopeChoiceFields in admin/RolesManager.jsx). No older build
 * wrote it, so a stored UNION without it came from the blanket re-stamp and is
 * treated as unstated; with it, an admin picked UNION on purpose and it is
 * honoured. Every OTHER shape is honoured either way — union is the only value
 * that was ever written by accident, so this discount stays as narrow as the bug.
 *
 * Self-cleaning: the next time anyone touches that role's scope, the marker is
 * written and the question is settled for good.
 */
export function roleStatedScopeKind(role) {
  const kind = role?.scopeKind;
  if (!kind || !SCOPE_WIDTH[kind]) return null;
  if (kind === SCOPE_KINDS.UNION && !role?.scopeKindChosen) return null;
  return kind;
}

/**
 * resolveScope({ role, roles, volunteer, permissions })
 *
 * Collapses a volunteer + their role(s) into one plain object that every
 * filter, query and badge in the app can read. Never throws and never returns
 * null — a role that states no scopeKind falls back to inferScopeKind(), so a
 * half-migrated database narrows to what the assignment implies rather than
 * opening up to everything.
 *
 * `inferred: true` marks that outcome, so a screen can say "this came from your
 * assignment, not from a decision an admin made" instead of presenting a guess
 * as policy.
 *
 * With multiple roles the WIDEST stated scopeKind wins, matching how permissions
 * already union: holding both Karyakarta (intersect) and Area Moderator (area)
 * means you are an Area Moderator who also happens to call a batch. Narrowing
 * on the union would take away access the second role was granted for.
 */
export function resolveScope({ role = null, roles = null, volunteer = null, permissions = [] } = {}) {
  const list = Array.isArray(roles) && roles.length ? roles : (role ? [role] : []);

  const areas = Array.isArray(volunteer?.assignedAreas) ? volunteer.assignedAreas.filter(Boolean) : [];
  const mandals = Array.isArray(volunteer?.assignedMandals) ? volunteer.assignedMandals.filter(Boolean) : [];

  // view_all_contacts has always meant "ignore scoping", and firestore.rules
  // still short-circuits on it. Honour that before looking at scopeKind, or a
  // role marked `area` but holding view_all_contacts would be filtered in the
  // UI while the database happily returned everything — the worst kind of
  // mismatch, because it looks like data loss.
  if (Array.isArray(permissions) && permissions.includes('view_all_contacts')) {
    return { kind: SCOPE_KINDS.GLOBAL, areas, mandals, unrestricted: true, empty: false, inferred: false };
  }

  const stated = statedScopeKind(list.map((r) => roleStatedScopeKind(r)));
  const kind = stated || inferScopeKind({ areas, mandals });
  const inferred = !stated;

  if (kind === SCOPE_KINDS.GLOBAL) {
    return { kind, areas, mandals, unrestricted: true, empty: false, inferred };
  }
  if (kind === SCOPE_KINDS.NONE) {
    return { kind, areas: [], mandals: [], unrestricted: false, empty: true, inferred };
  }

  // `empty` means "this scope can match nothing" — a scoped role with no
  // territory assigned yet. Callers use it to show "no areas assigned, ask an
  // admin" instead of a bare empty list that reads like a loading bug.
  const needsAreas = kind === SCOPE_KINDS.AREA || kind === SCOPE_KINDS.INTERSECT;
  const needsMandals = kind === SCOPE_KINDS.MANDAL || kind === SCOPE_KINDS.INTERSECT;
  const empty = (needsAreas && !areas.length)
    || (needsMandals && !mandals.length)
    || (kind === SCOPE_KINDS.UNION && !areas.length && !mandals.length);

  return { kind, areas, mandals, unrestricted: false, empty, inferred };
}

// Widest → narrowest. Ordering is deliberate and load-bearing: see the
// multiple-roles note on resolveScope().
const SCOPE_WIDTH = {
  [SCOPE_KINDS.GLOBAL]: 5,
  [SCOPE_KINDS.UNION]: 4,
  [SCOPE_KINDS.AREA]: 3,
  [SCOPE_KINDS.MANDAL]: 3,
  [SCOPE_KINDS.INTERSECT]: 2,
  [SCOPE_KINDS.NONE]: 1,
};

/**
 * The widest of several STATED shapes. Answers UNION for an empty list, which is
 * what the admin screens want when they are choosing a value to store on a role
 * or a volunteer. Runtime scoping does NOT use this for the empty case — see
 * statedScopeKind() and inferScopeKind().
 */
export function widestScopeKind(kinds = []) {
  const valid = kinds.filter((k) => k && SCOPE_WIDTH[k]);
  if (!valid.length) return SCOPE_KINDS.UNION; // nothing stated
  // AREA and MANDAL tie at width 3 but are different shapes. Holding both
  // genuinely means "my areas OR my mandals", which is UNION — not one of them
  // arbitrarily winning the sort.
  if (valid.includes(SCOPE_KINDS.AREA) && valid.includes(SCOPE_KINDS.MANDAL)) {
    return SCOPE_KINDS.UNION;
  }
  return valid.reduce((best, k) => (SCOPE_WIDTH[k] > SCOPE_WIDTH[best] ? k : best), valid[0]);
}

/**
 * matchesScope(scope, { area, mandal })
 *
 * The one predicate. `area` is the household's area (or a standalone contact's
 * own area); `mandal` is the individual's mandal. Either may be null.
 */
export function matchesScope(scope, { area = null, mandal = null } = {}) {
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

/**
 * Convenience for the common case of filtering individuals when you already
 * hold the households. Individuals don't carry `area`, so it comes from the
 * parent household — except for standalone contacts (Phase 13/16), which carry
 * their own. Checking the individual's own field FIRST matters: a standalone
 * contact has householdId === null and would otherwise resolve area to null and
 * fail an AREA-scoped check that should have passed.
 */
export function individualScopeArea(individual, householdsById = {}) {
  if (individual?.area) return individual.area;
  const h = individual?.householdId ? householdsById[individual.householdId] : null;
  return h?.area || null;
}

export function filterIndividualsByScope(individuals, scope, householdsById = {}) {
  if (!scope || scope.unrestricted) return individuals || [];
  if (scope.kind === SCOPE_KINDS.NONE) return [];
  return (individuals || []).filter((ind) => matchesScope(scope, {
    area: individualScopeArea(ind, householdsById),
    mandal: ind?.mandal || null,
  }));
}

export function filterHouseholdsByScope(households, scope) {
  if (!scope || scope.unrestricted) return households || [];
  if (scope.kind === SCOPE_KINDS.NONE) return [];
  // A household has no mandal of its own — its members do, and they may be in
  // several different mandals. So for a MANDAL-scoped user every household is
  // potentially relevant and the filtering has to happen at the member level;
  // hiding households here would hide the only way to reach those members.
  if (scope.kind === SCOPE_KINDS.MANDAL) return households || [];
  return (households || []).filter((h) => scope.areas.includes(h?.area));
}

/** Human-readable territory, e.g. "Vaishali Nagar + 2 more · Yuvak Mandal". */
export function describeScope(scope) {
  if (!scope) return '—';
  if (scope.unrestricted) return 'All areas and mandals';
  if (scope.kind === SCOPE_KINDS.NONE) return 'No contact access';
  const join = (list) => {
    if (!list.length) return null;
    if (list.length <= 2) return list.join(', ');
    return `${list[0]} + ${list.length - 1} more`;
  };
  const a = join(scope.areas);
  const m = join(scope.mandals);
  const sep = scope.kind === SCOPE_KINDS.INTERSECT ? ' × ' : ' · ';
  if (a && m) return `${a}${sep}${m}`;
  if (a) return a;
  if (m) return m;
  return 'Nothing assigned yet';
}
