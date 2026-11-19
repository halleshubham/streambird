import { Controller, ForbiddenException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Account } from '../../accounts/entities/account.entity';
import { CurrentAccount } from '../../common/decorators/current-account.decorator';
import { AccountGuard, AccountRequest } from '../../common/guards/account.guard';
import { ReturnsSupportControlToken } from '../../impersonation/blocked-when-impersonating';
import { SupportControlService } from './support-control.service';

@Controller('streams')
export class SupportControlController {
  constructor(private readonly control: SupportControlService) {}

  /**
   * Live studio remote control for a superadmin support session (see `.claude/docs/backend.md` "Live studio remote
   * control"). ONLY an ACT-mode support session gets a token (view mode is refused by AccountGuard for every POST; a
   * customer or an admin outside a session has no `request.impersonation` and is refused here), for a LIVE stream of
   * the impersonated customer. Not covered by the `host-token` block on purpose: the token never yields publishing
   * rights, a participant slot or an invite. The response is the ONE place the token may appear (redaction spares it).
   */
  @Post(':id/support-control-token')
  @UseGuards(AccountGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ReturnsSupportControlToken()
  async mint(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Req() req: AccountRequest) {
    if (!req.impersonation) throw new ForbiddenException('Only available in a support session');
    return this.control.mint(req.impersonation, account.id, id);
  }
}
