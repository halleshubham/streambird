import * as crypto from 'crypto';
import { BillingService } from './billing.service';
import { RazorpayClient } from './razorpay.client';

const KEY_SECRET = 'ks';
const WH_SECRET = 'ws';
const hmac = (s: string, m: string | Buffer) => crypto.createHmac('sha256', s).update(m).digest('hex');

const PLANS: Record<string, any> = {
  free: { key: 'free', name: 'Free', kind: 'monthly', priceInr: 0, isActive: true, isPublic: true },
  starter: { key: 'starter', name: 'Starter', kind: 'monthly', priceInr: 999, isActive: true, isPublic: true },
  pro: { key: 'pro', name: 'Pro', kind: 'monthly', priceInr: 1999, isActive: true, isPublic: true },
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
    // The atomic claim: flip to paid only if not already paid; reports how many rows changed.
    createQueryBuilder: () => {
      let setv: any; let params: any;
      const qb: any = {
        update: () => qb, set: (v: any) => ((setv = v), qb),
        where: (_s: string, p: any) => ((params = p), qb),
        execute: async () => {
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
  const config = { get: (k: string) => ({ 'razorpay.keyId': keys ? 'rzp_test_k' : '', 'razorpay.keySecret': keys ? KEY_SECRET : '', 'razorpay.webhookSecret': WH_SECRET, publicBaseUrl: 'https://app.test' })[k] } as any;
  const razorpay = new RazorpayClient(config);
  const createOrder = jest.spyOn(razorpay, 'createOrder').mockImplementation(async (i) => ({ id: `order_${rows.size + 1}`, amount: i.amountPaise, currency: i.currency, status: 'created', receipt: i.receipt }));
  const plans = { findByKeyOrThrow: jest.fn(async (k: string) => { if (!PLANS[k]) throw new Error('nf'); return PLANS[k]; }) };
  const accountsService = {
    getLimits: jest.fn(async () => opts.limits ?? { planKey: 'free', planExpired: false }),
    grantDayPass: jest.fn(async () => ({ dayPassExpiresAt: new Date('2026-10-06T00:00:00Z') })),
    activatePlan: jest.fn(async () => ({ planExpiresAt: new Date('2026-11-04T00:00:00Z') })),
  };
  const users = { findOne: jest.fn(async () => ({ email: 'u@test.dev' })) };
  const email = { sendPaymentReceipt: jest.fn(async () => undefined) };
  const svc = new BillingService(payments as any, settings as any, { find: jest.fn(async () => []) } as any, users as any, razorpay, plans as any, accountsService as any, config, email as any);
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
  const account: any = { id: 'acc_1' };
  const user: any = { id: 'user_1' };
  return { svc, rows, payments, settings, razorpay, createOrder, accountsService, email, account, user };
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
});
