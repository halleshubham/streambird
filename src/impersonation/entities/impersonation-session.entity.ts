import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ImpersonationMode = 'view' | 'act';
export type ImpersonationEndReason = 'exit' | 'replaced' | 'expired' | 'logout' | 'target_gone' | 'invalid';

/**
 * One superadmin support session (migration 0036). The row is the authority: AccountGuard resolves a customer as
 * the principal only while an unended, unexpired row exists for the admin's own login session.
 */
@Entity('impersonation_sessions')
export class ImpersonationSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  adminUserId!: string;

  /** The admin's own `user_sessions` row (the browser/app login this support session belongs to). */
  @Column({ type: 'uuid', nullable: true })
  adminSessionId!: string | null;

  @Column({ type: 'uuid' })
  targetUserId!: string;

  @Column({ type: 'uuid' })
  targetAccountId!: string;

  @Column({ type: 'varchar', length: 4 })
  mode!: ImpersonationMode;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  endReason!: ImpersonationEndReason | null;

  @Column({ type: 'text', nullable: true })
  ipAddress!: string | null;

  /** sha256 hex of the admin's User-Agent, never the raw string. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  userAgentHash!: string | null;
}
