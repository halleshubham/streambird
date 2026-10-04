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

interface WebhookPayload {
  event?: string;
  payload?: {
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
      webhookEvents: ['payment.captured', 'order.paid', 'payment.failed'],
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

  private async sendReceipt(payment: Payment, planName: string, razorpayPaymentId: string, validUntil: Date): Promise<void> {
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
