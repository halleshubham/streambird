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

  @Column({ nullable: true })
  description!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'enum', enum: StreamStatus, default: StreamStatus.SCHEDULED })
  status!: StreamStatus;

  @Column({ nullable: true })
  relayLiveInputId!: string | null;

  /** Cloudflare's single ingest endpoint — the only ingestUrl/streamKey ever returned to a client. */
  @Column({ nullable: true })
  ingestUrl!: string | null;

  @Column({ nullable: true })
  streamKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @OneToMany(() => LiveStreamDestination, (d) => d.liveStream)
  destinations!: LiveStreamDestination[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
