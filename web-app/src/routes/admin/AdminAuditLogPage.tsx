import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { ApiError } from '../../api/client';
import type { AuditLogEntry } from '../../types/api';

/** Newest-first log of every superadmin action (approvals, suspensions,
 * subscription edits) -- see AuditLogService.log server-side. Shell/nav is
 * AdminShell (see App.tsx). */
export function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    superadminApi
      .listAuditLog()
      .then(setEntries)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load audit log.'));
  }, []);

  return (
    <>
      <h1>Audit log</h1>
      {error && <p className="error">{error}</p>}
      {entries === null ? (
        <BirdLoader loading compact label="Loading audit log…" />
      ) : entries.length === 0 ? (
        <p className="empty-state">No superadmin actions recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.action}</td>
                <td>
                  {e.targetType}
                  {e.targetId &&
                    (e.targetType === 'account' ? (
                      <>
                        {' · '}
                        <Link to={`/admin/accounts/${e.targetId}`}>{e.targetId}</Link>
                      </>
                    ) : (
                      ` · ${e.targetId}`
                    ))}
                </td>
                <td>
                  {e.metadata ? (
                    <pre className="audit-log-metadata">{JSON.stringify(e.metadata, null, 2)}</pre>
                  ) : (
                    '—'
                  )}
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
