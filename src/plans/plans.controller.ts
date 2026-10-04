import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { AccountGuard } from '../common/guards/account.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';
import { Plan } from './entities/plan.entity';

/** Public shape of a plan -- no internals, and numerics as numbers. */
export function toPublicPlan(p: Plan) {
  return {
    key: p.key,
    name: p.name,
    kind: p.kind,
    includedHoursPerMonth: p.includedHoursPerMonth === null ? null : Number(p.includedHoursPerMonth),
    maxDestinations: p.maxDestinations,
    maxGuests: p.maxGuests,
    maxResolution: p.maxResolution,
    maxSessionHours: p.maxSessionHours === null ? null : Number(p.maxSessionHours),
    validityHours: p.validityHours,
    priceInr: p.priceInr,
    priceUsd: p.priceUsd === null ? null : Number(p.priceUsd),
  };
}

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  /** Unauthenticated: feeds the pricing section of the public home page. */
  @Get('public')
  async publicPlans() {
    return (await this.plansService.listPublic()).map(toPublicPlan);
  }

  /** The caller's effective limits (plan + overrides + day pass), used by the UI to cap choices and explain refusals. */
  @Get('me')
  @UseGuards(AccountGuard)
  async myLimits(@CurrentAccount() account: Account) {
    return this.plansService.effectiveLimits(account);
  }
}
