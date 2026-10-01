import { ForbiddenException } from '@nestjs/common';
import { SuperadminUsersController } from './superadmin-users.controller';
import { Role } from '../common/enums/role.enum';

describe('SuperadminUsersController', () => {
  function build() {
    const usersService = {
      searchByEmail: jest.fn(),
      companyNamesByAccountIds: jest.fn().mockResolvedValue(new Map()),
      suspendUser: jest.fn(),
      reactivateUser: jest.fn(),
    };
    const accountsService = {
      suspend: jest.fn(),
      reactivate: jest.fn(),
    };
    const auditLog = { log: jest.fn() };
    const controller = new SuperadminUsersController(
      usersService as any,
      accountsService as any,
      auditLog as any,
    );
    const admin = { id: 'admin_1', role: Role.SUPERADMIN } as any;
    return { controller, usersService, accountsService, auditLog, admin };
  }

  it('searchUsers enriches each user with its companyName and omits sensitive fields', async () => {
    const { controller, usersService } = build();
    usersService.searchByEmail.mockResolvedValue([
      {
        id: 'u1',
        email: 'a@acme.com',
        displayName: 'A',
        role: Role.USER,
        accountId: 'acc_1',
        approvedAt: null,
        suspendedAt: null,
        createdAt: new Date('2024-01-01'),
      },
    ]);
    usersService.companyNamesByAccountIds.mockResolvedValue(new Map([['acc_1', 'Acme Inc']]));

    const result = await controller.searchUsers('a@acme');

    expect(usersService.searchByEmail).toHaveBeenCalledWith('a@acme');
    expect(result).toEqual([
      {
        id: 'u1',
        email: 'a@acme.com',
        displayName: 'A',
        role: Role.USER,
        accountId: 'acc_1',
        companyName: 'Acme Inc',
        approvedAt: null,
        suspendedAt: null,
        createdAt: new Date('2024-01-01'),
      },
    ]);
  });

  it('suspendUser suspends the target and audit-logs the action with the acting admin and target id', async () => {
    const { controller, usersService, auditLog, admin } = build();
    const suspended = { id: 'u1', suspendedAt: new Date('2024-05-01') };
    usersService.suspendUser.mockResolvedValue(suspended);

    const result = await controller.suspendUser(admin, 'u1');

    expect(usersService.suspendUser).toHaveBeenCalledWith('u1');
    expect(auditLog.log).toHaveBeenCalledWith(admin, 'suspend_user', 'user', 'u1');
    expect(result).toEqual({ id: 'u1', suspendedAt: suspended.suspendedAt });
  });

  it('suspendUser propagates the ForbiddenException refusal for a superadmin target without audit-logging', async () => {
    const { controller, usersService, auditLog, admin } = build();
    usersService.suspendUser.mockRejectedValue(
      new ForbiddenException('Superadmins cannot be suspended.'),
    );

    await expect(controller.suspendUser(admin, 'root_1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  it('reactivateUser clears suspension and audit-logs the action', async () => {
    const { controller, usersService, auditLog, admin } = build();
    usersService.reactivateUser.mockResolvedValue({ id: 'u1', suspendedAt: null });

    const result = await controller.reactivateUser(admin, 'u1');

    expect(usersService.reactivateUser).toHaveBeenCalledWith('u1');
    expect(auditLog.log).toHaveBeenCalledWith(admin, 'reactivate_user', 'user', 'u1');
    expect(result).toEqual({ id: 'u1', suspendedAt: null });
  });

  it('suspendAccount / reactivateAccount delegate to AccountsService and audit-log the account target', async () => {
    const { controller, accountsService, auditLog, admin } = build();
    accountsService.suspend.mockResolvedValue({ id: 'acc_1', suspendedAt: new Date() });
    accountsService.reactivate.mockResolvedValue({ id: 'acc_1', suspendedAt: null });

    await controller.suspendAccount(admin, 'acc_1');
    await controller.reactivateAccount(admin, 'acc_1');

    expect(auditLog.log).toHaveBeenCalledWith(admin, 'suspend_account', 'account', 'acc_1');
    expect(auditLog.log).toHaveBeenCalledWith(admin, 'reactivate_account', 'account', 'acc_1');
  });
});
