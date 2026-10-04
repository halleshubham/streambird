import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Razorpay's subscription states (we mirror them from webhooks). */
export type SubscriptionStatus =
  | 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired';

/** Statuses in which the customer is (or is about to be) paying: the account has a live autopay. */
export const LIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['authenticated', 'active', 'pending'];

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column()
  planKey!: string;

  @Column()
  razorpaySubscriptionId!: string;

  @Column()
  razorpayPlanId!: string;

  @Column({ type: 'int' })
  amountPaise!: number;

  @Column({ type: 'text', default: 'created' })
  status!: SubscriptionStatus;

  @Column({ default: false })
  cancelAtCycleEnd!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  currentEnd!: Date | null;

  @Column({ type: 'int', default: 0 })
  paidCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
