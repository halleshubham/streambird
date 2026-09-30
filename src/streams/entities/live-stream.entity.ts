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

  /** Set only when a RelayProvider is actually configured (see RelayProvider.isConfigured()) — null otherwise. */
  @Column({ type: 'text', nullable: true })
  relayLiveInputId!: string | null;

  /** The configured RelayProvider's own ingest endpoint, if any — not used for platform delivery (see MediaMtxService). */
  @Column({ type: 'text', nullable: true })
  ingestUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  streamKey!: string | null;

  /** Always our own MediaMTX instance's WHIP path — what the host's browser compositor publishes to (see MediaMtxService). */
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
