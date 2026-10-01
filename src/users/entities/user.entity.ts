import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import { Role } from '../../common/enums/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @Column()
  accountId!: string;

  // Many Users can now share one Account (a "company"), not a strict 1:1
  // any more -- see migrations/0005_add_roles_and_companies.sql. Every
  // controller that scopes by account.id (streams/platform-connections/
  // studio-sessions) keeps working unchanged: the tenant boundary is still
  // the Account, it can just now have more than one User attached to it.
  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role!: Role;

  // Only ever set for role=SUPERADMIN today (real password login, see
  // AuthService.superadminLogin) -- every other role still authenticates
  // exclusively via magic-code / Google OAuth. Nullable rather than a
  // separate table since it's a plain 1:1 optional attribute of a user.
  @Column({ type: 'text', nullable: true })
  passwordHash!: string | null;

  // Only meaningful for role=COMPANY_ADMIN: null means "pending Superadmin
  // approval" (see AccountGuard's approval gate, which only ever inspects
  // this field when role === COMPANY_ADMIN). Left null and simply unused
  // for role=USER/SUPERADMIN -- those roles are never subject to the gate
  // regardless of this field's value.
  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  approvedById!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy!: User | null;

  @Column({ type: 'text', nullable: true })
  displayName!: string | null;

  // Null = active. Suspending a User blocks just that one person on every
  // AccountGuard-protected route (see AccountGuard) without touching
  // anyone else on their Account -- distinct from suspending the whole
  // Account (see Account.suspendedAt).
  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
