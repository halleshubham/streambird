import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

/**
 * Superadmin-only. AccountGuard resolves the session as usual; its
 * approval gate never fires for role=SUPERADMIN (see AccountGuard), so a
 * Superadmin is always allowed through regardless. RolesGuard then
 * restricts every route here to role=SUPERADMIN specifically -- a
 * Company Admin or Normal User (even an approved one) gets a 403, and an
 * x-api-key caller (which never has a `user`/role at all) does too.
 */
@Controller('superadmin')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminController {
  constructor(private readonly usersService: UsersService) {}

  @Get('pending-company-admins')
  async pendingCompanyAdmins() {
    const users = await this.usersService.listPendingCompanyAdmins();
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      companyName: u.account?.name ?? null,
      createdAt: u.createdAt,
    }));
  }

  @Post('company-admins/:userId/approve')
  async approve(@CurrentUser() admin: User, @Param('userId', ParseUUIDPipe) userId: string) {
    const user = await this.usersService.approveCompanyAdmin(userId, admin.id);
    return { id: user.id, approvedAt: user.approvedAt };
  }

  @Post('company-admins/:userId/reject')
  @HttpCode(204)
  async reject(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    await this.usersService.rejectCompanyAdmin(userId);
  }
}
