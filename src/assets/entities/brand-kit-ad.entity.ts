import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const AD_PLACEMENTS = ['lower_third', 'side_third', 'full_screen'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export type AdMode = 'continuous' | 'interval';

/** The advertisement a brand kit runs in one placement (at most one per placement). The image is a library asset of kind 'ad'. */
@Entity('brand_kit_ads')
export class BrandKitAd {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  brandKitId!: string;

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
