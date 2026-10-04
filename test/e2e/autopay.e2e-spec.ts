import { describeE2E, bootApp, Client, Harness, ids, resetBillingState } from './harness';

const pay = ids('pay');

const DAY = 86_400_000;

describeE2E('payments: Razorpay autopay (Subscriptions)', () => {
  let h: Harness;
  let admin: Client;
  const rzp = () => h.razorpay!;
  const hook = (c: Client, event: string, subscription: Record<string, unknown>, payment?: any) => {
    const w = rzp().webhook(event, { subscription: { entity: subscription }, ...(payment ?? {}) });
    return c.call('POST', '/billing/webhook', { raw: w.body, headers: { 'x-razorpay-signature': w.signature } });
  };
  const charge = (id: string, amountPaise: number) => rzp().paymentEntity(id, null, amountPaise);
  const verifySub = (c: Client, subscriptionId: string, paymentId: string, signature = rzp().subscriptionSignature(paymentId, subscriptionId)) =>
    c.post('/billing/subscriptions/verify', { razorpay_subscription_id: subscriptionId, razorpay_payment_id: paymentId, razorpay_signature: signature });
  const expiry = async (c: Client) => new Date((await c.get('/plans/me')).body.planExpiresAt).getTime();
  const count = async (sql: string, args: unknown[] = []) => (await h.db.query(sql, args)).rows[0].n as number;

  beforeAll(async () => {
    h = await bootApp({ razorpay: true });
    await resetBillingState(h.db);
    admin = (await h.signIn({ superadmin: true })).client;
    await admin.patch('/superadmin/billing/settings', { paymentsEnabled: true });
  });
  afterAll(async () => {
    await resetBillingState(h.db);
    await h.close();
  });

  describe('subscribe, first charge, renewal, cancel', () => {
    let buyer: Client;
    let buyerEmail: string;
    let subId: string;
    const now = Date.now();
    const cycleEnd1 = Math.floor((now + 30 * DAY) / 1000);

    beforeAll(async () => {
      ({ client: buyer, email: buyerEmail } = await h.signIn());
    });

    it('a Day Pass cannot be a subscription; Pro creates a Razorpay plan at its price, once', async () => {
      expect((await buyer.post('/billing/subscriptions', { planKey: 'day_pass' })).status).toBe(400);
      const r = await buyer.post('/billing/subscriptions', { planKey: 'pro' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ planKey: 'pro', amountPaise: 199900 });
      subId = r.body.subscriptionId;
      const plans = rzp().callsTo('/plans');
      expect(plans).toHaveLength(1);
      expect(plans[0].body).toMatchObject({ period: 'monthly', interval: 1, item: { amount: 199900, currency: 'INR' } });
      expect((await h.db.query(`SELECT razorpay_plan_id FROM plans WHERE key = 'pro'`)).rows[0].razorpay_plan_id).toMatch(/^plan_/);
      expect((await buyer.get('/plans/me')).body.planKey).toBe('free'); // nothing active before the first charge
    });

    it('rejects a wrong signature, and the Orders-style id order', async () => {
      expect((await verifySub(buyer, subId, pay('1'), rzp().subscriptionSignature(pay('X'), subId))).status).toBe(400);
      expect((await verifySub(buyer, subId, pay('1'), rzp().orderSignature(subId, pay('1')))).status).toBe(400);
    });

    it('first charge verified: Pro until the cycle end + 3 days grace; recorded as an autopay payment', async () => {
      expect((await verifySub(buyer, subId, pay('1'))).status).toBe(200);
      expect(Math.abs((await expiry(buyer)) - (now + 33 * DAY))).toBeLessThan(5 * 60_000);
      expect((await buyer.get('/billing/subscription')).body).toMatchObject({ status: 'active', amountInr: 1999, cancelAtCycleEnd: false });
      const { rows } = await h.db.query(`SELECT razorpay_order_id, razorpay_subscription_id, kind FROM payments WHERE razorpay_payment_id = $1`, [pay('1')]);
      expect(rows[0]).toEqual({ razorpay_order_id: null, razorpay_subscription_id: subId, kind: 'plan' });
      expect(h.mailbox.receipts.filter((r) => r.to === buyerEmail)).toHaveLength(1);
    });

    it('the webhook for the very same charge changes nothing (ON CONFLICT DO NOTHING on real Postgres)', async () => {
      const before = await expiry(buyer);
      const r = await hook(buyer, 'subscription.charged', { id: subId, current_end: cycleEnd1, paid_count: 1 }, charge(pay('1'), 199900));
      expect(r.status).toBe(200);
      expect(await count(`SELECT count(*)::int AS n FROM payments WHERE razorpay_payment_id = $1`, [pay('1')])).toBe(1);
      expect(await expiry(buyer)).toBe(before);
    });

    it('a renewal pushes the plan out once; redelivery, a wrong amount and unknown subscriptions are ignored', async () => {
      const cycleEnd2 = Math.floor((now + 60 * DAY) / 1000);
      const renewal = { id: subId, current_end: cycleEnd2, paid_count: 2 };
      await hook(buyer, 'subscription.charged', renewal, charge(pay('2'), 199900));
      expect(Math.abs((await expiry(buyer)) - (cycleEnd2 * 1000 + 3 * DAY))).toBeLessThan(5000);
      await hook(buyer, 'subscription.charged', renewal, charge(pay('2'), 199900));
      await hook(buyer, 'subscription.charged', { ...renewal, paid_count: 3 }, charge(pay('3'), 100));
      await hook(buyer, 'subscription.charged', { id: 'sub_unknown', current_end: cycleEnd2 }, charge(pay('4'), 199900));
      expect(await count(`SELECT count(*)::int AS n FROM payments WHERE razorpay_subscription_id = $1`, [subId])).toBe(2);
      expect((await h.db.query(`SELECT paid_count FROM subscriptions WHERE razorpay_subscription_id = $1`, [subId])).rows[0].paid_count).toBe(2);
    });

    it('a one-time purchase is blocked while the autopay is live', async () => {
      const r = await buyer.post('/billing/orders', { planKey: 'pro' });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/autopay/);
    });

    it('cancel asks Razorpay to cancel AT CYCLE END; the plan keeps working; the cancelled event trims the grace', async () => {
      const cancelled = await buyer.post('/billing/subscription/cancel');
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.cancelAtCycleEnd).toBe(true);
      expect(rzp().callsTo('/cancel').at(-1)!.body).toEqual({ cancel_at_cycle_end: 1 });
      expect((await buyer.get('/plans/me')).body.planKey).toBe('pro');

      const cycleEnd2 = Math.floor((now + 60 * DAY) / 1000);
      await hook(buyer, 'subscription.cancelled', { id: subId, current_end: cycleEnd2 });
      expect((await h.db.query(`SELECT status FROM subscriptions WHERE razorpay_subscription_id = $1`, [subId])).rows[0].status).toBe('cancelled');
      expect(Math.abs((await expiry(buyer)) - cycleEnd2 * 1000)).toBeLessThan(5000);
    });
  });

  it('a failed renewal: pending -> halted, the customer is emailed, the plan is not cut off at once', async () => {
    const { client, email } = await h.signIn();
    const s = (await client.post('/billing/subscriptions', { planKey: 'starter' })).body.subscriptionId;
    await verifySub(client, s, pay(s));
    expect((await client.get('/plans/me')).body.planKey).toBe('starter');

    await hook(client, 'subscription.pending', { id: s });
    expect((await client.get('/billing/subscription')).body.status).toBe('pending');
    await hook(client, 'subscription.halted', { id: s });
    expect((await client.get('/billing/subscription')).body.status).toBe('halted');
    expect(h.mailbox.notices.some((n) => n.to === email && /could not be charged/.test(n.subject))).toBe(true);
    expect((await client.get('/plans/me')).body.planKey).toBe('starter');
  });

  it('an upgrade cancels the old autopay only after the new one has charged; a late charge on the old one is not applied', async () => {
    const { client } = await h.signIn();
    const oldSub = (await client.post('/billing/subscriptions', { planKey: 'starter' })).body.subscriptionId;
    await verifySub(client, oldSub, pay(oldSub));

    const newSub = (await client.post('/billing/subscriptions', { planKey: 'pro' })).body.subscriptionId;
    expect(rzp().callsTo(`/subscriptions/${oldSub}/cancel`)).toHaveLength(0); // the new checkout might be abandoned
    expect((await client.post('/billing/orders', { planKey: 'pro' })).status).toBe(400);

    await verifySub(client, newSub, pay(newSub));
    expect(rzp().callsTo(`/subscriptions/${oldSub}/cancel`)).toHaveLength(1);
    expect(rzp().callsTo(`/subscriptions/${oldSub}/cancel`)[0].body).toEqual({ cancel_at_cycle_end: 0 }); // immediately
    expect((await client.get('/plans/me')).body.planKey).toBe('pro');

    await hook(client, 'subscription.charged', { id: oldSub, current_end: Math.floor((Date.now() + DAY) / 1000), paid_count: 2 }, charge(pay('late'), 99900));
    expect((await client.get('/plans/me')).body.planKey).toBe('pro'); // not moved back to Starter
    expect(await count(`SELECT count(*)::int AS n FROM payments WHERE razorpay_payment_id = $1`, [pay('late')])).toBe(1); // but recorded for review
  });

  it('the admin overview lists subscriptions and the subscription webhook events', async () => {
    const overview = (await admin.get('/superadmin/billing')).body;
    expect(overview.subscriptions.length).toBeGreaterThanOrEqual(3);
    expect(overview.webhookEvents).toEqual(expect.arrayContaining(['subscription.charged', 'subscription.halted']));
  });
});
