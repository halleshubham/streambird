import { Plan } from '../plans/entities/plan.entity';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Account } from './entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { PlanTier } from '../common/enums/plan-tier.enum';
import { PlansService, EffectiveLimits } from '../plans/plans.service';

const API_KEY_PREFIX = 'sb_';

/** Matches PRICING.md section 2's proposed tiers -- seeded onto every new
 * Account (which always starts on Free, per the entity's own column
 * default) so a brand-new signup has a real, usable included-hours
 * allowance from day one instead of the column default of 0. */
const DEFAULT_INCLUDED_HOURS_BY_TIER: Record<PlanTier, number> = {
  [PlanTier.FREE]: 2,
  [PlanTier.STARTER]: 10,
  [PlanTier.PRO]: 30,
  [PlanTier.ENTERPRISE]: 100,
};

const BILLING_PERIOD_DAYS = 30;

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    private readonly plans: PlansService,
  ) {}

  /**
   * Returns the newly created account plus the ONE-TIME raw API key.
   * Only its sha256 hash is ever persisted.
   */
  async create(dto: CreateAccountDto): Promise<{ account: Account; apiKey: string }> {
    const apiKey = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
    const apiKeyHash = this.hashApiKey(apiKey);

    const account = this.accounts.create({
      name: dto.name,
      apiKeyHash,
      includedHoursPerMonth: String(DEFAULT_INCLUDED_HOURS_BY_TIER[PlanTier.FREE]),
      billingPeriodStart: new Date().toISOString().slice(0, 10),
    });
    await this.accounts.save(account);

    return { account, apiKey };
  }

  async findByApiKey(apiKey: string): Promise<Account | null> {
    const apiKeyHash = this.hashApiKey(apiKey);
    return this.accounts.findOne({ where: { apiKeyHash } });
  }

  async findByIdOrThrow(id: string): Promise<Account> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return account;
  }

  /**
   * Deletes an Account outright, cascading to every row that references
   * it (users, companies, platform_connections, live_streams, ... -- all
   * ON DELETE CASCADE). Only ever called today for rejecting a pending,
   * never-yet-used signup -- a Company Admin or a solo user (see
   * UsersService.rejectUser) -- never on an account with real usage
   * history.
   */
  async remove(id: string): Promise<void> {
    await this.accounts.delete(id);
  }

  /**
   * Superadmin whole-company abuse lever (distinct from suspending a
   * single User -- see UsersService.suspendUser). Deliberately minimal:
   * a concurrent task building the account directory/detail page may
   * also implement this exact route, see SuperadminUsersController's
   * docstring for the overlap-avoidance note.
   */
  async suspend(id: string): Promise<Account> {
    const account = await this.findByIdOrThrow(id);
    account.suspendedAt = new Date();
    return this.accounts.save(account);
  }

  async reactivate(id: string): Promise<Account> {
    const account = await this.findByIdOrThrow(id);
    account.suspendedAt = null;
    return this.accounts.save(account);
  }

  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Lazy billing-period rollover: no cron job resets usage monthly, so
   * every read/write of streamHourUsageCurrentPeriod goes through this
   * first -- if more than BILLING_PERIOD_DAYS has passed since
   * billingPeriodStart (or there's no anchor at all, e.g. an account from
   * before this field was seeded at creation), reset the counter and move
   * the anchor to today before the caller does anything else with it.
   */
  private async rolloverIfNeeded(account: Account): Promise<Account> {
    const start = account.billingPeriodStart ? new Date(account.billingPeriodStart) : null;
    const msSinceStart = start ? Date.now() - start.getTime() : Infinity;
    if (msSinceStart < BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
      return account;
    }
    account.streamHourUsageCurrentPeriod = '0';
    account.billingPeriodStart = new Date().toISOString().slice(0, 10);
    return this.accounts.save(account);
  }

  /** Effective limits (plan + per-account overrides + any active day pass). */
  async getLimits(accountId: string): Promise<EffectiveLimits> {
    return this.plans.effectiveLimits(await this.findByIdOrThrow(accountId));
  }

  /**
   * Called by StreamsService.create()/start() before doing anything else --
   * throws if the account has used up its included hours (plus the plan's
   * grace buffer). Unlimited plans (null hours) never block here. Never
   * blocks a stream that's already running: only checked at creation/start,
   * matching PRICING.md's "never hard-cut a live stream" recommendation.
   */
  async assertCanStartStream(accountId: string): Promise<void> {
    const account = await this.rolloverIfNeeded(await this.findByIdOrThrow(accountId));
    const limits = await this.plans.effectiveLimits(account);
    if (limits.includedHours === null) return;

    const used = Number(account.streamHourUsageCurrentPeriod);
    if (used >= limits.includedHours * limits.graceMultiplier) {
      throw new ForbiddenException(
        limits.graceMultiplier <= 1
          ? `You've used all the stream hours included in your ${limits.planName} plan for this billing period. Upgrade your plan to keep streaming.`
          : `You've used the stream hours included in your ${limits.planName} plan (plus grace) for this billing period. Contact us to arrange more hours or upgrade your plan.`,
      );
    }
  }

  /** Refuses a stream that targets more destinations than the plan allows. */
  async assertDestinationCount(accountId: string, count: number): Promise<void> {
    const limits = await this.getLimits(accountId);
    if (count > limits.maxDestinations) {
      throw new ForbiddenException(
        `Your ${limits.planName} plan allows up to ${limits.maxDestinations} destination${limits.maxDestinations === 1 ? '' : 's'} per stream, but ${count} were selected. Remove some or upgrade your plan.`,
      );
    }
  }

  /**
   * Applies a purchased monthly plan: moves the account onto it for one
   * billing period (BILLING_PERIOD_DAYS), extending from the current expiry
   * when it is the same plan and still active. A fresh start also resets the
   * hours usage so the new period begins at zero.
   */
  async activatePlan(accountId: string, plan: Plan, now: Date = new Date()): Promise<Account> {
    const account = await this.findByIdOrThrow(accountId);
    const stillActive =
      account.planKey === plan.key && !!account.planExpiresAt && account.planExpiresAt.getTime() > now.getTime();
    const from = stillActive ? account.planExpiresAt!.getTime() : now.getTime();

    account.planKey = plan.key;
    account.planExpiresAt = new Date(from + BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    if ((Object.values(PlanTier) as string[]).includes(plan.key)) account.currentTier = plan.key as PlanTier;
    account.includedHoursPerMonth = String(account.includedHoursOverride ?? plan.includedHoursPerMonth ?? 0);
    if (!stillActive) {
      account.streamHourUsageCurrentPeriod = '0';
      account.billingPeriodStart = now.toISOString().slice(0, 10);
    }
    return this.accounts.save(account);
  }

  /** Grants (or extends from now) a day pass. Used by the superadmin today; a payment webhook later. */
  async grantDayPass(accountId: string, planKey = 'day_pass'): Promise<Account> {
    const pass = await this.plans.findByKeyOrThrow(planKey);
    if (pass.kind !== 'day_pass' || !pass.validityHours) {
      throw new ForbiddenException(`Plan '${planKey}' is not a day pass`);
    }
    const account = await this.findByIdOrThrow(accountId);
    account.dayPassPlanKey = pass.key;
    account.dayPassExpiresAt = new Date(Date.now() + pass.validityHours * 3_600_000);
    return this.accounts.save(account);
  }

  /** Called by StreamsService.end() with the stream's actual duration. A
   * no-op for a stream that never really started (hours <= 0, e.g.
   * startedAt was never set), so ending a never-live stream can't produce
   * negative or phantom usage. */
  async recordStreamUsage(accountId: string, hours: number): Promise<void> {
    if (!(hours > 0)) return;
    const account = await this.rolloverIfNeeded(await this.findByIdOrThrow(accountId));
    account.streamHourUsageCurrentPeriod = (Number(account.streamHourUsageCurrentPeriod) + hours).toFixed(2);
    await this.accounts.save(account);
  }
}
