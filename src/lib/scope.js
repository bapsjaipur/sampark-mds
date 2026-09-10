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
 * PHASE 32 — MANDALS WORKED BY THE SAME PEOPLE.
 *
 * Bal Mandal and Sishu Mandal are two separate mandals on the CONTACT — a child
 * is one or the other, and that distinction is kept on purpose so the split can
 * be analysed later. But right now there is one set of volunteers covering both:
 * there is no separate Sishu Mandal karyakarta to assign, and nobody wants to
 * tick two boxes on every volunteer to say something that is true of all of them.
 *
 * So the pairing lives here, at scope-resolution time, and NOT in the data:
 * being assigned either mandal resolves to both. Nothing is written to any
 * volunteer document, so the day Sishu Mandal gets its own team this array is
 * emptied and every scope narrows back on the next page load — no migration, no
 * stranded `assignedMandals` to clean up.
 *
 * What this does NOT do: it does not merge the two mandals anywhere else. A
 * contact stays Bal Mandal or Sishu Mandal, sabhas are still created per mandal,
 * batches are still cut per mandal, and every report still groups by the real
 * value. The only thing widened is who is allowed to see and edit them.
 *
 * firestore.rules mirrors this in ctx(). If you change this array, change the
 * rules in the same commit — otherwise the UI offers Sishu Mandal and the
 * database refuses the write.
 */
export const MANDAL_GROUPS = [
  ['Bal Mandal', 'Sishu Mandal'],
];

/**
 * Grows a list of assigned mandals to include everything in the same group.
 * Order is preserved and duplicates removed, so `describeScope` reads naturally
 * and the assignment the admin actually made still comes first.
 */
export function expandMandalGroups(mandals = []) {
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
  // Expanded, not stored: MANDAL_GROUPS pairs mandals that share one set of
  // volunteers, so being given Bal Mandal resolves to Sishu Mandal too. The
  // volunteer document is untouched — see MANDAL_GROUPS above.
  const mandals = expandMandalGroups(
    Array.isArray(volunteer?.assignedMandals) ? volunteer.assignedMandals.filter(Boolean) : [],
  );

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

/**
 * writableMandals(scope) — which mandals may this person CREATE or FILE things
 * under? `null` means "this axis doesn't restrict them"; an array means those
 * names and no others; `[]` means nothing at all.
 *
 * Reading is the wrong test for a form. A UNION-scoped karyakarta with an area
 * and a mandal can legitimately add a Mahila Mandal contact in their area, so
 * narrowing their Mandal dropdown to their one assigned mandal would take away
 * something they are entitled to. Only the shapes where the mandal axis is
 * genuinely binding — MANDAL (the column) and INTERSECT (the cell) — restrict it.
 *
 * Screens should GREY OUT what this excludes rather than removing it: a Super
 * Moderator over two mandals needs to see both offered, and a dropdown that
 * silently drops options can't be told apart from one that failed to load.
 */
export function writableMandals(scope) {
  if (!scope || scope.unrestricted) return null;
  if (scope.kind === SCOPE_KINDS.NONE) return [];
  if (scope.kind === SCOPE_KINDS.MANDAL || scope.kind === SCOPE_KINDS.INTERSECT) {
    return scope.mandals || [];
  }
  return null;
}

/** The area-axis twin of writableMandals(). Same null/array/[] contract. */
export function writableAreas(scope) {
  if (!scope || scope.unrestricted) return null;
  if (scope.kind === SCOPE_KINDS.NONE) return [];
  if (scope.kind === SCOPE_KINDS.AREA || scope.kind === SCOPE_KINDS.INTERSECT) {
    return scope.areas || [];
  }
  return null;
}

/**
 * Is this VOLUNTEER inside the viewer's territory?
 *
 * A volunteer isn't a contact: they hold two lists of their own rather than one
 * area and one mandal, so matchesScope() can't judge them. Overlap on either
 * list counts — a karyakarta assigned to your mandal is yours to see even if
 * their area sits outside your own, which is what makes a mandal head able to
 * find every person working their column.
 *
 * A volunteer with no territory at all (an admin, a santo) belongs to nobody in
 * particular and stays out of scoped lists.
 */
export function volunteerInScope(volunteer, scope) {
  if (!scope || scope.unrestricted) return true;
  if (scope.kind === SCOPE_KINDS.NONE) return false;
  const vMandals = Array.isArray(volunteer?.assignedMandals) ? volunteer.assignedMandals : [];
  const vAreas = Array.isArray(volunteer?.assignedAreas) ? volunteer.assignedAreas : [];
  return vMandals.some((m) => scope.mandals.includes(m))
    || vAreas.some((a) => scope.areas.includes(a));
}

export function filterVolunteersByScope(volunteers, scope) {
  if (!scope || scope.unrestricted) return volunteers || [];
  return (volunteers || []).filter((v) => volunteerInScope(v, scope));
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
