import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';

describe('AccountsService', () => {
  let service: AccountsService;
  let repo: jest.Mocked<Repository<Account>>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: getRepositoryToken(Account),
          useValue: {
            create: jest.fn((v) => v),
            save: jest.fn(async (v) => ({ id: 'acc_1', ...v })),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AccountsService);
    repo = moduleRef.get(getRepositoryToken(Account));
  });

  it('creates an account and returns a raw API key that is never stored', async () => {
    const { account, apiKey } = await service.create({ name: 'Acme' });

    expect(apiKey).toMatch(/^sb_[0-9a-f]{64}$/);
    expect(account.name).toBe('Acme');
    expect((repo.save as jest.Mock).mock.calls[0][0].apiKeyHash).not.toBe(apiKey);
  });

  it('looks up an account by hashing the presented API key', async () => {
    const { apiKey } = await service.create({ name: 'Acme' });
    const expectedHash = (repo.save as jest.Mock).mock.calls[0][0].apiKeyHash;

    (repo.findOne as jest.Mock).mockResolvedValue({ id: 'acc_1', name: 'Acme' });
    await service.findByApiKey(apiKey);

    expect(repo.findOne).toHaveBeenCalledWith({ where: { apiKeyHash: expectedHash } });
  });

  it('returns null for an unknown API key', async () => {
    (repo.findOne as jest.Mock).mockResolvedValue(null);
    const result = await service.findByApiKey('sb_does-not-exist');
    expect(result).toBeNull();
  });
});
