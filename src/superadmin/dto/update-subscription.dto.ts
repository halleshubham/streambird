import { IsEnum, IsInt, IsISO8601, IsNumber, IsNumberString, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { PlanTier } from '../../common/enums/plan-tier.enum';

/**
 * All fields optional -- PATCH /superadmin/accounts/:id/subscription only
 * touches whichever of these the caller actually sent (see
 * SuperadminAccountsService.updateSubscription). `billingPeriodStart` may
 * be explicitly `null` to clear it; omitting the field entirely leaves it
 * untouched.
 */
export class UpdateSubscriptionDto {
  @IsOptional()
  @IsEnum(PlanTier)
  currentTier?: PlanTier;

  @IsOptional()
  @IsNumberString()
  includedHoursPerMonth?: string;

  @IsOptional()
  @IsISO8601()
  billingPeriodStart?: string | null;

  /** Moves the account to this plan (plans.key). Also syncs currentTier when the key is one of the built-in tiers. */
  @IsOptional()
  @IsString()
  planKey?: string;

  // Per-account exceptions to the plan. An explicit null clears the override
  // (back to the plan's value); omitting a field leaves it untouched.
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber() @Min(0) @Max(100000)
  includedHoursOverride?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt() @Min(1) @Max(50)
  maxDestinationsOverride?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt() @Min(0) @Max(50)
  maxGuestsOverride?: number | null;
}
