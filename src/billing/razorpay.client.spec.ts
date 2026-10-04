import * as crypto from 'crypto';
import { RazorpayClient, safeEqualHex } from './razorpay.client';

const cfg = (over: Record<string, string> = {}) =>
  ({
    get: (k: string) =>
      ({
        'razorpay.keyId': 'rzp_test_abc',
        'razorpay.keySecret': 'secret123',
        'razorpay.webhookSecret': 'whsec',
        'razorpay.apiBase': 'https://rzp.test/v1',
        ...over,
      })[k],
  }) as any;
const hmac = (secret: string, msg: string | Buffer) => crypto.createHmac('sha256', secret).update(msg).digest('hex');

describe('RazorpayClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports configuration and test/live mode from the key id', () => {
    expect(new RazorpayClient(cfg()).isConfigured()).toBe(true);
    expect(new RazorpayClient(cfg()).mode()).toBe('test');
    expect(new RazorpayClient(cfg({ 'razorpay.keyId': 'rzp_live_x' })).mode()).toBe('live');
    const blank = new RazorpayClient(cfg({ 'razorpay.keyId': '', 'razorpay.keySecret': '' }));
    expect(blank.isConfigured()).toBe(false);
    expect(blank.mode()).toBeNull();
  });

  it('verifies the checkout signature = HMAC-SHA256("order|payment", key secret)', () => {
    const c = new RazorpayClient(cfg());
    const good = hmac('secret123', 'order_1|pay_1');
    expect(c.verifyCheckoutSignature('order_1', 'pay_1', good)).toBe(true);
    expect(c.verifyCheckoutSignature('order_1', 'pay_2', good)).toBe(false); // other payment
    expect(c.verifyCheckoutSignature('order_2', 'pay_1', good)).toBe(false); // other order
    expect(c.verifyCheckoutSignature('order_1', 'pay_1', hmac('wrong', 'order_1|pay_1'))).toBe(false);
    expect(c.verifyCheckoutSignature('order_1', 'pay_1', '')).toBe(false);
    expect(c.verifyCheckoutSignature('order_1', 'pay_1', 'not-hex!')).toBe(false);
  });

  it('verifies the webhook signature over the exact raw bytes, with the webhook secret', () => {
    const c = new RazorpayClient(cfg());
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(c.verifyWebhookSignature(body, hmac('whsec', body))).toBe(true);
    expect(c.verifyWebhookSignature(Buffer.from('{"event":"payment.captured" }'), hmac('whsec', body))).toBe(false); // re-serialised body
    expect(c.verifyWebhookSignature(body, hmac('secret123', body))).toBe(false); // key secret is not the webhook secret
    expect(new RazorpayClient(cfg({ 'razorpay.webhookSecret': '' })).verifyWebhookSignature(body, hmac('', body))).toBe(false);
  });

  it('creates an order with Basic auth and the amount in paise', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'order_9', amount: 19900, currency: 'INR', status: 'created', receipt: 'r' }) } as Response);
    const order = await new RazorpayClient(cfg()).createOrder({ amountPaise: 19900, currency: 'INR', receipt: 'r', notes: { a: 'b' } });
    expect(order.id).toBe('order_9');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://rzp.test/v1/orders');
    expect((init!.headers as any).Authorization).toBe('Basic ' + Buffer.from('rzp_test_abc:secret123').toString('base64'));
    expect(JSON.parse(init!.body as string)).toEqual({ amount: 19900, currency: 'INR', receipt: 'r', notes: { a: 'b' } });
  });

  it('surfaces Razorpay errors without leaking request details', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { description: 'Amount exceeds maximum' } }) } as Response);
    await expect(new RazorpayClient(cfg()).createOrder({ amountPaise: 1, currency: 'INR', receipt: 'r', notes: {} })).rejects.toThrow(
      'Razorpay order creation failed (400): Amount exceeds maximum',
    );
  });

  it('verifies the SUBSCRIPTION signature = HMAC-SHA256("payment|subscription") -- reverse id order from Orders', () => {
    const c = new RazorpayClient(cfg());
    const good = hmac('secret123', 'pay_1|sub_1');
    expect(c.verifySubscriptionSignature('pay_1', 'sub_1', good)).toBe(true);
    expect(c.verifySubscriptionSignature('sub_1', 'pay_1', good)).toBe(false);
    expect(c.verifySubscriptionSignature('pay_1', 'sub_1', hmac('secret123', 'sub_1|pay_1'))).toBe(false); // the Orders ordering is not valid here
    expect(c.verifySubscriptionSignature('pay_1', 'sub_1', '')).toBe(false);
  });

  it('creates a monthly plan, a subscription, fetches and cancels (at cycle end or now)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'x' }) } as Response);
    const c = new RazorpayClient(cfg());
    await c.createPlan({ name: 'StreamBird Pro', amountPaise: 199900, description: 'd' });
    await c.createSubscription({ planId: 'plan_1', totalCount: 120, notes: { accountId: 'a' } });
    await c.fetchSubscription('sub_1');
    await c.cancelSubscription('sub_1', true);
    await c.cancelSubscription('sub_1', false);
    const calls = fetchMock.mock.calls.map(([url, init]) => [init!.method, url, init!.body ? JSON.parse(init!.body as string) : undefined]);
    expect(calls[0]).toEqual(['POST', 'https://rzp.test/v1/plans', { period: 'monthly', interval: 1, item: { name: 'StreamBird Pro', amount: 199900, currency: 'INR', description: 'd' } }]);
    expect(calls[1]).toEqual(['POST', 'https://rzp.test/v1/subscriptions', { plan_id: 'plan_1', total_count: 120, quantity: 1, customer_notify: 1, notes: { accountId: 'a' } }]);
    expect(calls[2]).toEqual(['GET', 'https://rzp.test/v1/subscriptions/sub_1', undefined]);
    expect(calls[3]).toEqual(['POST', 'https://rzp.test/v1/subscriptions/sub_1/cancel', { cancel_at_cycle_end: 1 }]);
    expect(calls[4][2]).toEqual({ cancel_at_cycle_end: 0 });
  });

  it('safeEqualHex rejects mismatched lengths and empty input', () => {
    expect(safeEqualHex('ab', 'abcd')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
  });
});
