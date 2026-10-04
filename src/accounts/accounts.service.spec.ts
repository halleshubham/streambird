import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';
import { PlanTier } from '../common/enums/plan-tier.enum';
import { PlansService } from '../plans/plans.service';
import { Plan } from '../plans/entities/plan.entity';

function plan(over: Partial<Plan>): Plan {
  return {
    key: 'free', name: 'Free', kind: 'monthly', includedHoursPerMonth: '2', graceMultiplier: '1',
    maxDestinations: 1, maxGuests: 2, maxResolution: 'fhd', maxSessionHours: null, validityHours: null,
    priceInr: 0, priceUsd: '0', isPublic: true, isActive: true, sortOrder: 0, ...over,
  } as Plan;
}
const SEED: Plan[] = [
  plan({}),
  plan({ key: 'pro', name: 'Pro', includedHoursPerMonth: '30', graceMultiplier: '1.2', maxDestinations: 4, maxGuests: 6 }),
  plan({ key: 'unlimited', name: 'Unlimited', includedHoursPerMonth: null, graceMultiplier: '1', maxDestinations: 6, maxGuests: 10 }),
  plan({ key: 'day_pass', name: 'Day Pass', kind: 'day_pass', includedHoursPerMonth: null, maxDestinations: 4, maxGuests: 10, maxResolution: 'hd', maxSessionHours: '12', validityHours: 24 }),
];
const planRepo = { findOne: jest.fn(async ({ where }: any) => SEED.find((p) => p.key === where.key) ?? null) };

describe('AccountsService', () => {
  let service: AccountsService;
  let repo: jest.Mocked<Repository<Account>>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: PlansService, useValue: new PlansService(planRepo as any) },
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
        planKey: 'free',
        includedHoursOverride: null,
        maxDestinationsOverride: null,
        maxGuestsOverride: null,
        dayPassPlanKey: null,
        dayPassExpiresAt: null,
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
        fakeAccount({ currentTier: PlanTier.PRO, planKey: 'pro', streamHourUsageCurrentPeriod: '35' }),
      );
      // 35 < 30 * 1.2 (36) -- still inside the grace window.
      await expect(service.assertCanStartStream('acc_1')).resolves.toBeUndefined();
    });

    it('assertCanStartStream blocks a paid tier once it exceeds its grace window', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ currentTier: PlanTier.PRO, planKey: 'pro', streamHourUsageCurrentPeriod: '36' }),
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

    it('an unlimited plan (null hours) never blocks on hours', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount({ planKey: 'unlimited', streamHourUsageCurrentPeriod: '5000' }));
      await expect(service.assertCanStartStream('acc_1')).resolves.toBeUndefined();
    });

    it('a per-account hours override replaces the plan value', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount({ includedHoursOverride: '50', streamHourUsageCurrentPeriod: '10' }));
      await expect(service.assertCanStartStream('acc_1')).resolves.toBeUndefined(); // 10 < 50, though Free is 2h
    });

    it('assertDestinationCount enforces the plan cap and says what to do', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount());
      await expect(service.assertDestinationCount('acc_1', 1)).resolves.toBeUndefined();
      await expect(service.assertDestinationCount('acc_1', 2)).rejects.toThrow(/Free plan allows up to 1 destination/);
    });

    it('a per-account destination override beats the plan, and an active day pass raises the cap', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount({ maxDestinationsOverride: 3 }));
      await expect(service.assertDestinationCount('acc_1', 3)).resolves.toBeUndefined();

      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ dayPassPlanKey: 'day_pass', dayPassExpiresAt: new Date(Date.now() + 3_600_000) }),
      );
      await expect(service.assertDestinationCount('acc_1', 4)).resolves.toBeUndefined();
    });

    it('an expired day pass no longer lifts anything', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        fakeAccount({ dayPassPlanKey: 'day_pass', dayPassExpiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.assertDestinationCount('acc_1', 2)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('grantDayPass sets an expiry validityHours from now', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount());
      const before = Date.now();
      const saved = await service.grantDayPass('acc_1');
      expect(saved.dayPassPlanKey).toBe('day_pass');
      expect(saved.dayPassExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 24 * 3_600_000 - 1000);
    });

    describe('activatePlan', () => {
      const NOW = new Date('2026-10-05T00:00:00Z');
      const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
      const pro = SEED.find((p) => p.key === 'pro')!;

      it('starts a 30-day period and resets usage for a new purchase', async () => {
        (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount({ streamHourUsageCurrentPeriod: '1.5' }));
        const saved = await service.activatePlan('acc_1', pro, NOW);
        expect(saved.planKey).toBe('pro');
        expect(saved.currentTier).toBe(PlanTier.PRO);
        expect(saved.planExpiresAt).toEqual(days(30));
        expect(saved.streamHourUsageCurrentPeriod).toBe('0');
        expect(saved.includedHoursPerMonth).toBe('30');
      });

      it('renewing the same active plan extends from its expiry and keeps this period\'s usage', async () => {
        (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount({ planKey: 'pro', planExpiresAt: days(10), streamHourUsageCurrentPeriod: '12' }));
        const saved = await service.activatePlan('acc_1', pro, NOW);
        expect(saved.planExpiresAt).toEqual(days(40));
        expect(saved.streamHourUsageCurrentPeriod).toBe('12');
      });

      it('an expired plan is replaced from now, and an hours override still shows in the mirror', async () => {
        (repo.findOne as jest.Mock).mockResolvedValue(fakeAccount({ planKey: 'pro', planExpiresAt: days(-2), includedHoursOverride: '55' }));
        const saved = await service.activatePlan('acc_1', pro, NOW);
        expect(saved.planExpiresAt).toEqual(days(30));
        expect(saved.includedHoursPerMonth).toBe('55');
      });
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
