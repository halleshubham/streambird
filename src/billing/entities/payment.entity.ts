import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PaymentStatus = 'created' | 'paid' | 'failed';
export type PaymentKind = 'plan' | 'day_pass';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column()
  planKey!: string;

  @Column({ type: 'text' })
  kind!: PaymentKind;

  /** Fixed at order creation from the plan's price. */
  @Column({ type: 'int' })
  amountPaise!: number;

  @Column({ default: 'INR' })
  currency!: string;

  @Column({ type: 'text', default: 'created' })
  status!: PaymentStatus;

  @Column()
  razorpayOrderId!: string;

  @Column({ type: 'text', nullable: true })
  razorpayPaymentId!: string | null;

  @Column()
  receipt!: string;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
