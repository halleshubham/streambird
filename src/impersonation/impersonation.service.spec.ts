import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import {
  BlockedWhenImpersonating,
  BLOCKED_WHEN_IMPERSONATING_KEY,
  IMPERSONATION_BLOCK_CATEGORIES,
  impersonationBlockMessage,
  START_STOP_MESSAGE,
} from './blocked-when-impersonating';
import { IMPERSONATION_TTL_MS, ImpersonationService } from './impersonation.service';

/** Matches a TypeORM-style `where` (plain values, IsNull, LessThanOrEqual) against plain rows. */
function matches(row: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v instanceof FindOperator) {
      if (v.type === 'isNull') return row[k] === null || row[k] === undefined;
      if (v.type === 'lessThanOrEqual') return row[k] <= (v as any).value;
      throw new Error(`unsupported operator ${v.type}`);
    }
    return row[k] === v;
  });
}

function fakeRepo<T extends { id?: string }>(rows: T[] = []) {
  let n = 0;
  return {
    rows,
    create: (v: any) => ({ ...v }),
    save: jest.fn(async (v: any) => {
      if (!v.id) {
        v.id = `id_${++n}`;
        rows.push(v);
      }
      return v;
    }),
    find: jest.fn(async (opts: any = {}) => rows.filter((r) => matches(r, opts.where ?? {}))),
    findOne: jest.fn(async (opts: any) => rows.find((r) => matches(r, opts.where)) ?? null),
    update: jest.fn(async (where: any, patch: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
  };
}

const FAR = new Date('2040-01-01T00:00:00Z');
/** The admin's own login sessions ('s' and 'adm_sess' are the ids the tests start support sessions with). */
const LOGINS = () => ['s', 'adm_sess'].map((id) => ({ id, userId: 'admin', revokedAt: null, expiresAt: FAR }));

describe('ImpersonationService', () => {
  const t0 = new Date('2030-01-01T10:00:00Z');
  const admin: any = { id: 'admin', role: Role.SUPERADMIN, accountId: 'acc_admin' };
  const customer: any = { id: 'cust', email: 'c@x.dev', role: Role.COMPANY_ADMIN, accountId: 'acc_c', approvedAt: t0, suspendedAt: null, displayName: 'Cee' };
  const account: any = { id: 'acc_c', name: 'Acme', deletedAt: null, suspendedAt: null };
  customer.account = account;

  function build(over: { users?: any[]; accounts?: any[]; audit?: Partial<{ log: jest.Mock; logStrict: jest.Mock; logAnonymous: jest.Mock }> } = {}) {
    const sessions = fakeRepo<any>();
    const users = fakeRepo<any>(over.users ?? [customer]);
    const accounts = fakeRepo<any>(over.accounts ?? [account]);
    const logins = fakeRepo<any>(LOGINS());
    const companies = fakeRepo<any>([{ id: 'co', accountId: 'acc_c', name: 'Acme Inc' }]);
    const audit = { log: jest.fn(async () => undefined), logStrict: jest.fn(async () => undefined), logAnonymous: jest.fn(async () => undefined), ...over.audit };
    const service = new ImpersonationService(sessions as any, users as any, accounts as any, companies as any, logins as any, audit as any);
    let now = t0;
    service.now = () => now;
    return { service, sessions, users, accounts, audit, logins, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  }

  describe('start', () => {
    it('creates a 30 minute session bound to the admin login and records it', async () => {
      const { service, sessions, audit } = build();
      const info = await service.start(admin, 'adm_sess', { userId: 'cust', mode: 'act', reason: 'ticket 12' }, { ip: '1.2.3.4', userAgent: 'UA/1' });
      expect(info).toMatchObject({ mode: 'act', reason: 'ticket 12', target: { userId: 'cust', email: 'c@x.dev', accountName: 'Acme', companyName: 'Acme Inc' } });
      expect(info.expiresAt.getTime() - info.startedAt.getTime()).toBe(IMPERSONATION_TTL_MS);
      expect(IMPERSONATION_TTL_MS).toBe(30 * 60_000);
      const row = sessions.rows[0];
      expect(row).toMatchObject({ adminUserId: 'admin', adminSessionId: 'adm_sess', targetUserId: 'cust', targetAccountId: 'acc_c', ipAddress: '1.2.3.4' });
      expect(row.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain('UA/1');
      expect(audit.logStrict).toHaveBeenCalledWith('admin', 'impersonation_started', 'account', 'acc_c', expect.objectContaining({ mode: 'act', sessionId: row.id }));
    });

    it('opens an account as its company admin', async () => {
      const plain = { id: 'u0', role: Role.USER, accountId: 'acc_c', approvedAt: t0, createdAt: new Date(0) };
      const { service } = build({ users: [plain, customer] });
      const info = await service.start(admin, 's', { accountId: 'acc_c', mode: 'view' });
      expect(info.target.userId).toBe('cust');
    });

    it('starting a new session ends the old one (one active session per admin)', async () => {
      const { service, sessions, audit } = build();
      const first = await service.start(admin, 's', { userId: 'cust', mode: 'view' });
      await service.start(admin, 's', { userId: 'cust', mode: 'act' });
      expect(sessions.rows.filter((r) => !r.endedAt)).toHaveLength(1);
      const old = sessions.rows.find((r) => r.id === first.id);
      expect(old).toMatchObject({ endReason: 'replaced' });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin' }), 'impersonation_ended', 'account', 'acc_c', expect.objectContaining({ endReason: 'replaced' }));
    });

    it('refuses a non-superadmin, a missing login session, both/neither id and a bad mode', async () => {
      const { service } = build();
      await expect(service.start(customer, 's', { userId: 'cust', mode: 'view' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.start(admin, null, { userId: 'cust', mode: 'view' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.start(admin, 's', { mode: 'view' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.start(admin, 's', { userId: 'cust', accountId: 'acc_c', mode: 'view' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.start(admin, 's', { userId: 'cust', mode: 'root' as any })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cannot target a superadmin, yourself, or your own account', async () => {
      const other: any = { id: 'adm2', role: Role.SUPERADMIN, accountId: 'acc_2', account: { id: 'acc_2', deletedAt: null } };
      const mine: any = { id: 'adm_colleague', role: Role.USER, accountId: 'acc_admin', approvedAt: t0, account: { id: 'acc_admin', deletedAt: null } };
      const { service } = build({ users: [customer, other, { ...admin, account: { id: 'acc_admin', deletedAt: null } }, mine] });
      await expect(service.start(admin, 's', { userId: 'adm2', mode: 'view' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.start(admin, 's', { userId: 'admin', mode: 'view' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.start(admin, 's', { userId: 'adm_colleague', mode: 'view' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 for an unknown or deleted target; pending approval is refused', async () => {
      const gone = { ...account, id: 'acc_gone', deletedAt: new Date() };
      const goneUser: any = { id: 'ug', role: Role.USER, accountId: 'acc_gone', approvedAt: t0, account: gone };
      const pending: any = { id: 'up', role: Role.USER, accountId: 'acc_p', approvedAt: null, account: { id: 'acc_p', deletedAt: null } };
      const { service } = build({ users: [customer, goneUser, pending], accounts: [account, gone] });
      await expect(service.start(admin, 's', { userId: 'nobody', mode: 'view' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.start(admin, 's', { userId: 'ug', mode: 'view' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.start(admin, 's', { accountId: 'acc_gone', mode: 'view' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.start(admin, 's', { userId: 'up', mode: 'view' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('a suspended account can be viewed but not acted on', async () => {
      const sus = { ...customer, account: { ...account, suspendedAt: new Date() } };
      const { service } = build({ users: [sus] });
      await expect(service.start(admin, 's', { userId: 'cust', mode: 'act' })).rejects.toBeInstanceOf(ConflictException);
      const info = await service.start(admin, 's', { userId: 'cust', mode: 'view' });
      expect(info.target.suspended).toBe(true);
    });

    it('fails closed: when the audit entry cannot be written no session stays active', async () => {
      const { service, sessions } = build({ audit: { logStrict: jest.fn(async () => Promise.reject(new Error('db down'))) } });
      await expect(service.start(admin, 's', { userId: 'cust', mode: 'view' })).rejects.toBeInstanceOf(ConflictException);
      expect(sessions.rows.filter((r) => !r.endedAt)).toHaveLength(0);
    });
  });

  describe('resolveForGuard / expiry / end', () => {
    it('resolves the target for the same admin login only', async () => {
      const { service } = build();
      await service.start(admin, 'adm_sess', { userId: 'cust', mode: 'act' });
      const ok = await service.resolveForGuard('adm_sess', admin);
      expect(ok?.user.id).toBe('cust');
      expect(ok?.account.id).toBe('acc_c');
      expect(await service.resolveForGuard('another_login_of_the_same_admin', admin)).toBeNull();
      expect(await service.resolveForGuard('adm_sess', { ...admin, id: 'someone_else' })).toBeNull();
    });

    it('expires after 30 minutes, ends the row once and writes one audit entry', async () => {
      const { service, advance, sessions, audit } = build();
      await service.start(admin, 'adm_sess', { userId: 'cust', mode: 'act' });
      advance(IMPERSONATION_TTL_MS - 1000);
      expect(await service.resolveForGuard('adm_sess', admin)).not.toBeNull();
      advance(1000);
      expect(await service.resolveForGuard('adm_sess', admin)).toBeNull();
      expect(await service.resolveForGuard('adm_sess', admin)).toBeNull();
      expect(sessions.rows[0]).toMatchObject({ endReason: 'expired' });
      expect(audit.log.mock.calls.filter((c: any[]) => c[1] === 'impersonation_ended')).toHaveLength(1);
      expect(await service.current(admin, 'adm_sess')).toBeNull();
    });

    it('sweepExpired ends sessions nobody asked about', async () => {
      const { service, advance, sessions } = build();
      await service.start(admin, 'adm_sess', { userId: 'cust', mode: 'view' });
      expect(await service.sweepExpired()).toBe(0);
      advance(IMPERSONATION_TTL_MS);
      expect(await service.sweepExpired()).toBe(1);
      expect(sessions.rows[0].endReason).toBe('expired');
    });

    it('is ignored (and ended) when the admin is no longer a superadmin or the target is gone', async () => {
      const a = build();
      await a.service.start(admin, 'adm_sess', { userId: 'cust', mode: 'act' });
      expect(await a.service.resolveForGuard('adm_sess', { ...admin, role: Role.USER })).toBeNull();
      expect(a.sessions.rows[0].endReason).toBe('invalid');

      const b = build();
      await b.service.start(admin, 'adm_sess', { userId: 'cust', mode: 'act' });
      b.users.rows.splice(0, b.users.rows.length);
      expect(await b.service.resolveForGuard('adm_sess', admin)).toBeNull();
      expect(b.sessions.rows[0].endReason).toBe('target_gone');
    });

    it('exit ends the session and is idempotent; logout ends the session of that login only', async () => {
      const { service, sessions, audit } = build();
      await service.start(admin, 'adm_sess', { userId: 'cust', mode: 'act' });
      await service.end(admin);
      await service.end(admin);
      expect(sessions.rows[0].endReason).toBe('exit');
      expect(audit.log.mock.calls.filter((c: any[]) => c[1] === 'impersonation_ended')).toHaveLength(1);
      expect(await service.resolveForGuard('adm_sess', admin)).toBeNull();

      await service.start(admin, 'adm_sess', { userId: 'cust', mode: 'act' });
      await service.endForAdminSession('other_login');
      expect(await service.resolveForGuard('adm_sess', admin)).not.toBeNull();
      await service.endForAdminSession('adm_sess');
      expect(await service.resolveForGuard('adm_sess', admin)).toBeNull();
    });
  });

  describe('audit entries', () => {
    const imp = { sessionId: 's1', mode: 'act' as const, adminUserId: 'admin', targetUserId: 'cust', targetAccountId: 'acc_c' };
    const uuid = '3f2b6a52-0c1e-4b8e-9d57-1a2b3c4d5e6f';

    it('intent (strict, before the handler) and result carry ids, method, route template and UUID params only', async () => {
      const { service, audit } = build();
      await service.recordIntent(imp, { method: 'PATCH', route: '/api/brand-kits/:id', params: { id: uuid, token: 'not-a-uuid-secret' } });
      await service.recordResult(imp, { method: 'PATCH', route: '/api/brand-kits/:id', params: { id: uuid }, status: 200 });
      expect(audit.logStrict).toHaveBeenCalledWith('admin', 'impersonated_action', 'account', 'acc_c', {
        sessionId: 's1', mode: 'act', targetUserId: 'cust', targetAccountId: 'acc_c', method: 'PATCH', route: '/api/brand-kits/:id', resourceIds: [uuid], phase: 'intent',
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin' }), 'impersonated_action_result', 'account', 'acc_c', expect.objectContaining({ status: 200, resourceIds: [uuid] }));
      expect(JSON.stringify(audit.logStrict.mock.calls)).not.toContain('not-a-uuid-secret');
    });

    it('fails closed: when the intent cannot be written the action is refused with 503', async () => {
      const { service } = build({ audit: { logStrict: jest.fn(async () => Promise.reject(new Error('db down'))) } });
      await expect(service.recordIntent(imp, { method: 'POST', route: '/api/presets' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('a refused request is one entry with its reason; a read is logged once per (session, route)', async () => {
      const { service, audit } = build();
      await service.recordRefused(imp, { method: 'POST', route: '/api/billing/orders', blocked: 'billing' });
      expect(audit.log).toHaveBeenCalledWith(expect.anything(), 'impersonated_action', 'account', 'acc_c', expect.objectContaining({ status: 403, blocked: 'billing' }));
      audit.log.mockClear();
      await service.recordRead(imp, { method: 'GET', route: '/api/brand-kits', status: 200 });
      await service.recordRead(imp, { method: 'GET', route: '/api/brand-kits', status: 200 });
      await service.recordRead(imp, { method: 'GET', route: '/api/presets', status: 200 });
      await service.recordRead({ ...imp, sessionId: 's2' }, { method: 'GET', route: '/api/brand-kits', status: 200 });
      expect(audit.log.mock.calls.map((c: any[]) => c[1])).toEqual(['impersonated_read', 'impersonated_read', 'impersonated_read']);
    });

    it('endForTarget ends the sessions on a customer that is being deleted, with an audit entry', async () => {
      const { service, sessions, audit } = build();
      await service.start(admin, 's', { userId: 'cust', mode: 'act' });
      await service.endForTarget({ accountId: 'acc_c' });
      expect(sessions.rows[0].endReason).toBe('target_gone');
      expect(audit.log.mock.calls.filter((c: any[]) => c[1] === 'impersonation_ended')).toHaveLength(1);
    });

    it('an ended row whose admin is gone is still audited (anonymous actor, email kept)', async () => {
      const { service, sessions, audit } = build();
      await service.start(admin, 's', { userId: 'cust', mode: 'act' });
      sessions.rows[0].adminUserId = null;
      await service.endForAdminSession('s');
      expect(audit.logAnonymous).toHaveBeenCalledWith('impersonation_ended', 'account', 'acc_c', expect.objectContaining({ endReason: 'logout' }));
    });
  });
});

describe('ImpersonationService: live studio control checks', () => {
  const t0 = new Date('2030-01-01T10:00:00Z');
  const admin: any = { id: 'admin', role: Role.SUPERADMIN, accountId: 'acc_admin' };
  const account: any = { id: 'acc_c', name: 'Acme', deletedAt: null, suspendedAt: null };
  const customer: any = { id: 'cust', email: 'c@x.dev', role: Role.COMPANY_ADMIN, accountId: 'acc_c', approvedAt: t0, suspendedAt: null, account };

  function build(audit: any = {}) {
    const sessions = fakeRepo<any>();
    const adminUser: any = { id: 'admin', role: Role.SUPERADMIN, accountId: 'acc_admin', suspendedAt: null, account: { id: 'acc_admin', suspendedAt: null } };
    const users = fakeRepo<any>([customer, adminUser]);
    const accounts = fakeRepo<any>([account]);
    const logins = fakeRepo<any>(LOGINS());
    const a = { log: jest.fn(async () => undefined), logStrict: jest.fn(async () => undefined), logAnonymous: jest.fn(async () => undefined), ...audit };
    const service = new ImpersonationService(sessions as any, users as any, accounts as any, fakeRepo<any>() as any, logins as any, a as any);
    let now = t0;
    service.now = () => now;
    return { service, sessions, accounts, users, logins, audit: a, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  }

  it('accepts an active ACT session, refuses view mode, an ended, an expired and a suspended one', async () => {
    const { service, sessions, accounts, advance } = build();
    const act = await service.start(admin, 's', { userId: 'cust', mode: 'act' });
    expect(await service.checkControlSession(act.id)).toMatchObject({ ok: true });
    accounts.rows[0].suspendedAt = t0;
    expect(await service.checkControlSession(act.id)).toEqual({ ok: false, reason: 'suspended' });
    accounts.rows[0].suspendedAt = null;
    advance(IMPERSONATION_TTL_MS + 1000);
    expect(await service.checkControlSession(act.id)).toEqual({ ok: false, reason: 'expired' });
    expect(sessions.rows[0]).toMatchObject({ endReason: 'expired' });
    expect(await service.checkControlSession(act.id)).toEqual({ ok: false, reason: 'ended' });
    expect(await service.checkControlSession('nope')).toEqual({ ok: false, reason: 'ended' });
    const view = await service.start(admin, 's', { userId: 'cust', mode: 'view' });
    expect(await service.checkControlSession(view.id)).toEqual({ ok: false, reason: 'view' });
  });

  it('the ADMIN is re-checked: demoted, suspended, login revoked or expired = the support session is over (invalid)', async () => {
    for (const breakIt of [
      (c: any) => (c.users.rows.find((u: any) => u.id === 'admin').role = Role.USER),
      (c: any) => (c.users.rows.find((u: any) => u.id === 'admin').suspendedAt = t0),
      (c: any) => (c.users.rows.find((u: any) => u.id === 'admin').account.suspendedAt = t0),
      (c: any) => (c.logins.rows.find((l: any) => l.id === 's').revokedAt = t0),
      (c: any) => (c.logins.rows.find((l: any) => l.id === 's').expiresAt = new Date(0)),
      (c: any) => c.logins.rows.splice(0),
    ]) {
      const c = build();
      const act = await c.service.start(admin, 's', { userId: 'cust', mode: 'act' });
      expect(await c.service.checkControlSession(act.id)).toMatchObject({ ok: true });
      breakIt(c);
      expect(await c.service.checkControlSession(act.id)).toEqual({ ok: false, reason: 'ended' });
      expect(c.sessions.rows[0]).toMatchObject({ endReason: 'invalid' });
    }
  });

  it('tells listeners when a session ends, whatever the reason', async () => {
    const { service } = build();
    const seen: Array<[string, string]> = [];
    const off = service.onSessionEnded((id, reason) => seen.push([id, reason]));
    const info = await service.start(admin, 's', { userId: 'cust', mode: 'act' });
    await service.end(admin);
    expect(seen).toEqual([[info.id, 'exit']]);
    off();
    await service.start(admin, 's', { userId: 'cust', mode: 'act' });
    await service.end(admin);
    expect(seen).toHaveLength(1);
  });

  it('a listener that throws never breaks ending the session', async () => {
    const { service, sessions } = build();
    service.onSessionEnded(() => {
      throw new Error('boom');
    });
    await service.start(admin, 's', { userId: 'cust', mode: 'act' });
    await service.end(admin);
    expect(sessions.rows[0].endedAt).toBeTruthy();
  });

  it('strict studio-control audit throws 503 when the log is down; the lenient one goes through log()', async () => {
    const { service, audit } = build({ logStrict: jest.fn(async () => Promise.reject(new Error('db down'))) });
    await expect(service.recordStudioControl('impersonated_studio_command', 'admin', 'acc_c', { phase: 'intent' }, true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await service.recordStudioControl('impersonated_studio_command', 'admin', 'acc_c', { phase: 'result' }, false);
    expect(audit.log).toHaveBeenCalledWith({ id: 'admin' }, 'impersonated_studio_command', 'account', 'acc_c', { phase: 'result' });
  });
});

describe('blocked-when-impersonating registry', () => {
  it('every category has a plain-language label and the message names it', () => {
    for (const [key, label] of Object.entries(IMPERSONATION_BLOCK_CATEGORIES)) {
      expect(label.length).toBeGreaterThan(5);
      expect(impersonationBlockMessage(key)).toBe(
        key === 'go-live' || key === 'live-control' ? START_STOP_MESSAGE : `Not allowed while acting as a customer: ${label}`,
      );
    }
  });

  it('the decorator stores its category under the key the guard reads', () => {
    class C {
      @BlockedWhenImpersonating('billing')
      m() {}
    }
    expect(Reflect.getMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, C.prototype.m)).toBe('billing');
  });
});
