import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Account } from '../accounts/entities/account.entity';
import { Company } from '../companies/entities/company.entity';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { UserSession } from '../auth/entities/user-session.entity';
import { StartImpersonationDto } from './dto/start-impersonation.dto';
import { ImpersonationEndReason, ImpersonationMode, ImpersonationSession } from './entities/impersonation-session.entity';

/** A support session lasts 30 minutes, then the admin is back on their own principal. Not extendable: start a new one. */
export const IMPERSONATION_TTL_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImpersonationInfo {
  id: string;
  mode: ImpersonationMode;
  reason: string | null;
  startedAt: Date;
  expiresAt: Date;
  target: {
    userId: string;
    email: string;
    displayName: string | null;
    accountId: string;
    accountName: string;
    companyName: string | null;
    suspended: boolean;
  };
}

/** What AccountGuard needs: the session plus the customer to act as. */
export interface ResolvedImpersonation {
  session: ImpersonationSession;
  user: User;
  account: Account;
}

export interface ActionInfo {
  method: string;
  route: string;
  params?: Record<string, unknown>;
}

/** Attached to the request by AccountGuard while a support session is in effect. */
export interface RequestImpersonation {
  sessionId: string;
  mode: ImpersonationMode;
  adminUserId: string;
  targetUserId: string;
  targetAccountId: string;
}

/**
 * Superadmin support sessions ("view as" / "act as" a customer). The session row is the only authority; see
 * `.claude/docs/backend.md` "Support sessions (impersonation)". Lookups are keyed by the admin's own
 * `user_sessions` row, so a support session never leaks to another browser, the mobile app or an API key.
 */
