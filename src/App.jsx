// src/App.jsx
// Adds: /login (public), RequireAuth guard wrapping everything else,
// AppLayout (nav + sign out) wrapping the protected routes.
//
// PHASE 43 — LOAD SPEED. Every page component below is React.lazy(), so a
// browser downloads the JS for the screen it is actually on, not all twenty. The
// shell — providers, the router, AppLayout, RequireAuth, RequireRoute — stays
// eager (it is on every screen), and the <Suspense> that catches a page while
// its chunk arrives lives inside AppLayout around the <Outlet>, so the sidebar
// and tab bar never blink. The public routes below get their own top-level
// Suspense because they render before the layout exists. Paired with the vendor
// manualChunks in vite.config.js, this turns one 2.6 MB bundle into a small
// shell plus per-route chunks: the calling karyekarta no longer pays to download
// the admin tools, the import wizard, or the PDF/xlsx libraries to answer a call.
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/usePermissions";
import { ToastProvider } from "./contexts/ToastContext";
import ConfirmHost from "./components/ui/ConfirmHost";
import { titleForPath } from "./lib/pageTitle";
import { getRoleView, canRunStandardPromotion } from "./lib/roleView";
import RequireRoute from "./components/RequireRoute";
import AppLayout, { RequireAuth } from "./components/AppLayout";

