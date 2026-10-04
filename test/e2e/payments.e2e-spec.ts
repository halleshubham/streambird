import { describeE2E, bootApp, Client, Harness, ids, resetBillingState } from './harness';

const pay = ids('pay');

describeE2E('payments: one-time Razorpay orders (Day Pass, pay-once plans)', () => {
  let h: Harness;
  let admin: Client;
  let user: Client;
  let userEmail: string;
  const rzp = () => h.razorpay!;

  beforeAll(async () => {
    h = await bootApp({ razorpay: true });
    await resetBillingState(h.db);
    admin = (await h.signIn({ superadmin: true })).client;
    ({ client: user, email: userEmail } = await h.signIn());
  });
  afterAll(async () => {
    await resetBillingState(h.db);
    await h.close();
  });

  it('starts OFF: no key leaked, no orders', async () => {
    expect((await user.get('/billing/config')).body).toEqual({ enabled: false, keyId: null });
    const r = await user.post('/billing/orders', { planKey: 'pro' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toMatch(/not enabled/);
  });

  it('an admin turns it on (test mode); the config then exposes only the public key id', async () => {
    const r = await admin.patch('/superadmin/billing/settings', { paymentsEnabled: true });
    expect(r.body).toMatchObject({ enabled: true, keysConfigured: true, webhookSecretConfigured: true, mode: 'test' });
    expect((await user.get('/billing/config')).body).toEqual({ enabled: true, keyId: 'rzp_test_e2e' });
  });

  it('charges the SERVER-side price, refuses free/unknown plans', async () => {
    expect((await user.post('/billing/orders', { planKey: 'free' })).status).toBe(400);
    expect((await user.post('/billing/orders', { planKey: 'nope' })).status).toBe(404);
    const pro = await user.post('/billing/orders', { planKey: 'pro' });
    expect(pro.status).toBe(201);
    expect(pro.body).toMatchObject({ amountPaise: 199900, currency: 'INR', planKey: 'pro' });
    expect(rzp().callsTo('/orders').at(-1)!.body).toMatchObject({ amount: 199900, currency: 'INR' });
  });

  it('a forged signature applies nothing; the real one activates the plan; repeats are idempotent', async () => {
    const order = (await user.post('/billing/orders', { planKey: 'pro' })).body;
    const verify = (sig: string, payment = pay('A')) =>
      user.post('/billing/verify', { razorpay_order_id: order.orderId, razorpay_payment_id: payment, razorpay_signature: sig });

    expect((await verify('deadbeef')).status).toBe(400);
    expect((await user.get('/plans/me')).body.planKey).toBe('free');

    expect((await verify(rzp().orderSignature(order.orderId, pay('A')))).status).toBe(200);
    const limits = (await user.get('/plans/me')).body;
    expect(limits).toMatchObject({ planKey: 'pro', maxDestinations: 4, planExpired: false });
    expect(limits.planExpiresAt).toBeTruthy();

    await verify(rzp().orderSignature(order.orderId, pay('A')));
    expect((await user.get('/plans/me')).body.planExpiresAt).toBe(limits.planExpiresAt);
    const { rows } = await h.db.query(`SELECT count(*)::int AS n FROM payments WHERE razorpay_payment_id = $1`, [pay('A')]);
    expect(rows[0].n).toBe(1);
    expect(h.mailbox.receipts.filter((r) => r.to === userEmail)).toHaveLength(1);
  });

  it('refuses downgrades while a dearer plan is active', async () => {
    const r = await user.post('/billing/orders', { planKey: 'starter' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/lower plan/);
  });

  it("won't confirm someone else's order", async () => {
    const order = (await user.post('/billing/orders', { planKey: 'day_pass' })).body;
    const { client: stranger } = await h.signIn();
    const r = await stranger.post('/billing/verify', {
      razorpay_order_id: order.orderId,
      razorpay_payment_id: pay('steal'),
      razorpay_signature: rzp().orderSignature(order.orderId, pay('steal')),
    });
    expect(r.status).toBe(404);
  });

  describe('webhook (the backstop when the browser never comes back)', () => {
    let orderId: string;
    beforeAll(async () => {
      orderId = (await user.post('/billing/orders', { planKey: 'day_pass' })).body.orderId;
    });
    const send = (c: Client, body: Buffer, signature: string) =>
      c.call('POST', '/billing/webhook', { raw: body, headers: { 'x-razorpay-signature': signature } });

    it('rejects a bad signature (400)', async () => {
      const { body } = rzp().webhook('payment.captured', rzp().paymentEntity(pay('B'), orderId, 19900));
      expect((await send(user, body, 'ab'.repeat(32))).status).toBe(400);
    });

    it('ignores a validly-signed notice with the WRONG amount', async () => {
      const w = rzp().webhook('payment.captured', rzp().paymentEntity(pay('B'), orderId, 100));
      expect((await send(user, w.body, w.signature)).status).toBe(200);
      expect((await user.get('/plans/me')).body.dayPass).toBeNull();
    });

    it('a valid notice alone grants the day pass, once, even if redelivered', async () => {
      const w = rzp().webhook('payment.captured', rzp().paymentEntity(pay('B'), orderId, 19900));
      expect((await send(user, w.body, w.signature)).status).toBe(200);
      await send(user, w.body, w.signature);
      const limits = (await user.get('/plans/me')).body;
      expect(limits.dayPass).toMatchObject({ name: 'Day Pass' });
      expect(limits.maxGuests).toBe(10);
      const { rows } = await h.db.query(`SELECT count(*)::int AS n FROM payments WHERE status = 'paid' AND razorpay_payment_id = $1`, [pay('B')]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('shows the user their history and the admin everyone’s', async () => {
    const mine = (await user.get('/billing/payments')).body;
    expect(mine.map((p: any) => p.planKey).sort()).toEqual(['day_pass', 'pro']);
    const overview = (await admin.get('/superadmin/billing')).body;
    expect(overview.payments.length).toBeGreaterThanOrEqual(2);
    expect(overview.payments[0].accountName).toBeTruthy();
  });

  it('when the paid period lapses the account falls back to Free, and a lapsed plan stops blocking purchases', async () => {
    await h.db.query(`UPDATE accounts SET plan_expires_at = now() - interval '1 hour' WHERE plan_key = 'pro' AND id = (SELECT account_id FROM users WHERE email = $1)`, [userEmail]);
    const limits = (await user.get('/plans/me')).body;
    expect(limits).toMatchObject({ planKey: 'free', planExpired: true });
    expect((await user.post('/billing/orders', { planKey: 'starter' })).status).toBe(201);
  });

  it('turning it OFF again refuses orders and hides the key', async () => {
    expect((await admin.patch('/superadmin/billing/settings', { paymentsEnabled: false })).body.enabled).toBe(false);
    expect((await user.post('/billing/orders', { planKey: 'pro' })).status).toBe(403);
    expect((await user.get('/billing/config')).body).toEqual({ enabled: false, keyId: null });
  });
});
