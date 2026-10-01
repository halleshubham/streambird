import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import type { AccountSummary } from '../../types/api';

/** Directory of every Account (company/solo) -- tier, usage, user count,
 * suspension status. Shell/nav is AdminShell (see App.tsx). Row click
 * goes to AdminAccountDetailPage for subscription edits + suspend/
 * reactivate. */
export function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    superadminApi
      .listAccounts()
      .then((res) => setAccounts(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load accounts.'));
  }, []);

  return (
    <>
      <h1>Companies</h1>
      {error && <p className="error">{error}</p>}
      {accounts === null ? (
        <BirdLoader loading compact label="Loading companies…" />
      ) : accounts.length === 0 ? (
        <p className="empty-state">No accounts yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Company</th>
              <th>Tier</th>
              <th>Usage (hrs)</th>
              <th>Users</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.companyName ?? '—'}</td>
                <td>{a.currentTier}</td>
                <td>
                  <UsageBar
                    compact
                    used={Number(a.streamHourUsageCurrentPeriod)}
                    included={Number(a.includedHoursPerMonth)}
                  />
                </td>
                <td>{a.userCount}</td>
                <td>{a.suspendedAt ? <span className="badge badge-danger">Suspended</span> : '—'}</td>
                <td>
                  <Link to={`/admin/accounts/${a.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
