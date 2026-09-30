import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionRequest } from '../guards/session.guard';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<SessionRequest>();
    return request.user;
  },
);
