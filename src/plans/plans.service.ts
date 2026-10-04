import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { Plan, RESOLUTION_ORDER, Resolution } from './entities/plan.entity';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

/** What an account may do right now: its plan, per-account overrides, and any active day pass, merged. */
export interface EffectiveLimits {
  planKey: string;
  planName: string;
  /** null = unlimited hours. */
  includedHours: number | null;
  graceMultiplier: number;
  maxDestinations: number;
  /** Simultaneous guests in the studio, host excluded. */
  maxGuests: number;
  maxResolution: Resolution;
  /** A single live session ends after this many hours; null = no cap. */
  maxSessionHours: number | null;
  dayPass: { planKey: string; name: string; expiresAt: Date } | null;
  /** When a purchased plan lapses (null = no expiry). */
  planExpiresAt: Date | null;
  /** The account's plan has lapsed, so these are Free limits. */
  planExpired: boolean;
}

const num = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Pure merge, separate from the DB so it can be tested directly. Base plan
 * first; per-account overrides replace the plan's value; an active day pass
 * can only ever raise a limit (the better of pass and plan), never lower one.
 */
export function computeLimits(
  plan: Plan,
  account: Pick<
    Account,
    'includedHoursOverride' | 'maxDestinationsOverride' | 'maxGuestsOverride' | 'dayPassExpiresAt' | 'dayPassPlanKey'
  >,
  dayPass: Plan | null,
  now: Date = new Date(),
): EffectiveLimits {
  let includedHours = account.includedHoursOverride !== null ? Number(account.includedHoursOverride) : num(plan.includedHoursPerMonth);
  let maxDestinations = account.maxDestinationsOverride ?? plan.maxDestinations;
  let maxGuests = account.maxGuestsOverride ?? plan.maxGuests;
  let maxResolution = plan.maxResolution;
  let maxSessionHours = num(plan.maxSessionHours);
  let graceMultiplier = Number(plan.graceMultiplier);
  let activePass: EffectiveLimits['dayPass'] = null;

  if (dayPass && account.dayPassExpiresAt && account.dayPassExpiresAt.getTime() > now.getTime()) {
    activePass = { planKey: dayPass.key, name: dayPass.name, expiresAt: account.dayPassExpiresAt };
    const passHours = num(dayPass.includedHoursPerMonth);
    if (passHours === null || includedHours === null) includedHours = null;
    else includedHours = Math.max(includedHours, passHours);
    maxDestinations = Math.max(maxDestinations, dayPass.maxDestinations);
    maxGuests = Math.max(maxGuests, dayPass.maxGuests);
    if (RESOLUTION_ORDER.indexOf(dayPass.maxResolution) > RESOLUTION_ORDER.indexOf(maxResolution)) {
      maxResolution = dayPass.maxResolution;
    }
    const passSession = num(dayPass.maxSessionHours);
    // A pass with no session cap removes the plan's; otherwise the longer of the two.
    maxSessionHours = passSession === null || maxSessionHours === null ? null : Math.max(maxSessionHours, passSession);
    graceMultiplier = Math.max(graceMultiplier, Number(dayPass.graceMultiplier));
  }

  return {
    planKey: plan.key,
    planName: plan.name,
    includedHours,
    graceMultiplier,
    maxDestinations,
    maxGuests,
    maxResolution,
    maxSessionHours,
    dayPass: activePass,
    planExpiresAt: null,
    planExpired: false,
  };
}

@Injectable()
export class PlansService {
  constructor(@InjectRepository(Plan) private readonly plans: Repository<Plan>) {}

  /**
   * accounts.included_hours_per_month is kept as a mirror of the effective
   * monthly hours (override, else plan, else 0 for unlimited) so the usage
   * meters and analytics keep reading one simple column. Enforcement never
   * reads it -- it resolves limits via effectiveLimits().
   */
  async syncAccountHoursMirror(planKey: string): Promise<void> {
    const plan = await this.findByKeyOrThrow(planKey);
    await this.plans.manager.query(
      `UPDATE accounts SET included_hours_per_month = COALESCE(included_hours_override, $1::numeric, 0) WHERE plan_key = $2`,
      [plan.includedHoursPerMonth, planKey],
    );
  }

