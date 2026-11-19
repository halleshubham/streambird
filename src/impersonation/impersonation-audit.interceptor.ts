import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { ImpersonationService, RequestImpersonation } from './impersonation.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global (APP_INTERCEPTOR). When AccountGuard put a support session on the request: a mutating request's final
 * status is written as `impersonated_action_result` (its strict `impersonated_action` intent entry was already
 * written by the guard, before the handler), and a read is written once per (session, route) as
 * `impersonated_read`. Requests refused by the guard are recorded by the guard itself. Requests without a
 * support session pass straight through untouched.
 */
@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  constructor(private readonly impersonation: ImpersonationService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { impersonation?: RequestImpersonation }>();
    const imp = req.impersonation;
    if (!imp) return next.handle();
    const res = http.getResponse<Response>();
    const route = `${req.baseUrl ?? ''}${req.route?.path ?? ''}`;
    const read = SAFE_METHODS.has(req.method);
    const record = (status: number) =>
      void (read
        ? this.impersonation.recordRead(imp, { method: req.method, route, status, params: req.params })
        : this.impersonation.recordResult(imp, { method: req.method, route, status, params: req.params }));
    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        error: (e: unknown) => record(e instanceof HttpException ? e.getStatus() : 500),
      }),
    );
  }
}
