import { useEffect, useState } from 'react';
import * as billingApi from '../../api/billing';
import { ApiError } from '../../api/client';
import { BirdBusy } from '../../components/BirdBusy';
import { BirdLoader } from '../../components/BirdLoader';
import type { AdminBilling } from '../../types/api';

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** The payments on/off switch, Razorpay setup status, and recent payments. Keys live in the server environment, never here. */
export function AdminBillingPage() {
  const [data, setData] = useState<AdminBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    setError(null);
    try {
      await billingApi.setPaymentsEnabled(next);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <BirdLoader loading compact />;

  const live = data.enabled && data.keysConfigured;
  const setup: Array<[string, boolean, string]> = [
    ['API keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)', data.keysConfigured, data.mode ? `${data.mode} mode` : 'missing'],
    ['Webhook secret (RAZORPAY_WEBHOOK_SECRET)', data.webhookSecretConfigured, data.webhookSecretConfigured ? 'set' : 'missing -- webhooks are rejected'],
  ];

  return (
    <>
      <h1>Billing</h1>
      <div className="panel">
        <h2>Online payments: {live ? 'ON' : 'OFF'}</h2>
        <p>
          When on, signed-in users see Buy buttons (Razorpay Checkout) for paid plans and the Day Pass. When off, those buttons are hidden
          and no order can be created; plans are then assigned by hand on the company page.
        </p>
        <button type="button" disabled={saving || (!data.enabled && !data.keysConfigured)} onClick={() => void toggle(!data.enabled)}>
          {saving && <BirdBusy />} {data.enabled ? 'Turn payments off' : 'Turn payments on'}
        </button>
        {!data.keysConfigured && <p className="error">Add the Razorpay keys to the server environment first.</p>}
        {data.enabled && data.mode === 'test' && <p className="docs-hint">Test mode: no real money moves. Switch to live keys when ready.</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <h2>Setup</h2>
      <table className="data-table">
        <tbody>
          {setup.map(([label, ok, note]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{ok ? '✓' : '✗'} {note}</td>
            </tr>
          ))}
          <tr>
            <td>Webhook URL (add in Razorpay → Webhooks)</td>
            <td><code>{data.webhookUrl}</code></td>
          </tr>
          <tr>
            <td>Webhook events to enable</td>
            <td>{data.webhookEvents.join(', ')}</td>
          </tr>
        </tbody>
      </table>

      <h2>Recent payments</h2>
      {data.payments.length === 0 ? (
        <p className="empty-state">No payments yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>When</th><th>Company</th><th>Plan</th><th>₹</th><th>Status</th><th>Razorpay payment</th></tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{dt(p.paidAt ?? p.createdAt)}</td>
                  <td>{p.accountName ?? p.accountId.slice(0, 8)}</td>
                  <td>{p.planKey}{p.kind === 'day_pass' ? ' (pass)' : ''}</td>
                  <td>{p.amountInr}</td>
                  <td>{p.status}{p.failureReason ? ` -- ${p.failureReason}` : ''}</td>
                  <td><code>{p.razorpayPaymentId ?? '—'}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
