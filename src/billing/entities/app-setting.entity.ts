import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Small admin-editable key/value settings (e.g. payments_enabled). */
@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn()
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  @UpdateDateColumn()
  updatedAt!: Date;
}
