import { ConflictException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import { StreamsService } from '../streams/streams.service';
import { StreamSchedulingService } from '../streams/stream-scheduling.service';
import { PlatformConnectionsService } from '../platform-connections/platform-connections.service';
import { AssetsService } from '../assets/assets.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';

/** What the apps show before the person confirms. Counts and flags only -- no names, emails or titles. */
export interface DeletionPreview {
  isOnlyAdmin: boolean;
  memberCount: number;
  activeSubscription: { plan: string; nextRenewal: string | null } | null;
  liveStream: boolean;
  connectionsCount: number;
  assetsCount: number;
}

type Scope = 'member' | 'company';

/**
 * Self-service "delete my account and data". Two scopes, decided from the signed-in person's role:
 *
 *  - `member`: a normal team member, or one of several company admins. Only their own user goes (sessions, email,
 *    mobile number). What they created stays with the company account.
 *  - `company`: the account owner -- a solo user, or the ONLY company admin. The whole account goes: autopay is
 *    cancelled first (a failure aborts with nothing deleted), live/scheduled streams are ended, platform tokens are
 *    revoked best-effort, then one transaction removes streams, connections, brand kits, files, presets, subscriptions,
 *    every user of the account and the account itself. Bucket objects are deleted afterwards, best-effort.
 *
 * Kept: payment rows (amounts, Razorpay ids; no email/name) for accounting. An account that has any keeps an
 * anonymous tombstone row (`accounts.deleted_at`, migration 0030) because payments.account_id is NOT NULL.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(LiveStream) private readonly liveStreams: Repository<LiveStream>,
    @InjectRepository(PlatformConnection) private readonly connections: Repository<PlatformConnection>,
    private readonly auth: AuthService,
    private readonly billing: BillingService,
    private readonly streams: StreamsService,
    private readonly scheduling: StreamSchedulingService,
    private readonly platformConnections: PlatformConnectionsService,
    private readonly assets: AssetsService,
    private readonly audit: AuditLogService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  /** Who is affected, from the caller's role and the other users on the account. */
  private async scopeFor(user: User): Promise<{ scope: Scope; members: User[] }> {
    const members = await this.users.find({ where: { accountId: user.accountId }, order: { createdAt: 'ASC' } });
    // Only the owner of the account may take the company down: the only company admin, or the only person on it.
    const otherAdmins = members.filter((m) => m.id !== user.id && m.role === Role.COMPANY_ADMIN);
    const owner = otherAdmins.length === 0 && (user.role === Role.COMPANY_ADMIN || members.length === 1);
    return { scope: owner ? 'company' : 'member', members };
  }

  private assertNotSuperadmin(user: User, members: User[]): void {
    if (user.role === Role.SUPERADMIN || members.some((m) => m.role === Role.SUPERADMIN)) {
      throw new ForbiddenException('Administrator accounts cannot be deleted here. Contact the StreamBird team.');
    }
  }

  async preview(user: User, account: Account): Promise<DeletionPreview> {
    const { scope, members } = await this.scopeFor(user);
    this.assertNotSuperadmin(user, members);
    if (scope === 'member') {
      // Deleting only yourself leaves the company's subscription, streams, connections and files alone.
      return { isOnlyAdmin: false, memberCount: members.length, activeSubscription: null, liveStream: false, connectionsCount: 0, assetsCount: 0 };
    }
    const [activeSubscription, live, connectionsCount, assetsCount] = await Promise.all([
      this.billing.activeSubscriptionSummary(account.id),
      this.liveStreams.count({ where: { accountId: account.id, status: StreamStatus.LIVE } }),
      this.connections.count({ where: { accountId: account.id, isActive: true } }),
      this.assets.countForAccount(account.id),
    ]);
    return { isOnlyAdmin: true, memberCount: members.length, activeSubscription, liveStream: live > 0, connectionsCount, assetsCount };
  }

  /** Emails the confirmation code. Always sent, also to review accounts that sign in without a login code. */
  async requestCode(user: User): Promise<void> {
    const { members } = await this.scopeFor(user);
    this.assertNotSuperadmin(user, members);
    await this.auth.sendDeletionCode(user.email);
  }

  async delete(user: User, account: Account, input: { code: string; confirmCompanyDeletion?: boolean }): Promise<void> {
    const { scope, members } = await this.scopeFor(user);
    this.assertNotSuperadmin(user, members);

    // 400 for a wrong/expired code, nothing changed (wrong guesses count towards the 5-attempt cap). Not consumed yet:
    // the checks below can still refuse without making the person ask for a new code.
    await this.auth.checkDeletionCode(user.email, input.code, { consume: false });

    if (scope === 'company' && members.length > 1 && input.confirmCompanyDeletion !== true) {
      throw new ConflictException(
        `You are the only admin of this company and ${members.length - 1} other ${members.length === 2 ? 'person is' : 'people are'} on it. Deleting your account deletes the whole company account for everyone. Confirm that to continue.`,
      );
    }

    const emails = members.map((m) => m.email);
    if (scope === 'member') {
      await this.auth.checkDeletionCode(user.email, input.code, { consume: true });
      await this.dataSource.transaction(async (m) => {
        await m.query('DELETE FROM users WHERE id = $1', [user.id]); // sessions go with it (ON DELETE CASCADE)
        await m.query('DELETE FROM login_codes WHERE email = ANY($1::text[])', [[user.email.toLowerCase(), `delete:${user.email.toLowerCase()}`]]);
      });
      await this.audit.logAnonymous('account_delete_member', 'user', user.id, { accountId: account.id, role: user.role });
      await this.notify([user.email], false);
      return;
    }

    // Whole company. The autopay stops first; if it cannot, nothing has been deleted and the code is still valid.
    try {
      await this.billing.cancelAllForAccountDeletion(account.id);
    } catch (err) {
      await this.audit.logAnonymous('account_delete_aborted', 'account', account.id, { reason: 'subscription_cancel_failed', userId: user.id });
      throw err;
    }
    await this.auth.checkDeletionCode(user.email, input.code, { consume: true });

    await this.endStreams(account);
    await this.platformConnections.revokeAllAtProvider(account.id).catch((err) => this.logger.warn(`Account deletion: revoking platform tokens failed: ${(err as Error).message}`));
    const storageKeys = await this.assets.storageKeysForAccount(account.id);

    const tombstoned = await this.dataSource.transaction(async (m) => {
      const id = account.id;
      // Order matters: streams before connections (destinations RESTRICT), kits before files (RESTRICT).
      await m.query('DELETE FROM live_streams WHERE account_id = $1', [id]); // destinations, studio sessions, invites, tokens, thumbnails cascade
      await m.query('DELETE FROM platform_connections WHERE account_id = $1', [id]);
      await m.query('DELETE FROM brand_kits WHERE account_id = $1', [id]); // kit ads cascade
      await m.query('DELETE FROM assets WHERE account_id = $1', [id]);
      await m.query('DELETE FROM stream_presets WHERE account_id = $1', [id]);
      await m.query('DELETE FROM subscriptions WHERE account_id = $1', [id]);
      await m.query('DELETE FROM login_codes WHERE email = ANY($1::text[])', [emails.flatMap((e) => [e.toLowerCase(), `delete:${e.toLowerCase()}`])]);
      await m.query('DELETE FROM users WHERE account_id = $1', [id]); // sessions cascade; payments.user_id is set null
      await m.query('DELETE FROM companies WHERE account_id = $1', [id]);
      const paid = (await m.query('SELECT 1 FROM payments WHERE account_id = $1 LIMIT 1', [id])).length > 0;
      if (paid) {
        // Payment records must stay (accounting/tax), and they point at the account row: keep it as an anonymous shell.
        await m.query(
          `UPDATE accounts SET name = 'Deleted account', api_key_hash = $2, razorpay_customer_id = NULL, plan_key = 'free', current_tier = 'free',
             plan_expires_at = NULL, day_pass_plan_key = NULL, day_pass_expires_at = NULL, included_hours_override = NULL,
             max_destinations_override = NULL, max_guests_override = NULL, suspended_at = now(), deleted_at = now() WHERE id = $1`,
          [id, crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex')],
        );
      } else {
        await m.query('DELETE FROM accounts WHERE id = $1', [id]);
      }
      return paid;
    });

    // The rows are gone; now the files. A failure leaves a stray object, logged by key.
    const files = await this.assets.deleteStoredObjects(storageKeys);
    await this.audit.logAnonymous('account_delete_company', 'account', account.id, {
      userId: user.id,
      members: members.length,
      tombstone: tombstoned,
      files: storageKeys.length,
      filesFailed: files.failed,
    });
    // Everyone who was on it hears that it happened; the person who asked gets the "your account" wording.
    await this.notify([user.email], false);
    await this.notify(emails.filter((e) => e !== user.email), true);
  }

  /** Ends what is running or booked, so no platform keeps an orphan broadcast and guests are not left hanging. Best-effort per stream. */
  private async endStreams(account: Account): Promise<void> {
    const open = await this.liveStreams.find({ where: { accountId: account.id, status: In([StreamStatus.LIVE, StreamStatus.SCHEDULED]) } });
    for (const stream of open) {
      try {
        if (stream.isScheduledEvent && stream.status === StreamStatus.SCHEDULED) await this.scheduling.cancel(account, stream.id);
        else await this.streams.end(stream.id, account.id);
      } catch (err) {
        this.logger.warn(`Account deletion: could not end stream ${stream.id}: ${(err as Error).message}`);
        await this.streams.end(stream.id, account.id).catch(() => undefined);
      }
    }
  }

  private async notify(addresses: string[], companyDeleted: boolean): Promise<void> {
    for (const to of addresses) {
      await this.email.sendAccountDeletedNotice(to, { companyDeleted }).catch((err) => this.logger.warn(`Account deletion: confirmation email failed: ${(err as Error).message}`));
    }
  }
}
