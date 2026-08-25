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

module.exports = { volunteerRoleIds, permissionsForVolunteer, normalizeRoleRefs };
