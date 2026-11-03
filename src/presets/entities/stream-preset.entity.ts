import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PresetQuality = 'sd' | 'hd' | 'fhd' | 'qhd';

/** The settings a preset remembers. Every key is optional; see PresetConfigDto for the validation. */
export interface PresetConfig {
  orientation?: 'landscape' | 'portrait';
  destinationIds?: string[];
  brandKitId?: string | null;
  quality?: PresetQuality;
  tickerEnabled?: boolean;
  tickerText?: string;
}

/** A named "go live" setup of an account (migration 0029). */
@Entity('stream_presets')
export class StreamPreset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  config!: PresetConfig;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
