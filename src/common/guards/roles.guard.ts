import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AccountRequest } from './account.guard';

/**
 * Role-scoping on top of AccountGuard: AccountGuard resolves *who* the
 * caller is (and, for Company Admins, whether they're approved yet --
 * that's the separate approval gate baked directly into AccountGuard
 * itself so it can never be forgotten on a route). RolesGuard is the
 * opt-in "only these roles" check for specific endpoints (team
 * management, superadmin approval) -- always run AFTER AccountGuard in
 * @UseGuards(...) so request.user is populated.
 *
 * request.user is only ever set on the session-cookie auth path, never
 * the x-api-key path -- so an x-api-key caller is correctly rejected by
 * any route guarded with @Roles(...), since a raw API key has no
 * associated role at all.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AccountRequest>();
    const user = request.user;

    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}
