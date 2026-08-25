// src/hooks/useVolunteerIdentity.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 21 — "show me which of these contacts is a karyakarta".
//
// A volunteer exists twice in this database, and always has: once in
// `volunteers` (the login, the role, the assigned areas/mandals) and once in
// `individuals` (the person, in their household, with their mandal). Nothing
// joined the two, so a karyakarta appeared in search, in the contact list and in
// the attendance sheet as an ordinary contact — and the person marking
// attendance had no way to tell the sevak from the haribhakt they had called.
//
// THREE ways the join is made, in order of trust:
//   1. `individual.volunteerId`     — set explicitly. Always wins.
//   2. `volunteer.linkedIndividualId` — set when a login is created "From
//      contact". The reverse of (1), and the field the create form already sends.
//   3. Normalised 10-digit mobile   — the fallback that actually works on the
//      existing data, where neither link was ever written. Indian numbers are
//      compared on their last 10 digits so +91/0/spaces don't defeat it.
//
// A shared module-level listener rather than one per component: `volunteers` is
// ~22 documents and the badge is wanted in the search bar, the contacts list, the
// attendance sheet and the household pages at the same time. Refcounted, so it
// unsubscribes on the last unmount and doesn't sit there throwing
// permission-denied after logout.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Last 10 digits. "+91 98290 12345", "098290-12345" and "9829012345" are the
 * same person, and all three shapes exist in this data.
 */
export function normalizeMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

// ── Shared subscription ──────────────────────────────────────────────────────
let cache = { volunteers: [], loading: true, error: null };
const subscribers = new Set();
let unsubscribe = null;

function publish(next) {
  cache = next;
  subscribers.forEach((fn) => fn(cache));
}

function acquire(fn) {
  subscribers.add(fn);
  if (!unsubscribe) {
    unsubscribe = onSnapshot(
      collection(db, 'volunteers'),
      (snap) => publish({
        volunteers: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        loading: false,
        error: null,
      }),
      // A signed-out or role-less session can't read `volunteers`. That must not
      // break the screens the badge decorates, so it degrades to "nobody is
      // flagged" rather than throwing.
      (err) => publish({ volunteers: [], loading: false, error: err?.message || 'volunteer-directory-error' }),
    );
  }
  fn(cache);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      cache = { volunteers: [], loading: true, error: null };
    }
  };
}

/**
 * @returns {{
 *   volunteers: object[],
 *   loading: boolean,
 *   identify: (individual: object) => object|null,
 *   identifyByMobile: (mobile: string) => object|null,
 *   isVolunteer: (individual: object) => boolean,
 * }}
 */
export function useVolunteerIdentity() {
  const [state, setState] = useState(cache);

  useEffect(() => acquire(setState), []);

  const { byId, byLinkedIndividual, byMobile } = useMemo(() => {
    const byIdMap = {};
    const byLinked = {};
    const byPhone = {};
    for (const v of state.volunteers) {
      if (v.isActive === false) continue; // a disabled login is not a sevak any more
      byIdMap[v.id] = v;
      if (v.linkedIndividualId) byLinked[v.linkedIndividualId] = v;
      const phone = normalizeMobile(v.mobile);
      // First writer wins: with two volunteer logins on one number, flagging the
      // first consistently beats flipping between them as documents re-order.
      if (phone && !byPhone[phone]) byPhone[phone] = v;
    }
    return { byId: byIdMap, byLinkedIndividual: byLinked, byMobile: byPhone };
  }, [state.volunteers]);

  return useMemo(() => {
    const identify = (individual) => {
      if (!individual) return null;
      if (individual.volunteerId && byId[individual.volunteerId]) return byId[individual.volunteerId];
      if (byLinkedIndividual[individual.id]) return byLinkedIndividual[individual.id];
      const phone = normalizeMobile(individual.mobile);
      return (phone && byMobile[phone]) || null;
    };
    return {
      volunteers: state.volunteers,
      loading: state.loading,
      identify,
      identifyByMobile: (mobile) => byMobile[normalizeMobile(mobile)] || null,
      isVolunteer: (individual) => Boolean(identify(individual)),
    };
  }, [state.volunteers, state.loading, byId, byLinkedIndividual, byMobile]);
}

export default useVolunteerIdentity;
