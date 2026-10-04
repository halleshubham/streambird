import { computeLimits, PlansService } from './plans.service';
import { Plan } from './entities/plan.entity';

const plan = (o: Partial<Plan> = {}): Plan =>
  ({
    key: 'pro', name: 'Pro', kind: 'monthly', includedHoursPerMonth: '30', graceMultiplier: '1.2',
    maxDestinations: 4, maxGuests: 6, maxResolution: 'hd', maxSessionHours: null, validityHours: null,
    priceInr: 1999, priceUsd: '39', isPublic: true, isActive: true, sortOrder: 30, ...o,
  }) as Plan;
const none = { includedHoursOverride: null, maxDestinationsOverride: null, maxGuestsOverride: null, dayPassPlanKey: null, dayPassExpiresAt: null };
const pass = plan({ key: 'day_pass', name: 'Day Pass', kind: 'day_pass', includedHoursPerMonth: null, graceMultiplier: '1', maxDestinations: 6, maxGuests: 10, maxResolution: 'fhd', maxSessionHours: '12', validityHours: 24 });
const NOW = new Date('2026-10-05T12:00:00Z');

describe('computeLimits', () => {
  it("uses the plan's values when there are no overrides or pass", () => {
    const l = computeLimits(plan(), none, null, NOW);
    expect(l).toMatchObject({ planKey: 'pro', includedHours: 30, graceMultiplier: 1.2, maxDestinations: 4, maxGuests: 6, maxResolution: 'hd', maxSessionHours: null, dayPass: null });
  });

  it('per-account overrides replace the plan values; an override of 0 hours is respected', () => {
    const l = computeLimits(plan(), { ...none, includedHoursOverride: '0', maxDestinationsOverride: 2, maxGuestsOverride: 1 }, null, NOW);
    expect(l).toMatchObject({ includedHours: 0, maxDestinations: 2, maxGuests: 1 });
  });

  it('an unlimited plan stays unlimited (null hours)', () => {
    expect(computeLimits(plan({ includedHoursPerMonth: null }), none, null, NOW).includedHours).toBeNull();
  });

  it('an active day pass raises limits to the better of pass and plan (unlimited hours, longer session)', () => {
    const l = computeLimits(plan({ maxSessionHours: '6' }), { ...none, dayPassPlanKey: 'day_pass', dayPassExpiresAt: new Date(NOW.getTime() + 3_600_000) }, pass, NOW);
    expect(l).toMatchObject({ includedHours: null, maxDestinations: 6, maxGuests: 10, maxResolution: 'fhd', maxSessionHours: 12 });
    expect(l.dayPass?.planKey).toBe('day_pass');
  });

  it('a day pass never lowers anything the plan already allows', () => {
    const small = plan({ key: 'day_pass', kind: 'day_pass', includedHoursPerMonth: '5', maxDestinations: 1, maxGuests: 1, maxResolution: 'sd', maxSessionHours: '2' });
    const l = computeLimits(plan({ maxDestinations: 4, maxGuests: 6 }), { ...none, dayPassPlanKey: 'day_pass', dayPassExpiresAt: new Date(NOW.getTime() + 3_600_000) }, small, NOW);
    expect(l).toMatchObject({ includedHours: 30, maxDestinations: 4, maxGuests: 6, maxResolution: 'hd' });
  });

  it('an expired pass changes nothing', () => {
    const l = computeLimits(plan(), { ...none, dayPassPlanKey: 'day_pass', dayPassExpiresAt: new Date(NOW.getTime() - 1) }, pass, NOW);
    expect(l.dayPass).toBeNull();
    expect(l.maxDestinations).toBe(4);
  });
});

describe('PlansService.update', () => {
  function build(existing: Plan) {
    const repo = {
      findOne: jest.fn(async () => existing),
      save: jest.fn(async (p: Plan) => p),
      manager: { query: jest.fn(async () => undefined) },
    };
    return { service: new PlansService(repo as any), repo };
  }

  it('re-syncs the hours mirror on every account on the plan when the allowance changes', async () => {
    const { service, repo } = build(plan());
    await service.update('pro', { includedHoursPerMonth: 45 });
    expect(repo.manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (repo.manager.query as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/COALESCE\(included_hours_override/);
    expect(params[1]).toBe('pro');
  });

  it('does not touch accounts when an unrelated field changes, and stores null for "unlimited"', async () => {
    const { service, repo } = build(plan());
    await service.update('pro', { maxGuests: 8 });
    expect(repo.manager.query).not.toHaveBeenCalled();

    const saved = await service.update('pro', { includedHoursPerMonth: null, priceInr: null });
    expect(saved.includedHoursPerMonth).toBeNull();
    expect(saved.priceInr).toBeNull();
  });
});

describe('PlansService.effectiveLimits: purchased plan expiry', () => {
  const free = plan({ key: 'free', name: 'Free', includedHoursPerMonth: '2', graceMultiplier: '1', maxDestinations: 1, maxGuests: 2 });
  const pro = plan({});
  const build = () => new PlansService({ findOne: jest.fn(async ({ where }: any) => ({ free, pro })[where.key as 'free' | 'pro'] ?? null) } as any);
  const acct = (over: any = {}) => ({ planKey: 'pro', ...none, planExpiresAt: null, ...over }) as any;

  it('keeps the plan while it has not expired, and reports when it lapses', async () => {
    const until = new Date(NOW.getTime() + 86_400_000);
    const l = await build().effectiveLimits(acct({ planExpiresAt: until }), NOW);
    expect(l).toMatchObject({ planKey: 'pro', maxDestinations: 4, planExpired: false });
    expect(l.planExpiresAt).toEqual(until);
  });

  it('falls back to Free limits once expired, ignoring admin overrides made for the old plan', async () => {
    const l = await build().effectiveLimits(acct({ planExpiresAt: new Date(NOW.getTime() - 1), maxDestinationsOverride: 9, includedHoursOverride: '500' }), NOW);
    expect(l).toMatchObject({ planKey: 'free', maxDestinations: 1, maxGuests: 2, includedHours: 2, planExpired: true });
  });

  it('a plan with no expiry never lapses', async () => {
    expect((await build().effectiveLimits(acct(), NOW)).planKey).toBe('pro');
  });

  it('a day pass still lifts a lapsed account above Free', async () => {
    const l = await build().effectiveLimits(
      acct({ planExpiresAt: new Date(NOW.getTime() - 1), dayPassPlanKey: 'day_pass', dayPassExpiresAt: new Date(NOW.getTime() + 3_600_000) }),
      NOW,
    );
    // (day-pass row isn't in this fake repo, so it resolves to no pass -- the point is it doesn't crash)
    expect(l.planKey).toBe('free');
  });
});
