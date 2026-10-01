import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { Account } from '../accounts/entities/account.entity';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { PlanTier } from '../common/enums/plan-tier.enum';

export interface AccountUsageRanking {
  accountId: string;
  accountName: string;
  currentTier: PlanTier;
  streamHourUsageCurrentPeriod: string;
  includedHoursPerMonth: string;
}

export interface AnalyticsOverview {
  streamsToday: number;
  streamsThisWeek: number;
  currentlyLive: number;
  /** Fraction (0-1) of LiveStreamDestination rows created in the last 7
   * days that ended up FAILED. See getOverview()'s docstring for why
   * this window was chosen. */
  destinationFailureRate: number;
  topAccountsByUsage: AccountUsageRanking[];
}

export type UsageAlertBucket = 'near_limit' | 'over_limit';

export interface UsageAlert extends AccountUsageRanking {
  bucket: UsageAlertBucket;
  ratio: number;
}

const NEAR_LIMIT_RATIO = 0.8;
const OVER_LIMIT_RATIO = 1.0;
const TOP_ACCOUNTS_LIMIT = 10;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Read-only aggregation for the Superadmin analytics dashboard. No
 * mutations, so (per this feature's scope) nothing here calls
 * AuditLogService.
 */
@Injectable()
export class SuperadminAnalyticsService {
  constructor(
    @InjectRepository(LiveStream)
    private readonly liveStreams: Repository<LiveStream>,
    @InjectRepository(LiveStreamDestination)
    private readonly destinations: Repository<LiveStreamDestination>,
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
  ) {}

  /**
   * "Activity today/this week" is counted by createdAt (when the stream
   * record was created), not startedAt -- startedAt is null for streams
   * that are merely scheduled or that failed before going live, which
   * would undercount what a superadmin actually wants to see here: how
   * much stream-creation activity is happening on the platform. "Today"
   * is a UTC calendar-day boundary (this server has no single customer
   * timezone to prefer); "this week" is a rolling 7-day window ending
   * now, not a calendar week, to avoid Mon-vs-Sun ambiguity.
   *
   * destinationFailureRate is windowed to the same rolling 7 days (by
   * LiveStreamDestination.createdAt) rather than all-time, so a
   * historical blip from months ago doesn't permanently depress a number
   * meant to reflect current platform health. Accounts with zero
   * destinations in that window report a 0 rate rather than NaN.
   */
  async getOverview(): Promise<AnalyticsOverview> {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const weekAgo = new Date(now.getTime() - WEEK_WINDOW_MS);

    const [streamsToday, streamsThisWeek, currentlyLive, recentDestinations, accounts] =
      await Promise.all([
        this.liveStreams.count({ where: { createdAt: MoreThanOrEqual(startOfToday) } }),
        this.liveStreams.count({ where: { createdAt: MoreThanOrEqual(weekAgo) } }),
        this.liveStreams.count({ where: { status: StreamStatus.LIVE } }),
        this.destinations.find({ where: { createdAt: MoreThanOrEqual(weekAgo) } }),
        this.accounts.find(),
      ]);

    const destinationFailureRate =
      recentDestinations.length === 0
        ? 0
        : recentDestinations.filter((d) => d.status === DestinationStatus.FAILED).length /
          recentDestinations.length;

    const topAccountsByUsage = this.rankByUsage(accounts).slice(0, TOP_ACCOUNTS_LIMIT);

    return {
      streamsToday,
      streamsThisWeek,
      currentlyLive,
      destinationFailureRate,
      topAccountsByUsage,
    };
  }

  /**
   * Every account at or above 80% (near_limit) or 100% (over_limit) of
   * its included hours -- thresholds taken directly from PRICING.md's
   * overage-handling recommendation ("soft warning at 80% of included
   * hours", hard overage behavior starting once usage reaches/exceeds
   * 100%). Accounts with includedHoursPerMonth of 0 are skipped (a
   * tier/account not provisioned with any included hours yet) rather
   * than dividing by zero.
   */
  async getUsageAlerts(): Promise<UsageAlert[]> {
    const accounts = await this.accounts.find();
    const alerts: UsageAlert[] = [];

    for (const account of accounts) {
      const included = Number(account.includedHoursPerMonth);
      if (!included || included <= 0) continue;

      const used = Number(account.streamHourUsageCurrentPeriod);
      const ratio = used / included;

      let bucket: UsageAlertBucket | null = null;
      if (ratio >= OVER_LIMIT_RATIO) bucket = 'over_limit';
      else if (ratio >= NEAR_LIMIT_RATIO) bucket = 'near_limit';

      if (!bucket) continue;

      alerts.push({
        accountId: account.id,
        accountName: account.name,
        currentTier: account.currentTier,
        streamHourUsageCurrentPeriod: account.streamHourUsageCurrentPeriod,
        includedHoursPerMonth: account.includedHoursPerMonth,
        bucket,
        ratio,
      });
    }

    return alerts.sort((a, b) => b.ratio - a.ratio);
  }

  private rankByUsage(accounts: Account[]): AccountUsageRanking[] {
    return [...accounts]
      .sort(
        (a, b) =>
          Number(b.streamHourUsageCurrentPeriod) - Number(a.streamHourUsageCurrentPeriod),
      )
      .map((a) => ({
        accountId: a.id,
        accountName: a.name,
        currentTier: a.currentTier,
        streamHourUsageCurrentPeriod: a.streamHourUsageCurrentPeriod,
        includedHoursPerMonth: a.includedHoursPerMonth,
      }));
  }
}
