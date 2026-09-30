import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { Company } from '../companies/entities/company.entity';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    private readonly accountsService: AccountsService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email }, relations: ['account'] });
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id }, relations: ['account'] });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  /**
   * First-ever login for an email (via magic-code OR Google OAuth --
   * both call this same method, see AuthService.verifyCode and
   * .loginWithGoogleProfile) creates both the Account (tenant) and the
   * User (login identity) together, with the default role='user' and no
   * Company row -- a solo, single-user account exactly like every
   * account created before this feature existed. A returning email just
   * resolves the existing User (whatever role/company it actually has --
   * this is also how an invited team member's or a company's own
   * continuing members' subsequent logins resolve). No apiKey is
   * surfaced here; AccountsService.create() still mints one for API-key
   * access, it's just not shown to this login flow.
   */
  async findOrCreateForEmail(email: string): Promise<{ user: User; account: Account }> {
    const existing = await this.findByEmail(email);
    if (existing) {
      return { user: existing, account: existing.account };
    }

    const { account } = await this.accountsService.create({ name: email });
    const user = this.users.create({ email, accountId: account.id, role: Role.USER });
    await this.users.save(user);

    return { user, account };
  }

  /**
   * Company Admin sign-up: creates a brand-new Company + Account + the
   * first User, as role='company_admin', unapproved (approvedAt is left
   * null -- see AccountGuard's approval gate). Distinct from
   * findOrCreateForEmail: this is an explicit "create a new company"
   * action, never triggered implicitly by a login attempt.
   */
  async createCompanyAdmin(
    companyName: string,
    email: string,
  ): Promise<{ user: User; account: Account; company: Company }> {
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException(
        'This email is already registered. Log in instead of creating a new company.',
      );
    }

    const { account } = await this.accountsService.create({ name: companyName });
    const company = this.companies.create({ name: companyName, accountId: account.id });
    await this.companies.save(company);

    const user = this.users.create({
      email,
      accountId: account.id,
      role: Role.COMPANY_ADMIN,
      approvedAt: null,
    });
    await this.users.save(user);

    return { user, account, company };
  }

  /** All Users belonging to one Account ("team members"), oldest first. */
  async listForAccount(accountId: string): Promise<User[]> {
    return this.users.find({ where: { accountId }, order: { createdAt: 'ASC' } });
  }

  /**
   * A Company Admin invites a Normal User into their OWN company only --
   * the caller's accountId is always the inviter's own (see TeamController,
   * which derives it from @CurrentAccount(), never from client input), so
   * there is no way to invite into a different company. Pre-creates the
   * User row (role='user') with no password/session of its own; the
   * invitee picks it up on their own first magic-code (or Google) login
   * for that exact email, which then just resolves this existing row
   * instead of creating a new solo Account for them.
   */
  async inviteUser(accountId: string, email: string): Promise<User> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('This email is already registered to an account.');
    }

    const user = this.users.create({ email, accountId, role: Role.USER });
    return this.users.save(user);
  }

  /**
   * Removes a Normal User from the caller's OWN company only: `accountId`
   * must match the target user's accountId, enforced here (not left to
   * the caller), so a Company Admin can never remove -- or even discover
   * the existence of -- a user belonging to a different company. Only
   * role='user' targets are removable this way; Company Admins and
   * Superadmins cannot be removed through this path.
   */
  async removeUser(accountId: string, userId: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || user.accountId !== accountId) {
      throw new NotFoundException('User not found in your company.');
    }
    if (user.role !== Role.USER) {
      throw new ForbiddenException('Only Normal Users can be removed this way.');
    }
    await this.users.delete(user.id);
  }

  /** Superadmin-only: every Company Admin still awaiting approval. */
  async listPendingCompanyAdmins(): Promise<User[]> {
    return this.users.find({
      where: { role: Role.COMPANY_ADMIN, approvedAt: IsNull() },
      relations: ['account'],
      order: { createdAt: 'ASC' },
    });
  }

  async approveCompanyAdmin(userId: string, approvedByUserId: string): Promise<User> {
    const user = await this.findByIdOrThrow(userId);
    if (user.role !== Role.COMPANY_ADMIN) {
      throw new ForbiddenException('Only a Company Admin can be approved.');
    }
    user.approvedAt = new Date();
    user.approvedById = approvedByUserId;
    return this.users.save(user);
  }

  /**
   * Rejecting a pending Company Admin deletes their whole (never-yet-used)
   * Account -- which cascades to delete the Company row and the User row
   * with it (see migrations' ON DELETE CASCADE). Safe to do unconditionally
   * here because an unapproved Company Admin cannot have created ANY data
   * yet (every AccountGuard-protected route rejects them -- see
   * AccountGuard's approval gate), so there is nothing else to clean up.
   */
  async rejectCompanyAdmin(userId: string): Promise<void> {
    const user = await this.findByIdOrThrow(userId);
    if (user.role !== Role.COMPANY_ADMIN || user.approvedAt) {
      throw new ForbiddenException('Only a pending Company Admin can be rejected.');
    }
    await this.accountsService.remove(user.accountId);
  }
}
