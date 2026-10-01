import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  function buildService(repoOverrides?: Partial<{ save: jest.Mock; create: jest.Mock; find: jest.Mock }>) {
    const repo = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'entry_1', ...v })),
      find: jest.fn(),
      ...repoOverrides,
    };
    return { service: new AuditLogService(repo as any), repo };
  }

  it('log() records the actor, action, target, and metadata', async () => {
    const { service, repo } = buildService();
    const actor = { id: 'admin_1' } as any;

    await service.log(actor, 'suspend_account', 'account', 'acc_1', { reason: 'abuse' });

    expect(repo.create).toHaveBeenCalledWith({
      actorUserId: 'admin_1',
      action: 'suspend_account',
      targetType: 'account',
      targetId: 'acc_1',
      metadata: { reason: 'abuse' },
    });
    expect(repo.save).toHaveBeenCalled();
  });

  it('log() never throws even if the underlying write fails -- an audit-log failure must never block the real action', async () => {
    const { service } = buildService({ save: jest.fn().mockRejectedValue(new Error('db down')) });
    const actor = { id: 'admin_1' } as any;

    await expect(service.log(actor, 'approve_company_admin', 'user', 'u1')).resolves.toBeUndefined();
  });

  it('list() returns entries newest-first with the given pagination', async () => {
    const { service, repo } = buildService({ find: jest.fn().mockResolvedValue([{ id: 'e1' }]) });

    const result = await service.list(25, 10);

    expect(repo.find).toHaveBeenCalledWith({
      order: { createdAt: 'DESC' },
      take: 25,
      skip: 10,
    });
    expect(result).toEqual([{ id: 'e1' }]);
  });
});
