import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('login_codes')
export class LoginCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @Column()
  codeHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
