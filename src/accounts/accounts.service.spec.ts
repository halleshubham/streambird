import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';
import { PlanTier } from '../common/enums/plan-tier.enum';

describe('AccountsService', () => {
  let service: AccountsService;
  let repo: jest.Mocked<Repository<Account>>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: getRepositoryToken(Account),
          useValue: {
            create: jest.fn((v) => v),
            save: jest.fn(async (v) => ({ id: 'acc_1', ...v })),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AccountsService);
    repo = moduleRef.get(getRepositoryToken(Account));
  });

  it('creates an account and returns a raw API key that is never stored', async () => {
    const { account, apiKey } = await service.create({ name: 'Acme' });

    expect(apiKey).toMatch(/^sb_[0-9a-f]{64}$/);
    expect(account.name).toBe('Acme');
    expect((repo.save as jest.Mock).mock.calls[0][0].apiKeyHash).not.toBe(apiKey);
  });

  it('looks up an account by hashing the presented API key', async () => {
    const { apiKey } = await service.create({ name: 'Acme' });
    const expectedHash = (repo.save as jest.Mock).mock.calls[0][0].apiKeyHash;

    (repo.findOne as jest.Mock).mockResolvedValue({ id: 'acc_1', name: 'Acme' });
    await service.findByApiKey(apiKey);

    expect(repo.findOne).toHaveBeenCalledWith({ where: { apiKeyHash: expectedHash } });
  });

  it('returns null for an unknown API key', async () => {
    (repo.findOne as jest.Mock).mockResolvedValue(null);
    const result = await service.findByApiKey('sb_does-not-exist');
    expect(result).toBeNull();
  });

  it('create() seeds Free-tier included hours and a billing-period anchor, not the bare column default of 0', async () => {
    await service.create({ name: 'Acme' });

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.includedHoursPerMonth).toBe('2');
    expect(saved.billingPeriodStart).toBe(new Date().toISOString().slice(0, 10));
  });

  describe('usage enforcement', () => {
    function fakeAccount(overrides: Partial<Account> = {}): Account {
      return {
        id: 'acc_1',
        currentTier: PlanTier.FREE,
        includedHoursPerMonth: '2',
        streamHourUsageCurrentPeriod: '0',
        billingPeriodStart: new Date().toISOString().slice(0, 10),
        ...overrides,
      } as Account;
    }

    it('assertCanStartStream allows a Free-tier account under its included hours', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount({ streamHourUsageCurrentPeriod: '1' }));
      await expect(service.assertCanStartStream('acc_1')).resolves.toBeUndefined();
    });

    it('assertCanStartStream hard-blocks a Free-tier account AT exactly its included hours -- no grace', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ streamHourUsageCurrentPeriod: '2' }),
      );
      await expect(service.assertCanStartStream('acc_1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('assertCanStartStream gives a paid tier 20% grace beyond its included hours', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ currentTier: PlanTier.PRO, includedHoursPerMonth: '30', streamHourUsageCurrentPeriod: '35' }),
      );
      // 35 < 30 * 1.2 (36) -- still inside the grace window.
      await expect(service.assertCanStartStream('acc_1')).resolves.toBeUndefined();
    });

    it('assertCanStartStream blocks a paid tier once it exceeds its grace window', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ currentTier: PlanTier.PRO, includedHoursPerMonth: '30', streamHourUsageCurrentPeriod: '36' }),
      );
      await expect(service.assertCanStartStream('acc_1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('assertCanStartStream resets usage first if the billing period has rolled over, then allows the stream', async () => {
      const staleStart = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ streamHourUsageCurrentPeriod: '2', billingPeriodStart: staleStart }),
      );

      await expect(service.assertCanStartStream('acc_1')).resolves.toBeUndefined();

      const savedForRollover = (repo.save as jest.Mock).mock.calls[0][0];
      expect(savedForRollover.streamHourUsageCurrentPeriod).toBe('0');
      expect(savedForRollover.billingPeriodStart).toBe(new Date().toISOString().slice(0, 10));
    });

    it('recordStreamUsage adds the given hours to the running total', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ streamHourUsageCurrentPeriod: '1.5' }),
      );

      await service.recordStreamUsage('acc_1', 0.5);

      const saved = (repo.save as jest.Mock).mock.calls[0][0];
      expect(saved.streamHourUsageCurrentPeriod).toBe('2.00');
    });

    it('recordStreamUsage is a no-op for zero or negative hours -- never produces phantom usage', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount());

      await service.recordStreamUsage('acc_1', 0);
      await service.recordStreamUsage('acc_1', -1);

      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
