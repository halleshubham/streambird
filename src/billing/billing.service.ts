import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Payment } from './entities/payment.entity';
import { LIVE_SUBSCRIPTION_STATUSES, Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { Plan } from '../plans/entities/plan.entity';
import { AppSetting } from './entities/app-setting.entity';
import { RazorpayClient } from './razorpay.client';
import { PlansService } from '../plans/plans.service';
import { AccountsService } from '../accounts/accounts.service';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';

const PAYMENTS_ENABLED_KEY = 'payments_enabled';

export interface CheckoutOrder {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  planKey: string;
  planName: string;
  description: string;
}

/** How long autopay is asked to run: 10 years of monthly cycles (Razorpay requires a count). */
const SUBSCRIPTION_TOTAL_COUNT = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

interface WebhookPayload {
  event?: string;
  payload?: {
    subscription?: { entity?: { id?: string; status?: string; current_end?: number | null; paid_count?: number } };
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string; error_description?: string } };
    order?: { entity?: { id?: string } };
  };
}

/**
 * Razorpay payments: one-time Orders for a 30-day plan period or a day pass.
 * Admin-togglable; the amount always comes from the plan's price on the
 * server, and an entitlement is applied exactly once however many times the
 * browser callback and the webhook both report the same payment.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>,
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Plan) private readonly planRepo: Repository<Plan>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly razorpay: RazorpayClient,
    private readonly plans: PlansService,
    private readonly accountsService: AccountsService,
    private readonly config: ConfigService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  // ---- admin switch ------------------------------------------------------

  private async switchIsOn(): Promise<boolean> {
    const row = await this.settings.findOne({ where: { key: PAYMENTS_ENABLED_KEY } });
    return row?.value === true;
  }

  /** On only when an admin turned it on AND the Razorpay keys are present. */
  async isEnabled(): Promise<boolean> {
    return (await this.switchIsOn()) && this.razorpay.isConfigured();
  }

  async setPaymentsEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.razorpay.isConfigured()) {
      throw new BadRequestException('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the environment before enabling payments.');
    }
    await this.settings.save({ key: PAYMENTS_ENABLED_KEY, value: enabled });
  }

  /** What the browser needs: whether to show Buy buttons, and the public key id for Checkout. */
  async publicConfig(): Promise<{ enabled: boolean; keyId: string | null }> {
    const enabled = await this.isEnabled();
    return { enabled, keyId: enabled ? this.razorpay.getKeyId() : null };
  }

  async adminStatus() {
    const base = (this.config.get<string>('publicBaseUrl') ?? '').replace(/\/$/, '');
    return {
      enabled: await this.switchIsOn(),
      keysConfigured: this.razorpay.isConfigured(),
      webhookSecretConfigured: this.razorpay.webhookConfigured(),
      mode: this.razorpay.mode(),
      webhookUrl: `${base}/api/billing/webhook`,
      webhookEvents: [
        'payment.captured', 'order.paid', 'payment.failed',
        'subscription.authenticated', 'subscription.activated', 'subscription.charged', 'subscription.pending',
        'subscription.halted', 'subscription.cancelled', 'subscription.completed',
      ],
    };
  }

  // ---- checkout ----------------------------------------------------------

  async createOrder(account: Account, user: User | undefined, planKey: string): Promise<CheckoutOrder> {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException('Online payments are not enabled right now. Email support@shackyapps.in to upgrade.');
    }
    const plan = await this.plans.findByKeyOrThrow(planKey);
    if (!plan.isActive || !plan.isPublic || !plan.priceInr || plan.priceInr <= 0) {
      throw new BadRequestException('That plan is not available for purchase.');
    }

    if (plan.kind === 'monthly') {
      const live = await this.liveSubscription(account.id);
      if (live) {
        // A one-time purchase beside a running autopay would let the autopay later put the account back on its own plan.
        throw new BadRequestException(
          live.planKey === plan.key
            ? `You're already on autopay for ${plan.name}; it renews itself.`
            : `You have autopay running for another plan. To switch, subscribe to ${plan.name} (it replaces the old autopay), or cancel autopay first.`,
        );
      }
      // No silent downgrades: buying a cheaper plan while on a dearer, unexpired one would waste what's paid for.
      const limits = await this.accountsService.getLimits(account.id);
      if (!limits.planExpired && limits.planKey !== plan.key) {
        const current = await this.plans.findByKeyOrThrow(limits.planKey);
        if ((current.priceInr ?? 0) > plan.priceInr) {
          throw new BadRequestException(
            `You're on the ${current.name} plan. To switch to a lower plan, email support@shackyapps.in; or renew ${current.name} instead.`,
          );
        }
      }
    }

    const paymentId = crypto.randomUUID();
    const amountPaise = plan.priceInr * 100;
    const receipt = `sb_${paymentId.replace(/-/g, '')}`.slice(0, 40);
    const order = await this.razorpay.createOrder({
      amountPaise,
      currency: 'INR',
      receipt,
      notes: { paymentId, accountId: account.id, planKey: plan.key },
    });

    await this.payments.save(
      this.payments.create({
        id: paymentId,
        accountId: account.id,
        userId: user?.id ?? null,
        planKey: plan.key,
        kind: plan.kind === 'day_pass' ? 'day_pass' : 'plan',
        amountPaise,
        currency: 'INR',
        status: 'created',
        razorpayOrderId: order.id,
        receipt,
      }),
    );

    return {
      orderId: order.id,
      amountPaise,
      currency: 'INR',
      keyId: this.razorpay.getKeyId(),
      planKey: plan.key,
      planName: plan.name,
      description: plan.kind === 'day_pass' ? `StreamBird ${plan.name}` : `StreamBird ${plan.name} (30 days)`,
    };
  }

  /** The browser's success callback. Verifies the HMAC, then applies the plan once. */
  async verifyCheckout(
    accountId: string,
    input: { orderId: string; paymentId: string; signature: string },
  ): Promise<{ status: 'paid' }> {
    const payment = await this.payments.findOne({ where: { razorpayOrderId: input.orderId, accountId } });
    if (!payment) throw new NotFoundException('Unknown order.');
    if (!this.razorpay.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
      throw new BadRequestException('Payment signature did not match. If you were charged, email support@shackyapps.in with your payment reference.');
    }
    await this.fulfill(payment, input.paymentId);
    return { status: 'paid' };
  }

  // ---- webhook -----------------------------------------------------------

  /** Razorpay's server-to-server notice: the backstop when the browser never came back. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: true }> {
    if (!this.razorpay.webhookConfigured()) throw new ServiceUnavailableException('Webhook secret not configured.');
    if (!rawBody || !signature || !this.razorpay.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature.');
    }

    let body: WebhookPayload;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as WebhookPayload;
    } catch {
      throw new BadRequestException('Malformed webhook body.');
    }
    if (body.event?.startsWith('subscription.')) {
      await this.handleSubscriptionEvent(body);
      return { received: true };
    }
    const entity = body.payload?.payment?.entity;
    const orderId = entity?.order_id ?? body.payload?.order?.entity?.id;
    if (!orderId) return { received: true };

    const payment = await this.payments.findOne({ where: { razorpayOrderId: orderId } });
    if (!payment) return { received: true }; // not one of ours (or a different environment)

    if (body.event === 'payment.captured' || body.event === 'order.paid') {
      // Never trust the notice alone for what was paid: it must match what we asked for.
      if (!entity?.id || entity.amount !== payment.amountPaise || entity.currency !== payment.currency) {
        this.logger.warn(`Ignoring ${body.event} for order ${orderId}: amount/currency mismatch`);
        return { received: true };
      }
      await this.fulfill(payment, entity.id);
    } else if (body.event === 'payment.failed' && payment.status === 'created') {
      // Not terminal: Razorpay lets the customer retry on the same order.
      await this.payments.update({ id: payment.id, status: 'created' }, { failureReason: entity?.error_description ?? 'payment failed' });
    }
    return { received: true };
  }

  // ---- fulfillment -------------------------------------------------------

  /**
   * Marks the payment paid and applies the entitlement, once. The
   * conditional UPDATE is the lock: only the caller that flips the row to
   * 'paid' goes on to apply anything, so a callback and a webhook racing each
   * other (or a webhook retry) cannot double-apply. If applying fails the row
   * is put back to 'created' and the error rethrown, so Razorpay's webhook
   * retry gets another go.
   */
  async fulfill(payment: Payment, razorpayPaymentId: string): Promise<boolean> {
    const claimed = await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set({ status: 'paid', razorpayPaymentId, paidAt: new Date(), failureReason: null })
      .where('id = :id AND status != :paid', { id: payment.id, paid: 'paid' })
      .execute();
    if (!claimed.affected) return false;

    try {
      const plan = await this.plans.findByKeyOrThrow(payment.planKey);
      let validUntil: Date;
      if (payment.kind === 'day_pass') {
        const account = await this.accountsService.grantDayPass(payment.accountId, plan.key);
        validUntil = account.dayPassExpiresAt!;
      } else {
        const account = await this.accountsService.activatePlan(payment.accountId, plan);
        validUntil = account.planExpiresAt!;
      }
      void this.sendReceipt(payment, plan.name, razorpayPaymentId, validUntil);
      return true;
    } catch (err) {
      this.logger.error(`Applying payment ${payment.id} failed; releasing it for retry: ${(err as Error).message}`);
      await this.payments.update({ id: payment.id }, { status: 'created', razorpayPaymentId: null, paidAt: null });
      throw err;
    }
  }

  private async sendReceipt(payment: Pick<Payment, 'id' | 'userId' | 'kind' | 'amountPaise'>, planName: string, razorpayPaymentId: string, validUntil: Date): Promise<void> {
    try {
      const user = payment.userId ? await this.users.findOne({ where: { id: payment.userId } }) : null;
      if (!user) return;
      await this.email.sendPaymentReceipt(user.email, {
        planName,
        kind: payment.kind,
        amountInr: payment.amountPaise / 100,
        paymentId: razorpayPaymentId,
        validUntil,
      });
    } catch (err) {
      this.logger.warn(`Receipt email for payment ${payment.id} failed: ${(err as Error).message}`);
    }
  }

  // ---- autopay (Razorpay Subscriptions) ----------------------------------

  private get graceMs(): number {
    return (this.config.get<number>('razorpay.graceDays') ?? 3) * DAY_MS;
  }

  /** The account's current autopay, if it has one that is still alive. */
  liveSubscription(accountId: string): Promise<Subscription | null> {
    return this.subscriptions.findOne({ where: { accountId, status: In(LIVE_SUBSCRIPTION_STATUSES) }, order: { createdAt: 'DESC' } });
  }

  /** What the Billing page shows: the newest subscription that is live, or cancelled-but-still-running. */
  async mySubscription(accountId: string) {
    const sub = (await this.liveSubscription(accountId)) ?? (await this.subscriptions.findOne({ where: { accountId }, order: { createdAt: 'DESC' } }));
    if (!sub || !['authenticated', 'active', 'pending', 'halted', 'cancelled'].includes(sub.status)) return null;
    return {
      planKey: sub.planKey,
      status: sub.status,
      amountInr: sub.amountPaise / 100,
      cancelAtCycleEnd: sub.cancelAtCycleEnd,
      /** Next renewal (or the end of the paid cycle if cancelled). */
      currentEnd: sub.currentEnd,
    };
  }

  /** Makes sure Razorpay has a Plan carrying this plan's current price, creating one when the price changed. */
  private async ensureRazorpayPlan(plan: Plan, amountPaise: number): Promise<string> {
    if (plan.razorpayPlanId && plan.razorpayPlanAmountPaise === amountPaise) return plan.razorpayPlanId;
    const created = await this.razorpay.createPlan({
      name: `StreamBird ${plan.name}`,
      amountPaise,
      description: `StreamBird ${plan.name} -- monthly`,
    });
    await this.planRepo.update({ key: plan.key }, { razorpayPlanId: created.id, razorpayPlanAmountPaise: amountPaise });
    return created.id;
  }

  async createSubscription(account: Account, user: User | undefined, planKey: string) {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException('Online payments are not enabled right now. Email support@shackyapps.in to upgrade.');
    }
    const plan = await this.plans.findByKeyOrThrow(planKey);
    if (plan.kind !== 'monthly' || !plan.isActive || !plan.isPublic || !plan.priceInr || plan.priceInr <= 0) {
      throw new BadRequestException('That plan is not available as a subscription.');
    }

    const existing = await this.liveSubscription(account.id);
    if (existing && existing.planKey === plan.key) {
      throw new BadRequestException(`You're already on autopay for ${plan.name}.`);
    }
    const limits = await this.accountsService.getLimits(account.id);
    if (!limits.planExpired && limits.planKey !== plan.key) {
      const current = await this.plans.findByKeyOrThrow(limits.planKey);
      if ((current.priceInr ?? 0) > plan.priceInr) {
        throw new BadRequestException(
          `You're on the ${current.name} plan. To switch to a lower plan, email support@shackyapps.in; or renew ${current.name} instead.`,
        );
      }
    }

    const amountPaise = plan.priceInr * 100;
    const planId = await this.ensureRazorpayPlan(plan, amountPaise);
    const rzp = await this.razorpay.createSubscription({
      planId,
      totalCount: SUBSCRIPTION_TOTAL_COUNT,
      notes: { accountId: account.id, planKey: plan.key },
    });

    await this.subscriptions.save(
      this.subscriptions.create({
        accountId: account.id,
        userId: user?.id ?? null,
        planKey: plan.key,
        razorpaySubscriptionId: rzp.id,
        razorpayPlanId: planId,
        amountPaise,
        status: 'created',
      }),
    );
    return {
      subscriptionId: rzp.id,
      keyId: this.razorpay.getKeyId(),
      planKey: plan.key,
      planName: plan.name,
      amountPaise,
      description: `StreamBird ${plan.name} -- autopay, cancel any time`,
    };
  }

  /** The browser's success callback for the first charge: verify the HMAC, then apply it exactly like a webhook would. */
  async verifySubscriptionCheckout(
    accountId: string,
    input: { subscriptionId: string; paymentId: string; signature: string },
  ): Promise<{ status: 'active' }> {
    const sub = await this.subscriptions.findOne({ where: { razorpaySubscriptionId: input.subscriptionId, accountId } });
    if (!sub) throw new NotFoundException('Unknown subscription.');
    if (!this.razorpay.verifySubscriptionSignature(input.paymentId, input.subscriptionId, input.signature)) {
      throw new BadRequestException('Payment signature did not match. If you were charged, email support@shackyapps.in with your payment reference.');
    }
    // Razorpay is the source of truth for the cycle dates; fall back to a month if it can't be reached.
    let currentEnd: Date | null = null;
    let paidCount = 1;
    try {
      const rzp = await this.razorpay.fetchSubscription(sub.razorpaySubscriptionId);
      if (rzp.current_end) currentEnd = new Date(rzp.current_end * 1000);
      if (rzp.paid_count) paidCount = rzp.paid_count;
    } catch (err) {
      this.logger.warn(`Could not fetch subscription ${sub.razorpaySubscriptionId}: ${(err as Error).message}`);
    }
    await this.applySubscriptionCharge(sub, { paymentId: input.paymentId, amountPaise: sub.amountPaise, currentEnd, paidCount });
    return { status: 'active' };
  }

  /** Stops renewals at the end of the paid cycle; the plan keeps working until then. */
  async cancelMySubscription(accountId: string) {
    const sub = await this.liveSubscription(accountId);
    if (!sub) throw new NotFoundException("You don't have an active autopay.");
    await this.cancelAtRazorpay(sub, true);
    await this.subscriptions.update({ id: sub.id }, { cancelAtCycleEnd: true });
    return this.mySubscription(accountId);
  }

  private async cancelAtRazorpay(sub: Subscription, atCycleEnd: boolean): Promise<void> {
    try {
      await this.razorpay.cancelSubscription(sub.razorpaySubscriptionId, atCycleEnd);
    } catch (err) {
      // Already cancelled/completed at Razorpay's end is fine; anything else the caller should see.
      if (!/already|cancelled|completed/i.test((err as Error).message)) throw err;
    }
    if (!atCycleEnd) await this.subscriptions.update({ id: sub.id }, { status: 'cancelled' });
  }

  private async handleSubscriptionEvent(body: WebhookPayload): Promise<void> {
    const entity = body.payload?.subscription?.entity;
    if (!entity?.id) return;
    const sub = await this.subscriptions.findOne({ where: { razorpaySubscriptionId: entity.id } });
    if (!sub) return; // not ours (or another environment)
    const currentEnd = entity.current_end ? new Date(entity.current_end * 1000) : null;

    switch (body.event) {
      case 'subscription.charged': {
        const pay = body.payload?.payment?.entity;
        if (!pay?.id) return;
        // The charge must be what this subscription bills each cycle.
        if (pay.amount !== sub.amountPaise || (pay.currency && pay.currency !== 'INR')) {
          this.logger.warn(`Ignoring subscription.charged for ${entity.id}: amount/currency mismatch`);
          return;
        }
        await this.applySubscriptionCharge(sub, { paymentId: pay.id, amountPaise: pay.amount, currentEnd, paidCount: entity.paid_count ?? sub.paidCount + 1 });
        return;
      }
      case 'subscription.authenticated':
      case 'subscription.activated':
      case 'subscription.pending': {
        const status = body.event.split('.')[1] as SubscriptionStatus;
        // Never walk a cancelled/halted state backwards on an out-of-order delivery of an older event.
        if (['cancelled', 'completed', 'expired'].includes(sub.status)) return;
        await this.subscriptions.update({ id: sub.id }, { status, ...(currentEnd ? { currentEnd } : {}) });
        return;
      }
      case 'subscription.halted': {
        await this.subscriptions.update({ id: sub.id }, { status: 'halted' });
        await this.notifyUser(
          sub.userId,
          'StreamBird autopay could not be charged',
          `We couldn't renew your StreamBird plan after several attempts, so autopay has been stopped. Your plan stays active for a few more days; to keep it, subscribe again from Billing (https://streambird.app/billing) or write to support@shackyapps.in.`,
        );
        return;
      }
      case 'subscription.cancelled':
      case 'subscription.completed': {
        await this.subscriptions.update({ id: sub.id }, { status: body.event === 'subscription.cancelled' ? 'cancelled' : 'completed' });
        // Autopay ended: the account keeps what is paid for -- through this cycle's end, without the renewal grace.
        const target = currentEnd ?? sub.currentEnd;
        if (target) await this.capPlanExpiry(sub, target);
        return;
      }
      default:
        return; // paused/resumed/updated: nothing for us to do
    }
  }

  /** On cancellation, tighten the expiry to the paid cycle's end (it was cycle end + grace). Never extends. */
  private async capPlanExpiry(sub: Subscription, end: Date): Promise<void> {
    const account = await this.accounts.findOne({ where: { id: sub.accountId } });
    if (!account || account.planKey !== sub.planKey || !account.planExpiresAt) return;
    if (account.planExpiresAt.getTime() > end.getTime()) {
      await this.accounts.update({ id: account.id }, { planExpiresAt: end });
    }
  }

  /**
   * One successful autopay charge (the first one via the browser callback, every
   * renewal via the webhook). The payment id is unique, so inserting the row is
   * the lock: whoever inserts it applies the entitlement, and a duplicate
   * (callback + webhook, or a webhook retry) is a no-op. The plan then runs
   * until Razorpay's cycle end plus the renewal grace.
   */
  private async applySubscriptionCharge(
    sub: Subscription,
    charge: { paymentId: string; amountPaise: number; currentEnd: Date | null; paidCount: number },
  ): Promise<boolean> {
    const id = crypto.randomUUID();
    const inserted = await this.payments
      .createQueryBuilder()
      .insert()
      .into(Payment)
      .values({
        id,
        accountId: sub.accountId,
        userId: sub.userId,
        planKey: sub.planKey,
        kind: 'plan',
        amountPaise: charge.amountPaise,
        currency: 'INR',
        status: 'paid',
        razorpayOrderId: null,
        razorpaySubscriptionId: sub.razorpaySubscriptionId,
        razorpayPaymentId: charge.paymentId,
        receipt: `sub_${charge.paymentId}`.slice(0, 40),
        paidAt: new Date(),
      })
      .orIgnore() // ON CONFLICT DO NOTHING on the unique razorpay_payment_id
      .returning('id')
      .execute();
    // No row back = this payment id was already recorded: a duplicate delivery, nothing to do.
    if (!Array.isArray(inserted.raw) || inserted.raw.length === 0) return false;

    if (['cancelled', 'completed', 'expired'].includes(sub.status)) {
      // Money arrived on an autopay we had already ended (e.g. replaced by an upgrade a moment ago). Recorded, not applied.
      this.logger.error(`Charge ${charge.paymentId} arrived on ended subscription ${sub.razorpaySubscriptionId}; recorded but not applied -- needs review/refund.`);
      return false;
    }

    try {
      const plan = await this.plans.findByKeyOrThrow(sub.planKey);
      const cycleEnd = charge.currentEnd ?? new Date(Date.now() + 30 * DAY_MS);
      await this.accountsService.activatePlan(sub.accountId, plan, new Date(), new Date(cycleEnd.getTime() + this.graceMs));
      await this.subscriptions.update({ id: sub.id }, { status: 'active', currentEnd: cycleEnd, paidCount: charge.paidCount });
    } catch (err) {
      this.logger.error(`Applying autopay charge ${charge.paymentId} failed; releasing it for retry: ${(err as Error).message}`);
      await this.payments.delete({ id });
      throw err;
    }

    // The customer is now on this autopay: end any older one (an upgrade) so they are never charged twice.
    const others = await this.subscriptions.find({ where: { accountId: sub.accountId, status: In(LIVE_SUBSCRIPTION_STATUSES) } });
    for (const other of others) {
      if (other.id === sub.id) continue;
      try {
        await this.cancelAtRazorpay(other, false);
      } catch (err) {
        this.logger.error(`Could not cancel superseded subscription ${other.razorpaySubscriptionId}: ${(err as Error).message}`);
      }
    }

    void this.sendReceipt(
      { id, userId: sub.userId, kind: 'plan', amountPaise: charge.amountPaise },
      (await this.plans.findByKeyOrThrow(sub.planKey)).name,
      charge.paymentId,
      charge.currentEnd ?? new Date(Date.now() + 30 * DAY_MS),
    );
    return true;
  }

  private async notifyUser(userId: string | null, subject: string, text: string): Promise<void> {
    try {
      const user = userId ? await this.users.findOne({ where: { id: userId } }) : null;
      if (user) await this.email.sendBillingNotice(user.email, subject, text);
    } catch (err) {
      this.logger.warn(`Billing notice failed: ${(err as Error).message}`);
    }
  }

  /** Recent subscriptions for the admin screen. */
  async listSubscriptions(limit = 50): Promise<Array<Subscription & { accountName: string | null }>> {
    const rows = await this.subscriptions.find({ order: { createdAt: 'DESC' }, take: limit });
    const accounts = rows.length ? await this.accounts.find({ where: { id: In([...new Set(rows.map((r) => r.accountId))]) } }) : [];
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    return rows.map((r) => Object.assign(r, { accountName: names.get(r.accountId) ?? null }));
  }

  // ---- history -----------------------------------------------------------

  /** An account's own payments (created-but-abandoned orders excluded). */
  listForAccount(accountId: string): Promise<Payment[]> {
    return this.payments.find({ where: { accountId, status: In(['paid', 'failed']) }, order: { createdAt: 'DESC' }, take: 50 });
  }

  async listRecent(limit = 100): Promise<Array<Payment & { accountName: string | null }>> {
    const rows = await this.payments.find({ order: { createdAt: 'DESC' }, take: limit });
    const accounts = rows.length ? await this.accounts.find({ where: { id: In([...new Set(rows.map((r) => r.accountId))]) } }) : [];
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    return rows.map((r) => Object.assign(r, { accountName: names.get(r.accountId) ?? null }));
  }
}
