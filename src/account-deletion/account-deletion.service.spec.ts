import { ConflictException, ForbiddenException, BadGatewayException, BadRequestException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { Role } from '../common/enums/role.enum';
import { StreamStatus } from '../common/enums/stream-status.enum';

const account = { id: 'acc_1' } as any;
const person = (id: string, role: Role, email = `${id}@x.test`) => ({ id, email, role, accountId: 'acc_1' }) as any;

function build(members: any[]) {
  const calls: string[] = [];
  const queries: string[] = [];
  const manager = { query: jest.fn(async (sql: string) => { queries.push(sql); return sql.startsWith('SELECT 1 FROM payments') ? [] : []; }) };
  const dataSource = { transaction: jest.fn(async (fn: any) => { calls.push('tx'); return fn(manager); }) };
  const users = { find: jest.fn(async () => members) };
  const liveStreams = { count: jest.fn(async () => 1), find: jest.fn(async () => [{ id: 's_live', status: StreamStatus.LIVE, isScheduledEvent: false }, { id: 's_sched', status: StreamStatus.SCHEDULED, isScheduledEvent: true }]) };
  const connections = { count: jest.fn(async () => 2) };
  const auth = {
    sendDeletionCode: jest.fn(async () => { calls.push('sendCode'); }),
    checkDeletionCode: jest.fn(async (_e: string, _c: string, o: { consume: boolean }) => { calls.push(o.consume ? 'consumeCode' : 'peekCode'); }),
  };
  const billing = {
    cancelAllForAccountDeletion: jest.fn(async () => { calls.push('cancelAutopay'); return 1; }),
    activeSubscriptionSummary: jest.fn(async () => ({ plan: 'Pro', nextRenewal: '2030-01-01T00:00:00.000Z' })),
  };
  const streams = { end: jest.fn(async (id: string) => { calls.push(`end:${id}`); }) };
  const scheduling = { cancel: jest.fn(async (_a: any, id: string) => { calls.push(`cancel:${id}`); }) };
  const platformConnections = { revokeAllAtProvider: jest.fn(async () => { calls.push('revoke'); }) };
  const assets = {
    countForAccount: jest.fn(async () => 3),
    storageKeysForAccount: jest.fn(async () => ['k1', 'k2']),
    deleteStoredObjects: jest.fn(async () => { calls.push('deleteObjects'); return { deleted: 2, failed: 0 }; }),
  };
  const audit = { logAnonymous: jest.fn(async () => undefined) };
  const email = { sendAccountDeletedNotice: jest.fn(async () => undefined) };
  const service = new AccountDeletionService(
    dataSource as any, users as any, liveStreams as any, connections as any, auth as any, billing as any,
    streams as any, scheduling as any, platformConnections as any, assets as any, audit as any, email as any,
  );
  return { service, calls, queries, manager, dataSource, auth, billing, streams, scheduling, assets, audit, email, platformConnections };
}

describe('AccountDeletionService', () => {
  describe('scope and preview', () => {
    it('the only company admin is the owner; a normal member is not', async () => {
      const admin = person('a', Role.COMPANY_ADMIN);
      const member = person('m', Role.USER);
      const { service } = build([admin, member]);
      expect(await service.preview(admin, account)).toEqual({
        isOnlyAdmin: true, memberCount: 2, activeSubscription: { plan: 'Pro', nextRenewal: '2030-01-01T00:00:00.000Z' }, liveStream: true, connectionsCount: 2, assetsCount: 3,
      });
      expect(await service.preview(member, account)).toEqual({
        isOnlyAdmin: false, memberCount: 2, activeSubscription: null, liveStream: false, connectionsCount: 0, assetsCount: 0,
      });
    });

    it('a second company admin makes each admin a plain member; a lone normal user is the owner', async () => {
      const a = person('a', Role.COMPANY_ADMIN);
      const b = person('b', Role.COMPANY_ADMIN);
      expect((await build([a, b]).service.preview(a, account)).isOnlyAdmin).toBe(false);
      const solo = person('s', Role.USER);
      expect((await build([solo]).service.preview(solo, account)).isOnlyAdmin).toBe(true);
    });

    it('refuses a superadmin, or an account that has one on it', async () => {
      const sa = person('x', Role.SUPERADMIN);
      await expect(build([sa]).service.preview(sa, account)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(build([sa]).service.requestCode(sa)).rejects.toBeInstanceOf(ForbiddenException);
      const admin = person('a', Role.COMPANY_ADMIN);
      await expect(build([admin, sa]).service.delete(admin, account, { code: '123456', confirmCompanyDeletion: true })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('a wrong code stops everything before any side effect', async () => {
      const admin = person('a', Role.COMPANY_ADMIN);
      const t = build([admin]);
      t.auth.checkDeletionCode.mockRejectedValueOnce(new BadRequestException('Incorrect code.'));
      await expect(t.service.delete(admin, account, { code: '000000' })).rejects.toBeInstanceOf(BadRequestException);
      expect(t.billing.cancelAllForAccountDeletion).not.toHaveBeenCalled();
      expect(t.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('the only admin of a company with members gets a 409 without the confirmation, with the code left unused', async () => {
      const admin = person('a', Role.COMPANY_ADMIN);
      const t = build([admin, person('m', Role.USER)]);
      await expect(t.service.delete(admin, account, { code: '123456' })).rejects.toBeInstanceOf(ConflictException);
      expect(t.calls).toEqual(['peekCode']);
      expect(t.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('a member deletes only their own user: no autopay, no streams, no company data', async () => {
      const member = person('m', Role.USER);
      const t = build([person('a', Role.COMPANY_ADMIN), member]);
      await t.service.delete(member, account, { code: '123456' });
      expect(t.billing.cancelAllForAccountDeletion).not.toHaveBeenCalled();
      expect(t.streams.end).not.toHaveBeenCalled();
      expect(t.queries.join('\n')).toContain('DELETE FROM users WHERE id');
      expect(t.queries.join('\n')).not.toContain('live_streams');
      expect(t.email.sendAccountDeletedNotice).toHaveBeenCalledTimes(1);
    });

    it('the company path cancels the autopay BEFORE using the code or deleting anything, and files go after the rows', async () => {
      const admin = person('a', Role.COMPANY_ADMIN);
      const t = build([admin, person('m', Role.USER)]);
      await t.service.delete(admin, account, { code: '123456', confirmCompanyDeletion: true });
      expect(t.calls).toEqual(['peekCode', 'cancelAutopay', 'consumeCode', 'end:s_live', 'cancel:s_sched', 'revoke', 'tx', 'deleteObjects']);
      const order = t.queries.map((q) => q.match(/(?:FROM|UPDATE) (\w+)/)?.[1]);
      expect(order.indexOf('live_streams')).toBeLessThan(order.indexOf('platform_connections'));
      expect(order.indexOf('brand_kits')).toBeLessThan(order.indexOf('assets'));
      expect(t.email.sendAccountDeletedNotice).toHaveBeenCalledWith('a@x.test', { companyDeleted: false });
      expect(t.email.sendAccountDeletedNotice).toHaveBeenCalledWith('m@x.test', { companyDeleted: true });
      const auditArgs = JSON.stringify(t.audit.logAnonymous.mock.calls);
      expect(auditArgs).not.toContain('@x.test');
    });

    it('if the autopay cannot be cancelled nothing else happens and the code is not used', async () => {
      const admin = person('a', Role.COMPANY_ADMIN);
      const t = build([admin]);
      t.billing.cancelAllForAccountDeletion.mockRejectedValueOnce(new BadGatewayException('nothing was deleted'));
      await expect(t.service.delete(admin, account, { code: '123456' })).rejects.toBeInstanceOf(BadGatewayException);
      expect(t.calls).toEqual(['peekCode']);
      expect(t.dataSource.transaction).not.toHaveBeenCalled();
      expect(t.audit.logAnonymous).toHaveBeenCalledWith('account_delete_aborted', 'account', 'acc_1', expect.any(Object));
    });

    it('a stream that will not end does not block the deletion; revoke failures are only logged', async () => {
      const admin = person('a', Role.COMPANY_ADMIN);
      const t = build([admin]);
      t.streams.end.mockRejectedValue(new Error('boom'));
      t.scheduling.cancel.mockRejectedValue(new Error('boom'));
      t.platformConnections.revokeAllAtProvider.mockRejectedValue(new Error('google down'));
      await expect(t.service.delete(admin, account, { code: '123456' })).resolves.toBeUndefined();
      expect(t.dataSource.transaction).toHaveBeenCalled();
    });
  });
});
