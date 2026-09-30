import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Account } from './entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';

const API_KEY_PREFIX = 'sb_';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
  ) {}

  /**
   * Returns the newly created account plus the ONE-TIME raw API key.
   * Only its sha256 hash is ever persisted.
   */
  async create(dto: CreateAccountDto): Promise<{ account: Account; apiKey: string }> {
    const apiKey = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
    const apiKeyHash = this.hashApiKey(apiKey);

    const account = this.accounts.create({
      name: dto.name,
      apiKeyHash,
    });
    await this.accounts.save(account);

    return { account, apiKey };
  }

  async findByApiKey(apiKey: string): Promise<Account | null> {
    const apiKeyHash = this.hashApiKey(apiKey);
    return this.accounts.findOne({ where: { apiKeyHash } });
  }

  async findByIdOrThrow(id: string): Promise<Account> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return account;
  }

  /**
   * Deletes an Account outright, cascading to every row that references
   * it (users, companies, platform_connections, live_streams, ... -- all
   * ON DELETE CASCADE). Only ever called today for rejecting a pending,
   * never-yet-used Company Admin signup (see
   * UsersService.rejectCompanyAdmin) -- never on an account with real
   * usage history.
   */
  async remove(id: string): Promise<void> {
    await this.accounts.delete(id);
  }

  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }
}
