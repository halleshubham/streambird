import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PlanTier } from '../../common/enums/plan-tier.enum';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  apiKeyHash!: string;

  @Column({ type: 'enum', enum: PlanTier, default: PlanTier.FREE })
  currentTier!: PlanTier;

  /** Legacy mirror of the hours allowance; limits are now read from the plan (see PlansService.effectiveLimits) plus the overrides below. */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  includedHoursPerMonth!: string;

  /** The plan this account is on (plans.key). currentTier is kept alongside for analytics/back-compat. */
  @Column({ type: 'text', default: 'free' })
  planKey!: string;

  // Per-account exceptions to the plan; null = use the plan's value.
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  includedHoursOverride!: string | null;

  @Column({ type: 'int', nullable: true })
  maxDestinationsOverride!: number | null;

  @Column({ type: 'int', nullable: true })
  maxGuestsOverride!: number | null;

  /** An active day pass (see Plan.kind) lifts the limits for its duration. */
  @Column({ type: 'text', nullable: true })
  dayPassPlanKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  dayPassExpiresAt!: Date | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  streamHourUsageCurrentPeriod!: string;

  @Column({ type: 'date', nullable: true })
  billingPeriodStart!: string | null;

  @Column({ type: 'text', nullable: true })
  razorpayCustomerId!: string | null;

  // Null = active. Suspending an Account blocks every User on it from
  // every AccountGuard-protected route (see AccountGuard) -- the
  // superadmin's abuse-handling lever for an entire company at once,
  // distinct from suspending one User on an otherwise-fine account.
  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
