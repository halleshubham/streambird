import { useEffect, useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { ApiError } from '../../api/client';
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

  async function handleSuspend(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await superadminApi.suspendUser(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to suspend.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReactivate(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await superadminApi.reactivateUser(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reactivate.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h1>Users</h1>
      <p>Search for any user across every company by email.</p>
      <input
        type="search"
        placeholder="Search by email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 360 }}
      />
      {error && <p className="error">{error}</p>}

      {trimmedQuery.length < MIN_QUERY_LENGTH ? (
        <p className="empty-state">Type at least {MIN_QUERY_LENGTH} characters to search.</p>
      ) : results === null ? (
        <BirdLoader loading compact label="Searching…" />
      ) : results.length === 0 ? (
        <p className="empty-state">No users match "{trimmedQuery}".</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Company</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {results.map((u) => {
              const pendingApproval = u.role !== 'superadmin' && !u.approvedAt;
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.companyName ?? '—'}</td>
                  <td>
                    <span className="badge">{u.role}</span>
                  </td>
                  <td>
                    {pendingApproval && <span className="badge">Pending approval</span>}{' '}
                    {u.suspendedAt && <span className="badge badge-danger">Suspended</span>}
                    {!pendingApproval && !u.suspendedAt && '—'}
                  </td>
                  <td>
                    {u.role !== 'superadmin' &&
                      (u.suspendedAt ? (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => void handleReactivate(u.id)}
                        >
                          Reactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="danger-button"
                          disabled={busyId === u.id}
                          onClick={() => void handleSuspend(u.id)}
                        >
                          Suspend
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
