import * as crypto from 'crypto';
import { BillingService } from './billing.service';
import { RazorpayClient } from './razorpay.client';

const KEY_SECRET = 'ks';
const WH_SECRET = 'ws';
let planSeq = 0;
let subSeq = 0;
const hmac = (s: string, m: string | Buffer) => crypto.createHmac('sha256', s).update(m).digest('hex');

const PLANS: Record<string, any> = {
  free: { key: 'free', name: 'Free', kind: 'monthly', priceInr: 0, isActive: true, isPublic: true },
  starter: { key: 'starter', name: 'Starter', kind: 'monthly', priceInr: 999, isActive: true, isPublic: true, razorpayPlanId: null, razorpayPlanAmountPaise: null },
  pro: { key: 'pro', name: 'Pro', kind: 'monthly', priceInr: 1999, isActive: true, isPublic: true, razorpayPlanId: null, razorpayPlanAmountPaise: null },
  day_pass: { key: 'day_pass', name: 'Day Pass', kind: 'day_pass', priceInr: 199, isActive: true, isPublic: true },
  hidden: { key: 'hidden', name: 'Hidden', kind: 'monthly', priceInr: 500, isActive: true, isPublic: false },
};

function build(opts: { switchOn?: boolean; keys?: boolean; limits?: any } = {}) {
  const { switchOn = true, keys = true } = opts;
  const rows = new Map<string, any>();
  const payments = {
    create: (v: any) => v,
    save: jest.fn(async (v: any) => { rows.set(v.id, { ...v }); return v; }),
    findOne: jest.fn(async ({ where }: any) =>
      [...rows.values()].find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null),
    update: jest.fn(async (where: any, patch: any) => {
      for (const r of rows.values()) if (Object.entries(where).every(([k, v]) => r[k] === v)) Object.assign(r, patch);
    }),
    delete: jest.fn(async (where: any) => { rows.delete(where.id); }),
    // The atomic claim (update) and the insert-or-ignore used for autopay charges.
    createQueryBuilder: () => {
      let setv: any; let params: any; let inserting: any = null;
      const qb: any = {
        update: () => qb, set: (v: any) => ((setv = v), qb),
        where: (_s: string, p: any) => ((params = p), qb),
        insert: () => qb, into: () => qb, orIgnore: () => qb, returning: () => qb,
        values: (v: any) => ((inserting = v), qb),
        execute: async () => {
          if (inserting) {
            const dupe = [...rows.values()].some((r) => r.razorpayPaymentId && r.razorpayPaymentId === inserting.razorpayPaymentId);
            if (dupe) return { raw: [] };
            rows.set(inserting.id, { ...inserting }); return { raw: [{ id: inserting.id }] };
          }
          const r = rows.get(params.id);
          if (!r || r.status === 'paid') return { affected: 0 };
          Object.assign(r, setv); return { affected: 1 };
        },
      };
      return qb;
    },
    find: jest.fn(async () => [...rows.values()]),
  };
  const settings = { findOne: jest.fn(async () => ({ value: switchOn })), save: jest.fn(async () => undefined) };
  const subRows = new Map<string, any>();
  const matches = (r: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => (v && typeof v === 'object' && ('_value' in v || 'value' in v) ? (v._value ?? v.value).includes(r[k]) : r[k] === v));
  const subscriptions = {
    create: (v: any) => ({ id: crypto.randomUUID(), createdAt: new Date(), cancelAtCycleEnd: false, currentEnd: null, paidCount: 0, ...v }),
    save: jest.fn(async (v: any) => { subRows.set(v.id, v); return v; }),
    findOne: jest.fn(async ({ where }: any) => [...subRows.values()].reverse().find((r) => matches(r, where)) ?? null),
    find: jest.fn(async ({ where }: any = {}) => [...subRows.values()].filter((r) => !where || matches(r, where))),
    update: jest.fn(async (where: any, patch: any) => { for (const r of subRows.values()) if (matches(r, where)) Object.assign(r, patch); }),
  };
  const planRepo = { update: jest.fn(async (where: any, patch: any) => { Object.assign(PLANS[where.key], patch); }) };
  const accountRows = new Map<string, any>([['acc_1', { id: 'acc_1', planKey: 'pro', planExpiresAt: new Date('2026-11-10T00:00:00Z') }]]);
  const accountsRepo = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async ({ where }: any) => accountRows.get(where.id) ?? null),
    update: jest.fn(async (where: any, patch: any) => { Object.assign(accountRows.get(where.id), patch); }),
  };
  const config = { get: (k: string) => ({ 'razorpay.keyId': keys ? 'rzp_test_k' : '', 'razorpay.keySecret': keys ? KEY_SECRET : '', 'razorpay.webhookSecret': WH_SECRET, 'razorpay.graceDays': 3, publicBaseUrl: 'https://app.test' })[k] } as any;
  const razorpay = new RazorpayClient(config);
  const createOrder = jest.spyOn(razorpay, 'createOrder').mockImplementation(async (i) => ({ id: `order_${rows.size + 1}`, amount: i.amountPaise, currency: i.currency, status: 'created', receipt: i.receipt }));
  const plans = { findByKeyOrThrow: jest.fn(async (k: string) => { if (!PLANS[k]) throw new Error('nf'); return PLANS[k]; }) };
  const accountsService = {
    getLimits: jest.fn(async () => opts.limits ?? { planKey: 'free', planExpired: false }),
    grantDayPass: jest.fn(async () => ({ dayPassExpiresAt: new Date('2026-10-06T00:00:00Z') })),
    activatePlan: jest.fn(async () => ({ planExpiresAt: new Date('2026-11-04T00:00:00Z') })),
  };
  const users = { findOne: jest.fn(async () => ({ email: 'u@test.dev' })) };
  const email = { sendPaymentReceipt: jest.fn(async () => undefined), sendBillingNotice: jest.fn(async () => undefined) };
  const svc = new BillingService(payments as any, settings as any, subscriptions as any, planRepo as any, accountsRepo as any, users as any, razorpay, plans as any, accountsService as any, config, email as any);
  const rzpPlan = jest.spyOn(razorpay, 'createPlan').mockImplementation(async () => ({ id: `plan_${++planSeq}` }));
  const rzpSub = jest.spyOn(razorpay, 'createSubscription').mockImplementation(async (i) => ({ id: `sub_${++subSeq}`, plan_id: i.planId, status: 'created' }));
  const rzpFetch = jest.spyOn(razorpay, 'fetchSubscription').mockImplementation(async (id) => ({ id, plan_id: 'p', status: 'active', current_end: Math.floor(new Date('2026-11-05T00:00:00Z').getTime() / 1000), paid_count: 1 }));
  const rzpCancel = jest.spyOn(razorpay, 'cancelSubscription').mockImplementation(async (id) => ({ id, plan_id: 'p', status: 'cancelled' }));
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
  const account: any = { id: 'acc_1' };
  const user: any = { id: 'user_1' };
  return { svc, rows, payments, settings, razorpay, createOrder, accountsService, email, account, user, subRows, subscriptions, rzpPlan, rzpSub, rzpFetch, rzpCancel, accountRows };
}

