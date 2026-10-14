import { useEffect, useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { BirdBusy } from '../../components/BirdBusy';
import { PENDING_CHANGED_EVENT } from '../../lib/adminEvents';
import { Badge, DataTable, Empty, PageHeader, ROLE_LABEL, When } from '../../components/admin/adminKit';
import { ApiError } from '../../api/client';
import type { PendingApproval } from '../../types/api';

/** Everyone waiting for approval -- a new Company Admin signup or a brand-new solo user's first login. */
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
    // Fetching on mount -- an async network call, never derivable during render.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, []);

  async function decide(id: string, run: () => Promise<unknown>, failure: string) {
    setBusyId(id);
    setError(null);
    try {
      await run();
      await load();
      window.dispatchEvent(new Event(PENDING_CHANGED_EVENT));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusyId(null);
    }
  }

  function handleReject(id: string, email: string) {
    if (!window.confirm(`Reject and permanently delete the signup for ${email}? This cannot be undone.`)) return;
    void decide(id, () => superadminApi.rejectUser(id), 'Failed to reject.');
  }

  return (
    <>
      <PageHeader
        title="Pending approvals"
        subtitle="New signups can't use StreamBird until you approve them. They get an email either way."
      />
      {error && <p className="error" role="alert">{error}</p>}
      {pending === null ? (
        <BirdLoader loading compact label="Loading pending approvals…" />
      ) : pending.length === 0 ? (
        <Empty>Nobody is waiting. New signups will appear here.</Empty>
      ) : (
        <DataTable caption="Signups waiting for approval">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col" className="hide-sm">Type</th>
              <th scope="col" className="hide-sm">Company</th>
              <th scope="col" className="hide-sm">Mobile</th>
              <th scope="col" className="hide-sm">Signed up</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="admin-cell-main">{p.email}</span>
                  <span className="admin-cell-sub show-sm">
                    {ROLE_LABEL[p.role]}{p.role === 'company_admin' && p.companyName ? ` · ${p.companyName}` : ''}{p.phone ? ` · ${p.phone}` : ''} · <When iso={p.createdAt} />
                  </span>
                </td>
                <td className="hide-sm"><Badge tone={p.role === 'company_admin' ? 'info' : 'neutral'}>{ROLE_LABEL[p.role]}</Badge></td>
                <td className="hide-sm">{p.role === 'company_admin' ? (p.companyName ?? '—') : '—'}</td>
                <td className="nowrap hide-sm">{p.phone ?? '—'}</td>
                <td className="nowrap hide-sm"><When iso={p.createdAt} /></td>
                <td className="actions">
                  <button type="button" className="btn-sm" disabled={busyId === p.id} onClick={() => void decide(p.id, () => superadminApi.approveUser(p.id), 'Failed to approve.')}>
                    {busyId === p.id && <BirdBusy />} Approve
                  </button>
                  <button type="button" className="btn-sm danger-button" disabled={busyId === p.id} onClick={() => handleReject(p.id, p.email)}>
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
