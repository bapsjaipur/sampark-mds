// src/App.jsx
// Adds: /login (public), RequireAuth guard wrapping everything else,
// AppLayout (nav + sign out) wrapping the protected routes.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/usePermissions";
import { ToastProvider } from "./contexts/ToastContext";
import { getRoleView } from "./lib/roleView";
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
                <Route path="/" element={<DefaultRedirect />} />
                <Route path="/calling" element={<CallingFlowPage />} />
                <Route path="/households" element={<HouseholdsPage />} />
                <Route path="/households/:householdId" element={<HouseholdDetailPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/contacts/:id" element={<IndividualDetailPage />} />
                <Route path="/padhramani" element={<PadhramaniPage />} />
                <Route path="/santo-schedule" element={<SantoSchedulePage />} />
                <Route path="/my-contacts" element={<MyContactsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/bal-mandal" element={<BalMandalDashboard />} />
                <Route path="/bal-mandal/promotion" element={<StandardPromotionPage />} />
                <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
                <Route path="/admin/batches" element={<BatchesPage />} />
                <Route path="/reminders" element={<RemindersDashboard />} />
                <Route path="/admin/roles" element={<RolesManager />} />
                <Route path="/admin/volunteers" element={<VolunteerEditor />} />
                <Route path="/admin/areas-mandals" element={<AreasMandalsManager />} />
                <Route path="/admin/tools" element={<AdminToolsPage />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
