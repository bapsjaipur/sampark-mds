// src/App.jsx
// Adds: /login (public), RequireAuth guard wrapping everything else,
// AppLayout (nav + sign out) wrapping the protected routes.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/usePermissions";
import { ToastProvider } from "./contexts/ToastContext";
import LoginPage from "./pages/LoginPage";
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

// 4.1 — redirect to first route the volunteer actually has permission to see
function DefaultRedirect() {
  const { permissions, loading } = useAuth();
  if (loading) return null;
  // Santo role: lands on their personal schedule
  if (permissions.includes("view_padhramani") && !permissions.includes("view_all_contacts") && !permissions.includes("edit_contacts")) {
    return <Navigate to="/santo-schedule" replace />;
  }
  if (permissions.includes("view_all_contacts") || permissions.includes("view_assigned_contacts")) {
    return <Navigate to="/contacts" replace />;
  }
  if (permissions.includes("assign_batches")) return <Navigate to="/admin/batches" replace />;
  if (permissions.includes("manage_events")) return <Navigate to="/events" replace />;
  // Fallback: households (visible to all authenticated users with no specific gate)
  return <Navigate to="/households" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

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
                <Route path="/events" element={<EventsPage />} />
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
