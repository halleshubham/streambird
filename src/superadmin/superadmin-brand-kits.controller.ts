import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { SuperadminBrandKitsService } from './superadmin-brand-kits.service';

/** Read-only brand kit views for support (what does this customer's kit / stream use?). Same guards as the sibling superadmin controllers; no writes. */
@Controller('superadmin')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminBrandKitsController {
  constructor(private readonly brandKits: SuperadminBrandKitsService) {}

  @Get('accounts/:id/brand-kits')
  forAccount(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.brandKits.forAccount(id, admin);
  }

  @Get('streams/:streamId/brand-kit')
  forStream(@CurrentUser() admin: User, @Param('streamId', ParseUUIDPipe) streamId: string) {
    return this.brandKits.forStream(streamId, admin);
  }
}
