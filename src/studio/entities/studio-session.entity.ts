import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LiveStream } from '../../streams/entities/live-stream.entity';
import { StudioGuestInvite } from './studio-guest-invite.entity';
import { StudioParticipant } from './studio-participant.entity';

export enum CompositingMode {
  CLIENT = 'client',
  SERVER_EGRESS = 'server_egress',
}

@Entity('studio_sessions')
export class StudioSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  liveStreamId!: string;

  @OneToOne(() => LiveStream)
  @JoinColumn({ name: 'live_stream_id' })
  liveStream!: LiveStream;

  /** Active layout + overlay/branding config, e.g. { layout: 'grid', slots: [...], overlays: [...] }. */
  @Column({ type: 'jsonb', default: {} })
  layoutConfig!: Record<string, unknown>;

  @Column({ type: 'enum', enum: CompositingMode, default: CompositingMode.CLIENT })
  compositingMode!: CompositingMode;

  @OneToMany(() => StudioGuestInvite, (i) => i.studioSession)
  invites!: StudioGuestInvite[];

  @OneToMany(() => StudioParticipant, (p) => p.studioSession)
  participants!: StudioParticipant[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
