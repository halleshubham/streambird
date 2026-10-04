import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import type { AccountDetail, AdminPlan } from '../../types/api';
import { BirdBusy } from '../../components/BirdBusy';

/** Full detail for one Account: editable subscription fields, suspend/
 * reactivate, and its users / stream history / platform connections.
 * Shell/nav is AdminShell (see App.tsx). */
export function AdminAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState(false);

  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [planKey, setPlanKey] = useState('free');
  // Blank = no override (use the plan's value).
  const [hoursOverride, setHoursOverride] = useState('');
  const [destinationsOverride, setDestinationsOverride] = useState('');
  const [guestsOverride, setGuestsOverride] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [billingPeriodStart, setBillingPeriodStart] = useState('');

  async function load() {
    if (!id) return;
    try {
      const detail = await superadminApi.getAccountDetail(id);
      setAccount(detail);
      setPlanKey(detail.planKey);
      setHoursOverride(detail.includedHoursOverride ?? '');
      setDestinationsOverride(detail.maxDestinationsOverride === null ? '' : String(detail.maxDestinationsOverride));
      setGuestsOverride(detail.maxGuestsOverride === null ? '' : String(detail.maxGuestsOverride));
      setBillingPeriodStart(detail.billingPeriodStart ? detail.billingPeriodStart.slice(0, 10) : '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load account.');
    }
  }

  useEffect(() => {
    void load();
    superadminApi.listPlans().then(setPlans).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handlePass(grant: boolean) {
    if (!id) return;
    setPassBusy(true);
    setError(null);
    try {
      if (grant) await superadminApi.grantDayPass(id);
      else await superadminApi.revokeDayPass(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update the day pass.');
    } finally {
      setPassBusy(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      await superadminApi.updateAccountSubscription(id, {
        planKey,
        includedHoursOverride: hoursOverride.trim() === '' ? null : Number(hoursOverride),
        maxDestinationsOverride: destinationsOverride.trim() === '' ? null : Number(destinationsOverride),
        maxGuestsOverride: guestsOverride.trim() === '' ? null : Number(guestsOverride),
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
    const confirmed = account.suspendedAt
      ? true
      : window.confirm(
          `Suspend ${account.name}? This immediately blocks every user on this account from logging in or streaming.`,
        );
    if (!confirmed) return;
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
    return <BirdLoader loading compact label="Loading account…" />;
  }

  return (
    <>
      <p>
        <Link to="/admin/accounts">← Back to companies</Link>
      </p>
      <h1>
        {account.name} {account.suspendedAt && <span className="badge badge-danger">Suspended</span>}
      </h1>
      {error && <p className="error">{error}</p>}
      <p>Company: {account.companyName ?? '—'}</p>

      <h2>Subscription</h2>
      <form className="inline-form" onSubmit={(e) => void handleSave(e)}>
        <label>
          Plan
          <select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
            {plans
              .filter((p) => p.kind === 'monthly' && (p.isActive || p.key === planKey))
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            {!plans.some((p) => p.key === planKey) && <option value={planKey}>{planKey}</option>}
          </select>
        </label>
        <label>
          Hours / month override
          <input type="number" min="0" step="0.5" value={hoursOverride} onChange={(e) => setHoursOverride(e.target.value)} placeholder="plan default" />
        </label>
        <label>
          Max destinations override
          <input type="number" min="1" max="50" value={destinationsOverride} onChange={(e) => setDestinationsOverride(e.target.value)} placeholder="plan default" />
        </label>
        <label>
          Max guests override
          <input type="number" min="0" max="50" value={guestsOverride} onChange={(e) => setGuestsOverride(e.target.value)} placeholder="plan default" />
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
          {saving && <BirdBusy />} Save
        </button>
      </form>
      <p className="docs-hint">
        Leave an override blank to follow the plan. Plan limits are edited on the <Link to="/admin/plans">Plans</Link> page.
      </p>
      <h3>Day pass</h3>
      {account.dayPassExpiresAt && new Date(account.dayPassExpiresAt) > new Date() ? (
        <p>
          Active until {new Date(account.dayPassExpiresAt).toLocaleString()}.{' '}
          <button type="button" className="link-button" disabled={passBusy} onClick={() => void handlePass(false)}>
            Revoke
          </button>
        </p>
      ) : (
        <p>
          No active pass.{' '}
          <button type="button" disabled={passBusy} onClick={() => void handlePass(true)}>
            {passBusy && <BirdBusy />} Grant day pass
          </button>
        </p>
      )}
      <p>Usage this period:</p>
      <UsageBar
        used={Number(account.streamHourUsageCurrentPeriod)}
        included={Number(account.includedHoursPerMonth)}
      />
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
        <div className="table-scroll">
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
                <td>{u.suspendedAt ? <span className="badge badge-danger">Suspended</span> : '—'}</td>
                <td>{new Date(u.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <h2>Stream history</h2>
      {account.streams.length === 0 ? (
        <p className="empty-state">No streams yet.</p>
      ) : (
        <div className="table-scroll">
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
        </div>
      )}

      <h2>Platform connections</h2>
      {account.platformConnections.length === 0 ? (
        <p className="empty-state">No platform connections.</p>
      ) : (
        <div className="table-scroll">
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
        </div>
      )}
    </>
  );
}
