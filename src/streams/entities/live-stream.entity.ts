import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StreamStatus } from '../../common/enums/stream-status.enum';
import { LiveStreamDestination } from './live-stream-destination.entity';

@Entity('live_streams')
export class LiveStream {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column()
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'enum', enum: StreamStatus, default: StreamStatus.SCHEDULED })
  status!: StreamStatus;

  @Column({ type: 'text', nullable: true })
  relayLiveInputId!: string | null;

  /** Cloudflare's single ingest endpoint — the only ingestUrl/streamKey ever returned to a client. */
  @Column({ type: 'text', nullable: true })
  ingestUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  streamKey!: string | null;

  /** Cloudflare's WHIP (WebRTC) publish URL — what the host's browser compositor publishes to. */
  @Column({ type: 'text', nullable: true })
  whipUrl!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @OneToMany(() => LiveStreamDestination, (d) => d.liveStream)
  destinations!: LiveStreamDestination[];

  /**
   * Not persisted on this table (studio_sessions.live_stream_id is the FK,
   * the reverse direction) — StreamsService attaches it after creating the
   * StudioSession so callers don't need a second round-trip.
   */
  studioSessionId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