const webhookBody = (event: string, over: any = {}) =>
  Buffer.from(JSON.stringify({ event, payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 199 * 100, currency: 'INR', status: 'captured', ...over } } } }));

describe('BillingService', () => {
  describe('admin switch', () => {
    it('is off unless an admin switched it on AND keys are configured', async () => {
      expect(await build({ switchOn: false }).svc.isEnabled()).toBe(false);
      expect(await build({ keys: false }).svc.isEnabled()).toBe(false);
      expect(await build().svc.isEnabled()).toBe(true);
    });

    it('refuses to enable without keys, and only exposes the public key id while enabled', async () => {
      await expect(build({ keys: false }).svc.setPaymentsEnabled(true)).rejects.toThrow(/RAZORPAY_KEY_ID/);
      await expect(build({ switchOn: false }).svc.publicConfig()).resolves.toEqual({ enabled: false, keyId: null });
      await expect(build().svc.publicConfig()).resolves.toEqual({ enabled: true, keyId: 'rzp_test_k' });
    });
  });

  describe('createOrder', () => {
    it('refuses while payments are off', async () => {
      const { svc, account, user, createOrder } = build({ switchOn: false });
      await expect(svc.createOrder(account, user, 'pro')).rejects.toThrow(/not enabled/);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it("charges the plan's server-side price in paise and records a pending payment", async () => {
      const { svc, account, user, createOrder, rows } = build();
      const order = await svc.createOrder(account, user, 'day_pass');
      expect(order).toMatchObject({ amountPaise: 19900, currency: 'INR', planKey: 'day_pass', keyId: 'rzp_test_k' });
      expect(createOrder.mock.calls[0][0].receipt.length).toBeLessThanOrEqual(40);
      const row = [...rows.values()][0];
      expect(row).toMatchObject({ accountId: 'acc_1', planKey: 'day_pass', kind: 'day_pass', amountPaise: 19900, status: 'created' });
    });

    it('rejects free, hidden and unknown plans', async () => {
      const { svc, account, user } = build();
      await expect(svc.createOrder(account, user, 'free')).rejects.toThrow(/not available/);
      await expect(svc.createOrder(account, user, 'hidden')).rejects.toThrow(/not available/);
      await expect(svc.createOrder(account, user, 'nope')).rejects.toThrow();
    });

    it("blocks buying a cheaper plan while on a dearer, unexpired one; allows renewing or upgrading", async () => {
      const onPro = { planKey: 'pro', planExpired: false };
      await expect(build({ limits: onPro }).svc.createOrder({ id: 'a' } as any, undefined, 'starter')).rejects.toThrow(/lower plan/);
      await expect(build({ limits: onPro }).svc.createOrder({ id: 'a' } as any, undefined, 'pro')).resolves.toBeDefined();
      await expect(build({ limits: { planKey: 'starter', planExpired: false } }).svc.createOrder({ id: 'a' } as any, undefined, 'pro')).resolves.toBeDefined();
      // A lapsed plan no longer protects anything.
      await expect(build({ limits: { planKey: 'pro', planExpired: true } }).svc.createOrder({ id: 'a' } as any, undefined, 'starter')).resolves.toBeDefined();
    });
  });

  describe('verifyCheckout (browser callback)', () => {
    async function pending(kind: 'pro' | 'day_pass' = 'pro') {
      const ctx = build();
      const o = await ctx.svc.createOrder(ctx.account, ctx.user, kind);
      return { ...ctx, o };
    }

    it('applies the plan once on a valid signature, however many times it is reported', async () => {
      const { svc, o, accountsService, email } = await pending();
      const sig = hmac(KEY_SECRET, `${o.orderId}|pay_9`);
      await svc.verifyCheckout('acc_1', { orderId: o.orderId, paymentId: 'pay_9', signature: sig });
      await svc.verifyCheckout('acc_1', { orderId: o.orderId, paymentId: 'pay_9', signature: sig });
      expect(accountsService.activatePlan).toHaveBeenCalledTimes(1);
      await new Promise((r) => setImmediate(r));
      expect(email.sendPaymentReceipt).toHaveBeenCalledTimes(1);
    });

    it('grants a day pass for a day-pass order', async () => {
      const { svc, o, accountsService } = await pending('day_pass');
      await svc.verifyCheckout('acc_1', { orderId: o.orderId, paymentId: 'pay_9', signature: hmac(KEY_SECRET, `${o.orderId}|pay_9`) });
      expect(accountsService.grantDayPass).toHaveBeenCalledWith('acc_1', 'day_pass');
      expect(accountsService.activatePlan).not.toHaveBeenCalled();
    });

    it('rejects a bad signature and applies nothing', async () => {
      const { svc, o, accountsService, rows } = await pending();
      await expect(svc.verifyCheckout('acc_1', { orderId: o.orderId, paymentId: 'pay_9', signature: hmac('wrong', `${o.orderId}|pay_9`) })).rejects.toThrow(/signature/);
      expect(accountsService.activatePlan).not.toHaveBeenCalled();
      expect([...rows.values()][0].status).toBe('created');
    });

    it("won't confirm someone else's order", async () => {
      const { svc, o } = await pending();
      await expect(svc.verifyCheckout('acc_OTHER', { orderId: o.orderId, paymentId: 'pay_9', signature: hmac(KEY_SECRET, `${o.orderId}|pay_9`) })).rejects.toThrow(/Unknown order/);
    });

    it('releases the payment for retry if applying the plan fails', async () => {
      const { svc, o, accountsService, rows } = await pending();
      accountsService.activatePlan.mockRejectedValueOnce(new Error('db down'));
      const sig = hmac(KEY_SECRET, `${o.orderId}|pay_9`);
      await expect(svc.verifyCheckout('acc_1', { orderId: o.orderId, paymentId: 'pay_9', signature: sig })).rejects.toThrow('db down');
      expect([...rows.values()][0].status).toBe('created');
      await svc.verifyCheckout('acc_1', { orderId: o.orderId, paymentId: 'pay_9', signature: sig }); // retry succeeds
      expect([...rows.values()][0].status).toBe('paid');
    });
  });

  describe('webhook', () => {
    async function pendingDayPass() {
      const ctx = build();
      await ctx.svc.createOrder(ctx.account, ctx.user, 'day_pass'); // order_1, ₹199
      return ctx;
    }

    it('rejects a bad or missing signature, and 503s when no webhook secret is set', async () => {
      const { svc } = await pendingDayPass();
      const body = webhookBody('payment.captured');
      await expect(svc.handleWebhook(body, hmac('wrong', body))).rejects.toThrow(/Invalid webhook signature/);
      await expect(svc.handleWebhook(body, undefined)).rejects.toThrow(/Invalid webhook signature/);
      await expect(svc.handleWebhook(undefined, 'x')).rejects.toThrow(/Invalid webhook signature/);
    });

    it('fulfils on payment.captured, once even if the callback and webhook both arrive', async () => {
      const { svc, accountsService, rows } = await pendingDayPass();
      const body = webhookBody('payment.captured');
      await svc.handleWebhook(body, hmac(WH_SECRET, body));
      await svc.handleWebhook(body, hmac(WH_SECRET, body)); // redelivery
      await svc.verifyCheckout('acc_1', { orderId: 'order_1', paymentId: 'pay_1', signature: hmac(KEY_SECRET, 'order_1|pay_1') });
      expect(accountsService.grantDayPass).toHaveBeenCalledTimes(1);
      expect([...rows.values()][0]).toMatchObject({ status: 'paid', razorpayPaymentId: 'pay_1' });
    });

    it('ignores a notice whose amount does not match what we asked for', async () => {
      const { svc, accountsService } = await pendingDayPass();
      const body = webhookBody('payment.captured', { amount: 100 });
      await svc.handleWebhook(body, hmac(WH_SECRET, body));
      expect(accountsService.grantDayPass).not.toHaveBeenCalled();
    });

    it('acknowledges events for orders it does not know, and marks failures without making them final', async () => {
      const { svc, rows, accountsService } = await pendingDayPass();
      const unknown = webhookBody('payment.captured', { order_id: 'order_zzz' });
      await expect(svc.handleWebhook(unknown, hmac(WH_SECRET, unknown))).resolves.toEqual({ received: true });

      const failed = webhookBody('payment.failed', { status: 'failed', error_description: 'Card declined' });
      await svc.handleWebhook(failed, hmac(WH_SECRET, failed));
      expect([...rows.values()][0]).toMatchObject({ status: 'created', failureReason: 'Card declined' });

      const ok = webhookBody('payment.captured');
      await svc.handleWebhook(ok, hmac(WH_SECRET, ok)); // a retry on the same order can still succeed
      expect([...rows.values()][0].status).toBe('paid');
      expect(accountsService.grantDayPass).toHaveBeenCalledTimes(1);
    });
  });

  describe('autopay (subscriptions)', () => {
    const subSig = (payment: string, sub: string) => hmac(KEY_SECRET, `${payment}|${sub}`);
    const CYCLE_END = new Date('2026-11-05T00:00:00Z');
    const GRACE_END = new Date(CYCLE_END.getTime() + 3 * 86_400_000);
    const event = (type: string, subEntity: any, pay?: any) =>
      Buffer.from(JSON.stringify({ event: type, payload: { subscription: { entity: subEntity }, ...(pay ? { payment: { entity: pay } } : {}) } }));
    const send = (svc: BillingService, body: Buffer) => svc.handleWebhook(body, hmac(WH_SECRET, body));
    const endOf = (ms = CYCLE_END) => Math.floor(ms.getTime() / 1000);

    async function subscribed(limits?: any) {
      const ctx = build({ limits });
      const o = await ctx.svc.createSubscription(ctx.account, ctx.user, 'pro');
      return { ...ctx, o };
    }

    it('refuses while payments are off, and for non-subscribable plans', async () => {
      const off = build({ switchOn: false });
      await expect(off.svc.createSubscription(off.account, off.user, 'pro')).rejects.toThrow(/not enabled/);
      const { svc, account, user } = build();
      await expect(svc.createSubscription(account, user, 'day_pass')).rejects.toThrow(/not available as a subscription/);
      await expect(svc.createSubscription(account, user, 'free')).rejects.toThrow(/not available as a subscription/);
      await expect(svc.createSubscription(account, user, 'hidden')).rejects.toThrow(/not available as a subscription/);
    });

    it("creates the Razorpay plan once, with the plan's price, and reuses it; a new price makes a new one", async () => {
      const a = build();
      const first = await a.svc.createSubscription(a.account, a.user, 'starter');
      expect(first).toMatchObject({ amountPaise: 99900, planKey: 'starter' });
      expect(a.rzpPlan).toHaveBeenCalledWith({ name: 'StreamBird Starter', amountPaise: 99900, description: expect.any(String) });
      expect(a.rzpSub.mock.calls[0][0]).toMatchObject({ planId: expect.stringMatching(/^plan_/), totalCount: 120 });

      a.subRows.clear(); // (a second customer subscribing to the same plan)
      await a.svc.createSubscription(a.account, a.user, 'starter');
      expect(a.rzpPlan).toHaveBeenCalledTimes(1); // plan reused

      PLANS.starter.priceInr = 1099; // admin changed the price
      await a.svc.createSubscription(a.account, a.user, 'starter');
      expect(a.rzpPlan).toHaveBeenCalledTimes(2);
      PLANS.starter.priceInr = 999; PLANS.starter.razorpayPlanId = null; PLANS.starter.razorpayPlanAmountPaise = null;
    });

    it('does not double-subscribe, blocks downgrades, and blocks one-time monthly orders beside a live autopay', async () => {
      const { svc, account, user, subRows } = await subscribed();
      for (const r of subRows.values()) r.status = 'active';
      await expect(svc.createSubscription(account, user, 'pro')).rejects.toThrow(/already on autopay/);
      await expect(svc.createOrder(account, user, 'pro')).rejects.toThrow(/already on autopay/);
      await expect(svc.createOrder(account, user, 'starter')).rejects.toThrow(/autopay running for another plan/);
      const dear = build({ limits: { planKey: 'pro', planExpired: false } });
      await expect(dear.svc.createSubscription(dear.account, dear.user, 'starter')).rejects.toThrow(/lower plan/);
    });

    it('first charge: bad signature applies nothing; valid one runs the plan to cycle end + 3 days grace, once', async () => {
      const { svc, o, accountsService, rows, email } = await subscribed();
      await expect(svc.verifySubscriptionCheckout('acc_1', { subscriptionId: o.subscriptionId, paymentId: 'pay_1', signature: subSig('pay_X', o.subscriptionId) })).rejects.toThrow(/signature/);
      await expect(svc.verifySubscriptionCheckout('acc_OTHER', { subscriptionId: o.subscriptionId, paymentId: 'pay_1', signature: subSig('pay_1', o.subscriptionId) })).rejects.toThrow(/Unknown subscription/);
      expect(accountsService.activatePlan).not.toHaveBeenCalled();

      const input = { subscriptionId: o.subscriptionId, paymentId: 'pay_1', signature: subSig('pay_1', o.subscriptionId) };
      await svc.verifySubscriptionCheckout('acc_1', input);
      await svc.verifySubscriptionCheckout('acc_1', input); // same payment again
      // ...and the webhook for the very same charge arriving too
      await send(svc, event('subscription.charged', { id: o.subscriptionId, current_end: endOf(), paid_count: 1 }, { id: 'pay_1', amount: 199900, currency: 'INR' }));

      expect(accountsService.activatePlan).toHaveBeenCalledTimes(1);
      const until = (accountsService.activatePlan.mock.calls[0] as any[])[3] as Date;
      expect(until.getTime()).toBe(GRACE_END.getTime());
      expect([...rows.values()].filter((r) => r.razorpayPaymentId === 'pay_1')).toHaveLength(1);
      expect([...rows.values()][0]).toMatchObject({ status: 'paid', kind: 'plan', razorpaySubscriptionId: o.subscriptionId, amountPaise: 199900, razorpayOrderId: null });
      await new Promise((r) => setImmediate(r));
      expect(email.sendPaymentReceipt).toHaveBeenCalledTimes(1);
    });

    it('each renewal charge extends the plan once; a wrong amount or unknown subscription is ignored', async () => {
      const { svc, o, accountsService, subRows } = await subscribed();
      await svc.verifySubscriptionCheckout('acc_1', { subscriptionId: o.subscriptionId, paymentId: 'pay_1', signature: subSig('pay_1', o.subscriptionId) });

      const nextEnd = new Date('2026-12-05T00:00:00Z');
      const renewal = event('subscription.charged', { id: o.subscriptionId, current_end: endOf(nextEnd), paid_count: 2 }, { id: 'pay_2', amount: 199900, currency: 'INR' });
      await send(svc, renewal);
      await send(svc, renewal); // redelivery
      expect(accountsService.activatePlan).toHaveBeenCalledTimes(2);
      expect(((accountsService.activatePlan.mock.calls[1] as any[])[3] as Date).getTime()).toBe(nextEnd.getTime() + 3 * 86_400_000);
      expect([...subRows.values()][0]).toMatchObject({ status: 'active', paidCount: 2 });

      await send(svc, event('subscription.charged', { id: o.subscriptionId, current_end: endOf(nextEnd), paid_count: 3 }, { id: 'pay_3', amount: 100, currency: 'INR' }));
      await send(svc, event('subscription.charged', { id: 'sub_unknown', current_end: endOf(nextEnd) }, { id: 'pay_4', amount: 199900, currency: 'INR' }));
      expect(accountsService.activatePlan).toHaveBeenCalledTimes(2);
    });

    it('a failed renewal (halted) stops autopay, emails the customer and extends nothing', async () => {
      const { svc, o, accountsService, subRows, email } = await subscribed();
      await svc.verifySubscriptionCheckout('acc_1', { subscriptionId: o.subscriptionId, paymentId: 'pay_1', signature: subSig('pay_1', o.subscriptionId) });
      await send(svc, event('subscription.pending', { id: o.subscriptionId }));
      expect([...subRows.values()][0].status).toBe('pending');
      await send(svc, event('subscription.halted', { id: o.subscriptionId }));
      expect([...subRows.values()][0].status).toBe('halted');
      expect(email.sendBillingNotice).toHaveBeenCalledWith('u@test.dev', expect.stringMatching(/could not be charged/), expect.any(String));
      expect(accountsService.activatePlan).toHaveBeenCalledTimes(1);
    });

    it('cancelling: the customer keeps the paid cycle; on the cancelled event the grace is trimmed off', async () => {
      const { svc, o, subRows, rzpCancel, accountRows } = await subscribed();
      await svc.verifySubscriptionCheckout('acc_1', { subscriptionId: o.subscriptionId, paymentId: 'pay_1', signature: subSig('pay_1', o.subscriptionId) });
      for (const r of subRows.values()) r.currentEnd = CYCLE_END;

      const summary = await svc.cancelMySubscription('acc_1');
      expect(rzpCancel).toHaveBeenCalledWith(o.subscriptionId, true); // at cycle end
      expect(summary).toMatchObject({ cancelAtCycleEnd: true, planKey: 'pro' });

      accountRows.get('acc_1').planExpiresAt = GRACE_END; // as set by the last charge
      await send(svc, event('subscription.cancelled', { id: o.subscriptionId, current_end: endOf() }));
      expect([...subRows.values()][0].status).toBe('cancelled');
      expect(accountRows.get('acc_1').planExpiresAt.getTime()).toBe(CYCLE_END.getTime());
    });

    it("cancel with no autopay is a 404; a late charge on an already-ended subscription is recorded but not applied", async () => {
      await expect(build().svc.cancelMySubscription('acc_1')).rejects.toThrow(/don't have an active autopay/);
      const { svc, o, subRows, accountsService, rows } = await subscribed();
      for (const r of subRows.values()) r.status = 'cancelled';
      await send(svc, event('subscription.charged', { id: o.subscriptionId, current_end: endOf(), paid_count: 1 }, { id: 'pay_late', amount: 199900, currency: 'INR' }));
      expect(accountsService.activatePlan).not.toHaveBeenCalled();
      expect([...rows.values()].some((r) => r.razorpayPaymentId === 'pay_late')).toBe(true);
    });

    it('an upgrade only cancels the old autopay once the new one has actually charged', async () => {
      const ctx = build({ limits: { planKey: 'starter', planExpired: false } });
      // existing live autopay on Starter
      const old = ctx.subscriptions.create({ accountId: 'acc_1', userId: 'user_1', planKey: 'starter', razorpaySubscriptionId: 'sub_old', razorpayPlanId: 'p', amountPaise: 99900, status: 'active' });
      ctx.subRows.set(old.id, old);
      const o = await ctx.svc.createSubscription(ctx.account, ctx.user, 'pro');
      expect(ctx.rzpCancel).not.toHaveBeenCalled(); // customer might abandon the new checkout
      await ctx.svc.verifySubscriptionCheckout('acc_1', { subscriptionId: o.subscriptionId, paymentId: 'pay_up', signature: subSig('pay_up', o.subscriptionId) });
      expect(ctx.rzpCancel).toHaveBeenCalledWith('sub_old', false);
      expect([...ctx.subRows.values()].find((r) => r.razorpaySubscriptionId === 'sub_old').status).toBe('cancelled');
    });
  });
});
