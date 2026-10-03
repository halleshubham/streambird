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

  /** 'public' | 'unlisted' | 'private' -- only meaningful to providers that support it (YouTube); others ignore it, same as scheduledAt. Null = provider default (YouTubeProvider defaults to 'unlisted'). Persisted here (not just passed through BroadcastMeta at create time) so retryDestination() can resend the same choice. */
  @Column({ type: 'text', nullable: true })
  visibility!: string | null;

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

  /** True for a stream deliberately scheduled ahead of time (see StreamSchedulingService) -- as opposed to the transient 'scheduled' status every stream passes through inside create(). */
  @Column({ default: false })
  isScheduledEvent!: boolean;

  /** IANA timezone the host scheduled in -- only used to render the start time in invites; scheduledAt itself is an absolute instant. */
  @Column({ type: 'text', nullable: true })
  timezone!: string | null;

  @Column({ type: 'int', nullable: true })
  expectedDurationMinutes!: number | null;

  /** Free-text message from the host, included in every guest invite. */
  @Column({ type: 'text', nullable: true })
  guestNotes!: string | null;

  /** Set when a scheduled stream is cancelled before ever starting (status then becomes ENDED). */
  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

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
