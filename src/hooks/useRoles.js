// src/hooks/useRoles.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 32 — the roles collection, once, for everybody.
//
// Roles are the app's answer to "who is this person" — they carry `permissions`,
// `scopeKind` and `presetKey`, and a volunteer document holds nothing but ids
// pointing at them. Several screens need to look a role up (which of these
// volunteers is a Nirikshak? what is this person's rank?) and until now each one
// either ran its own getDocs or, worse, guessed from a `roleKey` field on the
// volunteer that no save path has ever written.
//
// Going through useSharedCollection means every caller after the first is free:
// the listener is keyed, so N screens open ONE Firestore listener between them.
// The roles collection is a handful of documents that change perhaps monthly, so
// this is one of the cheapest listeners in the app.
//
// firestore.rules keeps `roles` readable by any signed-in volunteer — it has to,
// since ctx() must read the caller's own role to resolve their permissions — so
// there is no scoping to apply here.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { collection, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSharedCollection } from './useSharedCollection';

/**
 * Every role document, plus a byId map for the common lookup.
 * @returns {{ roles: any[], rolesById: Map<string, any>, loading: boolean, error: Error|null }}
 */
export function useRoles() {
  const specs = useMemo(() => ([{
    key: 'roles:all',
    build: () => query(collection(db, 'roles')),
    source: 'useRoles',
  }]), []);

  const { rows, loading, error } = useSharedCollection(specs);

  const rolesById = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(r.id, r);
    return map;
  }, [rows]);

  return { roles: rows, rolesById, loading, error };
}

/**
 * The role documents a volunteer holds. `roleRefs` is the real list; `roleRef`
 * is the primary, mirrored on every save for firestore.rules (which cannot loop
 * over a list). Read both so a document written by either path resolves.
 */
export function rolesOfVolunteer(volunteer, rolesById) {
  if (!volunteer || !rolesById) return [];
  const ids = Array.isArray(volunteer.roleRefs) && volunteer.roleRefs.length
    ? volunteer.roleRefs
    : (volunteer.roleRef ? [volunteer.roleRef] : []);
  return ids.map((id) => rolesById.get(id)).filter(Boolean);
}
