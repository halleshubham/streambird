import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { AccountsService } from '../accounts/accounts.service';

function inMemoryUserRepo() {
  const rows = new Map<string, User>();
  let counter = 0;
  return {
    rows,
    create: jest.fn((v: Partial<User>) => ({ ...v }) as User),
    save: jest.fn(async (v: User) => {
      if (!v.id) v.id = `user_${++counter}`;
      rows.set(v.id, v);
      return v;
    }),
    findOne: jest.fn(async ({ where }: any) => {
      const match = [...rows.values()].find((r: any) =>
        Object.entries(where).every(([k, val]) => r[k] === val),
      );
      if (!match) return null;
      // relations: ['account'] -- the real repo would join it; the fake
      // account-bearing shape is attached directly onto the stored row by
      // findOrCreateForEmail below.
      return match;
    }),
  };
}

describe('UsersService', () => {
  async function build() {
    const users = inMemoryUserRepo();
    let accountCounter = 0;
    const accountsService = {
      create: jest.fn(async ({ name }: { name: string }) => {
        const account = { id: `acc_${++accountCounter}`, name };
        return { account, apiKey: 'sb_fake' };
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: AccountsService, useValue: accountsService },
      ],
    }).compile();

    return { service: moduleRef.get(UsersService), users, accountsService };
  }

  it('creates exactly one Account+User pair on first-ever login for an email', async () => {
    const { service, accountsService } = await build();

    const { user, account } = await service.findOrCreateForEmail('New@Example.com');

    expect(accountsService.create).toHaveBeenCalledTimes(1);
    expect(user.email).toBe('New@Example.com');
    expect(user.accountId).toBe(account.id);
  });

  it('a returning email resolves the same User/Account instead of creating a new pair', async () => {
    const { service, accountsService, users } = await build();

    const first = await service.findOrCreateForEmail('repeat@example.com');
    // Simulate the real repo's relations:['account'] join for the second lookup.
    users.rows.get(first.user.id)!.account = first.account as any;

    const second = await service.findOrCreateForEmail('repeat@example.com');

    expect(accountsService.create).toHaveBeenCalledTimes(1);
    expect(second.user.id).toBe(first.user.id);
    expect(second.account.id).toBe(first.account.id);
  });
});
