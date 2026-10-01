import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/** Marks a controller/handler as restricted to the given role(s). Requires
 * RolesGuard to run *after* AccountGuard (AccountGuard is what actually
 * attaches request.user) -- see RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
