// src/hooks/useSabhaSchedules.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 33 — the recurring-sabha rules, once, for everybody.
//
// One document per (area, mandal) pair — tens of documents that change perhaps
// monthly. Through useSharedCollection it is a single keyed listener no matter
// how many screens ask for it, which keeps the whole "All Area Sabhas" grid at
// essentially zero marginal read cost on a page that already subscribes to
// events and attendance.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { collection, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSharedCollection } from './useSharedCollection';

/**
 * @returns {{ schedules: any[], loading: boolean, error: Error|null }}
 */
export function useSabhaSchedules() {
  const specs = useMemo(() => ([{
    key: 'sabhaSchedules:all',
    build: () => query(collection(db, 'sabhaSchedules')),
    source: 'useSabhaSchedules',
  }]), []);

  const { rows, loading, error } = useSharedCollection(specs);
  return { schedules: rows, loading, error };
}
