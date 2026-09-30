import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StudioSession } from './studio-session.entity';

@Entity('studio_host_tokens')
export class StudioHostToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  studioSessionId!: string;

  @ManyToOne(() => StudioSession)
  @JoinColumn({ name: 'studio_session_id' })
  studioSession!: StudioSession;

  /** Reusable until expiry/revocation, unlike a single-use guest invite. Never logged. */
  @Column()
  token!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
