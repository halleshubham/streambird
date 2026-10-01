import { IsEnum, IsISO8601, IsNumberString, IsOptional } from 'class-validator';
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
}
