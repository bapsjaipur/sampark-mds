/**
 * functions/lib/callerAccess.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 21 — a volunteer can now hold MORE THAN ONE role.
 *
 * Every callable used to resolve the caller's permissions by reading the single
 * `roleRef` field. Left alone, an admin whose access came from the second entry
 * of `roleRefs[]` would be told "Missing manage_users permission" while the UI
 * quite correctly showed them as an admin — the worst kind of bug, because the
 * client and the server disagree and only one of them is on screen.
 *
 * So role resolution lives here, once, and matches src/hooks/usePermissions.jsx:
 * `roleRefs[]` is authoritative, `roleRef` is the pre-Phase-21 fallback, and
 * permissions are the UNION across every role that resolves.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** roleRefs[] wins; roleRef is the legacy single-role field. */
function volunteerRoleIds(data) {
  const many = Array.isArray(data?.roleRefs) ? data.roleRefs.filter(Boolean) : [];
  if (many.length) return [...new Set(many)];
  return data?.roleRef ? [data.roleRef] : [];
}

/**
 * Union of permissions across all of a volunteer's roles.
 * One getAll() rather than N gets — a volunteer with three roles otherwise
 * costs three round trips on every callable invocation.
 */
async function permissionsForVolunteer(db, volunteerData) {
  const ids = volunteerRoleIds(volunteerData);
  if (ids.length === 0) return [];
  const refs = ids.map((id) => db.collection('roles').doc(id));
  const snaps = await db.getAll(...refs);
  const out = new Set();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const perms = snap.data().permissions;
    if (Array.isArray(perms)) perms.forEach((p) => out.add(p));
  }
  return [...out];
}

/**
 * PHASE 41 — the ladder, server-side.
 *
 * `roles/{id}.rank` (0–100) is the hierarchy: Admin 100, Super Moderator /
 * Nirdeshak 80–85, Moderator / Sanchalak 60–75, Karyakarta 40, Volunteer 20.
 * KEEP IN SYNC with DEFAULT_ROLE_RANK and canManageRole() in
 * src/constants/roleTemplates.js — same numbers, same meaning.
 *
 * On the client the rank is a guard-rail: it stops a Moderator handed
 * manage_roles from editing the Admin role by accident, and firestore.rules does
 * not check it. HERE IT IS LOAD-BEARING. Password approval is the first place
 * where outranking someone is itself the authority — "admin or someone who is
 * upper to there role wise" — so the comparison has to happen where the caller
 * cannot reach it, which is here and not in the browser.
 *
 * A volunteer holding several roles is as senior as their most senior one, which
 * is the same rule VolunteerEditor uses to pick a primary role.
 */
const DEFAULT_ROLE_RANK = 30;

async function rankForVolunteer(db, volunteerData) {
  const ids = volunteerRoleIds(volunteerData);
  if (ids.length === 0) return 0;
  const snaps = await db.getAll(...ids.map((id) => db.collection('roles').doc(id)));
  let best = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const r = snap.data().rank;
    best = Math.max(best, Number.isFinite(r) ? r : DEFAULT_ROLE_RANK);
  }
  return best;
}

/**
 * Normalise whatever the client sent for roles into the pair we store.
 *
 * BOTH fields are written on purpose: firestore.rules can't iterate an array
 * doing a get() per element (10 get()/exists() per request, no map/reduce), so
 * the rules still read the single `roleRef`. It is kept pointing at the caller's
 * most senior role so rules stay a conservative subset of what the UI allows.
 *
 * Returns null when the client didn't mention roles at all, so callers can tell
 * "don't touch roles" apart from "clear all roles".
 */
function normalizeRoleRefs({ roleRefs, roleRef }) {
  if (roleRefs === undefined && roleRef === undefined) return null;
  const list = Array.isArray(roleRefs)
    ? [...new Set(roleRefs.filter((r) => typeof r === 'string' && r))]
    : (roleRef ? [roleRef] : []);
  // The client sends `roleRef` already resolved to the highest-ranked entry; only
  // fall back to list[0] when it sent an array and nothing else.
  const primary = (roleRef && list.includes(roleRef)) ? roleRef : (list[0] || null);
  return { roleRefs: list, roleRef: primary };
}

module.exports = {
  volunteerRoleIds, permissionsForVolunteer, normalizeRoleRefs, rankForVolunteer, DEFAULT_ROLE_RANK,
};
