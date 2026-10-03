import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** The (single) thumbnail image of a scheduled stream. See StreamSchedulingService.setThumbnail. */
@Entity('stream_thumbnails')
export class StreamThumbnail {
  @PrimaryColumn()
  liveStreamId!: string;

  /** 'image/jpeg' | 'image/png' -- sniffed from the bytes, never trusted from the upload. */
  @Column()
  contentType!: string;

  @Column({ type: 'bytea' })
  data!: Buffer;

  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
