import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SuperadminRoute } from './components/SuperadminRoute';
import { HomeRoute } from './components/HomeRoute';
import { LoginPage } from './routes/LoginPage';
import { SignupCompanyPage } from './routes/SignupCompanyPage';
import { AdminLoginPage } from './routes/admin/AdminLoginPage';
import { PrivacyPolicyPage } from './routes/PrivacyPolicyPage';
import { TermsOfServicePage } from './routes/TermsOfServicePage';
import { NotFoundPage } from './routes/NotFoundPage';
import { DeleteAccountInfoPage } from './routes/DeleteAccountInfoPage';
import { AccountDeletedPage } from './routes/AccountDeletedPage';
import { CookieBanner } from './components/CookieBanner';
import { RouteHead } from './components/RouteHead';
import { BirdLoader } from './components/BirdLoader';

/** Signed-in, guest and admin screens load on demand so the public pages (landing, login, legal) ship a much smaller script. */
function lazyPage<T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T & string) {
  return lazy(async () => ({ default: (await load())[name] }));
}
const DashboardPage = lazyPage(() => import('./routes/DashboardPage'), 'DashboardPage');
const ConnectionsPage = lazyPage(() => import('./routes/ConnectionsPage'), 'ConnectionsPage');
const CreateStreamPage = lazyPage(() => import('./routes/CreateStreamPage'), 'CreateStreamPage');
const StreamDetailPage = lazyPage(() => import('./routes/StreamDetailPage'), 'StreamDetailPage');
const UpcomingStreamsPage = lazyPage(() => import('./routes/UpcomingStreamsPage'), 'UpcomingStreamsPage');
const TeamPage = lazyPage(() => import('./routes/TeamPage'), 'TeamPage');
const HostStudioPage = lazyPage(() => import('./routes/studio/HostStudioPage'), 'HostStudioPage');
const GuestJoinPage = lazyPage(() => import('./routes/studio/GuestJoinPage'), 'GuestJoinPage');
const AdminShell = lazyPage(() => import('./components/AdminShell'), 'AdminShell');
const AdminDashboardPage = lazyPage(() => import('./routes/admin/AdminDashboardPage'), 'AdminDashboardPage');
const AdminAuditLogPage = lazyPage(() => import('./routes/admin/AdminAuditLogPage'), 'AdminAuditLogPage');
const AdminAnalyticsPage = lazyPage(() => import('./routes/admin/AdminAnalyticsPage'), 'AdminAnalyticsPage');
const AdminAccountsPage = lazyPage(() => import('./routes/admin/AdminAccountsPage'), 'AdminAccountsPage');
const AdminAccountDetailPage = lazyPage(() => import('./routes/admin/AdminAccountDetailPage'), 'AdminAccountDetailPage');
const AdminPlansPage = lazyPage(() => import('./routes/admin/AdminPlansPage'), 'AdminPlansPage');
const AdminBillingPage = lazyPage(() => import('./routes/admin/AdminBillingPage'), 'AdminBillingPage');
const BillingPage = lazyPage(() => import('./routes/BillingPage'), 'BillingPage');
const BrandPage = lazyPage(() => import('./routes/BrandPage'), 'BrandPage');
const AccountPage = lazyPage(() => import('./routes/AccountPage'), 'AccountPage');

export function App() {
  return (
    <>
    <RouteHead />
    <Suspense fallback={<div className="page-loading"><BirdLoader loading compact /></div>}>
    <Routes>
      {/* Anonymous -> public marketing page; logged in -> straight to
          /dashboard. See HomeRoute. */}
      <Route path="/" element={<HomeRoute />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup-company" element={<SignupCompanyPage />} />

      {/* Public and unauthenticated -- required to be reachable without
          logging in by both Google Cloud's OAuth consent screen
          verification and Facebook's app review (Privacy Policy / Terms of
          Service URL fields). */}
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />
      {/* Public: how to delete an account and data (Google Play requires a public URL for this). */}
      <Route path="/delete-account" element={<DeleteAccountInfoPage />} />
      <Route path="/account-deleted" element={<AccountDeletedPage />} />

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
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          {/* Users were folded into Companies (search matches user emails); keep old links working. */}
          <Route path="/admin/users" element={<Navigate to="/admin/accounts" replace />} />
          <Route path="/admin/accounts" element={<AdminAccountsPage />} />
          <Route path="/admin/plans" element={<AdminPlansPage />} />
          <Route path="/admin/billing" element={<AdminBillingPage />} />
          <Route path="/admin/accounts/:id" element={<AdminAccountDetailPage />} />
          <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        {/* Deliberately outside AppShell -- the studio is a full, distraction-free
            production view, not a dashboard page with the app's own nav/logout bar. */}
        <Route path="/streams/:streamId/studio" element={<HostStudioPage />} />

        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/brand" element={<BrandPage />} />
          <Route path="/streams/new" element={<CreateStreamPage />} />
          <Route path="/streams/upcoming" element={<UpcomingStreamsPage />} />
          <Route path="/streams/:streamId" element={<StreamDetailPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
    <CookieBanner />
    </>
  );
}
