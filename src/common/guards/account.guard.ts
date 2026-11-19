import {
  CanActivate,
  ExecutionContext,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AccountsService } from '../../accounts/accounts.service';
import { AuthService } from '../../auth/auth.service';
import { Account } from '../../accounts/entities/account.entity';
import { User } from '../../users/entities/user.entity';
import { Role } from '../enums/role.enum';
import { legacyOrigins } from '../legacy-hosts';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  BLOCKED_WHEN_IMPERSONATING_KEY,
  impersonationBlockMessage,
  SUPPORT_SESSION_ENDED_CODE,
  SUPPORT_SESSION_HEADER,
  VIEW_ONLY_MESSAGE,
} from '../../impersonation/blocked-when-impersonating';
import { ImpersonationService, RequestImpersonation } from '../../impersonation/impersonation.service';

export interface AccountRequest extends Request {
  account?: Account;
  user?: User;
  /** Only while a superadmin support session is in effect: the real person (the admin). `user` is then the customer. */
  actor?: User;
  impersonation?: RequestImpersonation;
  /** The caller's own `user_sessions` id (cookie path only). */
  sessionId?: string;
}

const SESSION_COOKIE_NAME = 'sb_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Replaces ApiKeyGuard on every browser-reachable resource controller:
 * accepts either the x-api-key header (programmatic/external use, unchanged
 * behavior) or the sb_session cookie (the web UI). ApiKeyGuard itself stays
 * untouched for anything that only ever wants header auth.
 */
@Injectable()
export class AccountGuard implements CanActivate {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly impersonation: ImpersonationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AccountRequest>();

