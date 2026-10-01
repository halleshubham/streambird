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

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  includedHoursPerMonth!: string;

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
