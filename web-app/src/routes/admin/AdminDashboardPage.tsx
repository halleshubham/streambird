import { useEffect, useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { PENDING_CHANGED_EVENT } from '../../lib/adminEvents';
import { Badge, DataTable, Empty, Notice, PageHeader, ROLE_LABEL, Section, When } from '../../components/admin/adminKit';
import { ApiError } from '../../api/client';
import type { HeavyUsageRow, PendingApproval, RegistrationStatus } from '../../types/api';
import { Button, Card, confirm, toast } from '../../components/ui';

/** Everyone waiting for approval -- a new Company Admin signup or a brand-new solo user's first login. */
export function AdminDashboardPage() {
  const [pending, setPending] = useState<PendingApproval[] | null>(null);
  const [reg, setReg] = useState<RegistrationStatus | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heavy, setHeavy] = useState<HeavyUsageRow[] | null>(null);

  async function load() {
    try {
      const [list, status] = await Promise.all([superadminApi.listPendingApprovals(), superadminApi.getRegistration()]);
      setPending(list);
      setReg(status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load pending approvals.');
    }
  }

  useEffect(() => {
    // Read-only watch; a failure here must not block the approvals list.
    superadminApi.listHeavyUsage().then(setHeavy).catch(() => setHeavy([]));
  }, []);

  useEffect(() => {
    // Fetching on mount -- an async network call, never derivable during render.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, []);

  async function decide(id: string, run: () => Promise<unknown>, failure: string, done?: string) {
    setBusyId(id);
    setError(null);
    try {
      await run();
      if (done) toast.success(done);
      await load();
      window.dispatchEvent(new Event(PENDING_CHANGED_EVENT));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusyId(null);
    }
  }

  async function changeMode(autoApprove: boolean) {
    if (reg?.autoApprove === autoApprove) return;
    setRegBusy(true);
    setError(null);
    setNotice(null);
    try {
      setReg(await superadminApi.setRegistration(autoApprove));
      setNotice(autoApprove ? 'Auto-approve is on: new signups get in immediately.' : 'Registrations paused: new signups will wait here for your approval.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the registration mode.');
    } finally {
      setRegBusy(false);
    }
  }

  async function approveAll() {
    if (!pending || pending.length === 0) return;
    const n = pending.length;
    const shown = pending.slice(0, 3).map((p) => p.email);
    const ok = await confirm({
      title: `Approve all ${n} signup${n === 1 ? '' : 's'}?`,
      body: 'Each person is emailed that their studio is ready and can sign in right away. You can still suspend any account later.',
      details: n > 3 ? `${shown.join(', ')} and ${n - 3} more` : shown.join(', '),
      confirmLabel: `Approve all ${n}`,
    });
    if (!ok) return;
    setRegBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { approved } = await superadminApi.approveAllPending();
      setNotice(`Approved ${approved} signup${approved === 1 ? '' : 's'}. They have been emailed.`);
      await load();
      window.dispatchEvent(new Event(PENDING_CHANGED_EVENT));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the waiting signups.');
    } finally {
      setRegBusy(false);
    }
  }

  async function handleReject(id: string, email: string) {
    const ok = await confirm({
      title: 'Reject this signup?',
      details: email,
      body: 'This permanently deletes the signup and emails the person that it was not approved. It cannot be undone.',
      confirmLabel: 'Reject and delete',
      cancelLabel: 'Keep pending',
      destructive: true,
    });
    if (!ok) return;
    void decide(id, () => superadminApi.rejectUser(id), 'Failed to reject.', `${email} rejected.`);
  }

  return (
    <>
      <PageHeader title="Pending approvals" subtitle="Unless registration is open (auto-approve), new signups can't use StreamBird until you approve them. They get an email either way." />
      {notice && <Notice tone="success" onDismiss={() => setNotice(null)}>{notice}</Notice>}
      {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}
      {reg && (
        <Section>
          <div className="admin-reg" aria-label="Registration">
            <div>
              <div className="admin-card-head">
                <h2>
                  Registration <Badge tone={reg.autoApprove ? 'success' : 'warning'}>{reg.autoApprove ? 'Open' : 'Paused'}</Badge>
                </h2>
              </div>
              <p className="admin-hint">
                Open: new accounts are approved automatically. Paused: every signup waits for you. People already approved are never affected.
              </p>
              <p className="admin-hint" data-testid="registration-history" style={{ marginBottom: 0 }}>
                New signups: <strong>{reg.last24h}</strong> in the last 24 hours, <strong>{reg.last7d}</strong> in the last 7 days. <strong>{reg.waiting}</strong> waiting for approval now.
              </p>
            </div>
            <div className="admin-seg" role="group" aria-label="Registration mode">
              <button type="button" aria-pressed={reg.autoApprove} disabled={regBusy} onClick={() => void changeMode(true)}>
                Open, auto-approve
              </button>
              <button type="button" aria-pressed={!reg.autoApprove} disabled={regBusy} onClick={() => void changeMode(false)}>
                Paused, manual review
              </button>
            </div>
          </div>
        </Section>
      )}
      <Section
        title="Heavy usage this month"
        hint="Accounts with the most stream hours this billing period. Visibility only: nothing is enforced. Bandwidth cost is a rough estimate (destination-hours x Rs 2.4)."
      >
        <div data-testid="heavy-usage">
          {heavy === null ? (
            <BirdLoader loading compact label="Loading heavy usage…" />
          ) : heavy.length === 0 ? (
            <Empty>Nobody has used stream hours this period yet.</Empty>
          ) : (
            <DataTable caption="Accounts with the heaviest usage this month">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" className="hide-sm">Plan</th>
                  <th scope="col" className="num">Hours</th>
                  <th scope="col" className="num">Used</th>
                  <th scope="col" className="num hide-sm">Dest-hours</th>
                  <th scope="col" className="num hide-sm">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {heavy.map((r) => (
                  <tr key={r.accountId} data-heavy={r.percentUsed !== null && r.percentUsed >= 80 ? 'true' : undefined}>
                    <td>
                      <span className="admin-cell-main">{r.accountName}</span>
                      <span className="admin-cell-sub">{r.ownerEmail ?? '—'}</span>
                      <span className="admin-cell-sub show-sm">{r.planName} · {r.destinationHours} dest-h · Rs {r.estimatedBandwidthCostInr}</span>
                    </td>
                    <td className="hide-sm">{r.planName}</td>
                    <td className="num nowrap">{r.hoursUsed} / {r.includedHours === null ? '∞' : r.includedHours}</td>
                    <td className="num nowrap">
                      {r.percentUsed === null ? (
                        <Badge tone="neutral">Unlimited</Badge>
                      ) : (
                        <Badge tone={r.percentUsed >= 100 ? 'danger' : r.percentUsed >= 80 ? 'warning' : 'neutral'}>{r.percentUsed}%</Badge>
                      )}
                    </td>
                    <td className="num nowrap hide-sm">{r.destinationHours}</td>
                    <td className="num nowrap hide-sm">Rs {r.estimatedBandwidthCostInr}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </Section>
      {pending === null ? (
        <BirdLoader loading compact label="Loading pending approvals…" />
      ) : pending.length === 0 ? (
        <Empty title="All caught up">No signups are waiting. When registration is paused, new requests will show up here and in the Approvals badge.</Empty>
      ) : (
        <Card className="admin-section">
          <div className="admin-card-head">
            <h2>
              Pending signups <Badge tone="warning">{pending.length}</Badge>
            </h2>
            <Button size="sm" busy={regBusy} onClick={() => void approveAll()}>
              Approve all ({pending.length})
            </Button>
          </div>
          <DataTable caption="Signups waiting for approval" cards>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col" className="hide-sm">Type</th>
                <th scope="col" className="hide-sm">Company</th>
                <th scope="col" className="hide-sm">Mobile</th>
                <th scope="col" className="hide-sm">Signed up</th>
                <th scope="col"><span className="ui-sr-only">Actions</span></th>
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
                    <Button size="sm" busy={busyId === p.id} disabled={busyId === p.id} onClick={() => void decide(p.id, () => superadminApi.approveUser(p.id), 'Failed to approve.', `${p.email} approved. They have been emailed.`)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" className="admin-reject" disabled={busyId === p.id} onClick={() => handleReject(p.id, p.email)}>
                      Reject
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </>
  );
}
