import { useAuth } from '../context/AuthContext';

// Placeholder landing page for a logged-in session -- the real dashboard
// (usage meter, stream list, connections summary, Go Live CTA) is a
// separate, later change.
export function DashboardPage() {
  const { user, accountId } = useAuth();

  return (
    <div>
      <h1>Dashboard</h1>
      <p>
        Logged in as <strong>{user?.email}</strong> (account {accountId}).
      </p>
    </div>
  );
}
