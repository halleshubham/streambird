import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const AD_PLACEMENTS = ['lower_third', 'side_third', 'full_screen', 'l_shape'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export const BRAND_ORIENTATIONS = ['landscape', 'portrait'] as const;
/** Which set of a kit's materials: landscape = 16:9 streams, portrait = 9:16 (same words as LiveStream.orientation). */
export type BrandOrientation = (typeof BRAND_ORIENTATIONS)[number];
export type AdMode = 'continuous' | 'interval';

/** Most ads one placement can play in sequence (per orientation set). Position 0 = the first / only ad. */
export const MAX_ADS_PER_PLACEMENT = 5;
/** Continuous (always on) sequences: how long each ad is shown before the next one, in seconds. */
export const AD_DWELL_RANGE = { min: 5, max: 300 } as const;

/** One advertisement a brand kit runs in a placement; a placement plays up to MAX_ADS_PER_PLACEMENT of them in order (`position`). The image is a library asset of kind 'ad'. */
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

  /** Place in the placement's sequence, 0..4; 0 is what every ad from before sequences is. */
  @Column({ type: 'smallint', default: 0 })
  position!: number;

  @Column({ type: 'uuid' })
  assetId!: string;

  @Column({ default: true })
  enabled!: boolean;

  @Column({ type: 'text', default: 'continuous' })
  mode!: AdMode;

  /** Interval mode: seconds the ad is shown per cycle. Continuous mode: seconds it is shown before the next ad of the sequence (null = 20). */
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
