import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LoginCode } from './entities/login-code.entity';
import { UserSession } from './entities/user-session.entity';
import { UsersService } from '../users/users.service';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';
import { User } from '../users/entities/user.entity';
import { Account } from '../accounts/entities/account.entity';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(LoginCode)
    private readonly loginCodes: Repository<LoginCode>,
    @InjectRepository(UserSession)
    private readonly sessions: Repository<UserSession>,
    private readonly usersService: UsersService,
    @Inject(EMAIL_SERVICE)
    private readonly emailService: EmailService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  async requestCode(rawEmail: string): Promise<void> {
    const email = this.normalizeEmail(rawEmail);
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

    const loginCode = this.loginCodes.create({
      email,
      codeHash: this.hash(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    });
    await this.loginCodes.save(loginCode);

    await this.emailService.sendLoginCode(email, code);
  }

  async verifyCode(
    rawEmail: string,
    code: string,
    meta: { userAgent?: string; ipAddress?: string },
  ): Promise<{ user: User; account: Account; token: string; expiresAt: Date }> {
    const email = this.normalizeEmail(rawEmail);

    const loginCode = await this.loginCodes.findOne({
      where: { email },
      order: { createdAt: 'DESC' },
    });

    if (!loginCode || loginCode.consumedAt || loginCode.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This code is invalid or has expired. Request a new one.');
    }

    if (loginCode.codeHash !== this.hash(code)) {
      loginCode.attempts += 1;
      if (loginCode.attempts >= MAX_ATTEMPTS) {
        loginCode.consumedAt = new Date(); // force a fresh code after too many wrong guesses
      }
      await this.loginCodes.save(loginCode);
      throw new BadRequestException('Incorrect code.');
    }

    loginCode.consumedAt = new Date();
    await this.loginCodes.save(loginCode);

    const { user, account } = await this.usersService.findOrCreateForEmail(email);

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000);

    const session = this.sessions.create({
      userId: user.id,
      tokenHash: this.hash(rawToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt,
    });
    await this.sessions.save(session);

    return { user, account, token: rawToken, expiresAt };
  }

  async resolveSession(rawToken: string): Promise<{ user: User; account: Account } | null> {
    const session = await this.sessions.findOne({
      where: { tokenHash: this.hash(rawToken) },
      relations: ['user', 'user.account'],
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      return null;
    }

    session.lastSeenAt = new Date();
    await this.sessions.save(session);

    return { user: session.user, account: session.user.account };
  }

  async logout(rawToken: string): Promise<void> {
    await this.sessions.update({ tokenHash: this.hash(rawToken) }, { revokedAt: new Date() });
  }
}
