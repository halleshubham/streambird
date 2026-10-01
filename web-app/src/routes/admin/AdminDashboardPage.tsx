import { useEffect, useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import type { PendingApproval } from '../../types/api';

const ROLE_LABELS: Record<PendingApproval['role'], string> = {
  superadmin: 'Superadmin',
  company_admin: 'Company Admin',
  user: 'Solo user',
};

/** A table of every account awaiting approval -- both a new Company Admin
 * signup and a brand-new solo user's first login -- with approve/reject
 * buttons. Shell/nav is AdminShell (see App.tsx) -- not nested under
 * AppShell/ProtectedRoute, see SuperadminRoute. */
export function AdminDashboardPage() {
  const [pending, setPending] = useState<PendingApproval[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setPending(await superadminApi.listPendingApprovals());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load pending approvals.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleApprove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await superadminApi.approveUser(id);
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
      await superadminApi.rejectUser(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h1>Pending approvals</h1>
      {error && <p className="error">{error}</p>}
      {pending === null ? (
        <p>Loading…</p>
      ) : pending.length === 0 ? (
        <p>No accounts pending approval.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Company</th>
              <th>Email</th>
              <th>Signed up</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id}>
                <td>{ROLE_LABELS[p.role]}</td>
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
    </>
  );
}
