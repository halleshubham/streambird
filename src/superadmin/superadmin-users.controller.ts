import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * Cross-company user management: search any User by email, and the
 * Superadmin-only per-User suspend/reactivate abuse lever. Same guard
 * pattern as SuperadminController (AccountGuard + RolesGuard restricted to
 * Role.SUPERADMIN) -- kept in its own controller/file rather than added to
 * superadmin.controller.ts to avoid colliding with other work landing in
 * that same area concurrently.
 *
 * The whole-Account suspend/reactivate routes that originally lived here
 * too were removed -- SuperadminAccountsController (the company directory
 * feature) landed with the exact same two routes as part of its account
 * detail page, so that's the single source of truth for them now; see
 * AccountsService.suspend/reactivate, left in place but unused by this
 * file, for the discarded implementation this one used to call.
 */
@Controller('superadmin')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminUsersController {
  constructor(
    private readonly usersService: UsersService,
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

  /**
   * One-off superadmin lever: promotes an existing solo (role=user)
   * account to a company account in place -- see
   * UsersService.convertToCompanyAccount for exactly what that does and
   * doesn't change (notably: preserves the account's existing
   * approval/login history rather than starting a fresh unapproved
   * signup).
   */
  @Post('users/:id/convert-to-company')
  async convertToCompany(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('companyName') companyName?: string,
  ) {
    const trimmed = companyName?.trim();
    if (!trimmed) {
      throw new BadRequestException('companyName is required');
    }
    const { user, company } = await this.usersService.convertToCompanyAccount(id, trimmed);
    await this.auditLog.log(admin, 'convert_to_company', 'user', user.id, { companyName: trimmed });
    return { id: user.id, role: user.role, companyId: company.id, companyName: company.name };
  }
}
