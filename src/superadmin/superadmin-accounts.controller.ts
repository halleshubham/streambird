import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { SuperadminAccountsService } from './superadmin-accounts.service';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

/**
 * Company/account directory + subscription management, Superadmin-only.
 * Same guard pattern as SuperadminController (see that file's docstring)
 * -- kept as a separate controller/file to avoid churn there.
 */
@Controller('superadmin/accounts')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminAccountsController {
  constructor(private readonly accountsService: SuperadminAccountsService) {}

  @Get()
  async list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const parsedLimit = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    const parsedOffset = parseInt(offset ?? '0', 10) || 0;
    return this.accountsService.list(parsedLimit, parsedOffset);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.getDetail(id);
  }

  @Patch(':id/subscription')
  async updateSubscription(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.accountsService.updateSubscription(id, admin, dto);
  }

  @Post(':id/day-pass')
  @HttpCode(200)
  async grantDayPass(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('planKey') planKey?: string,
  ) {
    return this.accountsService.grantDayPass(id, admin, planKey);
  }

  @Delete(':id/day-pass')
  async revokeDayPass(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.revokeDayPass(id, admin);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.suspend(id, admin);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.reactivate(id, admin);
  }
}
