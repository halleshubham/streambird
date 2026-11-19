import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpException, NotFoundException, Param, ParseUUIDPipe, PayloadTooLargeException, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Account } from '../../accounts/entities/account.entity';
import { CurrentAccount } from '../../common/decorators/current-account.decorator';
import { StreamStatus } from '../../common/enums/stream-status.enum';
import { AccountGuard, AccountRequest } from '../../common/guards/account.guard';
import { BlockedWhenImpersonating } from '../../impersonation/blocked-when-impersonating';
import { StudioSessionsService } from '../studio-sessions.service';
import { PhoneRemoteService, PHONE_MAX_AFTER_AHEAD, PHONE_MAX_WAIT_SEC } from './phone-remote.service';

/**
 * The Android app's remote-control channel (see `.claude/docs/backend.md` "Phone remote control"): the phone long-polls
 * for commands a support session queued, acks them and uploads its settings snapshot. OWNER-only: the request must be
 * the stream owner's own cookie session. `@BlockedWhenImpersonating('phone-channel')` makes AccountGuard answer 403 to
 * ANY support session (view or act, any method) before the handler runs, so a support person can neither read the
 * queue nor answer a command; a second check below refuses an `impersonation` principal and API-key callers anyway.
 * The routes are ACCOUNT-scoped, not user-scoped: any signed-in member of the owning account (team) may poll (accepted).
 */
@Controller('streams')
@UseGuards(AccountGuard)
@BlockedWhenImpersonating('phone-channel')
export class PhoneRemoteController {
  constructor(
    private readonly phone: PhoneRemoteService,
    private readonly studioSessions: StudioSessionsService,
  ) {}

  /** The caller's own session, the stream theirs (404 otherwise, never revealing another account's stream) and LIVE (409). */
  private async resolve(account: Account, streamId: string, req: AccountRequest): Promise<{ studioSessionId: string }> {
    if (req.impersonation || req.actor) throw new ForbiddenException('Only the stream owner can use the phone control channel');
    if (!req.user) throw new ForbiddenException('A signed-in session is required');
    const studio = await this.studioSessions.findByLiveStreamId(streamId);
    const session = studio ? await this.studioSessions.findByIdWithLiveStream(studio.id) : null;
    if (!session || session.liveStream.accountId !== account.id) throw new NotFoundException('Stream not found');
    if (session.liveStream.status !== StreamStatus.LIVE) {
      this.phone.forget(streamId);
      throw new ConflictException('The stream is not live');
    }
    return { studioSessionId: session.id };
  }

  @Get(':id/remote-control')
  async poll(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('after') afterRaw: string | undefined,
    @Query('wait') waitRaw: string | undefined,
    @Req() req: AccountRequest,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const after = afterRaw === undefined || afterRaw === '' ? 0 : Number(afterRaw);
    const wait = waitRaw === undefined || waitRaw === '' ? PHONE_MAX_WAIT_SEC : Number(waitRaw);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isFinite(wait) || wait < 0) throw new BadRequestException('after and wait must be non-negative whole numbers');
    // A `after` far beyond any real sequence number (they start at the epoch-ms clock) would poison the stream's counter.
    if (after > Date.now() + PHONE_MAX_AFTER_AHEAD) throw new BadRequestException('after is not a sequence number of this stream');
    if (!this.phone.allowAccount('poll', account.id)) throw new HttpException('Too many polls', 429);
    // Registered BEFORE the database lookups: a client that hangs up during them must never get a hold.
    let gone = false;
    let handle: { cancel(): void } | null = null;
    res.on('close', () => {
      if (!res.writableEnded) {
        gone = true;
        handle?.cancel();
      }
    });
    const { studioSessionId } = await this.resolve(account, id, req);
    if (gone || req.destroyed || res.destroyed) return;
    const polled = this.phone.poll({ streamId: id, studioSessionId, accountId: account.id, after, waitSec: Math.min(wait, PHONE_MAX_WAIT_SEC) });
    handle = polled;
    if (gone) polled.cancel();
    const result = await polled.result;
    if (res.writableEnded || res.destroyed) return;
    if (result.status === 'limited') {
      res.status(429).json({ statusCode: 429, message: 'Too many polls' });
    } else if (result.status === 'empty') {
      res.status(204).end();
    } else {
      res.status(200).json({ commands: result.commands, now: result.now });
    }
  }

  @Post(':id/remote-control/ack')
  @HttpCode(204)
  async ack(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AccountRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.phone.allowAccount('ack', account.id)) throw new HttpException('Too many acknowledgements', 429);
    await this.resolve(account, id, req);
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const outcome = this.phone.ack({ streamId: id, accountId: account.id, id: b.id, ok: b.ok, error: b.error, appliedAt: b.appliedAt });
    if (outcome === 'limited') throw new HttpException('Too many acknowledgements', 429);
  }

  @Put(':id/remote-control/state')
  @HttpCode(204)
  async putState(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AccountRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.phone.allowAccount('state', account.id)) throw new HttpException('Too many state updates', 429);
    const { studioSessionId } = await this.resolve(account, id, req);
    const outcome = this.phone.putState({ streamId: id, studioSessionId, accountId: account.id, body });
    if (outcome === 'limited') throw new HttpException('Too many state updates', 429);
    if (outcome === 'too_large') throw new PayloadTooLargeException('State too large');
    if (outcome === 'invalid') throw new BadRequestException('Invalid state');
  }
}
