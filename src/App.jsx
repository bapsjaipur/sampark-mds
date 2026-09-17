// src/App.jsx
// Adds: /login (public), RequireAuth guard wrapping everything else,
// AppLayout (nav + sign out) wrapping the protected routes.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/usePermissions";
import { ToastProvider } from "./contexts/ToastContext";
import { getRoleView, canRunStandardPromotion } from "./lib/roleView";
import RequireRoute from "./components/RequireRoute";
import LoginPage from "./pages/LoginPage";
import PrivacyPolicyPage from "./pages/legal/PrivacyPolicyPage";
import TermsPage from "./pages/legal/TermsPage";
import AppLayout, { RequireAuth } from "./components/AppLayout";
import HouseholdsPage from "./pages/HouseholdsPage";
import HouseholdDetailPage from "./pages/HouseholdDetailPage";
import ContactsPage from "./pages/ContactsPage";
import EventsPage from "./pages/EventsPage";
import CallingFlowPage from "./pages/CallingFlowPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import BatchesPage from "./pages/BatchesPage";
import { RolesManager } from "./admin/RolesManager";
import { VolunteerEditor } from "./admin/VolunteerEditor";
import { AreasMandalsManager } from "./admin/AreasMandalsManager";
import AdminToolsPage from "./pages/AdminToolsPage";
import RemindersDashboard from "./components/reminders/RemindersDashboard";
import IndividualDetailPage from "./pages/IndividualDetailPage";
import PadhramaniPage from "./pages/PadhramaniPage";
import SantoSchedulePage from "./pages/SantoSchedulePage";
import MyContactsPage from "./pages/MyContactsPage";
import ProfilePage from "./pages/ProfilePage";
import BalMandalDashboard from "./pages/BalMandalDashboard";
import StandardPromotionPage from "./pages/StandardPromotionPage";

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

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Public legal pages — linked from the Google OAuth consent screen,
                so they must stay OUTSIDE RequireAuth (a signed-out reviewer opens
                them directly). See src/pages/legal/LegalShell.jsx. */}
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                {/* PHASE 42 — every protected route is now gated to the role's own
                    nav links (RequireRoute). `/` and `/profile` are the two
                    intentional exceptions: any signed-in user may reach them.
                    Non-nav routes carry an explicit `check`; see RequireRoute. */}
                <Route path="/" element={<DefaultRedirect />} />
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
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
