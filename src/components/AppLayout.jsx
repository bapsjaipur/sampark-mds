// src/components/AppLayout.jsx
// FIX (earlier phase): the sidebar was a normal flex child, not fixed/sticky —
// on a tall page (1240 households!), the flex row stretched the <aside> to match
// the page's full scrollable height, which pushed the sign-out button (pinned to
// the BOTTOM of that now-enormous aside) far below the viewport. Fixed by making
// the sidebar `fixed` to the viewport with its own independent scroll.
//
// PHASE 20 — role-shaped navigation + a mobile bottom tab bar.
//
// Previously this file held the nav list inline and wrapped each item in
// <RequirePermission>. That produced identical ordering for every role: a
// volunteer's own calling queue was not linked at all (the /calling route
// existed but nothing pointed at it), and an admin found admin tools below six
// volunteer-facing links. The list now comes from lib/roleView.js, already
// filtered and ordered for the signed-in person's role.
//
// The hamburger drawer is kept, but it is no longer the ONLY way to navigate on
// a phone — a bottom tab bar carries the 4 destinations that role uses most,
// within thumb reach, plus a Menu button for the rest.
import { Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Link, Outlet, Navigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { LogOut, Menu, X, ChevronsLeft, ChevronsRight, MoreHorizontal } from 'lucide-react';
import { auth } from '../lib/firebase';
import { useAuth } from '../hooks/usePermissions';
import { getRoleView } from '../lib/roleView';
import { Avatar } from './ui/Avatar';
import { cn } from '../lib/cn';

// Screens that take over the whole viewport on mobile and manage their own
// bottom action bar. Showing the tab bar here would stack two fixed bars on top
// of each other and cover the primary action.
const IMMERSIVE_MOBILE_ROUTES = ['/calling'];

export function RequireAuth() {
  const { authUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-cream-100 text-sm text-slate-400">Loading…</div>;
  if (!authUser) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

function navLinkClass(collapsed) {
  return ({ isActive }) =>
    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${collapsed ? 'justify-center' : ''} ${
      isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
    }`;
}

function NavItem({ to, icon: Icon, collapsed, onNavigate, children }) {
  return (
    <NavLink to={to} className={navLinkClass(collapsed)} onClick={onNavigate} title={collapsed ? children : undefined}>
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && children}
    </NavLink>
  );
}

function SectionLabel({ collapsed, children }) {
  if (collapsed) return <div className="my-2 border-t border-slate-100" />;
  return <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</p>;
}

export function RoleBadge({ roleView, className }) {
  if (!roleView || roleView.key === 'none') return null;
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', roleView.badgeClass, className)}>
      {roleView.label}
    </span>
  );
}

function SidebarContent({ collapsed, onNavigate, roleView }) {
  const { volunteer } = useAuth();

  return (
    <>
      <div className={`mb-2 flex items-center px-2.5 py-1 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && <p className="text-[13px] font-semibold tracking-tight text-slate-900 truncate">BAPS Jaipur MDS</p>}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {roleView.sections.map((section, si) => (
          <div key={section.label || `main-${si}`}>
            {section.label && <SectionLabel collapsed={collapsed}>{section.label}</SectionLabel>}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.to} to={item.to} icon={item.icon} collapsed={collapsed} onNavigate={onNavigate}>
                  {item.label}
                </NavItem>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={`mt-3 flex items-center gap-2 border-t border-slate-100 px-1 pt-3 ${collapsed ? 'justify-center' : ''}`}>
        <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-2 transition-opacity hover:opacity-80" onClick={onNavigate}>
          {/* `src` was missing here and on the mobile top bar, so a volunteer who
              set a profile photo saw it only inside /profile — the one screen where
              it is least useful. Avatar already falls back to initials when src is
              empty, so passing it costs nothing. */}
          <Avatar src={volunteer?.profilePhotoURL} name={volunteer?.name} size="sm" />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-slate-700">{volunteer?.name || 'Signed in'}</span>
              <RoleBadge roleView={roleView} />
            </span>
          )}
        </Link>
        <button onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

// ── Mobile bottom tab bar ────────────────────────────────────────────────────
// 4 role-specific destinations + Menu. Tab targets are h-14 with the label
// beneath the icon, matching platform conventions and keeping every target
// comfortably above the 44px minimum.
function BottomTabBar({ roleView, onOpenMenu }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      {roleView.mobileTabs.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-orange-600' : 'text-slate-400',
            )
          }
        >
          <item.icon className="h-5 w-5" />
          <span className="max-w-full truncate px-0.5">{item.label}</span>
        </NavLink>
      ))}
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-slate-400"
      >
        <MoreHorizontal className="h-5 w-5" />
        <span>More</span>
      </button>
    </nav>
  );
}

export default function AppLayout() {
  const { permissions, volunteer } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mds_sidebar_collapsed') === '1');

  const roleView = useMemo(() => getRoleView(permissions, volunteer), [permissions, volunteer]);

  useEffect(() => {
    localStorage.setItem('mds_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes (the onNavigate handlers
  // on links cover the common case; this is the fallback for programmatic nav).
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const immersive = IMMERSIVE_MOBILE_ROUTES.includes(location.pathname);

  return (
    <div className="min-h-screen bg-cream-100">
      {/* Mobile top bar — hidden on immersive screens, which supply their own header */}
      {!immersive && (
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-2.5 md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
            <Menu className="h-5 w-5" />
          </button>
          <p className="text-[13px] font-semibold tracking-tight text-slate-900">BAPS Jaipur MDS</p>
          <div className="ml-auto flex items-center gap-2">
            <RoleBadge roleView={roleView} />
            <Link to="/profile" aria-label="Profile"><Avatar src={volunteer?.profilePhotoURL} name={volunteer?.name} size="sm" /></Link>
          </div>
        </div>
      )}

      {/* Mobile drawer + backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white px-3 py-4 shadow-xl">
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute right-3 top-3 rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} roleView={roleView} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — fixed to the viewport, independent scroll */}
      <aside className={`hidden md:fixed md:inset-y-0 md:left-0 md:flex md:flex-col md:border-r md:border-slate-100 md:bg-white md:px-3 md:py-4 md:transition-all ${collapsed ? 'md:w-16' : 'md:w-56'}`}>
        <SidebarContent collapsed={collapsed} onNavigate={undefined} roleView={roleView} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <><ChevronsLeft className="h-3.5 w-3.5" /> Collapse</>}
        </button>
      </aside>

      {/* Main content — offset to clear the fixed desktop sidebar. The bottom
          padding clears the mobile tab bar; without it the last row of any list
          sits permanently underneath it and can't be tapped. */}
      <main className={cn('min-w-0 transition-all', collapsed ? 'md:pl-16' : 'md:pl-56', !immersive && 'pb-14 md:pb-0')}>
        {/* PHASE 43 — the boundary for React.lazy() route chunks. It sits INSIDE
            the shell (sidebar + tab bar already rendered above/below), so a page
            arriving on its own chunk shows this line rather than blanking the
            whole screen the way a top-level Suspense would. */}
        <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>

      {!immersive && <BottomTabBar roleView={roleView} onOpenMenu={() => setMobileOpen(true)} />}
    </div>
  );
}
