import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per superadmin action -- approvals/rejections, suspensions,
 * subscription edits. Deliberately a flat, denormalized record (no FK
 * joins required to read it back) rather than relations to User/Account,
 * since an audit entry must remain legible even after its target is long
 * gone (e.g. a rejected signup's Account is actually deleted -- see
 * UsersService.rejectCompanyAdmin -- but the fact that it was rejected,
 * by whom, and when should still be readable).
 */
@Entity('superadmin_audit_log')
export class SuperadminAuditLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  /** Free-form but conventionally snake_case verbs, e.g. 'approve_company_admin', 'suspend_account', 'update_subscription'. Not an enum -- new actions should never require a migration. */
  @Column()
  action!: string;

  /** e.g. 'account', 'user'. */
  @Column()
  targetType!: string;

  @Column({ type: 'uuid', nullable: true })
  targetId!: string | null;

  /** Whatever's useful for that action -- e.g. { before: {...}, after: {...} } for a subscription edit. Never raw credentials/secrets. */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}