  list(includeInactive = true): Promise<Plan[]> {
    return this.plans.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', key: 'ASC' },
    });
  }

  /** What the public pricing page shows: active + public plans. */
  listPublic(): Promise<Plan[]> {
    return this.plans.find({ where: { isActive: true, isPublic: true }, order: { sortOrder: 'ASC', key: 'ASC' } });
  }

  async findByKeyOrThrow(key: string): Promise<Plan> {
    const plan = await this.plans.findOne({ where: { key } });
    if (!plan) throw new NotFoundException(`Plan '${key}' not found`);
    return plan;
  }

  async create(dto: CreatePlanDto): Promise<Plan> {
    if (await this.plans.findOne({ where: { key: dto.key } })) {
      throw new ConflictException(`A plan with key '${dto.key}' already exists`);
    }
    return this.plans.save(this.plans.create(this.fromDto(dto)));
  }

  async update(key: string, dto: UpdatePlanDto): Promise<Plan> {
    const plan = await this.findByKeyOrThrow(key);
    Object.assign(plan, this.fromDto(dto));
    const saved = await this.plans.save(plan);
    // A changed allowance applies to every account on the plan (those with a hand-set override keep it).
    if ('includedHoursPerMonth' in dto) await this.syncAccountHoursMirror(key);
    return saved;
  }

  /** Effective limits for an account, resolving its plan (and day pass, if any). Falls back to 'free' if the plan row is gone. */
  async effectiveLimits(account: Account, now: Date = new Date()): Promise<EffectiveLimits> {
    let plan =
      (await this.plans.findOne({ where: { key: account.planKey } })) ?? (await this.findByKeyOrThrow('free'));
    // A purchased plan that has lapsed drops the account to Free, and its
    // admin exceptions (which were granted for the old plan) stop applying.
    const planExpired = !!account.planExpiresAt && account.planExpiresAt.getTime() <= now.getTime() && plan.key !== 'free';
    if (planExpired) {
      plan = await this.findByKeyOrThrow('free');
      account = { ...account, includedHoursOverride: null, maxDestinationsOverride: null, maxGuestsOverride: null } as Account;
    }
    const dayPass =
      account.dayPassPlanKey && account.dayPassExpiresAt && account.dayPassExpiresAt.getTime() > now.getTime()
        ? await this.plans.findOne({ where: { key: account.dayPassPlanKey } })
        : null;
    const limits = computeLimits(plan, account, dayPass, now);
    return { ...limits, planExpiresAt: planExpired ? null : account.planExpiresAt, planExpired };
  }

  private fromDto(dto: Partial<CreatePlanDto>): Partial<Plan> {
    const out: Partial<Plan> = {};
    const str = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));
    if (dto.key !== undefined) out.key = dto.key;
    if (dto.name !== undefined) out.name = dto.name;
    if (dto.kind !== undefined) out.kind = dto.kind;
    if ('includedHoursPerMonth' in dto) out.includedHoursPerMonth = str(dto.includedHoursPerMonth);
    if (dto.graceMultiplier !== undefined) out.graceMultiplier = String(dto.graceMultiplier);
    if (dto.maxDestinations !== undefined) out.maxDestinations = dto.maxDestinations;
    if (dto.maxGuests !== undefined) out.maxGuests = dto.maxGuests;
    if (dto.maxResolution !== undefined) out.maxResolution = dto.maxResolution;
    if ('maxSessionHours' in dto) out.maxSessionHours = str(dto.maxSessionHours);
    if ('validityHours' in dto) out.validityHours = dto.validityHours ?? null;
    if ('priceInr' in dto) out.priceInr = dto.priceInr ?? null;
    if ('priceUsd' in dto) out.priceUsd = str(dto.priceUsd);
    if (dto.isPublic !== undefined) out.isPublic = dto.isPublic;
    if (dto.isActive !== undefined) out.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) out.sortOrder = dto.sortOrder;
    return out;
  }
}
