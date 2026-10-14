import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type PlanKind = 'monthly' | 'day_pass';
export type Resolution = 'sd' | 'hd' | 'fhd' | 'qhd';
export const RESOLUTION_ORDER: Resolution[] = ['sd', 'hd', 'fhd', 'qhd'];

/** One row per plan; see migrations/0012_configurable_plans.sql. numeric columns arrive as strings from pg. */
@Entity('plans')
export class Plan {
  @PrimaryColumn()
  key!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', default: 'monthly' })
  kind!: PlanKind;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  includedHoursPerMonth!: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, default: 1 })
  graceMultiplier!: string;

  @Column({ type: 'int' })
  maxDestinations!: number;

  @Column({ type: 'int' })
  maxGuests!: number;

  @Column({ type: 'text', default: 'fhd' })
  maxResolution!: Resolution;

  /** May record the composited stream to their own computer from the studio (client-side). */
  @Column({ default: false })
  canRecord!: boolean;

  /** May remove a green screen behind a person in the studio (client-side). */
  @Column({ default: false })
  canChromaKey!: boolean;

  /** May show animated lower-third banners in the studio (drawn client-side). */
  @Column({ default: false })
  canLowerThird!: boolean;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  maxSessionHours!: string | null;

  @Column({ type: 'int', nullable: true })
  validityHours!: number | null;

  @Column({ type: 'int', nullable: true })
  priceInr!: number | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  priceUsd!: string | null;

  /** The Razorpay Plan (plan_...) mirroring this plan for autopay, and the price it was created at. */
  @Column({ type: 'text', nullable: true })
  razorpayPlanId!: string | null;

  @Column({ type: 'int', nullable: true })
  razorpayPlanAmountPaise!: number | null;

  @Column({ default: true })
  isPublic!: boolean;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
