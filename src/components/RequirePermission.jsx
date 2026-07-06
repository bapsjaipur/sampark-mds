// src/components/RequirePermission.jsx
// CANONICAL — Phase 2's richer implementation (anyOf/allOf/disableOnly/
// loadingFallback), kept as the merged version since Phase 3's usage
// (`permission="edit_contacts"` only) is a strict subset of this API.
// Exports BOTH named and default, since Phase 2's admin screens import
// `{ RequirePermission }` and Phase 3's pages import a default export.
//
// NOTE: this is a UI convenience only — it hides/disables affordances so
// people aren't tempted to click things they can't do. It is NOT the
// security boundary. firestore.rules is the real enforcement layer; this
// component just matches it so the UI doesn't lie to the user.

import { usePermissions } from '../hooks/usePermissions';

export function RequirePermission({
  permission,
  anyOf,
  any, // alias of anyOf, for Phase 3 call sites
  allOf,
  fallback = null,
  loadingFallback = null,
  disableOnly = false,
  children,
}) {
  const { hasPermission, hasAnyPermission, hasAllPermissions, loading } = usePermissions();

  if (loading) return loadingFallback;

  const anyList = anyOf || any;

  let allowed;
  if (anyList) allowed = hasAnyPermission(anyList);
  else if (allOf) allowed = hasAllPermissions(allOf);
  else allowed = hasPermission(permission);

  if (allowed) return children;

  if (disableOnly) {
    return (
      <div aria-disabled="true" title="You don't have permission for this" className="opacity-40 pointer-events-none select-none">
        {children}
      </div>
    );
  }

  return fallback;
}

export default RequirePermission;
