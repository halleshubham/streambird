import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AccountGuard, AccountRequest } from '../common/guards/account.guard';
import { StreamCreateThrottlerGuard } from '../common/guards/stream-create-throttler.guard';
import { AccountDeletionService, DeletionPreview } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

const SESSION_COOKIE_NAME = 'sb_session';

/**
 * Self-service account deletion (Google Play / GDPR / DPDP). Session-cookie auth only: an x-api-key caller has no
 * person behind it to confirm, so it gets 403. The throttle is per account (StreamCreateThrottlerGuard keys on it).
 */
@Controller('account')
@UseGuards(AccountGuard, StreamCreateThrottlerGuard)
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  private person(req: AccountRequest) {
    if (!req.user || !req.account) throw new ForbiddenException('Sign in to delete your account.');
    return { user: req.user, account: req.account };
  }

  /** What deleting would remove, for the warning (counts and flags only). */
  @Get('delete/preview')
  async preview(@Req() req: AccountRequest): Promise<DeletionPreview> {
    const { user, account } = this.person(req);
    return this.deletion.preview(user, account);
  }

  /** Emails a 6-digit confirmation code (a deletion code, not a login code). */
  @Post('delete/request')
  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async request(@Req() req: AccountRequest): Promise<void> {
    await this.deletion.requestCode(this.person(req).user);
  }

  @Delete()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async delete(@Req() req: AccountRequest, @Body() dto: DeleteAccountDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    const { user, account } = this.person(req);
    await this.deletion.delete(user, account, dto);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  }
}
