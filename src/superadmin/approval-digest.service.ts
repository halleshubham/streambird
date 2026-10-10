import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../billing/entities/app-setting.entity';
import { UsersService } from '../users/users.service';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';

const SETTING_KEY = 'approval_digest_last_sent';
/** How often we look at whether a digest is due (the interval itself is APPROVAL_DIGEST_INTERVAL_HOURS). */
const CHECK_INTERVAL_MS = 15 * 60_000;
/** One look shortly after boot, so a restart never delays an overdue digest. */
const BOOT_DELAY_MS = 30_000;
const MAX_ROWS = 50;

export interface DigestResult {
  sent: boolean;
  reason?: 'none-waiting' | 'no-recipient' | 'not-due' | 'send-failed';
  count?: number;
}

/**
 * Emails the configured superadmin (SUPERADMIN_EMAIL) ONE consolidated list of the accounts still waiting
 * for approval, at most once per APPROVAL_DIGEST_INTERVAL_HOURS (default 12), and not at all while nobody
 * is waiting (everyone approved or rejected).
 *
 * When the last digest went out lives in `app_settings` (not in memory), so a deploy or restart does not
 * reset the clock, and it is claimed with a single conditional upsert before sending, so two processes
 * overlapping during a rolling deploy cannot both send. If sending fails the claim is released and the
 * next check retries. Polled like SessionLimitService; timers are unref'd.
 */
@Injectable()
export class ApprovalDigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApprovalDigestService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    if (this.intervalHours() <= 0) {
      this.logger.log('Approval digest emails are off (APPROVAL_DIGEST_INTERVAL_HOURS=0)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
    this.bootTimer = setTimeout(() => void this.tick(), BOOT_DELAY_MS);
    this.bootTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  private intervalHours(): number {
    return this.config.get<number>('approvalDigestIntervalHours') ?? 12;
  }

  private async tick(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.warn(`Approval digest check failed: ${(err as Error).message}`);
    }
  }

  /** Public for tests: `now` and the interval can be forced. */
  async run(opts: { now?: Date; intervalHours?: number } = {}): Promise<DigestResult> {
    const now = opts.now ?? new Date();
    const hours = opts.intervalHours ?? this.intervalHours();

    const pending = await this.usersService.listPendingApprovals();
    if (pending.length === 0) return { sent: false, reason: 'none-waiting' };

    const recipient = this.config.get<string>('superadminEmail');
    if (!recipient) return { sent: false, reason: 'no-recipient' };

    const previous = await this.settings.findOne({ where: { key: SETTING_KEY } });
    const previousIso = typeof previous?.value === 'string' ? previous.value : null;

    // Claim the slot: inserts, or moves the timestamp forward only if the last digest is older than the interval.
    const dueBefore = new Date(now.getTime() - hours * 3_600_000);
    const claimed = await this.settings.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, to_jsonb($2::text), now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         WHERE (app_settings.value #>> '{}')::timestamptz <= $3::timestamptz
       RETURNING key`,
      [SETTING_KEY, now.toISOString(), dueBefore.toISOString()],
    );
    if (claimed.length === 0) return { sent: false, reason: 'not-due' };

    const since = previousIso ? new Date(previousIso) : null;
    const newSinceLast = since ? pending.filter((u) => u.createdAt.getTime() > since.getTime()).length : pending.length;
    try {
      await this.email.sendPendingApprovalsDigest(recipient, {
        users: pending.slice(0, MAX_ROWS).map((u) => ({
          email: u.email,
          role: u.role,
          companyName: u.account?.name ?? null,
          createdAt: u.createdAt,
        })),
        totalPending: pending.length,
        newSinceLast,
        adminUrl: `${this.config.get<string>('publicBaseUrl')}/admin`,
        now,
      });
    } catch (err) {
      this.logger.warn(`Could not send the approval digest: ${(err as Error).message}`);
      // Give the slot back so the next check retries instead of waiting a whole interval.
      if (previousIso) {
        await this.settings.query(`UPDATE app_settings SET value = to_jsonb($2::text) WHERE key = $1`, [SETTING_KEY, previousIso]);
      } else {
        await this.settings.delete({ key: SETTING_KEY });
      }
      return { sent: false, reason: 'send-failed' };
    }
    this.logger.log(`Sent the approval digest to ${recipient}: ${pending.length} waiting (${newSinceLast} new)`);
    return { sent: true, count: pending.length };
  }
}
