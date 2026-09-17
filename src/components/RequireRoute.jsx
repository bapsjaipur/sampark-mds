// src/components/RequireRoute.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 42 — THE URL BAR IS NOW GATED TOO, NOT JUST THE NAV.
//
// THE HOLE. lib/roleView.js shaped the SIDEBAR per role — an SK-YM never saw a
// "Dashboard" link — but App.jsx wrapped every page in nothing but <RequireAuth>.
// So the link was hidden and the route was wide open: typing /admin/dashboard, or
// following a stale bookmark, loaded the admin dashboard for anyone signed in. The
// pages that *did* self-gate used loose `anyOf` lists (view_assigned_contacts,
// which SK-YM holds) and let them straight through. "Hidden" was being mistaken
// for "protected", and the two are not the same thing.
//
// THE RULE, in the user's words: "only according to role can access only their
// sub links only." So a route is reachable IFF it is one of THIS role's own nav
// destinations — the exact set lib/roleView.js already computes as `allItems`.
// The layout, not the page's permission list, is the gate: an SK-YM classifies as
// `volunteer`, and the volunteer LAYOUT lists neither dashboard nor batches nor
// any admin screen, so those URLs are refused even though the SK holds a read
// permission the old page-level `anyOf` would have accepted. No permission list
// had to be narrowed to close the hole — the shape of the role already said no.
//
// THE FEW ROUTES THAT ARE NOT NAV LINKS get an explicit `check` instead:
//   • /contacts/:id       — a contact card. Gated on the read permission, but
//                           NOT on the `hide_all_contacts` opt-out: SK-YM holds
//                           that opt-out yet still opens cards from its own
//                           calling queue and My Contacts, which link straight here.
//   • /households/:id      — same gate as the Households list.
//   • /bal-mandal/promotion— the single most destructive bulk write in the app;
//                           its own narrow gate, not merely "can see Bal Mandal".
// `/` and `/profile` are intentionally open to any signed-in user and are left
// unwrapped in App.jsx.
//
// THE LOOP TRAP. getRoleView() guarantees homePath is reachable, so a refused
// route redirects there safely — EXCEPT when the role can reach nothing at all
// (an empty role, a misconfigured Santo). Then homePath is a fallback the role
// also cannot reach, and redirecting to it would refuse again and redirect again,
// forever. Both cases (`allItems` empty, or the redirect target is where we
// already stand) render a terminal panel instead of navigating.
//
// This is defence in depth, not the boundary. firestore.rules is the boundary; a
// blocked page here still could not have read anything it wasn't entitled to. But
// "you loaded the admin dashboard and it was empty" and "the admin dashboard is
// not yours to open" are different messages, and the user asked for the second.
// ─────────────────────────────────────────────────────────────────────────────
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../hooks/usePermissions';
import { getRoleView } from '../lib/roleView';

function NoAccessPanel() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-50">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
        </div>
        <h2 className="text-sm font-semibold text-slate-900">This page isn’t part of your role</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          Your account doesn’t have a screen to land on here. If you think this is wrong,
          ask an administrator to check the role assigned to you.
        </p>
      </div>
    </div>
  );
}

/**
 * Gate a protected route to the signed-in person's own role.
 *
 * @param {string}   [navPath] canonical nav destination; allowed iff it is one of
 *                             getRoleView().allItems — i.e. it appears in this
 *                             role's sidebar. Use for every route that IS a nav link.
 * @param {(permissions: string[], volunteer: object) => boolean} [check]
 *                             explicit predicate for routes that are not nav links
 *                             (/contacts/:id, /households/:id, /bal-mandal/promotion).
 * @param {React.ReactNode} children the page to render when allowed.
 */
export default function RequireRoute({ navPath, check, children }) {
  const { permissions, volunteer, loading } = useAuth();
  const location = useLocation();

  // RequireAuth already blocks on loading before AppLayout mounts, so this is
  // belt-and-braces: never flash a "no access" panel at a session still resolving.
  if (loading) return null;

  const view = getRoleView(permissions, volunteer);
  const ok = typeof check === 'function'
    ? check(permissions, volunteer)
    : view.allItems.some((item) => item.to === navPath);

  if (ok) return children;

  // Refused. Redirect to the role's home — unless that would loop (see header).
  if (!view.allItems.length || view.homePath === location.pathname) {
    return <NoAccessPanel />;
  }
  return <Navigate to={view.homePath} replace />;
}
