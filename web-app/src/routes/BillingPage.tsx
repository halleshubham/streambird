import { monthlyHoursLabel } from '../lib/planCopy';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as billingApi from '../api/billing';
import { getMyLimits, getPublicPlans } from '../api/plans';
import { ApiError } from '../api/client';
import { getMyAccount } from '../api/accounts';
import { Notice, PageHeader } from '../components/host/HostKit';
import { BirdLoader } from '../components/BirdLoader';
import type { Account, BillingConfig, CheckoutOrder, EffectiveLimits, MyPayment, MySubscription, PublicPlan, SubscriptionCheckout } from '../types/api';
import { Button, Card, EmptyState, confirm } from '../components/ui';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpaySubscriptionSuccess {
  razorpay_subscription_id: string;
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
      : monthlyHoursLabel(p, 'stream-hours / month'),
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
  const [autopay, setAutopay] = useState<MySubscription | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const [c, pl, l, pay, sub] = await Promise.all([
      billingApi.getBillingConfig(),
      getPublicPlans(),
      getMyLimits(),
      billingApi.getMyPayments(),
      billingApi.getMySubscription(),
    ]);
    setAutopay(sub);
    getMyAccount().then(setAccount).catch(() => {}); // only for the hours meter; the page works without it
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

  /** Autopay: the customer authorises a recurring mandate once; Razorpay then charges each month. */
  async function subscribe(plan: PublicPlan) {
    setBusyPlan(plan.key);
    setMessage(null);
    try {
      const [order] = await Promise.all([billingApi.createSubscription(plan.key), loadCheckout()]);
      await openSubscriptionCheckout(order);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Something went wrong.', isError: true });
      setBusyPlan(null);
    }
  }

  function openSubscriptionCheckout(order: SubscriptionCheckout): Promise<void> {
    return new Promise((resolve) => {
      const rz = new window.Razorpay!({
        key: order.keyId,
        subscription_id: order.subscriptionId,
        name: 'StreamBird',
        description: order.description,
        theme: { color: '#7c3aed' },
        handler: (response: RazorpaySubscriptionSuccess) => {
          setMessage({ text: 'Autopay set up -- activating your plan…', isError: false });
          billingApi
            .verifySubscription(response)
            .then(() => refresh())
            .then(() => setMessage({ text: `${order.planName} is active and will renew automatically. A receipt is on its way.`, isError: false }))
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
      rz.on('payment.failed', (e) => setMessage({ text: e.error?.description ?? 'The payment failed. You have not been charged.', isError: true }));
      rz.open();
    });
  }

  async function cancelAutopay() {
    const ok = await confirm({
      title: 'Cancel autopay?',
      body: 'Your plan keeps working until the end of the period you have paid for, then your account drops to Free.',
      confirmLabel: 'Cancel autopay',
      cancelLabel: 'Keep autopay',
      destructive: true,
    });
    if (!ok) return;
    setMessage(null);
    try {
      setAutopay(await billingApi.cancelSubscription());
      setMessage({ text: 'Autopay cancelled. Your plan stays active until the end of the paid period.', isError: false });
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : 'Could not cancel autopay.', isError: true });
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

  if (!config || !limits) {
    return message?.isError ? (
      <div className="ha-page">
        <EmptyState tone="error" title="We couldn't load billing">
          {message.text}
        </EmptyState>
      </div>
    ) : (
      <BirdLoader loading compact label="Loading billing…" />
    );
  }

  const isFree = limits.planKey === 'free' || limits.planExpired;
  const used = account ? Number(account.streamHourUsageCurrentPeriod) : null;
  const included = limits.includedHours;
  const pct = used !== null && included !== null && included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const meterTone = pct >= 100 ? ' ha-meter--bad' : pct >= 80 ? ' ha-meter--warn' : '';
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  const autopayActive = !!autopay && ['authenticated', 'active', 'pending'].includes(autopay.status) && !autopay.cancelAtCycleEnd;

  return (
    <div className="ha-page billing-page">
      <PageHeader title="Billing" subtitle="Your plan, payments and receipts." />

      {message && (
        <Notice tone={message.isError ? 'error' : 'success'} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      <div className={autopay ? 'ha-dash-grid ha-dash-grid--pair' : undefined}>
        <Card as="section" aria-labelledby="cp-title">
          <div className="ha-row">
            <h2 id="cp-title">{isFree && !limits.planExpired ? `You are on the ${limits.planName} plan` : `Your plan: ${limits.planName}`}</h2>
            <span className="ha-sp" />
            {limits.planExpired ? <span className="ha-tag ha-tag--bad badge-danger">Expired</span> : <span className="ha-tag">{isFree ? 'Free' : 'Active'}</span>}
          </div>
          <p className="ha-muted ha-sm" style={{ marginTop: 6 }}>
            {limits.includedHours === null ? 'Unlimited hours' : `${limits.includedHours} stream-hours`} · up to {limits.maxDestinations} destination
            {limits.maxDestinations === 1 ? '' : 's'} · {limits.maxGuests} guests
          </p>
          {limits.planExpiresAt && !limits.planExpired && <p className="ha-muted ha-sm">Active until {when(limits.planExpiresAt)}.</p>}
          {limits.planExpired && <p className="ha-error" style={{ marginTop: 8 }}>Your paid plan ended, so you're on Free limits. Renew below to get it back.</p>}
          {limits.dayPass && <p className="ha-muted ha-sm">Day pass active until {new Date(limits.dayPass.expiresAt).toLocaleString()}.</p>}
          {used !== null && included !== null && (
            <>
              <p className="ha-muted ha-sm" style={{ margin: '18px 0 8px' }}>
                {fmt(used)} h of {fmt(included)} h streaming hours used this month
              </p>
              <div className={`ha-meter${meterTone}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Hours used" style={{ maxWidth: 420 }}>
                <i style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
        </Card>

        {autopay && (
          <Card as="section" aria-labelledby="ap-title">
            <h2 id="ap-title">Autopay</h2>
            {autopay.status === 'halted' ? (
              <p className="ha-error" style={{ marginTop: 8 }}>
                Autopay stopped because a renewal couldn't be charged. Your plan stays active for a few days; subscribe again below to keep it.
              </p>
            ) : autopay.cancelAtCycleEnd || autopay.status === 'cancelled' ? (
              <p className="ha-muted" style={{ marginTop: 8 }}>
                Autopay is cancelled.{autopay.currentEnd ? ` Your plan stays active until ${when(autopay.currentEnd)}.` : ''} Subscribe again below any time.
              </p>
            ) : (
              <>
                <p className="ha-muted" style={{ marginTop: 8 }}>
                  {rupees(autopay.amountInr)} is charged every month
                  {autopay.currentEnd ? `; next renewal around ${when(autopay.currentEnd)}` : ''}.
                  {autopay.status === 'pending' && ' The last renewal is being retried.'}
                </p>
                <div className="ha-row" style={{ marginTop: 16 }}>
                  <span className="ha-sp" />
                  <button type="button" className="ha-quiet ha-quiet--danger" onClick={() => void cancelAutopay()}>
                    Cancel autopay
                  </button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      {!config.enabled && (
        <Notice tone="info">
          Online payments aren't switched on yet. To upgrade or for customised pricing, email{' '}
          <a href="mailto:support@shackyapps.in?subject=StreamBird%20upgrade">support@shackyapps.in</a>.
        </Notice>
      )}

      <section aria-labelledby="plans-title">
        <h2 id="plans-title" style={{ marginBottom: 16 }}>
          {isFree ? 'Upgrade when you are ready' : 'Plans'}
        </h2>
        <div className="ha-plans">
          {plans.map((p) => {
            const isCurrent = !limits.planExpired && limits.planKey === p.key;
            return (
              <Card
                key={p.key}
                as="div"
                className={`ha-plan${isCurrent ? ' ha-plan--current' : ''}${highlight === p.key ? ' billing-plan--highlight' : ''}`}
              >
                <div className="ha-row">
                  <h3 style={{ fontSize: 17 }}>{p.name}</h3>
                  {isCurrent && <span className="ha-tag">Current</span>}
                </div>
                <p className="billing-price">
                  {rupees(p.priceInr ?? 0)}
                  <span>{p.kind === 'day_pass' ? ' / day' : ' / month'}</span>
                </p>
                <ul>
                  {describePlan(p).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="ha-plan-foot">
                  {config.enabled && p.kind === 'monthly' && (() => {
                    const onAutopay = autopayActive && autopay!.planKey === p.key;
                    const hasLiveAutopay = !!autopay && ['authenticated', 'active', 'pending'].includes(autopay.status);
                    return onAutopay ? (
                      <p className="ha-sm">Autopay is on for this plan</p>
                    ) : (
                      <>
                        <Button className={isCurrent ? 'ha-plan-btn-inv' : undefined} busy={busyPlan === p.key} disabled={busyPlan !== null} onClick={() => void subscribe(p)}>
                          Subscribe -- autopay
                        </Button>
                        {!hasLiveAutopay && (
                          <button type="button" className="ha-quiet" style={{ paddingLeft: 0, color: isCurrent ? '#fff' : undefined }} disabled={busyPlan !== null} onClick={() => void buy(p)}>
                            {isCurrent ? 'Renew once for 30 days' : 'Or pay once for 30 days'}
                          </button>
                        )}
                      </>
                    );
                  })()}
                  {config.enabled && p.kind === 'day_pass' && (
                    <Button busy={busyPlan === p.key} disabled={busyPlan !== null} onClick={() => void buy(p)}>
                      Buy
                    </Button>
                  )}
                  {isCurrent && !config.enabled && <p className="ha-sm">Your current plan</p>}
                </div>
              </Card>
            );
          })}
        </div>
        <p className="ha-hint">Prices in INR. Need a GST invoice or something custom? Email support@shackyapps.in.</p>
      </section>

      <Card as="section" aria-labelledby="ph-title">
        <h2 id="ph-title">Payment history</h2>
        {payments.length === 0 ? (
          <p className="ha-muted" style={{ marginTop: 6 }}>
            No payments yet. Receipts will appear here after your first payment.
          </p>
        ) : (
          <div className="ha-table-wrap table-scroll" style={{ marginTop: 12 }}>
            <table className="ha-table data-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{when(p.paidAt ?? p.createdAt)}</td>
                    <td>{plans.find((x) => x.key === p.planKey)?.name ?? p.planKey}</td>
                    <td>{rupees(p.amountInr)}</td>
                    <td>
                      <span className={`ha-tag ${p.status === 'paid' ? 'ha-tag--ok' : p.status === 'failed' ? 'ha-tag--bad' : 'ha-tag--warn'}`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
