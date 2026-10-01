import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AccountsService } from '../../accounts/accounts.service';
import { AuthService } from '../../auth/auth.service';
import { Account } from '../../accounts/entities/account.entity';
import { User } from '../../users/entities/user.entity';
import { Role } from '../enums/role.enum';

export interface AccountRequest extends Request {
  account?: Account;
  user?: User;
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
    // entirely since it isn't exposed the same way.
    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      const publicBaseUrl = this.config.get<string>('publicBaseUrl');
      if (!origin || origin !== publicBaseUrl) {
        throw new ForbiddenException('Origin mismatch');
      }
    }

    request.account = resolved.account;
    request.user = resolved.user;
    return true;
  }
}
