import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type LowerThirdStyleId = 'bar' | 'accent' | 'glass';
export type ClockPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
export type ClockFormat = '12h' | '24h';
export type ClockSize = 'small' | 'medium' | 'large';
export type ClockStyle = 'text' | 'pill';

/** A reusable look made of library assets. Platform connections point at a kit (see PlatformConnection.brandKitId). */
@Entity('brand_kits')
export class BrandKit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column()
  name!: string;

  @Column({ type: 'uuid', nullable: true })
  logoAssetId!: string | null;

  /** The 9:16 (portrait) set. logoAssetId / wallpaperAssetId are the landscape set (and what older clients read). */
  @Column({ type: 'uuid', nullable: true })
  logoAssetIdPortrait!: string | null;

  @Column({ type: 'uuid', nullable: true })
  wallpaperAssetIdPortrait!: string | null;

  /** The stream thumbnail (JPG/PNG, 16:9 recommended) given to streams created without their own. One for both orientations. */
  @Column({ type: 'uuid', nullable: true })
  thumbnailAssetId!: string | null;

  /** Default stream title for streams that use this kit and were created without their own (copied onto the stream). Max 200, like a stream title. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;

  /** Default stream description, same rule as `title`. Max 5000, like a stream description. */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Shrink the live picture into the space an ad leaves free, while that ad shows (default on). */
  @Column({ default: true })
  adsShrinkPicture!: boolean;

  @Column({ type: 'text', default: 'left' })
  logoPosition!: 'left' | 'right';

  @Column({ type: 'int', default: 90 })
  logoSize!: number;

  @Column({ type: 'uuid', nullable: true })
  wallpaperAssetId!: string | null;

  @Column({ type: 'int', default: 0 })
  wallpaperDim!: number;

  @Column({ type: 'text', default: 'accent' })
  lowerThirdStyle!: LowerThirdStyleId;

  /** On-air date and time overlay (migration 0034). One setting for both orientations. Off by default. */
  @Column({ default: false })
  clockEnabled!: boolean;

  @Column({ type: 'text', default: 'top_right' })
  clockPosition!: ClockPosition;

  @Column({ type: 'text', default: '12h' })
  clockFormat!: ClockFormat;

  @Column({ default: true })
  clockShowDate!: boolean;

  @Column({ default: false })
  clockShowSeconds!: boolean;

  /** IANA zone name; null = the streamer's device timezone. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  clockTimezone!: string | null;

  @Column({ type: 'text', default: 'small' })
  clockSize!: ClockSize;

  /** Migration 0035: 'text' = plain text with a shadow under the logo, 'pill' = the dark rounded plate. */
  @Column({ type: 'varchar', length: 8, default: 'text' })
  clockStyle!: ClockStyle;

  /** Migration 0035: the date and the time take turns in the same spot (true) or show together (false). */
  @Column({ default: true })
  clockAlternate!: boolean;

  /** The account-wide default kit, used by a stream whose destinations have no kit of their own. At most one per account. */
  @Column({ default: false })
  isDefault!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
