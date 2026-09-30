import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_sessions')
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column()
  tokenHash!: string;

  @Column({ type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'text', nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
