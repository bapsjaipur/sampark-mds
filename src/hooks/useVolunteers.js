// src/hooks/useVolunteers.js
// PHASE 24 — one shared listener for the volunteers roster.
//
// Five screens need the whole roster: the Volunteers editor, Roles & Permissions
// (to count and re-stamp holders), the Admin dashboard, Batches (to offer people
// to assign to) and Events (for the "Marked by" column). Each used to open its own
// listener, so an admin moving between them paid for the roster again every time.
// One shared store now serves all of them, sorted by name once.
//
// A role without read access to `volunteers` gets an empty array and a blank
// column, not a crash — which is why nothing here surfaces the error.
import { useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSharedCollection } from './useSharedCollection';

const SPEC = [{ key: 'volunteers', source: 'volunteers', build: () => collection(db, 'volunteers') }];

/** @returns {{ volunteers: any[], loading: boolean, error: Error|null }} */
export function useVolunteers() {
  const { rows, loading, error } = useSharedCollection(SPEC);
  const volunteers = useMemo(
    () => [...rows].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [rows],
  );
  return { volunteers, loading, error };
}
