import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnection } from './entities/platform-connection.entity';

describe('PlatformConnectionsService', () => {
  let service: PlatformConnectionsService;
  let repo: { find: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    repo = { find: jest.fn(), delete: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConnectionsService,
        { provide: getRepositoryToken(PlatformConnection), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(PlatformConnectionsService);
  });

  it('lists only active connections for the given account', async () => {
    repo.find.mockResolvedValue([{ id: 'c1' }]);
    const result = await service.findAllForAccount('acc_1');

    expect(repo.find).toHaveBeenCalledWith({
      where: { accountId: 'acc_1', isActive: true },
    });
    expect(result).toEqual([{ id: 'c1' }]);
  });

  it('removes a connection scoped to the requesting account', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.remove('c1', 'acc_1');
    expect(repo.delete).toHaveBeenCalledWith({ id: 'c1', accountId: 'acc_1' });
  });

  it('throws NotFoundException when nothing matched the account-scoped delete', async () => {
    repo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.remove('c1', 'acc_1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
