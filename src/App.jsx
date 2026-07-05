// src/App.jsx
// Adds: /login (public), RequireAuth guard wrapping everything else,
// AppLayout (nav + sign out) wrapping the protected routes.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/usePermissions";
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

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Navigate to="/calling" replace />} />
                <Route path="/calling" element={<CallingFlowPage />} />
                <Route path="/households" element={<HouseholdsPage />} />
                <Route path="/households/:householdId" element={<HouseholdDetailPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
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
