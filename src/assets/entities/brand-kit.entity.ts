import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type LowerThirdStyleId = 'bar' | 'accent' | 'glass';

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

  /** The account-wide default kit, used by a stream whose destinations have no kit of their own. At most one per account. */
  @Column({ default: false })
  isDefault!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
