// src/services/statsService.js
// Phase 8 — computes the admin overview stats client-side from already-
// loaded individuals/volunteers/batches, mirroring getAdminStats()'s output
// shape from CodeGSV5.gs (totalContacts, totalCalled, statusBreakdown,
// byMandal), but computed in the browser rather than a GAS endpoint.
//
// PHASE 9: both functions accept an optional `scope` — { mandals,
// householdIds, unscoped } (same shape reminderService.js uses). This is
// what makes the Moderator screen just this same dashboard, pre-filtered,
// instead of a separate codepath — a moderator is a volunteer with
// view_assigned_contacts + assignedAreas/assignedMandals, not a hardcoded
// role, matching the app's permission-based architecture throughout.

function individualInScope(ind, scope) {
  if (!scope || scope.unscoped) return true;
  if (scope.mandals?.length && ind.mandal && scope.mandals.includes(ind.mandal)) return true;
  if (scope.householdIds?.length && scope.householdIds.includes(ind.householdId)) return true;
  return false;
}

export function computeOverviewStats(individuals, scope) {
  const scoped = scope && !scope.unscoped ? individuals.filter((i) => individualInScope(i, scope)) : individuals;
  const total = scoped.length;
  const statusBreakdown = {};
  let called = 0;

  for (const ind of scoped) {
    const status = ind.status || '';
    if (status) {
      called++;
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
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

  return { total, called, statusBreakdown, byMandal };
}

/** Per-volunteer activity: how many people each volunteer has called (status
 * set) among the individuals in batches assigned to them. When scoped
 * (moderator view), only batches whose own `area` falls in the moderator's
 * assignedAreas are counted — batches already carry an `area` field, so
 * this doesn't need a household lookup the way individual-level scoping does. */
export function computeVolunteerStats(individuals, batches, volunteers, scope) {
  const individualsById = new Map(individuals.map((i) => [i.id, i]));
  const scopedBatches = scope && !scope.unscoped
    ? batches.filter((b) => scope.areas?.includes(b.area))
    : batches;

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
