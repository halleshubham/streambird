import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/entities/user.entity';
import { AccountsService } from '../accounts/accounts.service';
import { Role } from '../common/enums/role.enum';
import { hashPassword, verifyPassword } from '../auth/password.util';

/**
 * Seeds/reconciles the fixed Superadmin identity from
 * SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD on every boot. Runs as a plain
 * NestJS onModuleInit (not folded into the hand-written SQL migration
 * runner in migrations/ -- that runner has no access to ConfigService or
 * password hashing, and seeding a row based on env is application logic,
 * not a schema change) -- safe to run on every container start:
 *
 * - No env vars set: skipped entirely (app still boots; no Superadmin
 *   login exists yet). Lets local dev/CI run without ever needing these.
 * - No existing user for that email: creates a fresh Account + User
 *   (role=superadmin, pre-approved, password hashed with scrypt).
 * - An existing user for that email, already role=superadmin: reconciled
 *   in place -- the password hash is only rewritten if it no longer
 *   verifies against the current SUPERADMIN_PASSWORD (so a routine
 *   restart with an unchanged password is a no-op, not a write on every
 *   boot; a rotated password IS picked up and re-hashed).
 * - An existing user for that email that is NOT role=superadmin: never
 *   auto-promoted. That would let anyone who happened to previously
 *   self-register (via magic-code or Google) with whatever address ops
 *   later chooses as SUPERADMIN_EMAIL get silently escalated to
 *   Superadmin. Logs a warning and refuses instead -- ops must remove
 *   that user or pick a different SUPERADMIN_EMAIL.
 */
@Injectable()
export class SuperadminSeedService implements OnModuleInit {
  private readonly logger = new Logger(SuperadminSeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly accountsService: AccountsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = this.config.get<string>('superadminEmail')?.trim().toLowerCase();
    const password = this.config.get<string>('superadminPassword');

    if (!email || !password) {
      this.logger.log('SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD not set -- skipping seed.');
      return;
    }

    const existing = await this.users.findOne({ where: { email } });

    if (!existing) {
      const { account } = await this.accountsService.create({ name: 'Superadmin' });
      const user = this.users.create({
        email,
        accountId: account.id,
        role: Role.SUPERADMIN,
        passwordHash: hashPassword(password),
        approvedAt: new Date(),
      });
      await this.users.save(user);
      this.logger.log(`Seeded Superadmin user for ${email}.`);
      return;
    }

    if (existing.role !== Role.SUPERADMIN) {
      this.logger.warn(
        `SUPERADMIN_EMAIL (${email}) belongs to an existing non-superadmin user (id=${existing.id}); refusing to auto-promote it. Remove that user or change SUPERADMIN_EMAIL.`,
      );
      return;
    }

    let dirty = false;
    if (!existing.passwordHash || !verifyPassword(password, existing.passwordHash)) {
      existing.passwordHash = hashPassword(password);
      dirty = true;
    }
    if (!existing.approvedAt) {
      existing.approvedAt = new Date();
      dirty = true;
    }
    if (dirty) {
      await this.users.save(existing);
      this.logger.log(`Reconciled Superadmin user for ${email}.`);
    }
  }
}
