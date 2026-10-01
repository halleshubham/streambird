import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import type { AccountDetail, PlanTier } from '../../types/api';

const PLAN_TIERS: PlanTier[] = ['free', 'starter', 'pro', 'enterprise'];

/** Full detail for one Account: editable subscription fields, suspend/
 * reactivate, and its users / stream history / platform connections.
 * Shell/nav is AdminShell (see App.tsx). */
export function AdminAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState(false);

  const [tier, setTier] = useState<PlanTier>('free');
  const [includedHours, setIncludedHours] = useState('');
  const [billingPeriodStart, setBillingPeriodStart] = useState('');

  async function load() {
    if (!id) return;
    try {
      const detail = await superadminApi.getAccountDetail(id);
      setAccount(detail);
      setTier(detail.currentTier);
      setIncludedHours(detail.includedHoursPerMonth);
      setBillingPeriodStart(detail.billingPeriodStart ? detail.billingPeriodStart.slice(0, 10) : '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load account.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      await superadminApi.updateAccountSubscription(id, {
        currentTier: tier,
        includedHoursPerMonth: includedHours,
        billingPeriodStart: billingPeriodStart === '' ? null : billingPeriodStart,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update subscription.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSuspend() {
    if (!id || !account) return;
    setSuspending(true);
    setError(null);
    try {
      if (account.suspendedAt) {
        await superadminApi.reactivateAccount(id);
      } else {
        await superadminApi.suspendAccount(id);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update suspension status.');
    } finally {
      setSuspending(false);
    }
  }

  if (error && !account) {
    return (
      <>
        <p className="error">{error}</p>
        <Link to="/admin/accounts">Back to companies</Link>
      </>
    );
  }

  if (account === null) {
    return <p>Loading…</p>;
  }

  return (
    <>
      <p>
        <Link to="/admin/accounts">← Back to companies</Link>
      </p>
      <h1>
        {account.name} {account.suspendedAt && <span className="badge">Suspended</span>}
      </h1>
      {error && <p className="error">{error}</p>}
      <p>Company: {account.companyName ?? '—'}</p>

      <h2>Subscription</h2>
      <form className="inline-form" onSubmit={(e) => void handleSave(e)}>
        <label>
          Tier
          <select value={tier} onChange={(e) => setTier(e.target.value as PlanTier)}>
            {PLAN_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Included hours / month
          <input
            type="text"
            value={includedHours}
            onChange={(e) => setIncludedHours(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          Billing period start
          <input
            type="date"
            value={billingPeriodStart}
            onChange={(e) => setBillingPeriodStart(e.target.value)}
          />
        </label>
        <button type="submit" disabled={saving}>
          Save
        </button>
      </form>
      <p>
        Usage this period: {account.streamHourUsageCurrentPeriod} / {account.includedHoursPerMonth} hrs
      </p>
      <button
        type="button"
        className={account.suspendedAt ? '' : 'danger-button'}
        disabled={suspending}
        onClick={() => void handleToggleSuspend()}
      >
        {account.suspendedAt ? 'Reactivate account' : 'Suspend account'}
      </button>

      <h2>Users</h2>
      {account.users.length === 0 ? (
        <p className="empty-state">No users on this account.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Approved</th>
              <th>Suspended</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {account.users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.approvedAt ? new Date(u.approvedAt).toLocaleString() : '—'}</td>
                <td>{u.suspendedAt ? <span className="badge">Suspended</span> : '—'}</td>
                <td>{new Date(u.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Stream history</h2>
      {account.streams.length === 0 ? (
        <p className="empty-state">No streams yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Scheduled</th>
              <th>Started</th>
              <th>Ended</th>
            </tr>
          </thead>
          <tbody>
            {account.streams.map((s) => (
              <tr key={s.id}>
                <td>{s.title}</td>
                <td>{s.status}</td>
                <td>{s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : '—'}</td>
                <td>{s.startedAt ? new Date(s.startedAt).toLocaleString() : '—'}</td>
                <td>{s.endedAt ? new Date(s.endedAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Platform connections</h2>
      {account.platformConnections.length === 0 ? (
        <p className="empty-state">No platform connections.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Label</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {account.platformConnections.map((p) => (
              <tr key={p.id}>
                <td>{p.platform}</td>
                <td>{p.label}</td>
                <td>{p.isActive ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
