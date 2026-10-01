import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';

describe('RolesGuard', () => {
  function buildContext(user: any | undefined, requiredRoles: Role[] | undefined) {
    const request: any = { user };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext;

    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);

    return { context, guard: new RolesGuard(reflector) };
  }

  it('allows the request through when the route declares no @Roles(...) at all', () => {
    const { context, guard } = buildContext(undefined, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows a user whose role is in the route's required list", () => {
    const { context, guard } = buildContext({ role: Role.SUPERADMIN }, [Role.SUPERADMIN]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects a user whose role is NOT in the route's required list -- e.g. a Normal User hitting a Company-Admin-only route", () => {
    const { context, guard } = buildContext({ role: Role.USER }, [Role.COMPANY_ADMIN]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when there is no user on the request at all (e.g. an x-api-key caller, which never has a role)', () => {
    const { context, guard } = buildContext(undefined, [Role.SUPERADMIN]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
