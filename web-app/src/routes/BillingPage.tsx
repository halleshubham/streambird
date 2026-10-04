import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as billingApi from '../api/billing';
import { getMyLimits, getPublicPlans } from '../api/plans';
import { ApiError } from '../api/client';
import { BirdBusy } from '../components/BirdBusy';
import { BirdLoader } from '../components/BirdLoader';
import type { BillingConfig, CheckoutOrder, EffectiveLimits, MyPayment, PublicPlan } from '../types/api';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayCheckout {
  open(): void;
  on(event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** Loads Razorpay's Checkout script once, on demand (only when someone actually presses Buy). */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load the payment window. Check your connection and try again.')));
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function describePlan(p: PublicPlan): string[] {
  return [
    p.kind === 'day_pass'
      ? `${p.maxSessionHours ? `Up to ${p.maxSessionHours} h per stream` : 'Unlimited streams'} for ${p.validityHours === 24 ? 'one day' : `${p.validityHours} h`}`
      : p.includedHoursPerMonth === null
        ? 'Unlimited streaming (fair use)'
        : `${p.includedHoursPerMonth} stream-hours / 30 days`,
    `${p.maxDestinations} destination${p.maxDestinations === 1 ? '' : 's'}`,
    `${p.maxGuests} studio guests`,
  ];
}

/** Current plan, Buy buttons (Razorpay Checkout) and payment history. Buying is admin-switchable; with it off this page just explains how to upgrade. */
export function BillingPage() {
  const [params] = useSearchParams();
  const highlight = params.get('plan');
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [limits, setLimits] = useState<EffectiveLimits | null>(null);
  const [payments, setPayments] = useState<MyPayment[]>([]);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const [c, pl, l, pay] = await Promise.all([
      billingApi.getBillingConfig(),
      getPublicPlans(),
      getMyLimits(),
      billingApi.getMyPayments(),
    ]);
    setConfig(c);
    setPlans(pl.filter((p) => (p.priceInr ?? 0) > 0));
    setLimits(l);
    setPayments(pay);
  }, []);

  useEffect(() => {
    refresh().catch((err) => setMessage({ text: err instanceof ApiError ? err.message : 'Failed to load billing.', isError: true }));
  }, [refresh]);

  async function buy(plan: PublicPlan) {
    setBusyPlan(plan.key);
    setMessage(null);
    try {
      const [order] = await Promise.all([billingApi.createOrder(plan.key), loadCheckout()]);
      await openCheckout(order);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Something went wrong.', isError: true });
      setBusyPlan(null);
    }
  }

  function openCheckout(order: CheckoutOrder): Promise<void> {
    return new Promise((resolve) => {
      const rz = new window.Razorpay!({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'StreamBird',
        description: order.description,
        theme: { color: '#7c3aed' },
        handler: (response: RazorpaySuccess) => {
          setMessage({ text: 'Payment received -- activating your plan…', isError: false });
          billingApi
            .verifyPayment(response)
            .then(() => refresh())
            .then(() => setMessage({ text: `${order.planName} is active. A receipt is on its way to your email.`, isError: false }))
            .catch((err) =>
              setMessage({
                text: `${err instanceof ApiError ? err.message : 'Could not confirm the payment.'} If you were charged it will still be applied shortly; otherwise email support@shackyapps.in.`,
                isError: true,
              }),
            )
            .finally(() => {
              setBusyPlan(null);
              resolve();
            });
        },
        modal: {
          ondismiss: () => {
            setBusyPlan(null);
            resolve();
          },
        },
      });
      rz.on('payment.failed', (r) => setMessage({ text: r.error?.description ?? 'The payment failed. You have not been charged.', isError: true }));
      rz.open();
    });
  }

  if (!config || !limits) return message?.isError ? <p className="error">{message.text}</p> : <BirdLoader loading compact label="Loading billing…" />;

  return (
    <div className="billing-page">
      <h1>Billing</h1>

      <div className="panel billing-current">
        <h2>
          Your plan: {limits.planName}
          {limits.planExpired && <span className="badge badge-danger"> expired</span>}
        </h2>
        <p>
          {limits.includedHours === null ? 'Unlimited hours' : `${limits.includedHours} stream-hours`} · up to {limits.maxDestinations} destination
          {limits.maxDestinations === 1 ? '' : 's'} · {limits.maxGuests} guests
        </p>
        {limits.planExpiresAt && !limits.planExpired && <p>Active until {when(limits.planExpiresAt)}.</p>}
        {limits.planExpired && <p className="error">Your paid plan ended, so you're on Free limits. Renew below to get it back.</p>}
        {limits.dayPass && <p>Day pass active until {new Date(limits.dayPass.expiresAt).toLocaleString()}.</p>}
      </div>

      {message && <p className={message.isError ? 'error' : 'status'}>{message.text}</p>}

      {!config.enabled && (
        <p className="docs-hint">
          Online payments aren't switched on yet. To upgrade or for customised pricing, email{' '}
          <a href="mailto:support@shackyapps.in?subject=StreamBird%20upgrade">support@shackyapps.in</a>.
        </p>
      )}

      <h2>Plans</h2>
      <div className="billing-plans">
        {plans.map((p) => {
          const isCurrent = !limits.planExpired && limits.planKey === p.key;
          return (
            <div key={p.key} className={`panel billing-plan${highlight === p.key ? ' billing-plan--highlight' : ''}`}>
              <h3>{p.name}</h3>
              <p className="billing-price">
                {rupees(p.priceInr ?? 0)}
                <span>{p.kind === 'day_pass' ? ' / day' : ' / 30 days'}</span>
              </p>
              <ul>
                {describePlan(p).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {config.enabled ? (
                <button type="button" disabled={busyPlan !== null} onClick={() => void buy(p)}>
                  {busyPlan === p.key && <BirdBusy />} {isCurrent && p.kind === 'monthly' ? 'Renew' : 'Buy'}
                </button>
              ) : null}
              {isCurrent && <p className="docs-hint">Your current plan</p>}
            </div>
          );
        })}
      </div>
      <p className="docs-hint">Prices in INR. Need a GST invoice or something custom? Email support@shackyapps.in.</p>

      <h2>Payment history</h2>
      {payments.length === 0 ? (
        <p className="empty-state">No payments yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{when(p.paidAt ?? p.createdAt)}</td>
                  <td>{plans.find((x) => x.key === p.planKey)?.name ?? p.planKey}</td>
                  <td>{rupees(p.amountInr)}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