    const apiKey = request.headers['x-api-key'];
    if (apiKey && !Array.isArray(apiKey)) {
      const account = await this.accountsService.findByApiKey(apiKey);
      if (!account) {
        throw new UnauthorizedException('Invalid API key');
      }
      // Suspension must block the API-key path too -- otherwise it's a
      // trivial bypass of a session-cookie suspension check (just switch
      // to the API key instead).
      if (account.suspendedAt) {
        throw new ForbiddenException('This account has been suspended.');
      }
      request.account = account;
      return true;
    }

    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('Missing x-api-key header or session cookie');
    }

    const resolved = await this.authService.resolveSession(token);
    if (!resolved) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    // Approval gate: every non-Superadmin user needs approvedAt set before
    // they can use ANY route this guard protects -- covers a brand-new
    // solo signup (magic-code or Google, role=user) exactly the same as a
    // new Company Admin, per an explicit decision to gate every new
    // account rather than just company signups (see migrations/0009,
    // which backfills approvedAt for every pre-existing role=user row so
    // this change doesn't lock out accounts that existed before it).
    // UsersService.inviteUser auto-approves a team member added to an
    // ALREADY-approved company at creation time, so this only ever blocks
    // a genuinely brand-new account, never someone joining a company a
    // Superadmin already vetted. This lives here, directly in
    // AccountGuard, rather than as an opt-in decorator on each route -- an
    // opt-in check is one a future route can simply forget to add; baking
    // it into the guard itself means every current AND future
    // AccountGuard-protected route is covered automatically, fail-secure
    // by construction. The account-holder's own pending-status check
    // (GET /api/auth/me) and the Superadmin approval endpoints themselves
    // both intentionally sit behind SessionGuard, not AccountGuard, so
    // they're unaffected by this check.
    if (resolved.user.role !== Role.SUPERADMIN && !resolved.user.approvedAt) {
      throw new ForbiddenException('Your account is pending Superadmin approval.');
    }

    // Suspension gate: a superadmin's abuse-handling lever (see
    // SuperadminController's account/user suspend-reactivate routes), at
    // two independent granularities. Checked for every role including
    // SUPERADMIN itself -- there's no legitimate reason a Superadmin
    // would ever be suspended, but if one somehow were, the gate should
    // still hold rather than carve out a silent exception. The account
    // check is deliberately evaluated whether or not the suspended
    // account is the *acting* user's own -- a suspended company blocks
    // all of its users, full stop.
    if (resolved.account.suspendedAt) {
      throw new ForbiddenException('This account has been suspended.');
    }
    if (resolved.user.suspendedAt) {
      throw new ForbiddenException('Your user account has been suspended.');
    }

    // CSRF: a cookie rides along on any cross-site request automatically,
    // unlike the x-api-key header, which a browser will never attach
    // cross-origin on its own. Reject mutating requests on the cookie path
    // whose Origin doesn't match ours; the header path skips this check
    // entirely since it isn't exposed the same way. Hosts listed in
    // LEGACY_HOSTS (an old domain after a move) are accepted too.
    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      const publicBaseUrl = this.config.get<string>('publicBaseUrl') ?? '';
      const allowed = [publicBaseUrl, ...legacyOrigins(this.config.get<string[]>('legacyHosts') ?? [], publicBaseUrl)];
      if (!origin || !allowed.includes(origin)) {
        throw new ForbiddenException('Origin mismatch');
      }
    }

    // Support session (superadmin "view as / act as"). Only a superadmin's own login can have one, only on
    // routes that are not superadmin routes (those always authenticate as the real admin, so an impersonated
    // customer can never reach them), and only while the server-side session row is unended and unexpired.
    // Everything above (approval, suspension, CSRF origin) was checked against the REAL admin.
    const superadminRoute = this.isSuperadminRoute(context);
    const imp =
      resolved.user.role === Role.SUPERADMIN && !superadminRoute
        ? await this.impersonation.resolveForGuard(resolved.sessionId, resolved.user)
        : null;

    // The web client names the support session it believes it is in (X-Support-Session) on EVERY request. If that
    // session is not the ACTIVE one for this login (expired, ended in another tab, replaced ...) the request is
    // refused instead of silently falling back to the admin's OWN account: a customer screen that is still open
    // must never read or write the admin's data. Superadmin routes ignore it (Exit must keep working).
    const claimed = request.headers[SUPPORT_SESSION_HEADER];
    if (claimed && !superadminRoute && (!imp || imp.session.id !== claimed)) {
      throw new ConflictException({ code: SUPPORT_SESSION_ENDED_CODE, message: 'Support session ended' });
    }

    if (imp) {
      const req = this.impersonation.toRequestImpersonation(imp.session);
      const info = { method: request.method, route: `${request.baseUrl ?? ''}${request.route?.path ?? ''}`, params: request.params };
      const refuse = async (message: string, blocked: string): Promise<never> => {
        await this.impersonation.recordRefused(req, { ...info, blocked });
        throw new ForbiddenException(message);
      };
      // View mode is read-only for every request that is not a plain read.
      if (imp.session.mode === 'view' && !SAFE_METHODS.has(request.method)) {
        return refuse(VIEW_ONLY_MESSAGE, 'view-only');
      }
      // The blocked list (see impersonation/blocked-when-impersonating.ts): both modes, any method.
      const category = this.reflector.getAllAndOverride<string | undefined>(BLOCKED_WHEN_IMPERSONATING_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (category) return refuse(impersonationBlockMessage(category), category);
      // A customer suspended after the session started can still be looked at, no longer changed.
      if (imp.session.mode === 'act' && (imp.account.suspendedAt || imp.user.suspendedAt)) {
        return refuse('This account has been suspended. Support sessions on suspended accounts are view-only.', 'suspended');
      }
      // Fail closed: the intent is on record (strict) before the handler can change anything.
      if (!SAFE_METHODS.has(request.method)) await this.impersonation.recordIntent(req, info);
      // Nothing seen in a support session may be cached by the browser or a proxy (customer files, thumbnails ...).
      const res = context.switchToHttp().getResponse<Response>();
      const setHeader = res.setHeader.bind(res);
      res.setHeader = ((name: string, value: unknown) =>
        setHeader(name, name.toLowerCase() === 'cache-control' ? 'no-store' : (value as string))) as Response['setHeader'];
      res.setHeader('Cache-Control', 'no-store');
      request.actor = resolved.user;
      request.sessionId = resolved.sessionId;
      request.impersonation = req;
      request.user = imp.user;
      request.account = imp.account;
      return true;
    }

    request.account = resolved.account;
    request.user = resolved.user;
    request.sessionId = resolved.sessionId;
    return true;
  }

  private isSuperadminRoute(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    return !!roles && roles.includes(Role.SUPERADMIN);
  }
}
