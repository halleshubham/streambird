import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccountGuard, AccountRequest } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ImpersonationService } from '../impersonation/impersonation.service';
import { StartImpersonationDto } from '../impersonation/dto/start-impersonation.dto';

/**
 * Support sessions ("view as / act as a customer"). Like every superadmin route these ALWAYS authenticate as
 * the real admin: AccountGuard never swaps in the impersonated customer on a `@Roles(SUPERADMIN)` route, so
 * Exit and the banner keep working during a session and a customer can never reach these.
 */
@Controller('superadmin/impersonation')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  /** Starts (and replaces any earlier) support session for this login. 30 minutes. */
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  start(@CurrentUser() admin: User, @Req() req: AccountRequest, @Body() dto: StartImpersonationDto) {
    return this.impersonation.start(admin, req.sessionId ?? null, dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  /** The active session for the banner, or `{ active: false }`. */
  @Get()
  async current(@CurrentUser() admin: User, @Req() req: AccountRequest) {
    const info = await this.impersonation.current(admin, req.sessionId ?? null);
    return info ? { active: true, ...info } : { active: false };
  }

  /** Exit. Idempotent. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(@CurrentUser() admin: User): Promise<void> {
    await this.impersonation.end(admin);
  }
}
