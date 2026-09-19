// src/hooks/usePresence.js
// PHASE 25 — presence & self-reported usage, split off the volunteer document.
//
// The heartbeat used to stamp `lastSeenAt` + `usage` onto volunteers/{uid} every
// ten minutes. But five admin screens hold a live listener on the whole volunteers
// collection (see useVolunteers.js), so every online person's beat re-delivered
// their doc to ALL of them — churn that scaled with team size × screens open, on a
// collection whose real data (name, role, scope) almost never changes.
//
// Presence now lives in its own `presence/{uid}` collection. Only the two screens
// that actually display it — the Volunteers editor's "online now" dot and the Free
// Tier Usage dashboard — open THIS listener, and they open it only while on screen.
// The other three roster screens (Roles, Admin dashboard, Batches, Events) stop
// paying for heartbeat churn entirely, because volunteers/{uid} no longer moves.
//
// A role without read access gets an empty map and a blank dot, not a crash.
import { useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSharedCollection } from './useSharedCollection';

const SPEC = [{ key: 'presence', source: 'presence', build: () => collection(db, 'presence') }];

/** @returns {{ presence: any[], byId: Map<string, any>, loading: boolean, error: Error|null }} */
export function usePresence() {
  const { rows, loading, error } = useSharedCollection(SPEC);
  const byId = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => m.set(r.id, r));
    return m;
  }, [rows]);
  return { presence: rows, byId, loading, error };
}
