import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AccountGuard } from './account.guard';
import { Role } from '../enums/role.enum';

/**
 * This is the single most security-critical check in the whole 3-tier
 * role system: AccountGuard is what every existing protected controller
 * (streams, platform-connections, studio-sessions, accounts) already
 * relies on for auth, so the approval gate is baked directly into it
 * (see account.guard.ts) rather than a separate opt-in guard a route
 * could forget to add. Every non-Superadmin role is gated now (a
 * brand-new solo signup exactly like a new Company Admin signup) -- these
 * tests cover an unapproved Company Admin AND an unapproved Normal User
 * both being rejected, an approved one of each being allowed, a
 * Superadmin always allowed regardless, and (separately) that the
 * x-api-key header path -- used by external/programmatic callers -- is
 * completely unaffected, since it never has a `user`/role at all.
 *
 * Tests further down that are specifically about suspension or CSRF
 * deliberately use an APPROVED user (approvedAt set) even where it isn't
 * the thing under test -- otherwise the approval gate would reject the
 * request first and the test would "pass" without ever exercising the
 * logic it's named for.
 */
describe('AccountGuard', () => {
  function buildContext(opts: {
    apiKey?: string;
    cookieToken?: string;
    method?: string;
    origin?: string;
    supportSession?: string;
  }): { context: ExecutionContext; request: any; response: any } {
    const request: any = {
      headers: {
        ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
        ...(opts.supportSession ? { 'x-support-session': opts.supportSession } : {}),
      },
      cookies: opts.cookieToken ? { sb_session: opts.cookieToken } : {},
      method: opts.method ?? 'GET',
    };
    const response: any = { headers: {} as Record<string, unknown>, setHeader(n: string, v: unknown) { this.headers[n.toLowerCase()] = v; } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    return { context, request, response };
  }

  function buildGuard(opts: {
    account?: any;
    resolvedUser?: any;
    publicBaseUrl?: string;
    legacyHosts?: string[];
    impersonation?: any;
    metadata?: Record<string, unknown>;
  }) {
    const accountsService = {
      findByApiKey: jest.fn(async () => opts.account ?? null),
    };
    const authService = {
      resolveSession: jest.fn(async () =>
        opts.resolvedUser
          ? { user: opts.resolvedUser, account: opts.resolvedUser.account, sessionId: 'sess_1' }
          : null,
      ),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'publicBaseUrl'
          ? opts.publicBaseUrl ?? 'https://app.example.com'
          : key === 'legacyHosts'
            ? opts.legacyHosts
            : undefined,
      ),
    };
    const impersonation = opts.impersonation ?? {
      resolveForGuard: jest.fn(async () => null),
      toRequestImpersonation: jest.fn(),
      recordRefused: jest.fn(async () => undefined),
      recordIntent: jest.fn(async () => undefined),
    };
    const reflector = { getAllAndOverride: jest.fn((key: string) => opts.metadata?.[key]) };
    const guard = new AccountGuard(accountsService as any, authService as any, config as any, impersonation as any, reflector as any);
    return { guard, accountsService, authService, impersonation };
  }

  it('rejects an unapproved Company Admin with a 403, even though their session is otherwise valid', async () => {
    const account = { id: 'acc_1' };
    const unapprovedAdmin = { id: 'u1', role: Role.COMPANY_ADMIN, approvedAt: null, account };
    const { guard } = buildGuard({ resolvedUser: unapprovedAdmin });
    const { context } = buildContext({ cookieToken: 'tok', method: 'GET' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an APPROVED Company Admin through', async () => {
    const account = { id: 'acc_1' };
    const approvedAdmin = {
      id: 'u1',
      role: Role.COMPANY_ADMIN,
      approvedAt: new Date(),
      account,
    };
    const { guard } = buildGuard({ resolvedUser: approvedAdmin });
    const { context, request } = buildContext({ cookieToken: 'tok', method: 'GET' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.account).toBe(account);
    expect(request.user).toBe(approvedAdmin);
  });

  it('always allows a Superadmin through, regardless of approvedAt', async () => {
    const account = { id: 'acc_root' };
    const superadmin = { id: 'root', role: Role.SUPERADMIN, approvedAt: null, account };
    const { guard } = buildGuard({ resolvedUser: superadmin });
    const { context } = buildContext({ cookieToken: 'tok', method: 'GET' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects an unapproved Normal User with a 403 -- a brand-new solo signup is gated exactly like a new Company Admin', async () => {
    const account = { id: 'acc_1' };
    const unapprovedUser = { id: 'u2', role: Role.USER, approvedAt: null, account };
    const { guard } = buildGuard({ resolvedUser: unapprovedUser });
    const { context } = buildContext({ cookieToken: 'tok', method: 'GET' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an APPROVED Normal User through', async () => {
    const account = { id: 'acc_1' };
    const approvedUser = { id: 'u2', role: Role.USER, approvedAt: new Date(), account };
    const { guard } = buildGuard({ resolvedUser: approvedUser });
    const { context, request } = buildContext({ cookieToken: 'tok', method: 'GET' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(approvedUser);
  });

  it('rejects when there is no session cookie and no x-api-key header', async () => {
    const { guard } = buildGuard({});
    const { context } = buildContext({ method: 'GET' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('the x-api-key header path is completely unaffected by the approval gate -- it never resolves a user/role at all', async () => {
    const account = { id: 'acc_1', name: 'Acme' };
    const { guard, authService } = buildGuard({ account });
    const { context, request } = buildContext({ apiKey: 'sb_some_key', method: 'POST' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.account).toBe(account);
    expect(request.user).toBeUndefined();
    // Never even attempted to resolve a session/user for the API-key path.
    expect(authService.resolveSession).not.toHaveBeenCalled();
  });

  it('rejects every user on a suspended Account with a 403, regardless of role', async () => {
    const account = { id: 'acc_1', suspendedAt: new Date() };
    // approvedAt set deliberately -- an unapproved user would be rejected
    // by the approval gate first, which would pass this test for the
    // wrong reason without ever exercising the suspension check.
    const approvedUser = { id: 'u2', role: Role.USER, approvedAt: new Date(), account };
    const { guard } = buildGuard({ resolvedUser: approvedUser });
    const { context } = buildContext({ cookieToken: 'tok', method: 'GET' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a suspended User even on an otherwise-active Account', async () => {
    const account = { id: 'acc_1' };
    const suspendedUser = { id: 'u2', role: Role.USER, approvedAt: new Date(), suspendedAt: new Date(), account };
    const { guard } = buildGuard({ resolvedUser: suspendedUser });
    const { context } = buildContext({ cookieToken: 'tok', method: 'GET' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects the x-api-key path too for a suspended Account -- suspension cannot be bypassed by switching auth methods', async () => {
    const account = { id: 'acc_1', suspendedAt: new Date() };
    const { guard } = buildGuard({ account });
    const { context } = buildContext({ apiKey: 'sb_some_key', method: 'GET' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still enforces the pre-existing CSRF origin check on mutating cookie-path requests, unchanged by the approval gate', async () => {
    const account = { id: 'acc_1' };
    // approvedAt set deliberately -- see the suspension tests above for why.
    const approvedUser = { id: 'u2', role: Role.USER, approvedAt: new Date(), account };
    const { guard } = buildGuard({
      resolvedUser: approvedUser,
      publicBaseUrl: 'https://app.example.com',
    });
    const { context } = buildContext({
      cookieToken: 'tok',
      method: 'POST',
      origin: 'https://evil.example.com',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('CSRF origin check across a domain move (LEGACY_HOSTS)', () => {
    const account = { id: 'acc_1' };
    const approvedUser = { id: 'u3', role: Role.USER, approvedAt: new Date(), account };
    const post = (origin: string) => buildContext({ cookieToken: 'tok', method: 'POST', origin });
    const guardWith = (legacyHosts?: string[]) =>
      buildGuard({ resolvedUser: approvedUser, publicBaseUrl: 'https://new.example.com', legacyHosts }).guard;

    it('accepts the canonical origin and an old-domain origin, but nothing else', async () => {
      const guard = guardWith(['old.example.com']);
      await expect(guard.canActivate(post('https://new.example.com').context)).resolves.toBe(true);
      await expect(guard.canActivate(post('https://old.example.com').context)).resolves.toBe(true);
      await expect(guard.canActivate(post('https://evil.example.com').context)).rejects.toBeInstanceOf(ForbiddenException);
      // A look-alike that merely contains the legacy host is still foreign.
      await expect(guard.canActivate(post('https://old.example.com.evil.io').context)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects the old origin once it is no longer listed, and a missing Origin always', async () => {
      const guard = guardWith(undefined);
      await expect(guard.canActivate(post('https://old.example.com').context)).rejects.toBeInstanceOf(ForbiddenException);
      const { context } = buildContext({ cookieToken: 'tok', method: 'POST' });
      await expect(guardWith(['old.example.com']).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('superadmin support sessions (impersonation)', () => {
    const adminAccount = { id: 'acc_admin' };
    const admin = { id: 'admin', role: Role.SUPERADMIN, approvedAt: null, account: adminAccount };
    const targetAccount = { id: 'acc_t', suspendedAt: null };
    const target = { id: 'target', role: Role.COMPANY_ADMIN, approvedAt: new Date(), suspendedAt: null };
    const session = (mode: 'view' | 'act') => ({ id: 'imp_1', mode, adminUserId: 'admin', targetUserId: 'target', targetAccountId: 'acc_t' });
    const impersonation = (mode: 'view' | 'act', over: { account?: any; user?: any } = {}) => ({
      resolveForGuard: jest.fn(async () => ({ session: session(mode), user: over.user ?? target, account: over.account ?? targetAccount })),
      toRequestImpersonation: jest.fn((row: any) => ({ sessionId: row.id, mode: row.mode, adminUserId: row.adminUserId, targetUserId: row.targetUserId, targetAccountId: row.targetAccountId })),
      recordRefused: jest.fn(async () => undefined),
      recordIntent: jest.fn(async () => undefined),
    });
    const origin = 'https://app.example.com';

    it('swaps in the customer as the principal and keeps the admin as the actor', async () => {
      const imp = impersonation('act');
      const { guard } = buildGuard({ resolvedUser: admin, impersonation: imp });
      const { context, request } = buildContext({ cookieToken: 'tok', method: 'POST', origin });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBe(target);
      expect(request.account).toBe(targetAccount);
      expect(request.actor).toBe(admin);
      expect(request.impersonation).toMatchObject({ sessionId: 'imp_1', mode: 'act' });
      expect(imp.resolveForGuard).toHaveBeenCalledWith('sess_1', admin);
    });

    it('a superadmin route always authenticates as the real admin, never the customer', async () => {
      const imp = impersonation('act');
      const { guard } = buildGuard({ resolvedUser: admin, impersonation: imp, metadata: { roles: [Role.SUPERADMIN] } });
      const { context, request } = buildContext({ cookieToken: 'tok', method: 'GET' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBe(admin);
      expect(request.actor).toBeUndefined();
      expect(imp.resolveForGuard).not.toHaveBeenCalled();
    });

    it('without a valid support session the admin stays themselves', async () => {
      const { guard } = buildGuard({ resolvedUser: admin });
      const { context, request } = buildContext({ cookieToken: 'tok', method: 'GET' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBe(admin);
      expect(request.impersonation).toBeUndefined();
    });

    it('never looks up a support session for a non-superadmin', async () => {
      const normal = { id: 'u9', role: Role.USER, approvedAt: new Date(), account: { id: 'acc_9' } };
      const imp = impersonation('act');
      const { guard } = buildGuard({ resolvedUser: normal, impersonation: imp });
      const { context, request } = buildContext({ cookieToken: 'tok', method: 'GET' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(imp.resolveForGuard).not.toHaveBeenCalled();
      expect(request.user).toBe(normal);
    });

    it('view mode: reads pass, every other method is refused with "View-only support session" and recorded', async () => {
      const imp = impersonation('view');
      const { guard } = buildGuard({ resolvedUser: admin, impersonation: imp });
      await expect(guard.canActivate(buildContext({ cookieToken: 'tok', method: 'GET' }).context)).resolves.toBe(true);
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        await expect(guard.canActivate(buildContext({ cookieToken: 'tok', method, origin }).context)).rejects.toThrow('View-only support session');
      }
      expect(imp.recordRefused).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'imp_1' }), expect.objectContaining({ blocked: 'view-only' }));
    });

    it('act mode: the blocked-list marker refuses with the plain-language message, for GET too', async () => {
      const imp = impersonation('act');
      const { guard } = buildGuard({ resolvedUser: admin, impersonation: imp, metadata: { blockedWhenImpersonating: 'billing' } });
      await expect(guard.canActivate(buildContext({ cookieToken: 'tok', method: 'POST', origin }).context)).rejects.toThrow(
        'Not allowed while acting as a customer: payments and plan changes',
      );
      await expect(guard.canActivate(buildContext({ cookieToken: 'tok', method: 'GET' }).context)).rejects.toThrow('Not allowed while acting as a customer');
      expect(imp.recordRefused).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ blocked: 'billing' }));
    });

    it('act mode on a customer suspended after the start is refused; view mode still reads', async () => {
      const suspended = { id: 'acc_t', suspendedAt: new Date() };
      const act = buildGuard({ resolvedUser: admin, impersonation: impersonation('act', { account: suspended }) }).guard;
      await expect(act.canActivate(buildContext({ cookieToken: 'tok', method: 'POST', origin }).context)).rejects.toThrow('suspended');
      const view = buildGuard({ resolvedUser: admin, impersonation: impersonation('view', { account: suspended }) }).guard;
      await expect(view.canActivate(buildContext({ cookieToken: 'tok', method: 'GET' }).context)).resolves.toBe(true);
    });

    it('act mode writes the strict intent entry BEFORE the handler, and a failing audit refuses the request', async () => {
      const imp = impersonation('act');
      const { guard } = buildGuard({ resolvedUser: admin, impersonation: imp });
      await guard.canActivate(buildContext({ cookieToken: 'tok', method: 'PATCH', origin }).context);
      expect(imp.recordIntent).toHaveBeenCalledTimes(1);
      await guard.canActivate(buildContext({ cookieToken: 'tok', method: 'GET' }).context);
      expect(imp.recordIntent).toHaveBeenCalledTimes(1); // reads are not intents
      imp.recordIntent.mockRejectedValueOnce(new Error('Audit log unavailable; action refused'));
      const { context, request } = buildContext({ cookieToken: 'tok', method: 'POST', origin });
      await expect(guard.canActivate(context)).rejects.toThrow('Audit log unavailable');
      expect(request.impersonation).toBeUndefined();
    });

    it('everything in a support session is no-store, even where a handler asks for a cache', async () => {
      const { guard } = buildGuard({ resolvedUser: admin, impersonation: impersonation('view') });
      const { context, response } = buildContext({ cookieToken: 'tok', method: 'GET' });
      await guard.canActivate(context);
      expect(response.headers['cache-control']).toBe('no-store');
      response.setHeader('Cache-Control', 'private, max-age=3600');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('X-Support-Session: the matching active session passes; a missing/other/ended one is a 409 support_session_ended, never the admin own account', async () => {
      const ok = buildGuard({ resolvedUser: admin, impersonation: impersonation('act') }).guard;
      await expect(ok.canActivate(buildContext({ cookieToken: 'tok', method: 'GET', supportSession: 'imp_1' }).context)).resolves.toBe(true);
      await expect(ok.canActivate(buildContext({ cookieToken: 'tok', method: 'GET', supportSession: 'other' }).context)).rejects.toMatchObject({ status: 409 });
      const ended = buildGuard({ resolvedUser: admin }).guard; // no active session any more
      const { context, request } = buildContext({ cookieToken: 'tok', method: 'POST', origin, supportSession: 'imp_1' });
      await expect(ended.canActivate(context)).rejects.toMatchObject({ status: 409, response: { code: 'support_session_ended' } });
      expect(request.user).toBeUndefined();
      // a superadmin route ignores the header (Exit must keep working)
      const sup = buildGuard({ resolvedUser: admin, metadata: { roles: [Role.SUPERADMIN] } }).guard;
      await expect(sup.canActivate(buildContext({ cookieToken: 'tok', method: 'DELETE', origin, supportSession: 'imp_1' }).context)).resolves.toBe(true);
      // and a normal customer carrying the header (e.g. logged in again in that browser) is refused too
      const normal = { id: 'u9', role: Role.USER, approvedAt: new Date(), account: { id: 'acc_9' } };
      await expect(buildGuard({ resolvedUser: normal }).guard.canActivate(buildContext({ cookieToken: 'tok', method: 'GET', supportSession: 'imp_1' }).context)).rejects.toMatchObject({ status: 409 });
    });

    it('the CSRF origin check still applies first, against the real admin request', async () => {
      const { guard } = buildGuard({ resolvedUser: admin, impersonation: impersonation('act') });
      await expect(
        guard.canActivate(buildContext({ cookieToken: 'tok', method: 'POST', origin: 'https://evil.example.com' }).context),
      ).rejects.toThrow('Origin mismatch');
    });

    it('the x-api-key path never impersonates', async () => {
      const imp = impersonation('act');
      const { guard } = buildGuard({ account: { id: 'acc_k' }, impersonation: imp });
      const { context, request } = buildContext({ apiKey: 'sb_k', method: 'GET' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.impersonation).toBeUndefined();
      expect(imp.resolveForGuard).not.toHaveBeenCalled();
    });
  });
});
