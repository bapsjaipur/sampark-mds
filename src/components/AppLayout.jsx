// src/components/AppLayout.jsx
// FIX: the sidebar was a normal flex child, not fixed/sticky — on a tall
// page (1240 households!), the flex row stretched the <aside> to match the
// page's full scrollable height, which pushed the sign-out button (pinned
// to the BOTTOM of that now-enormous aside) far below the viewport. Fixed
// by making the sidebar `fixed` to the viewport with its own independent
// scroll, and the main content area scrolls separately.
// ADDED: a mobile hamburger drawer (sidebar is off-canvas below `md`,
// slides in over a backdrop) and a desktop collapse-to-icons toggle,
// persisted in localStorage.
import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import {
  Home, Users, CalendarDays, Bell, ListChecks, LayoutDashboard,
  ShieldCheck, UserCog, MapPin, Wrench, LogOut, Menu, X, ChevronsLeft, ChevronsRight,
  HeartHandshake,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { useAuth } from '../hooks/usePermissions';
import { RequirePermission } from './RequirePermission';
import { Avatar } from './ui/Avatar';

export function RequireAuth() {
  const { authUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Loading\u2026</div>;
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

function SidebarContent({ collapsed, onNavigate }) {
  const { volunteer } = useAuth();

  return (
    <>
      <div className={`mb-2 flex items-center px-2.5 py-1 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && <p className="text-[13px] font-semibold text-slate-900 tracking-tight truncate">BAPS Jaipur MDS</p>}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        <NavItem to="/households" icon={Home} collapsed={collapsed} onNavigate={onNavigate}>Households</NavItem>
        <RequirePermission anyOf={['view_all_contacts', 'view_assigned_contacts', 'edit_contacts']}>
          <NavItem to="/contacts" icon={Users} collapsed={collapsed} onNavigate={onNavigate}>All Contacts</NavItem>
        </RequirePermission>
        <NavItem to="/events" icon={CalendarDays} collapsed={collapsed} onNavigate={onNavigate}>Events</NavItem>
        <NavItem to="/padhramani" icon={HeartHandshake} collapsed={collapsed} onNavigate={onNavigate}>Padhramani</NavItem>
        <NavItem to="/reminders" icon={Bell} collapsed={collapsed} onNavigate={onNavigate}>Reminders</NavItem>

        <RequirePermission anyOf={['assign_batches', 'view_all_contacts', 'view_assigned_contacts', 'manage_users', 'manage_roles', 'run_gas_sync']}>
          <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
        </RequirePermission>
        <RequirePermission permission="assign_batches">
          <NavItem to="/admin/batches" icon={ListChecks} collapsed={collapsed} onNavigate={onNavigate}>Batches</NavItem>
        </RequirePermission>
        <RequirePermission anyOf={['view_all_contacts', 'view_assigned_contacts']}>
          <NavItem to="/admin/dashboard" icon={LayoutDashboard} collapsed={collapsed} onNavigate={onNavigate}>Dashboard</NavItem>
        </RequirePermission>
        <RequirePermission permission="manage_roles">
          <NavItem to="/admin/roles" icon={ShieldCheck} collapsed={collapsed} onNavigate={onNavigate}>Roles</NavItem>
        </RequirePermission>
        <RequirePermission permission="manage_users">
          <NavItem to="/admin/volunteers" icon={UserCog} collapsed={collapsed} onNavigate={onNavigate}>Volunteers</NavItem>
        </RequirePermission>
        <RequirePermission permission="manage_users">
          <NavItem to="/admin/areas-mandals" icon={MapPin} collapsed={collapsed} onNavigate={onNavigate}>Areas & Mandals</NavItem>
        </RequirePermission>
        <RequirePermission anyOf={['view_all_contacts', 'manage_users', 'run_gas_sync']}>
          <NavItem to="/admin/tools" icon={Wrench} collapsed={collapsed} onNavigate={onNavigate}>Admin Tools</NavItem>
        </RequirePermission>
      </nav>

      <div className={`mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 px-1 ${collapsed ? 'justify-center' : ''}`}>
        <Avatar name={volunteer?.name} size="sm" />
        {!collapsed && <span className="flex-1 truncate text-[13px] font-medium text-slate-700">{volunteer?.name || 'Signed in'}</span>}
        <button onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mds_sidebar_collapsed') === '1');

  useEffect(() => {
    localStorage.setItem('mds_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes (handled via onNavigate on links too, this is a fallback).
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Mobile top bar — only visible below md */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-2.5 md:hidden">
        <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
          <Menu className="h-5 w-5" />
        </button>
        <p className="text-[13px] font-semibold text-slate-900 tracking-tight">BAPS Jaipur MDS</p>
      </div>

      {/* Mobile drawer + backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white px-3 py-4 shadow-xl">
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute right-3 top-3 rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — fixed to the viewport, independent scroll, doesn't stretch with page content */}
      <aside className={`hidden md:fixed md:inset-y-0 md:left-0 md:flex md:flex-col md:border-r md:border-slate-100 md:bg-white md:px-3 md:py-4 md:transition-all ${collapsed ? 'md:w-16' : 'md:w-56'}`}>
        <SidebarContent collapsed={collapsed} onNavigate={undefined} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <><ChevronsLeft className="h-3.5 w-3.5" /> Collapse</>}
        </button>
      </aside>

      {/* Main content — offset to clear the fixed desktop sidebar, scrolls independently */}
      <main className={`min-w-0 transition-all ${collapsed ? 'md:pl-16' : 'md:pl-56'}`}>
        <Outlet />
      </main>
    </div>
  );
}
