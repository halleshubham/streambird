import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { User } from '../../users/entities/user.entity';
import { Account } from '../../accounts/entities/account.entity';

export interface SessionRequest extends Request {
  user?: User;
  account?: Account;
}

const SESSION_COOKIE_NAME = 'sb_session';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];

    if (!token) {
      throw new UnauthorizedException('Not logged in');
    }

    const resolved = await this.authService.resolveSession(token);
    if (!resolved) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    request.user = resolved.user;
    request.account = resolved.account;
    return true;
  }
}
