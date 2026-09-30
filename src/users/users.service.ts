import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly accountsService: AccountsService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email }, relations: ['account'] });
  }

  /**
   * First-ever login for an email creates both the Account (tenant) and
   * the User (login identity) together — a User always owns exactly one
   * Account in this phase. A returning email just resolves the existing
   * pair. No apiKey is surfaced here; AccountsService.create() still
   * mints one for API-key access, it's just not shown to this login flow.
   */
  async findOrCreateForEmail(email: string): Promise<{ user: User; account: Account }> {
    const existing = await this.findByEmail(email);
    if (existing) {
      return { user: existing, account: existing.account };
    }

    const { account } = await this.accountsService.create({ name: email });
    const user = this.users.create({ email, accountId: account.id });
    await this.users.save(user);

    return { user, account };
  }
}
