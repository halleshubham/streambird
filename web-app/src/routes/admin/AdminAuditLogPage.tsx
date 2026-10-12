import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { BirdBusy } from '../../components/BirdBusy';
import { DataTable, Empty, PageHeader, When, humanize, shortId } from '../../components/admin/adminKit';
import { ApiError } from '../../api/client';
import type { AuditLogEntry } from '../../types/api';

const PAGE = 50;

/** Newest-first log of every superadmin action (approvals, suspensions, plan and subscription edits). */
export function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');

  useEffect(() => {
    superadminApi
      .listAuditLog(PAGE, 0)
      .then((rows) => {
        setEntries(rows);
        setMore(rows.length === PAGE);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load audit log.'));
  }, []);

  async function loadMore() {
    if (!entries) return;
    setLoadingMore(true);
    try {
      const rows = await superadminApi.listAuditLog(PAGE, entries.length);
      setEntries([...entries, ...rows]);
      setMore(rows.length === PAGE);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  const actions = useMemo(() => [...new Set((entries ?? []).map((e) => e.action))].sort(), [entries]);
  const shown = (entries ?? []).filter((e) => !action || e.action === action);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Everything a superadmin changed, newest first." />
      {error && <p className="error" role="alert">{error}</p>}
      {entries === null ? (
        <BirdLoader loading compact label="Loading audit log…" />
      ) : entries.length === 0 ? (
        <Empty>No superadmin actions recorded yet.</Empty>
      ) : (
        <>
          <div className="admin-toolbar">
            <select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>{humanize(a)}</option>
              ))}
            </select>
            <span className="admin-toolbar-count">{shown.length} shown</span>
          </div>
          {shown.length === 0 ? (
            <Empty>No loaded entries for that action.</Empty>
          ) : (
            <DataTable caption="Audit log">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap"><When iso={e.createdAt} /></td>
                    <td><span className="admin-cell-main">{humanize(e.action)}</span></td>
                    <td>
                      <span className="admin-cell-sub">{humanize(e.targetType)}</span>
                      {e.targetId &&
                        (e.targetType === 'account' ? (
                          <Link to={`/admin/accounts/${e.targetId}`} className="admin-link" title={e.targetId}>{shortId(e.targetId)}</Link>
                        ) : (
                          <code title={e.targetId}>{shortId(e.targetId)}</code>
                        ))}
                    </td>
                    <td>
                      {e.metadata && Object.keys(e.metadata).length > 0 ? (
                        <details className="admin-details">
                          <summary>View</summary>
                          <pre className="audit-log-metadata">{JSON.stringify(e.metadata, null, 2)}</pre>
                        </details>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {more && (
            <p className="admin-showmore">
              {loadingMore ? (
                <BirdBusy />
              ) : (
                <button type="button" className="btn-sm btn-ghost" onClick={() => void loadMore()}>
                  Load older entries
                </button>
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}
