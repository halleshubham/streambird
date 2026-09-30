import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './routes/LoginPage';
import { DashboardPage } from './routes/DashboardPage';
import { ConnectionsPage } from './routes/ConnectionsPage';
import { CreateStreamPage } from './routes/CreateStreamPage';
import { HostStudioPage } from './routes/studio/HostStudioPage';
import { GuestJoinPage } from './routes/studio/GuestJoinPage';
import { NotFoundPage } from './routes/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Public -- a guest never has an account or session cookie. */}
      <Route path="/join/:token" element={<GuestJoinPage />} />

      <Route element={<ProtectedRoute />}>
        {/* Deliberately outside AppShell -- the studio is a full, distraction-free
            production view, not a dashboard page with the app's own nav/logout bar. */}
        <Route path="/streams/:streamId/studio" element={<HostStudioPage />} />

        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/streams/new" element={<CreateStreamPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
