import { Exclude, Expose } from 'class-transformer';
import { PlanTier } from '../../common/enums/plan-tier.enum';

@Exclude()
export class AccountResponseDto {
  @Expose() id!: string;
  @Expose() name!: string;
  @Expose() currentTier!: PlanTier;
  @Expose() includedHoursPerMonth!: string;
  @Expose() streamHourUsageCurrentPeriod!: string;
  @Expose() billingPeriodStart!: string | null;
}
