import * as crypto from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';

export const RZP = { keyId: 'rzp_test_e2e', keySecret: 'e2esecret', webhookSecret: 'whsec_e2e' };

export interface MockCall {
  method: string;
  url: string;
  body: any;
}

/**
 * A small stateful stand-in for the parts of Razorpay's API we call: Orders,
 * Plans, Subscriptions (create / fetch / cancel). It checks Basic auth, hands
 * out sequential ids, and records every call so tests can assert exactly what
 * we asked Razorpay to do (e.g. "cancel AT cycle end"). It also builds the
 * signatures Razorpay would send, so tests can play both sides.
 */
export class MockRazorpay {
  private server!: http.Server;
  /** Ids are unique per run so a reused test database never sees a colliding order/subscription id. */
  private readonly run = crypto.randomBytes(3).toString('hex');
  private orders = 0;
  private plans = 0;
  private subs = 0;
  private subscriptions: Record<string, any> = {};
  calls: MockCall[] = [];
  url = '';

  async start(): Promise<void> {
    const auth = 'Basic ' + Buffer.from(`${RZP.keyId}:${RZP.keySecret}`).toString('base64');
    this.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const out = (code: number, obj: unknown) => {
          res.writeHead(code, { 'content-type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        if (req.headers.authorization !== auth) return out(401, { error: { description: 'bad auth' } });
        const body = raw ? JSON.parse(raw) : {};
        const path = (req.url ?? '').replace(/^\/v1/, '');
        this.calls.push({ method: req.method ?? '', url: path, body });

        if (path === '/orders' && req.method === 'POST') {
          return out(200, { id: `order_${this.run}_${++this.orders}`, amount: body.amount, currency: body.currency, status: 'created', receipt: body.receipt });
        }
        if (path === '/plans' && req.method === 'POST') return out(200, { id: `plan_${this.run}_${++this.plans}`, item: body.item });
        if (path === '/subscriptions' && req.method === 'POST') {
          const id = `sub_${this.run}_${++this.subs}`;
          this.subscriptions[id] = { id, plan_id: body.plan_id, status: 'created', paid_count: 0, current_end: null };
          return out(200, this.subscriptions[id]);
        }
        const m = path.match(/^\/subscriptions\/([^/]+)(\/cancel)?$/);
        if (m) {
          const s = this.subscriptions[m[1]];
          if (!s) return out(404, { error: { description: 'not found' } });
          if (m[2] && req.method === 'POST') {
            s.status = 'cancelled';
            return out(200, s);
          }
          if (!m[2] && req.method === 'GET') {
            // The first charge happened at authentication: the cycle ends in 30 days.
            s.status = 'active';
            s.paid_count = 1;
            s.current_end = Math.floor(Date.now() / 1000) + 30 * 86400;
            return out(200, s);
          }
        }
        out(404, { error: { description: 'no such route' } });
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server.close(resolve));
  }

  callsTo(pathSuffix: string): MockCall[] {
    return this.calls.filter((c) => c.url.endsWith(pathSuffix));
  }

  // ---- what Razorpay would send / compute --------------------------------

  /** Standard Checkout success signature for an Order. */
  orderSignature(orderId: string, paymentId: string): string {
    return crypto.createHmac('sha256', RZP.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  }

  /** Subscription Checkout success signature (note the reversed id order). */
  subscriptionSignature(paymentId: string, subscriptionId: string): string {
    return crypto.createHmac('sha256', RZP.keySecret).update(`${paymentId}|${subscriptionId}`).digest('hex');
  }

  /** A webhook body plus the X-Razorpay-Signature for it (HMAC of the exact bytes). */
  webhook(event: string, payload: Record<string, unknown>, secret: string = RZP.webhookSecret): { body: Buffer; signature: string } {
    const body = Buffer.from(JSON.stringify({ event, payload }));
    return { body, signature: crypto.createHmac('sha256', secret).update(body).digest('hex') };
  }

  paymentEntity(id: string, orderId: string | null, amountPaise: number) {
    return { payment: { entity: { id, order_id: orderId, amount: amountPaise, currency: 'INR', status: 'captured' } } };
  }
}
