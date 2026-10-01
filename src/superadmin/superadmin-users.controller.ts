import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AccountsService } from '../accounts/accounts.service';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * Cross-company user management: search any User by email, and the
 * Superadmin-only suspend/reactivate abuse levers at both the per-User and
 * whole-Account granularity. Same guard pattern as SuperadminController
 * (AccountGuard + RolesGuard restricted to Role.SUPERADMIN) -- kept in its
 * own controller/file rather than added to superadmin.controller.ts to
 * avoid colliding with other work landing in that same area concurrently.
 *
 * NOTE on the two accounts/:id/suspend|reactivate routes below: a
 * concurrent task is building the account directory/detail page
 * (/admin/accounts, /admin/accounts/:id) and may ALSO implement these
 * exact two routes, since a company detail page naturally wants a suspend
 * button too. They're implemented here as minimal, obviously-correct
 * passthroughs to AccountsService.suspend/reactivate specifically so that,
 * if the other task's identical routes land first, discarding this
 * duplicate during merge review costs nothing. The per-User routes
 * (suspend/reactivate below) are NOT duplicated anywhere else and are the
 * actual deliverable of this task regardless of how the account-level
 * ones shake out.
 */
@Controller('superadmin')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('users')
  async searchUsers(@Query('email') email?: string) {
    const users = await this.usersService.searchByEmail(email ?? '');
    const accountIds = [...new Set(users.map((u) => u.accountId))];
    const companyNames = await this.usersService.companyNamesByAccountIds(accountIds);

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      accountId: u.accountId,
      companyName: companyNames.get(u.accountId) ?? null,
      approvedAt: u.approvedAt,
      suspendedAt: u.suspendedAt,
      createdAt: u.createdAt,
    }));
  }

  @Post('users/:id/suspend')
  async suspendUser(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.suspendUser(id);
    await this.auditLog.log(admin, 'suspend_user', 'user', user.id);
    return { id: user.id, suspendedAt: user.suspendedAt };
  }

  @Post('users/:id/reactivate')
  async reactivateUser(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.reactivateUser(id);
    await this.auditLog.log(admin, 'reactivate_user', 'user', user.id);
    return { id: user.id, suspendedAt: user.suspendedAt };
  }

  @Post('accounts/:id/suspend')
  async suspendAccount(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    const account = await this.accountsService.suspend(id);
    await this.auditLog.log(admin, 'suspend_account', 'account', account.id);
    return { id: account.id, suspendedAt: account.suspendedAt };
  }

  @Post('accounts/:id/reactivate')
  async reactivateAccount(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    const account = await this.accountsService.reactivate(id);
    await this.auditLog.log(admin, 'reactivate_account', 'account', account.id);
    return { id: account.id, suspendedAt: account.suspendedAt };
  }
}
