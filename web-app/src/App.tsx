import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SuperadminRoute } from './components/SuperadminRoute';
import { LoginPage } from './routes/LoginPage';
import { SignupCompanyPage } from './routes/SignupCompanyPage';
import { DashboardPage } from './routes/DashboardPage';
import { ConnectionsPage } from './routes/ConnectionsPage';
import { CreateStreamPage } from './routes/CreateStreamPage';
import { TeamPage } from './routes/TeamPage';
import { HostStudioPage } from './routes/studio/HostStudioPage';
import { GuestJoinPage } from './routes/studio/GuestJoinPage';
import { AdminShell } from './components/AdminShell';
import { AdminLoginPage } from './routes/admin/AdminLoginPage';
import { AdminDashboardPage } from './routes/admin/AdminDashboardPage';
import { AdminUsersPage } from './routes/admin/AdminUsersPage';
import { AdminAuditLogPage } from './routes/admin/AdminAuditLogPage';
import { PrivacyPolicyPage } from './routes/PrivacyPolicyPage';
import { TermsOfServicePage } from './routes/TermsOfServicePage';
import { NotFoundPage } from './routes/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup-company" element={<SignupCompanyPage />} />

      {/* Public and unauthenticated -- required to be reachable without
          logging in by both Google Cloud's OAuth consent screen
          verification and Facebook's app review (Privacy Policy / Terms of
          Service URL fields). */}
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />

      {/* Public -- a guest never has an account or session cookie. */}
      <Route path="/join/:token" element={<GuestJoinPage />} />

      {/* Superadmin: a wholly separate identity/login from the dashboard
          below -- deliberately NOT nested under AppShell/ProtectedRoute,
          see SuperadminRoute. Every /admin/* page below shares AdminShell
          for its header/nav -- add new admin pages as siblings here. */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route element={<SuperadminRoute />}>
        <Route element={<AdminShell />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        {/* Deliberately outside AppShell -- the studio is a full, distraction-free
            production view, not a dashboard page with the app's own nav/logout bar. */}
        <Route path="/streams/:streamId/studio" element={<HostStudioPage />} />

        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/streams/new" element={<CreateStreamPage />} />
          <Route path="/team" element={<TeamPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
