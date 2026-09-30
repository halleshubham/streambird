import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DestinationStatus } from '../../common/enums/destination-status.enum';
import { LiveStream } from './live-stream.entity';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';

@Entity('live_stream_destinations')
export class LiveStreamDestination {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  liveStreamId!: string;

  @ManyToOne(() => LiveStream, (s) => s.destinations)
  @JoinColumn({ name: 'live_stream_id' })
  liveStream!: LiveStream;

  @Column()
  platformConnectionId!: string;

  @ManyToOne(() => PlatformConnection)
  @JoinColumn({ name: 'platform_connection_id' })
  platformConnection!: PlatformConnection;

  @Column({ type: 'text', nullable: true })
  platformBroadcastId!: string | null;

  /** Platform-side ingest — server-side only, never returned to a client. */
  @Column({ type: 'text', nullable: true })
  ingestUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  streamKey!: string | null;

  @Column({ type: 'enum', enum: DestinationStatus, default: DestinationStatus.PENDING })
  status!: DestinationStatus;

  @Column({ type: 'int', nullable: true })
  viewerCount!: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  /** Legacy -- no longer written. Platform delivery goes through MediaMtxService's direct forward now, not a RelayProvider output. Column kept to avoid a migration for old rows; safe to drop in a future cleanup. */
  @Column({ type: 'text', nullable: true })
  cloudflareOutputUid!: string | null;

  @Column({ type: 'smallint', default: 0 })
  retryCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
