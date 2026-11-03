import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as billingApi from '../../api/billing';
import { ApiError } from '../../api/client';
import { BirdLoader } from '../../components/BirdLoader';
import { Badge, DataTable, Empty, Notice, PageHeader, Section, ShowMore, When, planLabel, statusTone } from '../../components/admin/adminKit';
import { Card, confirm, toast } from '../../components/ui';
import type { AdminBilling } from '../../types/api';

const ROWS = 20;

/** The payments on/off switch, Razorpay setup status, and recent payments. Keys live in the server environment, never here. */
export function AdminBillingPage() {
  const [data, setData] = useState<AdminBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [paymentRows, setPaymentRows] = useState(ROWS);
  const [subRows, setSubRows] = useState(ROWS);

  async function load() {
    try {
      setData(await billingApi.getAdminBilling());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load billing.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggle(next: boolean) {
    if (!next) {
      const ok = await confirm({
        title: 'Turn online payments off?',
        body: (
          <>
            Customers will not be able to buy plans or day passes.
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>The Buy buttons are hidden and no order can be created</li>
              <li>Existing autopay subscriptions keep renewing</li>
              <li>You can turn it back on at any time</li>
            </ul>
          </>
        ),
        confirmLabel: 'Turn off',
        cancelLabel: 'Keep payments on',
        destructive: true,
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      await billingApi.setPaymentsEnabled(next);
      toast.success(next ? 'Online payments are on.' : 'Online payments are off.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  }

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <BirdLoader loading compact />;

  const live = data.enabled && data.keysConfigured;
  const setup: Array<[string, boolean, string]> = [
    ['API keys', data.keysConfigured, data.keysConfigured ? (data.mode ? `${data.mode} mode` : 'set') : 'missing: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET'],
    ['Webhook secret', data.webhookSecretConfigured, data.webhookSecretConfigured ? 'set' : 'missing: set RAZORPAY_WEBHOOK_SECRET (webhooks are rejected without it)'],
  ];

  return (
    <>
      <PageHeader title="Billing" subtitle="The payments switch, Razorpay setup, autopay subscriptions and recent payments." />

      <Section>
        <div className="admin-card-head">
          <div>
            <h2>Online payments</h2>
            <p className="admin-hint">
              When on, signed-in users see Buy buttons (Razorpay Checkout) for paid plans and the Day Pass. When off, those buttons are hidden and no order can be created; plans are then assigned by hand on the company page. Existing autopay continues.
            </p>
          </div>
          <div className="admin-toggle">
            <span className="admin-toggle-state" data-on={live} aria-hidden="true">{live ? 'ON' : 'OFF'}</span>
            <button
              type="button"
              role="switch"
              className="admin-switch"
              aria-checked={live}
              aria-label="Online payments"
              disabled={saving || (!data.enabled && !data.keysConfigured)}
              onClick={() => void toggle(!data.enabled)}
            >
              <i />
            </button>
          </div>
        </div>
        {!data.keysConfigured && <Notice tone="error">Add the Razorpay keys to the server environment first.</Notice>}
        {data.enabled && data.mode === 'test' && <p className="admin-hint" style={{ marginBottom: 0 }}>Test mode: no real money moves. Switch to live keys when ready.</p>}
        {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}
      </Section>

      <Section title="Razorpay setup">
        <dl className="admin-kv">
          {setup.map(([label, ok, note]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>
                <Badge tone={ok ? 'success' : 'danger'}>{ok ? 'OK' : 'Missing'}</Badge> {note}
              </dd>
            </div>
          ))}
          <dt>Webhook URL (add in Razorpay → Webhooks)</dt>
          <dd><code>{data.webhookUrl}</code></dd>
          <dt>Webhook events to enable</dt>
          <dd>{data.webhookEvents.join(', ')}</dd>
        </dl>
      </Section>

      <Card className="admin-section">
      <h2>Autopay subscriptions</h2>
      {data.subscriptions.length === 0 ? (
        <Empty>No subscriptions yet.</Empty>
      ) : (
        <>
          <DataTable caption="Autopay subscriptions">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Plan</th>
                <th scope="col" className="num">₹ / month</th>
                <th scope="col">Status</th>
                <th scope="col">Next renewal / ends</th>
                <th scope="col" className="num">Charges</th>
              </tr>
            </thead>
            <tbody>
              {data.subscriptions.slice(0, subRows).map((sub) => (
                <tr key={sub.id}>
                  <td>{sub.accountName ?? '—'}</td>
                  <td>{planLabel(sub.planKey)}</td>
                  <td className="num">{sub.amountInr}</td>
                  <td>
                    <Badge tone={statusTone(sub.status)}>{sub.status}</Badge>
                    {sub.cancelAtCycleEnd && <> <Badge tone="warning">cancelling</Badge></>}
                  </td>
                  <td className="nowrap"><When iso={sub.currentEnd} /></td>
                  <td className="num">{sub.paidCount}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <ShowMore shown={Math.min(subRows, data.subscriptions.length)} total={data.subscriptions.length} step={ROWS} onMore={() => setSubRows((n) => n + ROWS)} />
        </>
      )}

      </Card>

      <Card className="admin-section">
      <h2>Recent payments</h2>
      {data.payments.length === 0 ? (
        <Empty>No payments yet.</Empty>
      ) : (
        <>
          <DataTable caption="Recent payments">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Company</th>
                <th scope="col">Plan</th>
                <th scope="col" className="num">₹</th>
                <th scope="col">Status</th>
                <th scope="col">Razorpay payment</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.slice(0, paymentRows).map((p) => (
                <tr key={p.id}>
                  <td className="nowrap"><When iso={p.paidAt ?? p.createdAt} /></td>
                  <td><Link to={`/admin/accounts/${p.accountId}`} className="admin-link">{p.accountName ?? p.accountId.slice(0, 8)}</Link></td>
                  <td>{planLabel(p.planKey)}{p.kind === 'day_pass' ? ' (pass)' : ''}</td>
                  <td className="num">{p.amountInr}</td>
                  <td>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    {p.failureReason && <span className="admin-cell-sub">{p.failureReason}</span>}
                  </td>
                  <td><code>{p.razorpayPaymentId ?? '—'}</code></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <ShowMore shown={Math.min(paymentRows, data.payments.length)} total={data.payments.length} step={ROWS} onMore={() => setPaymentRows((n) => n + ROWS)} />
        </>
      )}
      </Card>
    </>
  );
}
