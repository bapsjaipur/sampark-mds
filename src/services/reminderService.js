// src/services/reminderService.js
// MERGE FIX: import path — '../lib/permissions' -> '../constants/permissions'
// (canonical location established by Phase 2's folder structure).
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getMonthDayWindow, isMonthDayInWindows } from '../lib/dateRanges';
import { chunk } from '../lib/firestoreHelpers';
import { PERMISSIONS, hasPermission } from '../constants/permissions';

export async function getHouseholdIdsForAreas(areas) {
  if (!areas?.length) return [];
  const ids = new Set();
  for (const c of chunk(areas)) {
    const snap = await getDocs(query(collection(db, 'households'), where('area', 'in', c)));
    snap.forEach((d) => ids.add(d.id));
  }
  return [...ids];
}

async function queryByField(field, windows, { mandals, householdIds, unscoped }) {
  const results = new Map();

  for (const w of windows) {
    const rangeConstraints = [where(field, '>=', w.start), where(field, '<=', w.end)];
    const queries = [];

    if (unscoped) {
      queries.push(query(collection(db, 'individuals'), ...rangeConstraints));
    } else {
      for (const c of chunk(mandals || [])) {
        queries.push(query(collection(db, 'individuals'), ...rangeConstraints, where('mandal', 'in', c)));
      }
      for (const c of chunk(householdIds || [])) {
        queries.push(query(collection(db, 'individuals'), ...rangeConstraints, where('householdId', 'in', c)));
      }
    }

    for (const q of queries) {
      const snap = await getDocs(q);
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
    }
  }

  return [...results.values()];
}

/**
 * Fetches upcoming birthday/anniversary reminders scoped to a volunteer's
 * access, grouped into "thisWeek" (next 7 days) and "thisMonth" (8-30 days).
 * Scope = view_all_contacts ? everyone
 *       : union of (households in assignedAreas) ∪ (individuals in assignedMandals)
 */
export async function getReminders({ volunteer, permissions }) {
  const unscoped = hasPermission(permissions, PERMISSIONS.VIEW_ALL_CONTACTS);

  let mandals = null;
  let householdIds = null;

  if (!unscoped) {
    mandals = volunteer.assignedMandals || [];
    householdIds = await getHouseholdIdsForAreas(volunteer.assignedAreas || []);
    if (!mandals.length && !householdIds.length) return { thisWeek: [], thisMonth: [] };
  }

  const windows30 = getMonthDayWindow(30);
  const windows7 = getMonthDayWindow(7);
  const scope = { mandals, householdIds, unscoped };

  const [dobResults, annResults] = await Promise.all([
    queryByField('dobMonthDay', windows30, scope),
    queryByField('anniversaryMonthDay', windows30, scope),
  ]);

  const entries = [
    ...dobResults.map((ind) => ({ individual: ind, type: 'dob', monthDay: ind.dobMonthDay })),
    ...annResults.map((ind) => ({ individual: ind, type: 'anniversary', monthDay: ind.anniversaryMonthDay })),
  ];

  const thisWeek = entries.filter((e) => isMonthDayInWindows(e.monthDay, windows7));
  const thisMonth = entries.filter((e) => !isMonthDayInWindows(e.monthDay, windows7));

  const byMonthDay = (a, b) => (a.monthDay < b.monthDay ? -1 : 1);
  thisWeek.sort(byMonthDay);
  thisMonth.sort(byMonthDay);

  return { thisWeek, thisMonth };
}
