import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Platform } from '../../common/enums/platform.enum';

@Entity('platform_connections')
export class PlatformConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column({ type: 'enum', enum: Platform })
  platform!: Platform;

  /** AES-256-GCM: nonce(12) || ciphertext || authTag(16). Decrypt via EncryptionService. */
  @Column({ type: 'bytea' })
  credentialsCiphertext!: Buffer;

  @Column({ type: 'smallint', default: 1 })
  credentialsKeyVersion!: number;

  @Column()
  externalAccountId!: string;

  @Column()
  label!: string;

  @Column({ default: true })
  isActive!: boolean;

  /** The brand kit (look) this channel/page uses; several connections may share one. Null = the account default. */
  @Column({ type: 'uuid', nullable: true })
  brandKitId!: string | null;

  /** Permanent public live-link slug (/stream/<slug>); YouTube and Facebook connections only. Unique, never changes. */
  @Column({ type: 'text', nullable: true, unique: true })
  liveSlug!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
