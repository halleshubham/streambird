import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isReviewAccountEmail } from '../users/review-accounts';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LoginCode } from './entities/login-code.entity';
import { UserSession } from './entities/user-session.entity';
import { UsersService } from '../users/users.service';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';
import { User } from '../users/entities/user.entity';
import { Account } from '../accounts/entities/account.entity';
import { Company } from '../companies/entities/company.entity';
import { Role } from '../common/enums/role.enum';
import { verifyPassword } from './password.util';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 30;

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

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
    // Review accounts sign in without a code, so there is nothing to send (see review-accounts.ts).
    if (isReviewAccountEmail(email)) return;
    await this.sendCode(email);
  }

  private async sendCode(email: string): Promise<void> {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

    const loginCode = this.loginCodes.create({
      email,
      codeHash: this.hash(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    });
    await this.loginCodes.save(loginCode);

    await this.emailService.sendLoginCode(email, code);
  }

  /**
   * Validates and consumes (marks used) the most recent login code for an
   * email -- shared by the magic-code login flow (verifyCode) AND the
   * Company Admin sign-up flow (verifyCompanySignup), which is otherwise
   * identical except for what happens to identity resolution afterwards.
   */
  private async consumeLoginCode(email: string, code: string): Promise<void> {
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
  }

  private async mintSession(
    userId: string,
    meta: SessionMeta,
  ): Promise<{ token: string; expiresAt: Date }> {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000);

    const session = this.sessions.create({
      userId,
      tokenHash: this.hash(rawToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt,
    });
    await this.sessions.save(session);

    return { token: rawToken, expiresAt };
  }

  async verifyCode(
    rawEmail: string,
    code: string,
    meta: SessionMeta,
  ): Promise<{ user: User; account: Account; token: string; expiresAt: Date }> {
    const email = this.normalizeEmail(rawEmail);
    if (!isReviewAccountEmail(email)) await this.consumeLoginCode(email, code);

    const { user, account } = await this.usersService.findOrCreateForEmail(email);
    this.rejectSuperadmin(user);
    const { token, expiresAt } = await this.mintSession(user.id, meta);

    return { user, account, token, expiresAt };
  }

  /**
   * Company Admin sign-up: same magic-code verification as verifyCode,
   * but on success it explicitly creates a brand-new Company + Account +
   * User (role='company_admin', unapproved) instead of resolving/creating
   * a plain solo account. See UsersService.createCompanyAdmin for why
   * this is a distinct action rather than something verifyCode itself
   * could infer.
   */
  async verifyCompanySignup(
    companyName: string,
    rawEmail: string,
    code: string,
    meta: SessionMeta,
  ): Promise<{ user: User; account: Account; company: Company; token: string; expiresAt: Date }> {
    const email = this.normalizeEmail(rawEmail);
    await this.consumeLoginCode(email, code);

    const { user, account, company } = await this.usersService.createCompanyAdmin(
      companyName,
      email,
    );
    const { token, expiresAt } = await this.mintSession(user.id, meta);

    return { user, account, company, token, expiresAt };
  }

  private async checkSuperadminPassword(rawEmail: string, password: string): Promise<User> {
    const email = this.normalizeEmail(rawEmail);
    const user = await this.usersService.findByEmail(email);

    if (
      !user ||
      user.role !== Role.SUPERADMIN ||
      !user.passwordHash ||
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return user;
  }

  /**
   * Superadmin login, step 1 of 2: the password is checked first, and only
   * then is a one-time code emailed (a wrong password never triggers an
   * email). No session is issued until superadminVerify.
   */
  async superadminLogin(rawEmail: string, password: string): Promise<void> {
    const user = await this.checkSuperadminPassword(rawEmail, password);
    await this.sendCode(this.normalizeEmail(user.email)); // never skipped, even if listed as a review account
  }

  /**
   * Step 2 of 2: the password is re-checked (so the code alone is never
   * enough) and the emailed code consumed, then the same kind of
   * session/cookie as every other login path is issued.
   */
  async superadminVerify(
    rawEmail: string,
    password: string,
    code: string,
    meta: SessionMeta,
  ): Promise<{ user: User; account: Account; token: string; expiresAt: Date }> {
    const user = await this.checkSuperadminPassword(rawEmail, password);
    await this.consumeLoginCode(this.normalizeEmail(rawEmail), code);

    const { token, expiresAt } = await this.mintSession(user.id, meta);
    return { user, account: user.account, token, expiresAt };
  }

  /**
   * The superadmin must go through password + emailed code. Email-only paths
   * (magic code, Google, Facebook) would otherwise be a way around both.
   */
  private rejectSuperadmin(user: User): void {
    if (user.role === Role.SUPERADMIN) {
      throw new ForbiddenException('Administrators sign in at /admin/login with a password and an emailed code.');
    }
  }

  /**
   * Google OAuth login (see GoogleOAuthService for the actual token
   * exchange/profile fetch -- this just resolves identity once we have a
   * verified email). A brand-new email is resolved through the exact same
   * path a first-ever magic-code login would use (findOrCreateForEmail):
   * it lands them in a plain solo account, role='user', with no company
   * and no approval gate -- Google sign-in is just another way to LOG IN,
   * never a way to create a company (that's still the explicit, distinct
   * signup-company flow above). A returning email resolves whatever
   * User/role/company it already has, same as magic-code login would.
   */
  async loginWithGoogleProfile(
    rawEmail: string,
    meta: SessionMeta,
  ): Promise<{ user: User; account: Account; token: string; expiresAt: Date }> {
    const email = this.normalizeEmail(rawEmail);
    const { user, account } = await this.usersService.findOrCreateForEmail(email);
    this.rejectSuperadmin(user);
    const { token, expiresAt } = await this.mintSession(user.id, meta);
    return { user, account, token, expiresAt };
  }

  /**
   * Facebook login: same identity resolution as Google. Meta only returns an
   * email it has confirmed, so it's treated as verified.
   */
  async loginWithFacebookProfile(
    rawEmail: string,
    meta: SessionMeta,
  ): Promise<{ user: User; account: Account; token: string; expiresAt: Date }> {
    return this.loginWithGoogleProfile(rawEmail, meta);
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
