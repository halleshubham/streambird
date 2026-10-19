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
