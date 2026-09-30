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

  @Column({ nullable: true })
  platformBroadcastId!: string | null;

  /** Platform-side ingest — server-side only, never returned to a client. */
  @Column({ nullable: true })
  ingestUrl!: string | null;

  @Column({ nullable: true })
  streamKey!: string | null;

  @Column({ type: 'enum', enum: DestinationStatus, default: DestinationStatus.PENDING })
  status!: DestinationStatus;

  @Column({ type: 'int', nullable: true })
  viewerCount!: number | null;

  @Column({ nullable: true })
  errorMessage!: string | null;

  @Column({ nullable: true })
  cloudflareOutputUid!: string | null;

  @Column({ type: 'smallint', default: 0 })
  retryCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
