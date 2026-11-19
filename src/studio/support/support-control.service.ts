import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { BrandKit } from '../../assets/entities/brand-kit.entity';
import { StreamStatus } from '../../common/enums/stream-status.enum';
import { ImpersonationService, RequestImpersonation } from '../../impersonation/impersonation.service';
import { StudioSessionsService } from '../studio-sessions.service';

/** A control token lives at most 10 minutes (and never past the support session); the page re-mints before it runs out. */
export const SUPPORT_CONTROL_TOKEN_TTL_MS = 10 * 60_000;
const MAX_TOKENS_PER_SESSION = 20;

export interface ControlTokenRow {
  /** The stream this token is bound to, with its studio (signaling) session. */
  streamId: string;
  studioSessionId: string;
  accountId: string;
  /** The support session and the admin it is bound to: the gateway re-checks both on connect and on every command. */
  impersonationSessionId: string;
  adminUserId: string;
  expiresAt: number;
}

/**
 * Short-lived tokens that let a support session (ACT mode) attach a "support" socket to the signaling gateway of ONE
 * live stream of the impersonated customer. A token never yields publishing rights or a participant slot: the
 * gateway only lets such a socket send whitelisted commands to the host and receive the host's state snapshots.
 *
 * Stored in memory as sha256 only (single backend process, like the rest of the signaling state; a restart drops them
 * and the page simply asks for a new one). Never written to the audit log or any response except the mint response.
 */
@Injectable()
export class SupportControlService {
  private readonly tokens = new Map<string, ControlTokenRow>();
  /** Overridable in unit tests. */
  now: () => number = () => Date.now();

  constructor(
    private readonly studioSessions: StudioSessionsService,
    private readonly impersonation: ImpersonationService,
    @InjectRepository(BrandKit) private readonly kits: Repository<BrandKit>,
  ) {}

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mints a control token for a LIVE stream of the impersonated account. Only an ACT support session qualifies
   * (re-checked against the session row, not just the request), and the stream must be the customer's and LIVE.
   */
  async mint(imp: RequestImpersonation, accountId: string, streamId: string): Promise<{ controlToken: string; expiresAt: Date; studioSessionId: string }> {
    const check = await this.impersonation.checkControlSession(imp.sessionId);
    if (!check.ok) throw new ForbiddenException(check.reason === 'view' ? 'View-only support session' : 'The support session is not active');
    if (check.session.targetAccountId !== accountId || check.session.adminUserId !== imp.adminUserId) throw new ForbiddenException('The support session does not match this account');

    const studio = await this.studioSessions.findByLiveStreamId(streamId);
    const session = studio ? await this.studioSessions.findByIdWithLiveStream(studio.id) : null;
    if (!session || session.liveStream.accountId !== accountId) throw new NotFoundException('Stream not found');
    if (session.liveStream.status !== StreamStatus.LIVE) throw new ConflictException('The stream is not live');

    const now = this.now();
    const expiresAt = Math.min(now + SUPPORT_CONTROL_TOKEN_TTL_MS, check.session.expiresAt.getTime());
    if (expiresAt <= now) throw new ForbiddenException('The support session is not active');

    this.prune(now);
    const mine = [...this.tokens.entries()].filter(([, r]) => r.impersonationSessionId === imp.sessionId).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    while (mine.length >= MAX_TOKENS_PER_SESSION) this.tokens.delete(mine.shift()![0]);

    // Written BEFORE the token exists, fail closed: no audit entry, no token.
    await this.impersonation.recordStudioControl(
      'impersonated_studio_control',
      imp.adminUserId,
      accountId,
      { event: 'token_minted', sessionId: imp.sessionId, streamId, expiresAt: new Date(expiresAt).toISOString() },
      true,
    );
    const controlToken = crypto.randomBytes(32).toString('base64url');
    this.tokens.set(this.hash(controlToken), {
      streamId,
      studioSessionId: session.id,
      accountId,
      impersonationSessionId: imp.sessionId,
      adminUserId: imp.adminUserId,
      expiresAt,
    });
    return { controlToken, expiresAt: new Date(expiresAt), studioSessionId: session.id };
  }

  /** The row for a token, or null when unknown / expired. The caller still re-validates the support session itself. */
  resolve(token: unknown): ControlTokenRow | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
    const key = this.hash(token);
    const row = this.tokens.get(key);
    if (!row) return null;
    if (row.expiresAt <= this.now()) {
      this.tokens.delete(key);
      return null;
    }
    return row;
  }

  /** The support session ended: its tokens die with it. */
  revokeForSession(impersonationSessionId: string): void {
    for (const [key, row] of this.tokens) if (row.impersonationSessionId === impersonationSessionId) this.tokens.delete(key);
  }

  private prune(now: number): void {
    for (const [key, row] of this.tokens) if (row.expiresAt <= now) this.tokens.delete(key);
  }

  /** `kit.apply` may only name a kit of the impersonated account. */
  async kitBelongsTo(accountId: string, kitId: string): Promise<boolean> {
    return (await this.kits.count({ where: { id: kitId.toLowerCase(), accountId } })) > 0;
  }

  /** Is this studio session's stream still LIVE (and still the customer's)? */
  async isLive(studioSessionId: string, accountId: string): Promise<boolean> {
    const session = await this.studioSessions.findByIdWithLiveStream(studioSessionId);
    return !!session && session.liveStream.accountId === accountId && session.liveStream.status === StreamStatus.LIVE;
  }
}
