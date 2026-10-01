import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import type { PendingCompanyAdmin } from '../../types/api';

/** Minimal Superadmin UI: a table of pending Company Admins with
 * approve/reject buttons. Not nested under AppShell/ProtectedRoute --
 * see App.tsx and SuperadminRoute. */
export function AdminDashboardPage() {
  const { user, logout } = useAuth();
  const [pending, setPending] = useState<PendingCompanyAdmin[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setPending(await superadminApi.listPendingCompanyAdmins());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load pending admins.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleApprove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await superadminApi.approveCompanyAdmin(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await superadminApi.rejectCompanyAdmin(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">StreamBird Admin</span>
        <div className="app-header-right">
          {user && <span className="user-email">{user.email}</span>}
          <button type="button" className="icon-btn" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <main className="app-main">
        <h1>Pending company admins</h1>
        {error && <p className="error">{error}</p>}
        {pending === null ? (
          <p>Loading…</p>
        ) : pending.length === 0 ? (
          <p>No pending company admins.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Email</th>
                <th>Signed up</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td>{p.companyName ?? '—'}</td>
                  <td>{p.email}</td>
                  <td>{new Date(p.createdAt).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => void handleApprove(p.id)}
                    >
                      Approve
                    </button>{' '}
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busyId === p.id}
                      onClick={() => void handleReject(p.id)}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
