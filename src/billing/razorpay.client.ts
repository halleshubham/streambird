import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string;
}

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  paid_count?: number;
  short_url?: string;
}

/** Constant-time hex comparison; false for any length mismatch or non-hex input. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length > 0 && ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Thin Razorpay client: the Orders API (fetch + Basic auth) and the two
 * signature checks. Keys come from the environment; they are never stored in
 * the database or sent to the browser (only the public key id is).
 * apiBase is configurable so tests can point it at a local mock.
 */
@Injectable()
export class RazorpayClient {
  constructor(private readonly config: ConfigService) {}

  private get keyId(): string {
    return this.config.get<string>('razorpay.keyId') ?? '';
  }
  private get keySecret(): string {
    return this.config.get<string>('razorpay.keySecret') ?? '';
  }
  private get webhookSecret(): string {
    return this.config.get<string>('razorpay.webhookSecret') ?? '';
  }

  /** Key id + secret present (enough to take payments). */
  isConfigured(): boolean {
    return !!this.keyId && !!this.keySecret;
  }

  webhookConfigured(): boolean {
    return !!this.webhookSecret;
  }

  getKeyId(): string {
    return this.keyId;
  }

  mode(): 'live' | 'test' | null {
    if (!this.keyId) return null;
    return this.keyId.startsWith('rzp_live_') ? 'live' : 'test';
  }

  private get base(): string {
    return this.config.get<string>('razorpay.apiBase') ?? 'https://api.razorpay.com/v1';
  }

  private get authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
  }

  /** One authenticated JSON call; errors carry Razorpay's description but nothing from the request. */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: { description?: string } }).error?.description ?? '';
      } catch {
        // non-JSON error body
      }
      throw new Error(`Razorpay ${method} ${path.split('/')[1] ?? path} failed (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  }

  /** A monthly Razorpay Plan. Immutable on their side: a new price means a new plan. */
  async createPlan(input: { name: string; amountPaise: number; description: string }): Promise<{ id: string }> {
    return this.call('POST', '/plans', {
      period: 'monthly',
      interval: 1,
      item: { name: input.name, amount: input.amountPaise, currency: 'INR', description: input.description },
    });
  }

  async createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }): Promise<RazorpaySubscription> {
    return this.call('POST', '/subscriptions', {
      plan_id: input.planId,
      total_count: input.totalCount,
      quantity: 1,
      customer_notify: 1,
      notes: input.notes,
    });
  }

  fetchSubscription(id: string): Promise<RazorpaySubscription> {
    return this.call('GET', `/subscriptions/${encodeURIComponent(id)}`);
  }

  cancelSubscription(id: string, atCycleEnd: boolean): Promise<RazorpaySubscription> {
    return this.call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
  }

  /** Subscription checkout success: HMAC-SHA256("<payment_id>|<subscription_id>", key_secret) -- note: the reverse id order from Orders. */
  verifySubscriptionSignature(paymentId: string, subscriptionId: string, signature: string): boolean {
    if (!this.keySecret || !signature) return false;
    const expected = crypto.createHmac('sha256', this.keySecret).update(`${paymentId}|${subscriptionId}`).digest('hex');
    return safeEqualHex(expected, signature);
  }

  async createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder> {
    const base = this.config.get<string>('razorpay.apiBase') ?? 'https://api.razorpay.com/v1';
    const res = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64'),
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      }),
    });
    if (!res.ok) {
      // Razorpay's error body can echo request details; keep only status + their description.
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: { description?: string } }).error?.description ?? '';
      } catch {
        // non-JSON error body
      }
      throw new Error(`Razorpay order creation failed (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as RazorpayOrder;
  }

  /** Standard Checkout success callback: HMAC-SHA256("<order_id>|<payment_id>", key_secret). */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.keySecret || !signature) return false;
    const expected = crypto.createHmac('sha256', this.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    return safeEqualHex(expected, signature);
  }

  /** Webhook: HMAC-SHA256(raw request body, webhook_secret) in X-Razorpay-Signature. */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    if (!this.webhookSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    return safeEqualHex(expected, signature);
  }
}