@Injectable()
export class ImpersonationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImpersonationService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Overridable in unit tests. */
  now: () => Date = () => new Date();
  private readonly endListeners = new Set<(sessionId: string, reason: ImpersonationEndReason) => void>();

  constructor(
    @InjectRepository(ImpersonationSession) private readonly sessions: Repository<ImpersonationSession>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(UserSession) private readonly adminSessions: Repository<UserSession>,
    private readonly audit: AuditLogService,
  ) {}

  onModuleInit(): void {
    // Writes the "expired" audit entry even when the admin just closed the tab.
    this.timer = setInterval(() => void this.sweepExpired().catch((e) => this.logger.warn(`sweep failed: ${e?.message ?? e}`)), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Starts a support session for this admin login; ends any earlier one (one active session per admin). */
  async start(
    admin: User,
    adminSessionId: string | null,
    dto: StartImpersonationDto,
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<ImpersonationInfo> {
    if (admin.role !== Role.SUPERADMIN) throw new ForbiddenException('You do not have permission to perform this action.');
    if (!adminSessionId) throw new BadRequestException('Support sessions need a signed-in browser session.');
    if (!!dto.userId === !!dto.accountId) throw new BadRequestException('Send exactly one of accountId or userId.');
    if (dto.mode !== 'view' && dto.mode !== 'act') throw new BadRequestException('mode must be "view" or "act".');

    const { user, account } = await this.pickTarget(dto);
    if (user.id === admin.id || user.accountId === admin.accountId) {
      throw new BadRequestException('You cannot open your own account as a customer.');
    }
    if (user.role === Role.SUPERADMIN) throw new ForbiddenException('A superadmin cannot be opened as a customer.');
    if (!user.approvedAt) throw new ConflictException('This user is still waiting for approval. Approve them first.');
    const suspended = !!(account.suspendedAt || user.suspendedAt);
    if (suspended && dto.mode === 'act') {
      throw new ConflictException('Suspended accounts can only be opened in View-as mode.');
    }

    // Close whatever this admin had open (also the expired-but-unswept case) before the unique index would object.
    const open = await this.sessions.find({ where: { adminUserId: admin.id, endedAt: IsNull() } });
    for (const old of open) await this.endRow(old, 'replaced');

    const startedAt = this.now();
    let row: ImpersonationSession;
    try {
      row = await this.sessions.save(
        this.sessions.create({
          adminUserId: admin.id,
          adminSessionId,
          targetUserId: user.id,
          targetAccountId: account.id,
          adminEmail: admin.email,
          targetEmail: user.email,
          targetAccountName: account.name,
          mode: dto.mode,
          reason: dto.reason ? dto.reason.slice(0, 200) : null,
          startedAt,
          expiresAt: new Date(startedAt.getTime() + IMPERSONATION_TTL_MS),
          endedAt: null,
          endReason: null,
          ipAddress: meta.ip ?? null,
          userAgentHash: meta.userAgent ? crypto.createHash('sha256').update(meta.userAgent).digest('hex') : null,
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Another support session was just started. Try again.');
      throw e;
    }

    try {
      // Fail closed: a support session that cannot be recorded must not exist.
      await this.audit.logStrict(admin.id, 'impersonation_started', 'account', account.id, {
        sessionId: row.id,
        mode: row.mode,
        targetUserId: user.id,
        targetAccountId: account.id,
        reason: row.reason,
        expiresAt: row.expiresAt.toISOString(),
      });
    } catch (e) {
      await this.sessions.update({ id: row.id }, { endedAt: this.now(), endReason: 'invalid' });
      this.logger.error(`could not write the audit entry for a support session; it was not started: ${(e as Error).message}`);
      throw new ConflictException('The support session could not be recorded, so it was not started.');
    }
    return this.toInfo(row, user, account);
  }

  /** The admin's active support session (for the banner), or null. Ends it first if it has expired. */
  async current(admin: User, adminSessionId: string | null): Promise<ImpersonationInfo | null> {
    const resolved = adminSessionId ? await this.resolveForGuard(adminSessionId, admin) : null;
    return resolved ? this.toInfo(resolved.session, resolved.user, resolved.account) : null;
  }

  /** Exit: ends every open support session of this admin. Idempotent. */
  async end(admin: User, reason: ImpersonationEndReason = 'exit'): Promise<void> {
    const open = await this.sessions.find({ where: { adminUserId: admin.id, endedAt: IsNull() } });
    for (const row of open) await this.endRow(row, row.expiresAt.getTime() <= this.now().getTime() ? 'expired' : reason);
  }

  /** The admin's login session ended (logout): their support session ends with it. */
  async endForAdminSession(adminSessionId: string | undefined, reason: ImpersonationEndReason = 'logout'): Promise<void> {
    if (!adminSessionId) return;
    const open = await this.sessions.find({ where: { adminSessionId, endedAt: IsNull() } });
    for (const row of open) await this.endRow(row, reason);
  }

  /**
   * AccountGuard's lookup. Returns the target to act as, or null when the admin has no valid support session
   * (none, ended, expired, target gone, or the user is no longer a superadmin: all of which also end the row).
   */
  async resolveForGuard(adminSessionId: string, admin: User): Promise<ResolvedImpersonation | null> {
    const row = await this.sessions.findOne({ where: { adminSessionId, adminUserId: admin.id, endedAt: IsNull() } });
    if (!row) return null;
    if (admin.role !== Role.SUPERADMIN) {
      await this.endRow(row, 'invalid');
      return null;
    }
    if (row.expiresAt.getTime() <= this.now().getTime()) {
      await this.endRow(row, 'expired');
      return null;
    }
    const user = row.targetUserId ? await this.users.findOne({ where: { id: row.targetUserId }, relations: ['account'] }) : null;
    if (!user || !user.account || user.account.deletedAt || user.role === Role.SUPERADMIN) {
      await this.endRow(row, 'target_gone');
      return null;
    }
    return { session: row, user, account: user.account };
  }

  /** Ends every session whose time is up (writes the audit entry). Runs every minute and is safe to call any time. */
  async sweepExpired(): Promise<number> {
    const due = await this.sessions.find({ where: { endedAt: IsNull(), expiresAt: LessThanOrEqual(this.now()) } });
    for (const row of due) await this.endRow(row, 'expired');
    return due.length;
  }

  private resourceIds(params?: Record<string, unknown>): string[] {
    // Which things were touched: only values that are UUIDs (kit, preset, stream ids). Anything else in a URL could be a token.
    return Object.values(params ?? {}).filter((v): v is string => typeof v === 'string' && UUID_RE.test(v));
  }

  private entry(imp: RequestImpersonation, info: ActionInfo, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const resourceIds = this.resourceIds(info.params);
    return {
      sessionId: imp.sessionId,
      mode: imp.mode,
      targetUserId: imp.targetUserId,
      targetAccountId: imp.targetAccountId,
      method: info.method,
      route: info.route,
      ...(resourceIds.length ? { resourceIds } : {}),
      ...extra,
    };
  }

  /**
   * FAIL CLOSED: written (and awaited) BEFORE a mutating request of an act session reaches its handler. If the
   * audit log cannot take it the request is refused with 503, so no change can happen unrecorded. Never a body,
   * a query string, a token or a header: method, route template, UUID route params only.
   */
  async recordIntent(imp: RequestImpersonation, info: ActionInfo): Promise<void> {
    try {
      await this.audit.logStrict(imp.adminUserId, 'impersonated_action', 'account', imp.targetAccountId, this.entry(imp, info, { phase: 'intent' }));
    } catch (e) {
      this.logger.error(`audit log unavailable, support action refused: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Audit log unavailable; action refused');
    }
  }

  /**
   * The outcome (status) of a mutating request, written after the handler. Best-effort ON PURPOSE: the change has
   * already happened and the strict intent entry above is what proves it was recorded; failing the response now
   * would not undo anything. A failure here is only logged.
   */
  async recordResult(imp: RequestImpersonation, info: ActionInfo & { status: number }): Promise<void> {
    await this.audit.log({ id: imp.adminUserId } as User, 'impersonated_action_result', 'account', imp.targetAccountId, this.entry(imp, info, { status: info.status }));
  }

  /** A request the guard refused (view-only / blocked list / suspended): one best-effort entry with the reason. */
  async recordRefused(imp: RequestImpersonation, info: ActionInfo & { blocked: string }): Promise<void> {
    await this.audit.log({ id: imp.adminUserId } as User, 'impersonated_action', 'account', imp.targetAccountId, this.entry(imp, info, { status: 403, blocked: info.blocked }));
  }

  private readSeen = new Set<string>();

  /** Reads are logged ONCE per (session, route template) as `impersonated_read`, so browsing is visible without flooding. */
  async recordRead(imp: RequestImpersonation, info: ActionInfo & { status: number }): Promise<void> {
    const key = `${imp.sessionId}|${info.method}|${info.route}`;
    if (this.readSeen.has(key)) return;
    if (this.readSeen.size > 20_000) this.readSeen.clear();
    this.readSeen.add(key);
    await this.audit.log({ id: imp.adminUserId } as User, 'impersonated_read', 'account', imp.targetAccountId, this.entry(imp, info, { status: info.status }));
  }

  /** Called (synchronously, never throwing into the caller) whenever a support session row ends, for any reason. The studio gateway uses it to cut a support socket at once. */
  onSessionEnded(fn: (sessionId: string, reason: ImpersonationEndReason) => void): () => void {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  /**
   * Re-validation for the live studio control channel (token mint, socket connect and EVERY command): the support
   * session must still be unended and unexpired, in ACT mode, for a customer that is not suspended. An expired row is
   * ended here (audit entry) exactly like AccountGuard does.
   */
  async checkControlSession(sessionId: string): Promise<{ ok: true; session: ImpersonationSession } | { ok: false; reason: 'ended' | 'expired' | 'view' | 'suspended' }> {
    const row = await this.sessions.findOne({ where: { id: sessionId } });
    if (!row || row.endedAt || !row.adminUserId || !row.targetAccountId || !row.targetUserId) return { ok: false, reason: 'ended' };
    if (row.expiresAt.getTime() <= this.now().getTime()) {
      await this.endRow(row, 'expired');
      return { ok: false, reason: 'expired' };
    }
    // The ADMIN must still be who they were: a superadmin, not suspended, on a login session that is still valid
    // (the same conditions AccountGuard applies to every request). Otherwise the support session is over.
    const admin = await this.users.findOne({ where: { id: row.adminUserId }, relations: ['account'] });
    const login = row.adminSessionId ? await this.adminSessions.findOne({ where: { id: row.adminSessionId } }) : null;
    if (
      !admin ||
      admin.role !== Role.SUPERADMIN ||
      admin.suspendedAt ||
      admin.account?.suspendedAt ||
      !login ||
      login.userId !== admin.id ||
      login.revokedAt ||
      login.expiresAt.getTime() <= this.now().getTime()
    ) {
      await this.endRow(row, 'invalid');
      return { ok: false, reason: 'ended' };
    }
    if (row.mode !== 'act') return { ok: false, reason: 'view' };
    const account = await this.accounts.findOne({ where: { id: row.targetAccountId } });
    const user = await this.users.findOne({ where: { id: row.targetUserId } });
    if (!account || account.deletedAt || !user) {
      await this.endRow(row, 'target_gone');
      return { ok: false, reason: 'ended' };
    }
    if (account.suspendedAt || user.suspendedAt) return { ok: false, reason: 'suspended' };
    return { ok: true, session: row };
  }

  /**
   * Live studio remote control audit (`impersonated_studio_control` for token / connect / disconnect events,
   * `impersonated_studio_command` for commands). STRICT entries are awaited and throw when the audit log cannot take
   * them, so the caller refuses the action: nothing happens unrecorded. Metadata is ids, enums and a sanitised
   * summary only: never a token, never free text.
   */
  async recordStudioControl(
    action: 'impersonated_studio_control' | 'impersonated_studio_command',
    adminUserId: string,
    targetAccountId: string,
    meta: Record<string, unknown>,
    strict: boolean,
  ): Promise<void> {
    if (strict) {
      try {
        await this.audit.logStrict(adminUserId, action, 'account', targetAccountId, meta);
      } catch (e) {
        this.logger.error(`audit log unavailable, studio control refused: ${(e as Error).message}`);
        throw new ServiceUnavailableException('Audit log unavailable; action refused');
      }
      return;
    }
    await this.audit.log({ id: adminUserId } as User, action, 'account', targetAccountId, meta);
  }

  /** The customer (or their account) is being deleted: end every support session on it first, with an audit entry. */
  async endForTarget(target: { accountId?: string; userId?: string }): Promise<void> {
    const where = target.userId ? { targetUserId: target.userId, endedAt: IsNull() } : { targetAccountId: target.accountId, endedAt: IsNull() };
    const open = await this.sessions.find({ where });
    for (const row of open) await this.endRow(row, 'target_gone');
  }

  toRequestImpersonation(row: ImpersonationSession): RequestImpersonation {
    // An active row that reached the guard always has its references (they only go NULL after deletions).
    return { sessionId: row.id, mode: row.mode, adminUserId: row.adminUserId!, targetUserId: row.targetUserId!, targetAccountId: row.targetAccountId! };
  }

  async toInfoFor(resolved: ResolvedImpersonation): Promise<ImpersonationInfo> {
    return this.toInfo(resolved.session, resolved.user, resolved.account);
  }

  private async pickTarget(dto: StartImpersonationDto): Promise<{ user: User; account: Account }> {
    if (dto.userId) {
      const user = await this.users.findOne({ where: { id: dto.userId }, relations: ['account'] });
      if (!user || !user.account || user.account.deletedAt) throw new NotFoundException('User not found');
      return { user, account: user.account };
    }
    const account = await this.accounts.findOne({ where: { id: dto.accountId! } });
    if (!account || account.deletedAt) throw new NotFoundException('Account not found');
    const members = await this.users.find({ where: { accountId: account.id }, order: { createdAt: 'ASC' } });
    const user = members.find((m) => m.role === Role.COMPANY_ADMIN) ?? members.find((m) => m.role !== Role.SUPERADMIN) ?? members[0];
    if (!user) throw new NotFoundException('This account has no users');
    return { user, account };
  }

  private async endRow(row: ImpersonationSession, reason: ImpersonationEndReason): Promise<void> {
    const endedAt = this.now();
    const res = await this.sessions.update({ id: row.id, endedAt: IsNull() }, { endedAt, endReason: reason });
    if (!res.affected) return; // someone else ended it first: one audit entry only
    row.endedAt = endedAt;
    row.endReason = reason;
    for (const fn of this.endListeners) {
      try {
        fn(row.id, reason);
      } catch (e) {
        this.logger.warn(`end listener failed: ${(e as Error).message}`);
      }
    }
    const meta = {
      sessionId: row.id,
      mode: row.mode,
      endReason: reason,
      targetUserId: row.targetUserId,
      targetAccountId: row.targetAccountId,
      durationSeconds: Math.max(0, Math.round((endedAt.getTime() - row.startedAt.getTime()) / 1000)),
    };
    if (row.adminUserId) await this.audit.log({ id: row.adminUserId } as User, 'impersonation_ended', 'account', row.targetAccountId, meta);
    else await this.audit.logAnonymous('impersonation_ended', 'account', row.targetAccountId, { ...meta, adminEmail: row.adminEmail });
  }

  private async toInfo(row: ImpersonationSession, user: User, account: Account): Promise<ImpersonationInfo> {
    const company = await this.companies.findOne({ where: { accountId: account.id } });
    return {
      id: row.id,
      mode: row.mode,
      reason: row.reason,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      target: {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        accountId: account.id,
        accountName: account.name,
        companyName: company?.name ?? null,
        suspended: !!(account.suspendedAt || user.suspendedAt),
      },
    };
  }
}
