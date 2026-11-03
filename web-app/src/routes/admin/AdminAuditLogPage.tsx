import { useEffect, useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { Button, Card, Spinner } from '../../components/ui';
import { DataTable, Empty, Notice, PageHeader, When, humanize, shortId } from '../../components/admin/adminKit';
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
      <PageHeader title="Audit log" subtitle="Every admin action, newest first." />
      {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}
      {entries === null ? (
        <BirdLoader loading compact label="Loading audit log…" />
      ) : entries.length === 0 ? (
        <Empty title="Nothing recorded yet" icon={<ScrollText size={40} />}>Superadmin actions (approvals, suspensions, plan and subscription edits) will be listed here.</Empty>
      ) : (
        <>
          <div className="admin-toolbar">
            <select className="ui-input ui-select" aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>{humanize(a)}</option>
              ))}
            </select>
            {action && (
              <Button variant="secondary" size="sm" onClick={() => setAction('')}>
                Clear
              </Button>
            )}
            <span className="admin-toolbar-count">{shown.length} shown</span>
          </div>
          {shown.length === 0 ? (
            <Empty>No loaded entries for that action.</Empty>
          ) : (
            <Card className="admin-section">
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
                    <td><span className="admin-action-tag">{humanize(e.action)}</span></td>
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
                          <summary>Show details</summary>
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
            </Card>
          )}
          {more && (
            <p className="admin-showmore">
              {loadingMore ? (
                <Spinner size="sm" />
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void loadMore()}>
                  Load older entries
                </Button>
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}
