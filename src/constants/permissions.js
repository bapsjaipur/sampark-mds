// MERGED: Phase 2's labels/registry + Phase 4's helper functions, unioned.
// Single source of truth for permission strings. The Roles admin screen
// renders its checkbox matrix from ALL_PERMISSIONS — adding a new capability
// to the app is: add it here, add it to firestore.rules where relevant, and
// start gating UI/functions with it.

export const PERMISSIONS = {
  VIEW_ALL_CONTACTS: 'view_all_contacts',
  VIEW_ASSIGNED_CONTACTS: 'view_assigned_contacts',
  EDIT_CONTACTS: 'edit_contacts',
  // Separate delete gate — allows roles like Area Coordinator to edit but not delete
  DELETE_CONTACTS: 'delete_contacts',
  // Bulk delete (checkbox mass-delete) — higher risk, intended for Admin only
  BULK_DELETE_CONTACTS: 'bulk_delete_contacts',
  // 4.2 — granular page-level access
  VIEW_HOUSEHOLDS: 'view_households',
  EXPORT_DATA: 'export_data',
  ASSIGN_BATCHES: 'assign_batches',
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  // Added at Phase 5 merge — the syncFirestoreToGAS Cloud Function checks
  // for this, but it was never added to the registry until now.
  RUN_GAS_SYNC: 'run_gas_sync',
  // Added in Phase 6 (Events/Sabha):
  MANAGE_EVENTS: 'manage_events',
};

export const PERMISSION_LABELS = {
  [PERMISSIONS.VIEW_ALL_CONTACTS]: 'View All Contacts',
  [PERMISSIONS.VIEW_ASSIGNED_CONTACTS]: 'View Assigned Contacts (area/mandal only)',
  [PERMISSIONS.EDIT_CONTACTS]: 'Edit Contacts',
  [PERMISSIONS.DELETE_CONTACTS]: 'Delete Contacts & Households (single)',
  [PERMISSIONS.BULK_DELETE_CONTACTS]: 'Bulk Delete Contacts (checkbox)',
  [PERMISSIONS.VIEW_HOUSEHOLDS]: 'View Households',
  [PERMISSIONS.EXPORT_DATA]: 'Export Data (CSV / PDF)',
  [PERMISSIONS.ASSIGN_BATCHES]: 'Assign Batches',
  [PERMISSIONS.MANAGE_USERS]: 'Manage Users (volunteers)',
  [PERMISSIONS.MANAGE_ROLES]: 'Manage Roles',
  [PERMISSIONS.RUN_GAS_SYNC]: 'Run Google Sheets Backup Sync',
  [PERMISSIONS.MANAGE_EVENTS]: 'Create/Edit Events & Sabha',
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// ── Helper functions (from Phase 4) — used by components/services that
// receive a plain permissions[] array rather than calling usePermissions(). ──
export function hasPermission(permissions, permission) {
  return Array.isArray(permissions) && permissions.includes(permission);
}

export function hasAnyPermission(permissions, requiredList) {
  return Array.isArray(requiredList) && requiredList.some((p) => hasPermission(permissions, p));
}

export function hasAllPermissions(permissions, requiredList) {
  return Array.isArray(requiredList) && requiredList.every((p) => hasPermission(permissions, p));
}
