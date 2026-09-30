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
