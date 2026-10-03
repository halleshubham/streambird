import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StudioSession } from './studio-session.entity';

@Entity('studio_guest_invites')
export class StudioGuestInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  studioSessionId!: string;

  @ManyToOne(() => StudioSession, (s) => s.invites)
  @JoinColumn({ name: 'studio_session_id' })
  studioSession!: StudioSession;

  /** Opaque join token, reusable for the lifetime of the stream. Never logged. */
  @Column()
  token!: string;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  /**
   * Null means "valid until the host ends the stream" -- the only behavior
   * going forward (see StudioSessionsService.createInvite). The column
   * stays nullable rather than being dropped, so a fixed-TTL invite could
   * still be represented if that ever comes back.
   */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** sha256(password) hex digest, same technique as AuthService.hash(). Null = no password required. */
  @Column({ type: 'text', nullable: true })
  passwordHash!: string | null;

  /** Set for an invite addressed to a specific email (scheduled-stream guests); null for plain shareable links. */
  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  emailedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
