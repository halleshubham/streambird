import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const ASSET_KINDS = ['logo', 'wallpaper', 'background', 'other', 'ad'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** One uploaded file in an account's asset library. The bytes live in object storage (R2) under `storageKey`. */
@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column({ type: 'text' })
  kind!: AssetKind;

  @Column()
  name!: string;

  @Column()
  contentType!: string;

  @Column({ type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;

  @Column()
  storageKey!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
