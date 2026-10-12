import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BirdBusy } from '../../components/BirdBusy';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { ApiError } from '../../api/client';
import { Badge, DataTable, Empty, PageHeader, ROLE_LABEL, When } from '../../components/admin/adminKit';
import type { UserSearchResult } from '../../types/api';

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

/** Cross-company user search + per-user suspend/reactivate -- see
 * SuperadminUsersController server-side. Shell/nav is AdminShell (see
 * App.tsx). Search-as-you-type, debounced; a query shorter than
 * MIN_QUERY_LENGTH is never sent (the backend refuses it too, to avoid
 * ever listing every user in the system). */
export function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setError(null);
      return;
    }

    const handle = setTimeout(() => {
      superadminApi
        .searchUsers(trimmedQuery)
        .then((r) => {
          setResults(r);
          setError(null);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Search failed.'));
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery]);

  async function refresh() {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;
    try {
      setResults(await superadminApi.searchUsers(trimmedQuery));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    }
  }

  async function act(id: string, run: () => Promise<unknown>, failure: string) {
    setBusyId(id);
    setError(null);
    try {
      await run();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="Users" subtitle="Find any user across every company by email." />
      <div className="admin-toolbar">
        <input
          type="search"
          aria-label="Search users by email"
          placeholder="Search by email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {trimmedQuery.length < MIN_QUERY_LENGTH ? (
        <Empty>Type at least {MIN_QUERY_LENGTH} characters to search.</Empty>
      ) : results === null ? (
        <BirdLoader loading compact label="Searching…" />
      ) : results.length === 0 ? (
        <Empty>No users match "{trimmedQuery}".</Empty>
      ) : (
        <DataTable caption="Users">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col" className="hide-sm">Company</th>
              <th scope="col" className="hide-sm">Role</th>
              <th scope="col">Status</th>
              <th scope="col" className="hide-sm">Joined</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {results.map((u) => {
              const pendingApproval = u.role !== 'superadmin' && !u.approvedAt;
              return (
                <tr key={u.id}>
                  <td>
                    <Link to={`/admin/accounts/${u.accountId}`} className="admin-link">{u.email}</Link>
                    {u.displayName && <span className="admin-cell-sub">{u.displayName}</span>}
                  </td>
                  <td className="hide-sm">{u.companyName ?? '—'}</td>
                  <td className="hide-sm">{ROLE_LABEL[u.role]}</td>
                  <td>
                    {u.suspendedAt ? <Badge tone="danger">Suspended</Badge> : pendingApproval ? <Badge tone="warning">Pending approval</Badge> : <Badge tone="success">Active</Badge>}
                  </td>
                  <td className="nowrap hide-sm">{u.createdAt ? <When iso={u.createdAt} /> : '—'}</td>
                  <td className="actions">
                    {u.role !== 'superadmin' &&
                      (u.suspendedAt ? (
                        <button type="button" className="btn-sm" disabled={busyId === u.id} onClick={() => void act(u.id, () => superadminApi.reactivateUser(u.id), 'Failed to reactivate.')}>
                          {busyId === u.id && <BirdBusy />} Reactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-sm danger-button"
                          disabled={busyId === u.id}
                          onClick={() => {
                            if (window.confirm(`Suspend ${u.email}? They are signed out and cannot log in until reactivated.`)) {
                              void act(u.id, () => superadminApi.suspendUser(u.id), 'Failed to suspend.');
                            }
                          }}
                        >
                          {busyId === u.id && <BirdBusy />} Suspend
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
