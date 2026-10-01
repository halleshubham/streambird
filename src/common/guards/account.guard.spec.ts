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
  }): { context: ExecutionContext; request: any } {
    const request: any = {
      headers: {
        ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
      },
      cookies: opts.cookieToken ? { sb_session: opts.cookieToken } : {},
      method: opts.method ?? 'GET',
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  function buildGuard(opts: {
    account?: any;
    resolvedUser?: any;
    publicBaseUrl?: string;
  }) {
    const accountsService = {
      findByApiKey: jest.fn(async () => opts.account ?? null),
    };
    const authService = {
      resolveSession: jest.fn(async () =>
        opts.resolvedUser
          ? { user: opts.resolvedUser, account: opts.resolvedUser.account }
          : null,
      ),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'publicBaseUrl' ? opts.publicBaseUrl ?? 'https://app.example.com' : undefined,
      ),
    };
    const guard = new AccountGuard(accountsService as any, authService as any, config as any);
    return { guard, accountsService, authService };
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
});
