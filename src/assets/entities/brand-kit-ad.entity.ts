import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const AD_PLACEMENTS = ['lower_third', 'side_third', 'full_screen'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export const BRAND_ORIENTATIONS = ['landscape', 'portrait'] as const;
/** Which set of a kit's materials: landscape = 16:9 streams, portrait = 9:16 (same words as LiveStream.orientation). */
export type BrandOrientation = (typeof BRAND_ORIENTATIONS)[number];
export type AdMode = 'continuous' | 'interval';

/** The advertisement a brand kit runs in one placement (at most one per placement). The image is a library asset of kind 'ad'. */
@Entity('brand_kit_ads')
export class BrandKitAd {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  brandKitId!: string;

  /** The kit set this ad belongs to; rows from before migration 0028 are landscape. */
  @Column({ type: 'text', default: 'landscape' })
  orientation!: BrandOrientation;

  @Column({ type: 'text' })
  placement!: AdPlacement;

  @Column({ type: 'uuid' })
  assetId!: string;

  @Column({ default: true })
  enabled!: boolean;

  @Column({ type: 'text', default: 'continuous' })
  mode!: AdMode;

  /** Seconds the ad is shown per cycle; interval mode only. */
  @Column({ type: 'int', nullable: true })
  showSec!: number | null;

  /** Seconds it stays hidden between showings; interval mode only. */
  @Column({ type: 'int', nullable: true })
  everySec!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
