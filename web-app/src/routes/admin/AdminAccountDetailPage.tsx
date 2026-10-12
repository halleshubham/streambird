import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import type { AccountDetail, AdminPlan } from '../../types/api';
import { BirdBusy } from '../../components/BirdBusy';
import { Badge, DataTable, Empty, PageHeader, ROLE_LABEL, Section, When, fmtDate, planLabel, statusTone } from '../../components/admin/adminKit';

/** One account: its plan and exceptions, day pass, users, recent streams, connections; suspend/reactivate lives in a separate danger card. */
export function AdminAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [userBusyId, setUserBusyId] = useState<string | null>(null);

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

  async function handleUser(u: AccountDetail['users'][number]) {
    if (!u.suspendedAt && !window.confirm(`Suspend ${u.email}? They are signed out and cannot log in until reactivated.`)) return;
    setUserBusyId(u.id);
    setError(null);
    try {
      if (u.suspendedAt) await superadminApi.reactivateUser(u.id);
      else await superadminApi.suspendUser(u.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : u.suspendedAt ? 'Failed to reactivate.' : 'Failed to suspend.');
    } finally {
      setUserBusyId(null);
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
        <p className="error" role="alert">{error}</p>
        <Link to="/admin/accounts">Back to companies</Link>
      </>
    );
  }

  if (account === null) {
    return <BirdLoader loading compact label="Loading account…" />;
  }

  const passActive = !!account.dayPassExpiresAt && new Date(account.dayPassExpiresAt) > new Date();
  const name = account.companyName ?? account.name;

  return (
    <>
      <PageHeader
        back={{ to: '/admin/accounts', label: 'Companies' }}
        title={
          <>
            {name} {account.suspendedAt ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}
          </>
        }
        subtitle={
          <>
            {account.companyName && account.companyName !== account.name ? `${account.name} · ` : ''}Joined {fmtDate(account.createdAt)} · {account.userCount}{' '}
            {account.userCount === 1 ? 'user' : 'users'}
          </>
        }
      />
      {error && <p className="error" role="alert">{error}</p>}

      <Section title="Plan and usage">
        <div className="admin-kv">
          <dt>Plan</dt>
          <dd>{planLabel(account.planKey, plans)}{passActive && <> <Badge tone="info">Day pass active</Badge></>}</dd>
          <dt>Usage this period</dt>
          <dd>
            <UsageBar used={Number(account.streamHourUsageCurrentPeriod)} included={Number(account.includedHoursPerMonth)} />
          </dd>
        </div>
      </Section>

      <Section
        title="Subscription"
        hint={
          <>
            Leave an override blank to follow the plan. Plan limits themselves are edited on the <Link to="/admin/plans">Plans</Link> page.
          </>
        }
      >
        <form onSubmit={(e) => void handleSave(e)}>
          <div className="admin-form-grid">
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
              <input type="date" value={billingPeriodStart} onChange={(e) => setBillingPeriodStart(e.target.value)} />
            </label>
          </div>
          <div className="admin-form-actions">
            <button type="submit" disabled={saving}>
              {saving && <BirdBusy />} Save
            </button>
          </div>
        </form>
      </Section>

      <Section title="Day pass">
        {passActive ? (
          <div className="admin-form-actions" style={{ marginTop: 0 }}>
            <span>
              Active until <When iso={account.dayPassExpiresAt} />.
            </span>
            <button type="button" className="btn-sm danger-button" disabled={passBusy} onClick={() => void handlePass(false)}>
              {passBusy && <BirdBusy />} Revoke
            </button>
          </div>
        ) : (
          <div className="admin-form-actions" style={{ marginTop: 0 }}>
            <span>No active pass.</span>
            <button type="button" className="btn-sm" disabled={passBusy} onClick={() => void handlePass(true)}>
              {passBusy && <BirdBusy />} Grant day pass
            </button>
          </div>
        )}
      </Section>

      <h2 className="admin-list-title">Users</h2>
      {account.users.length === 0 ? (
        <Empty>No users on this account.</Empty>
      ) : (
        <DataTable caption="Users on this account">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col" className="hide-sm">Joined</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {account.users.map((u) => (
              <tr key={u.id}>
                <td><span className="admin-cell-main">{u.email}</span></td>
                <td>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role}</td>
                <td>
                  {u.suspendedAt ? <Badge tone="danger">Suspended</Badge> : u.approvedAt ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Pending approval</Badge>}
                </td>
                <td className="nowrap hide-sm"><When iso={u.createdAt} /></td>
                <td className="actions">
                  {u.role !== 'superadmin' &&
                    (u.suspendedAt ? (
                      <button type="button" className="btn-sm" disabled={userBusyId === u.id} onClick={() => void handleUser(u)}>
                        {userBusyId === u.id && <BirdBusy />} Reactivate
                      </button>
                    ) : (
                      <button type="button" className="btn-sm danger-button" disabled={userBusyId === u.id} onClick={() => void handleUser(u)}>
                        {userBusyId === u.id && <BirdBusy />} Suspend
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <h2 className="admin-list-title">Recent streams</h2>
      {account.streams.length === 0 ? (
        <Empty>No streams yet.</Empty>
      ) : (
        <DataTable caption="Recent streams">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Scheduled</th>
              <th scope="col">Started</th>
              <th scope="col">Ended</th>
            </tr>
          </thead>
          <tbody>
            {account.streams.map((st) => (
              <tr key={st.id}>
                <td><span className="admin-cell-main">{st.title}</span></td>
                <td><Badge tone={st.status === 'live' ? 'success' : statusTone(st.status)}>{st.status}</Badge></td>
                <td className="nowrap"><When iso={st.scheduledAt} /></td>
                <td className="nowrap"><When iso={st.startedAt} /></td>
                <td className="nowrap"><When iso={st.endedAt} /></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <h2 className="admin-list-title">Platform connections</h2>
      {account.platformConnections.length === 0 ? (
        <Empty>No platform connections.</Empty>
      ) : (
        <DataTable caption="Platform connections">
          <thead>
            <tr>
              <th scope="col">Platform</th>
              <th scope="col">Label</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {account.platformConnections.map((pc) => (
              <tr key={pc.id}>
                <td>{planLabel(pc.platform)}</td>
                <td>{pc.label}</td>
                <td>{pc.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <Section title={account.suspendedAt ? 'Reactivate account' : 'Suspend account'} danger={!account.suspendedAt} hint={account.suspendedAt ? 'Every user on this account can log in and stream again.' : 'Immediately blocks every user on this account from logging in or streaming. You can reactivate it at any time.'}>
        <button type="button" className={account.suspendedAt ? '' : 'danger-button'} disabled={suspending} onClick={() => void handleToggleSuspend()}>
          {suspending && <BirdBusy />} {account.suspendedAt ? 'Reactivate account' : 'Suspend account'}
        </button>
      </Section>
    </>
  );
}
