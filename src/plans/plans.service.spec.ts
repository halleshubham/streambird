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
