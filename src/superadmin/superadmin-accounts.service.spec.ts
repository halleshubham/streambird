import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SuperadminAccountsService } from './superadmin-accounts.service';
import { Account } from '../accounts/entities/account.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PlanTier } from '../common/enums/plan-tier.enum';

describe('SuperadminAccountsService', () => {
  let service: SuperadminAccountsService;
  let accountsRepo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let companiesRepo: { find: jest.Mock; findOne: jest.Mock };
  let usersRepo: {
    find: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let streamsRepo: { find: jest.Mock };
  let platformConnectionsRepo: { find: jest.Mock };
  let auditLog: { log: jest.Mock };

  let usersQueryBuilder: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock;
  };

  beforeEach(async () => {
    accountsRepo = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (v) => v),
    };
    companiesRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    usersQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    usersRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => usersQueryBuilder),
    };
    streamsRepo = { find: jest.fn().mockResolvedValue([]) };
    platformConnectionsRepo = { find: jest.fn().mockResolvedValue([]) };
    auditLog = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SuperadminAccountsService,
        { provide: getRepositoryToken(Account), useValue: accountsRepo },
        { provide: getRepositoryToken(Company), useValue: companiesRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(LiveStream), useValue: streamsRepo },
        { provide: getRepositoryToken(PlatformConnection), useValue: platformConnectionsRepo },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = moduleRef.get(SuperadminAccountsService);
  });

  const account = (overrides: Partial<Account> = {}): Account =>
    ({
      id: 'acc_1',
      name: 'Acme Inc',
      currentTier: PlanTier.FREE,
      includedHoursPerMonth: '10.00',
      streamHourUsageCurrentPeriod: '2.00',
      billingPeriodStart: '2026-01-01',
      suspendedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      apiKeyHash: 'hash',
      razorpayCustomerId: null,
      ...overrides,
    }) as Account;

  describe('list', () => {
    it('joins each account with its optional company name and user count', async () => {
      accountsRepo.findAndCount.mockResolvedValue([[account()], 1]);
      companiesRepo.find.mockResolvedValue([{ accountId: 'acc_1', name: 'Acme Co' }]);
      usersQueryBuilder.getRawMany.mockResolvedValue([{ accountId: 'acc_1', count: '3' }]);

      const result = await service.list(50, 0);

      expect(accountsRepo.findAndCount).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        take: 50,
        skip: 0,
      });
      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({ id: 'acc_1', companyName: 'Acme Co', userCount: 3 }),
      ]);
    });

    it('returns companyName null when the account has no Company row (solo account)', async () => {
      accountsRepo.findAndCount.mockResolvedValue([[account()], 1]);
      companiesRepo.find.mockResolvedValue([]);
      usersQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.list(50, 0);

      expect(result.items[0].companyName).toBeNull();
      expect(result.items[0].userCount).toBe(0);
    });

    it('short-circuits without extra queries when there are no accounts', async () => {
      accountsRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.list(50, 0);

      expect(result).toEqual({ items: [], total: 0 });
      expect(companiesRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getDetail', () => {
    it('assembles users, stream history, and platform connections for the account', async () => {
      accountsRepo.findOne.mockResolvedValue(account());
      companiesRepo.findOne.mockResolvedValue({ accountId: 'acc_1', name: 'Acme Co' });
      usersRepo.find.mockResolvedValue([
        { id: 'u1', email: 'a@acme.com', role: 'company_admin', approvedAt: null, suspendedAt: null, createdAt: new Date() },
      ]);
      usersRepo.count.mockResolvedValue(1);
      streamsRepo.find.mockResolvedValue([
        { id: 's1', title: 'Stream 1', status: 'ended', scheduledAt: null, startedAt: null, endedAt: null },
      ]);
      platformConnectionsRepo.find.mockResolvedValue([
        { id: 'p1', platform: 'youtube', label: 'My channel', isActive: true, credentialsCiphertext: Buffer.from('x') },
      ]);

      const detail = await service.getDetail('acc_1');

      expect(detail.companyName).toBe('Acme Co');
      expect(detail.userCount).toBe(1);
      expect(detail.users).toEqual([
        { id: 'u1', email: 'a@acme.com', role: 'company_admin', approvedAt: null, suspendedAt: null, createdAt: expect.any(Date) },
      ]);
      expect(detail.streams).toEqual([
        { id: 's1', title: 'Stream 1', status: 'ended', scheduledAt: null, startedAt: null, endedAt: null },
      ]);
      expect(detail.platformConnections).toEqual([{ id: 'p1', platform: 'youtube', label: 'My channel', isActive: true }]);
      // credentialsCiphertext must never leak into the response shape.
      expect((detail.platformConnections[0] as any).credentialsCiphertext).toBeUndefined();

      expect(streamsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { accountId: 'acc_1' }, take: 50 }),
      );
    });

    it('throws NotFoundException when the account does not exist', async () => {
      accountsRepo.findOne.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSubscription', () => {
    it('patches only the fields provided and logs before/after to the audit trail', async () => {
      accountsRepo.findOne.mockResolvedValue(account({ currentTier: PlanTier.FREE, includedHoursPerMonth: '10.00' }));
      companiesRepo.findOne.mockResolvedValue(null);
      const admin = { id: 'admin_1' } as User;

      const result = await service.updateSubscription('acc_1', admin, { currentTier: PlanTier.PRO });

      expect(result.currentTier).toBe(PlanTier.PRO);
      // includedHoursPerMonth untouched since it wasn't in the DTO.
      expect(result.includedHoursPerMonth).toBe('10.00');
      expect(accountsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentTier: PlanTier.PRO, includedHoursPerMonth: '10.00' }),
      );
      expect(auditLog.log).toHaveBeenCalledWith(admin, 'update_subscription', 'account', 'acc_1', {
        before: { currentTier: PlanTier.FREE, includedHoursPerMonth: '10.00', billingPeriodStart: '2026-01-01' },
        after: { currentTier: PlanTier.PRO, includedHoursPerMonth: '10.00', billingPeriodStart: '2026-01-01' },
      });
    });

    it('applies all three fields when all are provided, including clearing billingPeriodStart to null', async () => {
      accountsRepo.findOne.mockResolvedValue(account());
      companiesRepo.findOne.mockResolvedValue(null);
      const admin = { id: 'admin_1' } as User;

      await service.updateSubscription('acc_1', admin, {
        currentTier: PlanTier.ENTERPRISE,
        includedHoursPerMonth: '500.00',
        billingPeriodStart: null,
      });

      expect(accountsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          currentTier: PlanTier.ENTERPRISE,
          includedHoursPerMonth: '500.00',
          billingPeriodStart: null,
        }),
      );
    });

    it('throws NotFoundException when the account does not exist', async () => {
      accountsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateSubscription('missing', { id: 'admin_1' } as User, { currentTier: PlanTier.PRO }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('suspend', () => {
    it('sets suspendedAt and logs suspend_account', async () => {
      accountsRepo.findOne.mockResolvedValue(account({ suspendedAt: null }));
      companiesRepo.findOne.mockResolvedValue(null);
      const admin = { id: 'admin_1' } as User;

      const result = await service.suspend('acc_1', admin);

      expect(result.suspendedAt).toBeInstanceOf(Date);
      expect(accountsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ suspendedAt: expect.any(Date) }));
      expect(auditLog.log).toHaveBeenCalledWith(admin, 'suspend_account', 'account', 'acc_1');
    });
  });

  describe('reactivate', () => {
    it('clears suspendedAt and logs reactivate_account', async () => {
      accountsRepo.findOne.mockResolvedValue(account({ suspendedAt: new Date() }));
      companiesRepo.findOne.mockResolvedValue(null);
      const admin = { id: 'admin_1' } as User;

      const result = await service.reactivate('acc_1', admin);

      expect(result.suspendedAt).toBeNull();
      expect(accountsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ suspendedAt: null }));
      expect(auditLog.log).toHaveBeenCalledWith(admin, 'reactivate_account', 'account', 'acc_1');
    });
  });
});
