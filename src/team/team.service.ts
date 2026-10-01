import { Inject, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';

/**
 * Every method here takes the caller's OWN accountId (always resolved
 * from their session via @CurrentAccount(), never from client input --
 * see TeamController) and passes it straight through to UsersService,
 * which is what actually enforces the company-scoping (see
 * UsersService.inviteUser/removeUser's docstrings). This service is a
 * thin pass-through plus the invite email side-effect.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly usersService: UsersService,
    @Inject(EMAIL_SERVICE) private readonly emailService: EmailService,
  ) {}

  async list(accountId: string): Promise<User[]> {
    return this.usersService.listForAccount(accountId);
  }

  async invite(account: Account, email: string): Promise<User> {
    const user = await this.usersService.inviteUser(account.id, email);
    await this.emailService.sendTeamInvite(user.email, account.name);
    return user;
  }

  async remove(accountId: string, userId: string): Promise<void> {
    await this.usersService.removeUser(accountId, userId);
  }
}
