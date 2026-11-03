import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import type { AccountDetail, AdminPlan } from '../../types/api';
import { Badge, DataTable, Empty, Notice, PageHeader, ROLE_LABEL, Section, When, fmtDate, planLabel, statusTone } from '../../components/admin/adminKit';
import { Button, Card, Input, Modal, SelectField, confirm, toast } from '../../components/ui';

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
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantPlan, setGrantPlan] = useState('');
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

  async function handlePass(grant: boolean, planKey?: string) {
    if (!id) return;
    setPassBusy(true);
    setError(null);
    try {
      if (grant) await superadminApi.grantDayPass(id, planKey);
      else await superadminApi.revokeDayPass(id);
      toast.success(grant ? 'Day pass granted.' : 'Day pass revoked.');
      setGrantOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update the day pass.');
      setGrantOpen(false);
    } finally {
      setPassBusy(false);
    }
  }

  const passPlans = plans.filter((p) => p.kind === 'day_pass' && p.isActive);

  function openGrant() {
    setGrantPlan(passPlans[0]?.key ?? '');
    setGrantOpen(true);
  }

  async function askRevoke() {
    if (!account) return;
    const ok = await confirm({
      title: 'Revoke this day pass?',
      details: `${account.companyName ?? account.name} · active until ${new Date(account.dayPassExpiresAt ?? '').toLocaleString()}`,
      body: 'The account drops back to its normal plan immediately. A live stream may be ended if it exceeds the plan limits.',
      confirmLabel: 'Revoke pass',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (ok) void handlePass(false);
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
      toast.success('Subscription saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update subscription.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUser(u: AccountDetail['users'][number]) {
    if (u.suspendedAt) {
      const ok = await confirm({
        title: 'Reactivate this user?',
        details: u.email,
        body: 'They can sign in again straight away.',
        confirmLabel: 'Reactivate user',
      });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: 'Suspend this user?',
        details: u.email,
        body: 'They are signed out and cannot log in. Other users on the account are not affected. You can reactivate them at any time.',
        confirmLabel: 'Suspend user',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!ok) return;
    }
    setUserBusyId(u.id);
    setError(null);
    try {
      if (u.suspendedAt) await superadminApi.reactivateUser(u.id);
      else await superadminApi.suspendUser(u.id);
      toast.success(u.suspendedAt ? `${u.email} reactivated.` : `${u.email} suspended.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : u.suspendedAt ? 'Failed to reactivate.' : 'Failed to suspend.');
    } finally {
      setUserBusyId(null);
    }
  }

  async function handleToggleSuspend() {
    if (!id || !account) return;
    const shownName = account.companyName ?? account.name;
    const confirmed = account.suspendedAt
      ? await confirm({
          title: `Reactivate ${shownName}?`,
          body: 'Users can sign in again straight away. Their plan and settings are unchanged.',
          confirmLabel: 'Reactivate account',
        })
      : await confirm({
          title: `Suspend ${shownName}?`,
          body: `This affects the whole account: all ${account.userCount} ${account.userCount === 1 ? 'user is' : 'users are'} signed out and blocked, and any live stream is ended. Autopay is not touched; cancel it in Billing if needed.`,
          confirmLabel: 'Suspend account',
          destructive: true,
          typeToConfirm: shownName,
          typeToConfirmLabel: 'Type the company name to confirm',
        });
    if (!confirmed) return;
    setSuspending(true);
    setError(null);
    try {
      if (account.suspendedAt) {
        await superadminApi.reactivateAccount(id);
      } else {
        await superadminApi.suspendAccount(id);
      }
      toast.success(account.suspendedAt ? `${shownName} reactivated.` : `${shownName} suspended.`);
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
        <Notice tone="error">{error}</Notice>
        <Link to="/admin/accounts" className="admin-back">← Back to companies</Link>
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
      {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}

      <Section title="Plan and usage">
        <div className="admin-tiles">
          <div className="admin-tile">
            <b>{planLabel(account.planKey, plans)}</b>
            <span>Current plan{passActive && <> <Badge tone="info">Day pass active</Badge></>}</span>
          </div>
          <div className="admin-tile">
            <span>Usage this period</span>
            <UsageBar used={Number(account.streamHourUsageCurrentPeriod)} included={Number(account.includedHoursPerMonth)} />
          </div>
          <div className="admin-tile">
            <b>{account.userCount}</b>
            <span>{account.userCount === 1 ? 'User' : 'Users'}</span>
          </div>
        </div>
      </Section>

      <Section
        title="Subscription"
        hint={
          <>
            Leave an override blank to follow the plan. Plan limits themselves are edited on the <Link to="/admin/plans" className="admin-link">Plans</Link> page.
          </>
        }
      >
        <form onSubmit={(e) => void handleSave(e)}>
          <div className="admin-form-grid">
            <SelectField label="Plan" value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
              {plans
                .filter((p) => p.kind === 'monthly' && (p.isActive || p.key === planKey))
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              {!plans.some((p) => p.key === planKey) && <option value={planKey}>{planKey}</option>}
            </SelectField>
            <Input label="Hours / month override" type="number" min="0" step="0.5" value={hoursOverride} onChange={(e) => setHoursOverride(e.target.value)} placeholder="plan default" />
            <Input label="Max destinations override" type="number" min="1" max="50" value={destinationsOverride} onChange={(e) => setDestinationsOverride(e.target.value)} placeholder="plan default" />
            <Input label="Max guests override" type="number" min="0" max="50" value={guestsOverride} onChange={(e) => setGuestsOverride(e.target.value)} placeholder="plan default" />
            <Input label="Billing period start" type="date" value={billingPeriodStart} onChange={(e) => setBillingPeriodStart(e.target.value)} />
          </div>
          <div className="admin-form-actions">
            <Button type="submit" busy={saving}>Save</Button>
          </div>
        </form>
      </Section>

      <Section>
        <div className="admin-card-head">
          <div>
            <h2>Day pass</h2>
            <p className="admin-hint">
              {passActive ? (
                <>
                  Active until <When iso={account.dayPassExpiresAt} />.
                </>
              ) : (
                'No active pass. Grants the day pass limits for a limited time.'
              )}
            </p>
          </div>
          {passActive ? (
            <Button variant="secondary" className="admin-reject" busy={passBusy} onClick={() => void askRevoke()}>
              Revoke
            </Button>
          ) : (
            <Button busy={passBusy} onClick={openGrant}>
              Grant day pass
            </Button>
          )}
        </div>
      </Section>

      <Modal
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        title="Grant a day pass"
        description={`${name} gets the day pass limits for the validity period.`}
        testId="grant-pass-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button busy={passBusy} onClick={() => void handlePass(true, passPlans.length > 1 ? grantPlan : undefined)}>Grant</Button>
          </>
        }
      >
        {passPlans.length > 1 && (
          <SelectField label="Day pass plan" value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)}>
            {passPlans.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}{p.validityHours ? ` (valid ${p.validityHours} h)` : ''}
              </option>
            ))}
          </SelectField>
        )}
      </Modal>

      <Card className="admin-section" aria-label="Users">
        <h2>Users</h2>
        {account.users.length === 0 ? (
          <Empty>No users on this account.</Empty>
        ) : (
          <DataTable caption="Users on this account">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col" className="hide-sm">Mobile</th>
                <th scope="col">Status</th>
                <th scope="col" className="hide-sm">Joined</th>
                <th scope="col"><span className="ui-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {account.users.map((u) => (
                <tr key={u.id}>
                  <td><span className="admin-cell-main">{u.email}</span></td>
                  <td>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role}</td>
                  <td className="nowrap hide-sm">{u.phone ?? '—'}</td>
                  <td>
                    {u.suspendedAt ? <Badge tone="danger">Suspended</Badge> : u.approvedAt ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Pending approval</Badge>}
                  </td>
                  <td className="nowrap hide-sm"><When iso={u.createdAt} /></td>
                  <td className="actions">
                    {u.role !== 'superadmin' &&
                      (u.suspendedAt ? (
                        <Button variant="secondary" size="sm" busy={userBusyId === u.id} onClick={() => void handleUser(u)}>
                          Reactivate
                        </Button>
                      ) : (
                        <Button variant="secondary" size="sm" className="admin-reject" busy={userBusyId === u.id} onClick={() => void handleUser(u)}>
                          Suspend
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card className="admin-section" aria-label="Recent streams">
        <h2>Recent streams</h2>
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
                  <td><Badge tone={st.status === 'live' ? 'danger' : statusTone(st.status)}>{st.status}</Badge></td>
                  <td className="nowrap"><When iso={st.scheduledAt} /></td>
                  <td className="nowrap"><When iso={st.startedAt} /></td>
                  <td className="nowrap"><When iso={st.endedAt} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card className="admin-section" aria-label="Platform connections">
        <h2>Platform connections</h2>
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
      </Card>

      <Section
        title={account.suspendedAt ? 'Reactivate account' : 'Danger zone'}
        danger={!account.suspendedAt}
        hint={account.suspendedAt ? 'Every user on this account can log in and stream again.' : 'Suspending blocks every user of this account from signing in and ends any live stream. You can reactivate it at any time.'}
      >
        <Button variant={account.suspendedAt ? 'primary' : 'danger'} busy={suspending} onClick={() => void handleToggleSuspend()}>
          {account.suspendedAt ? 'Reactivate account' : 'Suspend account'}
        </Button>
      </Section>
    </>
  );
}
