import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

export interface AccountSummary {
  id: string;
  name: string;
  currentTier: Account['currentTier'];
  includedHoursPerMonth: string;
  streamHourUsageCurrentPeriod: string;
  billingPeriodStart: string | null;
  suspendedAt: Date | null;
  createdAt: Date;
  companyName: string | null;
  userCount: number;
}

export interface AccountDetail extends AccountSummary {
  users: Array<{
    id: string;
    email: string;
    role: string;
    approvedAt: Date | null;
    suspendedAt: Date | null;
    createdAt: Date;
  }>;
  streams: Array<{
    id: string;
    title: string;
    status: string;
    scheduledAt: Date | null;
    startedAt: Date | null;
    endedAt: Date | null;
  }>;
  platformConnections: Array<{
    id: string;
    platform: string;
    label: string;
    isActive: boolean;
  }>;
}

const STREAM_HISTORY_LIMIT = 50;

/**
 * Backs the Superadmin company/account directory + subscription
 * management surface (see SuperadminAccountsController). Deliberately a
 * standalone service rather than reusing AccountsService: every method
 * here is a cross-tenant, Superadmin-only read or write (list every
 * Account, patch any Account's billing fields) which is a fundamentally
 * different trust boundary from AccountsService's own-account-only API.
 */
@Injectable()
export class SuperadminAccountsService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(LiveStream) private readonly streams: Repository<LiveStream>,
    @InjectRepository(PlatformConnection)
    private readonly platformConnections: Repository<PlatformConnection>,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(limit: number, offset: number): Promise<{ items: AccountSummary[]; total: number }> {
    const [accounts, total] = await this.accounts.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    if (accounts.length === 0) {
      return { items: [], total };
    }

    const accountIds = accounts.map((a) => a.id);
    const [companies, userCounts] = await Promise.all([
      this.companies.find({ where: accountIds.map((id) => ({ accountId: id })) }),
      this.countUsersByAccount(accountIds),
    ]);
    const companyByAccountId = new Map(companies.map((c) => [c.accountId, c.name]));

    const items = accounts.map((account) =>
      this.toSummary(account, companyByAccountId.get(account.id) ?? null, userCounts.get(account.id) ?? 0),
    );
    return { items, total };
  }

  async getDetail(accountId: string): Promise<AccountDetail> {
    const account = await this.findAccountOrThrow(accountId);

    const [company, users, streams, platformConnections, userCount] = await Promise.all([
      this.companies.findOne({ where: { accountId } }),
      this.users.find({
        where: { accountId },
        order: { createdAt: 'DESC' },
      }),
      this.streams.find({
        where: { accountId },
        order: { createdAt: 'DESC' },
        take: STREAM_HISTORY_LIMIT,
      }),
      this.platformConnections.find({ where: { accountId } }),
      this.users.count({ where: { accountId } }),
    ]);

    return {
      ...this.toSummary(account, company?.name ?? null, userCount),
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        approvedAt: u.approvedAt,
        suspendedAt: u.suspendedAt,
        createdAt: u.createdAt,
      })),
      streams: streams.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
      platformConnections: platformConnections.map((p) => ({
        id: p.id,
        platform: p.platform,
        label: p.label,
        isActive: p.isActive,
      })),
    };
  }

  /** Patches only whichever of currentTier/includedHoursPerMonth/billingPeriodStart was actually provided. */
  async updateSubscription(
    accountId: string,
    admin: User,
    dto: UpdateSubscriptionDto,
  ): Promise<AccountSummary> {
    const account = await this.findAccountOrThrow(accountId);

    const before = {
      currentTier: account.currentTier,
      includedHoursPerMonth: account.includedHoursPerMonth,
      billingPeriodStart: account.billingPeriodStart,
    };

    if (dto.currentTier !== undefined) {
      account.currentTier = dto.currentTier;
    }
    if (dto.includedHoursPerMonth !== undefined) {
      account.includedHoursPerMonth = dto.includedHoursPerMonth;
    }
    if (dto.billingPeriodStart !== undefined) {
      account.billingPeriodStart = dto.billingPeriodStart;
    }

    const saved = await this.accounts.save(account);

    const after = {
      currentTier: saved.currentTier,
      includedHoursPerMonth: saved.includedHoursPerMonth,
      billingPeriodStart: saved.billingPeriodStart,
    };
    await this.auditLog.log(admin, 'update_subscription', 'account', saved.id, { before, after });

    const company = await this.companies.findOne({ where: { accountId: saved.id } });
    const userCount = await this.users.count({ where: { accountId: saved.id } });
    return this.toSummary(saved, company?.name ?? null, userCount);
  }

  async suspend(accountId: string, admin: User): Promise<AccountSummary> {
    const account = await this.findAccountOrThrow(accountId);
    account.suspendedAt = new Date();
    const saved = await this.accounts.save(account);
    await this.auditLog.log(admin, 'suspend_account', 'account', saved.id);

    const company = await this.companies.findOne({ where: { accountId: saved.id } });
    const userCount = await this.users.count({ where: { accountId: saved.id } });
    return this.toSummary(saved, company?.name ?? null, userCount);
  }

  async reactivate(accountId: string, admin: User): Promise<AccountSummary> {
    const account = await this.findAccountOrThrow(accountId);
    account.suspendedAt = null;
    const saved = await this.accounts.save(account);
    await this.auditLog.log(admin, 'reactivate_account', 'account', saved.id);

    const company = await this.companies.findOne({ where: { accountId: saved.id } });
    const userCount = await this.users.count({ where: { accountId: saved.id } });
    return this.toSummary(saved, company?.name ?? null, userCount);
  }

  private async findAccountOrThrow(accountId: string): Promise<Account> {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  private async countUsersByAccount(accountIds: string[]): Promise<Map<string, number>> {
    if (accountIds.length === 0) {
      return new Map();
    }
    const rows = await this.users
      .createQueryBuilder('user')
      .select('user.accountId', 'accountId')
      .addSelect('COUNT(*)', 'count')
      .where('user.accountId IN (:...accountIds)', { accountIds })
      .groupBy('user.accountId')
      .getRawMany<{ accountId: string; count: string }>();
    return new Map(rows.map((r) => [r.accountId, parseInt(r.count, 10)]));
  }

  private toSummary(account: Account, companyName: string | null, userCount: number): AccountSummary {
    return {
      id: account.id,
      name: account.name,
      currentTier: account.currentTier,
      includedHoursPerMonth: account.includedHoursPerMonth,
      streamHourUsageCurrentPeriod: account.streamHourUsageCurrentPeriod,
      billingPeriodStart: account.billingPeriodStart,
      suspendedAt: account.suspendedAt,
      createdAt: account.createdAt,
      companyName,
      userCount,
    };
  }
}