// Lazy pages — each becomes its own chunk. The three admin managers export a
// default alongside their named export, so the plain import() form resolves them.
const LoginPage = lazy(() => import("./pages/LoginPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const PrivacyPolicyPage = lazy(() => import("./pages/legal/PrivacyPolicyPage"));
const TermsPage = lazy(() => import("./pages/legal/TermsPage"));
const HouseholdsPage = lazy(() => import("./pages/HouseholdsPage"));
const HouseholdDetailPage = lazy(() => import("./pages/HouseholdDetailPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const CallingFlowPage = lazy(() => import("./pages/CallingFlowPage"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"));
const BatchesPage = lazy(() => import("./pages/BatchesPage"));
const RolesManager = lazy(() => import("./admin/RolesManager"));
const VolunteerEditor = lazy(() => import("./admin/VolunteerEditor"));
const AreasMandalsManager = lazy(() => import("./admin/AreasMandalsManager"));
const AdminToolsPage = lazy(() => import("./pages/AdminToolsPage"));
const RemindersDashboard = lazy(() => import("./components/reminders/RemindersDashboard"));
const IndividualDetailPage = lazy(() => import("./pages/IndividualDetailPage"));
const PadhramaniPage = lazy(() => import("./pages/PadhramaniPage"));
const SantoSchedulePage = lazy(() => import("./pages/SantoSchedulePage"));
const MyContactsPage = lazy(() => import("./pages/MyContactsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const BalMandalDashboard = lazy(() => import("./pages/BalMandalDashboard"));
const StandardPromotionPage = lazy(() => import("./pages/StandardPromotionPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

// Public routes render before AppLayout (and its Suspense) exist, so they need a
// boundary of their own. Full-screen because there is no shell to keep visible.
function PublicFallback() {
  return <div className="flex min-h-screen items-center justify-center bg-cream-100 text-sm text-slate-400">Loading…</div>;
}

// Phase 20 — landing page now comes from lib/roleView.js rather than a ladder
// of if-statements here. The old ladder sent anyone with view_assigned_contacts
// to /contacts, which meant a volunteer whose entire job is the calling queue
// landed on a list they can barely filter. getRoleView() also guarantees the
// destination is one this role can actually reach, so login can no longer bounce
// straight into a permission-denied screen.
function DefaultRedirect() {
  const { permissions, volunteer, loading } = useAuth();
  if (loading) return null;
  const { homePath } = getRoleView(permissions, volunteer);
  return <Navigate to={homePath} replace />;
}

// PHASE 45 — the signed-out landing screen. "/" used to live inside RequireAuth,
// so the very first thing a logged-out visitor saw was the bare sign-in form.
// Now "/" is public and gated here: a signed-out visitor gets the HomePage
// landing screen (brand + a Sign In button), while a signed-in one is forwarded
// to their role's home exactly as DefaultRedirect always did. The deep protected
// routes still send a logged-out visitor to /login (with return state), so a
// bookmarked inner page behaves as before — only the front door gained a lobby.
function RootGate() {
  const { authUser, loading } = useAuth();
  if (loading) return <PublicFallback />;
  return authUser ? <DefaultRedirect /> : <HomePage />;
}

// PHASE 44 — one place that keeps the browser tab title in step with the route,
// so history and bookmarks read "Households · BAPS Jaipur MDS", not twenty tabs
// all called "BAPS Jaipur MDS". Sits inside the router; covers public routes too.
function TitleManager() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        {/* PHASE 44 — the styled confirm dialog's host. Mounted once here so
            confirmDialog() from any screen has somewhere to render. */}
        <ConfirmHost />
        <BrowserRouter>
          <TitleManager />
          <Suspense fallback={<PublicFallback />}>
            <Routes>
              {/* PHASE 45 — "/" is public now: the landing screen for a signed-out
                  visitor, a role-home redirect for a signed-in one (see RootGate). */}
              <Route path="/" element={<RootGate />} />
              <Route path="/login" element={<LoginPage />} />
              {/* Public legal pages — linked from the Google OAuth consent screen,
                  so they must stay OUTSIDE RequireAuth (a signed-out reviewer opens
                  them directly). See src/pages/legal/LegalShell.jsx. */}
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/terms" element={<TermsPage />} />

              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  {/* PHASE 42 — every protected route is now gated to the role's own
                      nav links (RequireRoute). `/profile` is the intentional
                      exception: any signed-in user may reach it. ("/" itself is now
                      public — handled by RootGate above — so it is no longer here.)
                      Non-nav routes carry an explicit `check`; see RequireRoute. */}
                  <Route path="/profile" element={<ProfilePage />} />

                  <Route path="/calling" element={<RequireRoute navPath="/calling"><CallingFlowPage /></RequireRoute>} />
                  <Route path="/households" element={<RequireRoute navPath="/households"><HouseholdsPage /></RequireRoute>} />
                  <Route path="/households/:householdId" element={<RequireRoute check={(p) => p.includes('view_households')}><HouseholdDetailPage /></RequireRoute>} />
                  <Route path="/contacts" element={<RequireRoute navPath="/contacts"><ContactsPage /></RequireRoute>} />
                  {/* Contact card: gated on the read permission but NOT on the
                      hide_all_contacts opt-out — SK-YM holds that opt-out yet opens
                      cards straight from its calling queue and My Contacts. */}
                  <Route path="/contacts/:id" element={<RequireRoute check={(p) => ['view_all_contacts', 'view_assigned_contacts', 'edit_contacts'].some((x) => p.includes(x))}><IndividualDetailPage /></RequireRoute>} />
                  <Route path="/padhramani" element={<RequireRoute navPath="/padhramani"><PadhramaniPage /></RequireRoute>} />
                  <Route path="/santo-schedule" element={<RequireRoute navPath="/santo-schedule"><SantoSchedulePage /></RequireRoute>} />
                  <Route path="/my-contacts" element={<RequireRoute navPath="/my-contacts"><MyContactsPage /></RequireRoute>} />
                  <Route path="/events" element={<RequireRoute navPath="/events"><EventsPage /></RequireRoute>} />
                  <Route path="/bal-mandal" element={<RequireRoute navPath="/bal-mandal"><BalMandalDashboard /></RequireRoute>} />
                  <Route path="/bal-mandal/promotion" element={<RequireRoute check={canRunStandardPromotion}><StandardPromotionPage /></RequireRoute>} />
                  <Route path="/admin/dashboard" element={<RequireRoute navPath="/admin/dashboard"><AdminDashboardPage /></RequireRoute>} />
                  <Route path="/admin/batches" element={<RequireRoute navPath="/admin/batches"><BatchesPage /></RequireRoute>} />
                  <Route path="/reminders" element={<RequireRoute navPath="/reminders"><RemindersDashboard /></RequireRoute>} />
                  <Route path="/admin/roles" element={<RequireRoute navPath="/admin/roles"><RolesManager /></RequireRoute>} />
                  <Route path="/admin/volunteers" element={<RequireRoute navPath="/admin/volunteers"><VolunteerEditor /></RequireRoute>} />
                  <Route path="/admin/areas-mandals" element={<RequireRoute navPath="/admin/areas-mandals"><AreasMandalsManager /></RequireRoute>} />
                  <Route path="/admin/tools" element={<RequireRoute navPath="/admin/tools"><AdminToolsPage /></RequireRoute>} />
                  {/* PHASE 44 — catch-all 404, inside the shell so nav stays. Any
                      unmatched path a signed-in user reaches lands here. */}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
