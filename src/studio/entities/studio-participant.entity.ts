import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StudioSession } from './studio-session.entity';

export enum ParticipantRole {
  HOST = 'host',
  CO_HOST = 'co_host',
  GUEST = 'guest',
}

@Entity('studio_participants')
export class StudioParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  studioSessionId!: string;

  @ManyToOne(() => StudioSession, (s) => s.participants)
  @JoinColumn({ name: 'studio_session_id' })
  studioSession!: StudioSession;

  @Column({ type: 'enum', enum: ParticipantRole })
  role!: ParticipantRole;

  @Column()
  displayName!: string;

  @Column({ type: 'timestamptz', nullable: true })
  joinedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
