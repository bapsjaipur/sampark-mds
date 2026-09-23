// src/services/statsService.js
// Phase 8 — computes the admin overview stats client-side from already-
// loaded individuals/volunteers/batches, mirroring getAdminStats()'s output
// shape from CodeGSV5.gs (totalContacts, totalCalled, statusBreakdown,
// byMandal), but computed in the browser rather than a GAS endpoint.
//
// PHASE 9: both functions accept an optional `scope`. This is what makes the
// Moderator screen just this same dashboard, pre-filtered, instead of a separate
// codepath — a moderator is a volunteer with view_assigned_contacts and an
// assigned territory, not a hardcoded role, matching the app's permission-based
// architecture throughout.

// PHASE 31 — SCOPE. `scope` is now the canonical object from lib/scope.js
// (resolveScope), optionally carrying an extra `householdIds` array. That
// replaces the ad-hoc `{ unscoped, mandals, householdIds, areas }` shape this
// file invented, which had two holes:
//
//   • it ORed mandal against household, so an INTERSECT (area × mandal)
//     karyakarta was counted as a UNION — wider than their actual access, and
//     wider than every other list in the app showed them; and
//   • computeVolunteerStats filtered batches by AREA alone, so a MANDAL-scoped
//     Super Moderator — who has no assigned areas — matched no batch at all and
//     saw an empty Volunteer Activity table.
//
// Both now defer to matchesScope()/filterBatchesByScope(), the same predicates
// the Contacts list and the Batches page use, so the dashboard cannot disagree
// with the screens it summarises.
import { matchesScope, SCOPE_KINDS } from '../lib/scope';
import { filterBatchesByScope } from './batchService';

/**
 * The area to judge an individual by. Their own denormalised `area` first
 * (standalone contacts only have that), falling back to "is their household one
 * of the ones we looked up for the assigned areas" — which is what the optional
 * `scope.householdIds` is for, and the only reason it still exists.
 */
function individualArea(ind, scope) {
  if (ind?.area) return ind.area;
  if (scope?.householdIds?.length && ind?.householdId && scope.householdIds.includes(ind.householdId)) {
    // Membership is the answer; any assigned area serves as the matching value.
    return scope.areas?.[0] || null;
  }
  return null;
}

function individualInScope(ind, scope) {
  if (!scope || scope.unrestricted) return true;
  if (scope.kind === SCOPE_KINDS.NONE) return false;
  return matchesScope(scope, { area: individualArea(ind, scope), mandal: ind?.mandal || null });
}

/**
 * The exact set of people the dashboard's numbers are about.
 *
 * PHASE 29 — exported because "reset the dashboard" has to clear precisely the
 * contacts the dashboard counted, no more. Keeping the predicate in one place is
 * what guarantees the reset and the number above it can never disagree.
 */
export function filterInScope(individuals = [], scope) {
  if (!scope || scope.unrestricted) return individuals;
  return individuals.filter((i) => individualInScope(i, scope));
}

export function computeOverviewStats(individuals, scope) {
  const scoped = filterInScope(individuals, scope);
  const total = scoped.length;
  const statusBreakdown = {};
  // PHASE 42 — how many contacts keep each niyam. Keyed by niyam KEY (stable);
  // the dashboard resolves keys → labels via useNiyamDharma so a re-spelt niyam
  // still lines up. Counted in the same pass to avoid a second loop.
  const niyamBreakdown = {};
  let called = 0;

  for (const ind of scoped) {
    const status = ind.status || '';
    if (status) {
      called++;
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    }
    if (Array.isArray(ind.niyamDharma)) {
      for (const key of ind.niyamDharma) {
        if (key) niyamBreakdown[key] = (niyamBreakdown[key] || 0) + 1;
      }
    }
  }

  const byMandal = {};
  for (const ind of scoped) {
    const mandal = ind.mandal || 'Unassigned';
    if (!byMandal[mandal]) byMandal[mandal] = { total: 0, called: 0, interested: 0, statusBreakdown: {} };
    const m = byMandal[mandal];
    m.total++;
    if (ind.status) {
      m.called++;
      m.statusBreakdown[ind.status] = (m.statusBreakdown[ind.status] || 0) + 1;
      if (ind.status === 'Interested' || ind.status === 'Already Volunteer') m.interested++;
    }
  }

  return { total, called, statusBreakdown, niyamBreakdown, byMandal };
}

/** Per-volunteer activity: how many people each volunteer has called (status
 * set) among the individuals in batches assigned to them. When scoped, only
 * batches inside the viewer's territory are counted — via filterBatchesByScope,
 * the same predicate the Batches page lists with, so a mandal head sees the
 * mandal's volunteers and an area head sees the area's. */
export function computeVolunteerStats(individuals, batches, volunteers, scope) {
  const individualsById = new Map(individuals.map((i) => [i.id, i]));
  const scopedBatches = filterBatchesByScope(batches || [], scope);

  return volunteers.map((v) => {
    const myBatches = scopedBatches.filter((b) => b.assignedVolunteerId === v.id);
    const ids = new Set();
    myBatches.forEach((b) => (b.individualIds || []).forEach((id) => ids.add(id)));
    let called = 0;
    let interested = 0;
    ids.forEach((id) => {
      const ind = individualsById.get(id);
      if (ind?.status) {
        called++;
        if (ind.status === 'Interested' || ind.status === 'Already Volunteer') interested++;
      }
    });
    return { volunteer: v, assigned: ids.size, called, interested, remaining: ids.size - called };
  }).filter((row) => row.assigned > 0);
}
