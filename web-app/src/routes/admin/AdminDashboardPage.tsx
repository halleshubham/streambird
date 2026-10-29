import { useEffect, useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { BirdLoader } from '../../components/BirdLoader';
import { BirdBusy } from '../../components/BirdBusy';
import { PENDING_CHANGED_EVENT } from '../../lib/adminEvents';
import { Badge, DataTable, Empty, PageHeader, ROLE_LABEL, Section, When } from '../../components/admin/adminKit';
import { ApiError } from '../../api/client';
import type { HeavyUsageRow, PendingApproval, RegistrationStatus } from '../../types/api';

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
    if (!window.confirm(`Approve all ${pending.length} waiting signup${pending.length === 1 ? '' : 's'}? Each person is emailed that their studio is ready.`)) return;
    setRegBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { approved } = await superadminApi.approveAllPending();
      setNotice(`Approved ${approved} signup${approved === 1 ? '' : 's'}.`);
      await load();
      window.dispatchEvent(new Event(PENDING_CHANGED_EVENT));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the waiting signups.');
    } finally {
      setRegBusy(false);
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
        subtitle="Unless registration is open (auto-approve), new signups can't use StreamBird until you approve them. They get an email either way."
      />
      {reg && (
        <Section
          title={`Registration: ${reg.autoApprove ? 'open (auto-approve)' : 'paused (manual review)'}`}
          hint="Open lets new signups straight in. Paused makes them wait here for you, which is the way to slow growth when the server is busy. People already approved are never affected."
        >
          <div className="segmented" role="group" aria-label="Registration mode">
            <button type="button" className={!reg.autoApprove ? 'active' : ''} aria-pressed={!reg.autoApprove} disabled={regBusy} onClick={() => void changeMode(false)}>
              Manual review
            </button>
            <button type="button" className={reg.autoApprove ? 'active' : ''} aria-pressed={reg.autoApprove} disabled={regBusy} onClick={() => void changeMode(true)}>
              Auto-approve
            </button>
          </div>
          <p className="admin-hint" data-testid="registration-history">
            New signups: <strong>{reg.last24h}</strong> in the last 24 hours, <strong>{reg.last7d}</strong> in the last 7 days. <strong>{reg.waiting}</strong> waiting for approval now.
          </p>
          {notice && <p role="status" className="brand-notice">{notice}</p>}
          {reg.waiting > 0 && (
            <button type="button" className="icon-btn" disabled={regBusy} onClick={() => void approveAll()}>
              {regBusy && <BirdBusy />} Approve all waiting ({reg.waiting})
            </button>
          )}
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
                  <th scope="col">Hours</th>
                  <th scope="col">Used</th>
                  <th scope="col" className="hide-sm">Dest-hours</th>
                  <th scope="col" className="hide-sm">Est. cost</th>
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
                    <td className="nowrap">{r.hoursUsed} / {r.includedHours === null ? '∞' : r.includedHours}</td>
                    <td className="nowrap">
                      {r.percentUsed === null ? (
                        <Badge tone="neutral">Unlimited</Badge>
                      ) : (
                        <Badge tone={r.percentUsed >= 100 ? 'danger' : r.percentUsed >= 80 ? 'warning' : 'neutral'}>{r.percentUsed}%</Badge>
                      )}
                    </td>
                    <td className="nowrap hide-sm">{r.destinationHours}</td>
                    <td className="nowrap hide-sm">Rs {r.estimatedBandwidthCostInr}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </Section>
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
