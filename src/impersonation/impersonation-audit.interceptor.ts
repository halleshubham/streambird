import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { ImpersonationService, RequestImpersonation } from './impersonation.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global (APP_INTERCEPTOR). When AccountGuard put a support session on the request, every mutating request
 * that reaches a handler is written to the audit log as `impersonated_action` with its final status. Requests
 * refused by the guard (view-only / blocked list) are recorded by the guard itself, as the interceptor never runs
 * for them. Requests without a support session pass straight through untouched.
 */
@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  constructor(private readonly impersonation: ImpersonationService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { impersonation?: RequestImpersonation }>();
    const imp = req.impersonation;
    if (!imp || SAFE_METHODS.has(req.method)) return next.handle();
    const res = http.getResponse<Response>();
    const route = `${req.baseUrl ?? ''}${req.route?.path ?? ''}`;
    const record = (status: number) => void this.impersonation.recordAction(imp, { method: req.method, route, status, params: req.params });
    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        error: (e: unknown) => record(e instanceof HttpException ? e.getStatus() : 500),
      }),
    );
  }
}
