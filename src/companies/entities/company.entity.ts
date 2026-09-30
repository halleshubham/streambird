import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';

/**
 * The tenant/organizational identity a Company Admin signs up with --
 * deliberately kept distinct from Account (the billing + usage-tracking
 * unit; see currentTier/includedHoursPerMonth/etc. there). Today this is
 * always a strict 1:1 with Account: every Company owns exactly one
 * Account, created together at company-signup time. Keeping them as
 * separate tables means a future change (e.g. a company switching or
 * splitting billing accounts) never has to touch this table's shape, and
 * keeps "is this a company or a solo/legacy account" an explicit fact
 * instead of something inferred from row shape.
 *
 * Not every Account has a Company row: solo accounts created by the
 * pre-existing magic-code first-login path (findOrCreateForEmail) have no
 * Company at all -- they're a single User with role 'user' on their own
 * Account, exactly as before this feature existed.
 */
@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  accountId!: string;

  @OneToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
