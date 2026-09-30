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

  /** Single-use, opaque join token. Never logged. */
  @Column()
  token!: string;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
