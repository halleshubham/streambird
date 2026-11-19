import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { map, Observable } from 'rxjs';
import { IMPERSONATION_REDACTED_KEY, IMPERSONATION_REDACTED_VALUE, RETURNS_SUPPORT_CONTROL_TOKEN_KEY } from './blocked-when-impersonating';
import { RequestImpersonation } from './impersonation.service';

function redact(value: unknown, depth = 0, keep: string | null = null): unknown {
  if (value === null || typeof value !== 'object' || depth > 12) return value;
  if (value instanceof Date || Buffer.isBuffer(value) || value instanceof StreamableFile || typeof (value as { pipe?: unknown }).pipe === 'function') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // `keep`: the one top-level key (the control token) the mint response is allowed to carry.
    if (depth === 0 && keep !== null && k === keep) out[k] = v;
    else out[k] = IMPERSONATION_REDACTED_KEY.test(k) && v !== null && v !== undefined ? IMPERSONATION_REDACTED_VALUE : redact(v, depth + 1);
  }
  return out;
}

/**
 * Global (APP_INTERCEPTOR). While a support session is in effect NO response may carry a publishing or join
 * credential (stream key, ingest/WHIP url, guest join link or invite token ...): the impersonator must never be
 * able to publish as, or join as a guest into, the customer's stream. Redaction is by KEY NAME over the whole JSON
 * (see IMPERSONATION_REDACTED_KEY), so a new endpoint or DTO field is covered automatically; it applies in view
 * and act mode alike and never to the customer's own requests.
 */
@Injectable()
export class ImpersonationRedactionInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { impersonation?: RequestImpersonation }>();
    if (!req.impersonation) return next.handle();
    const keep = this.reflector.get<boolean | undefined>(RETURNS_SUPPORT_CONTROL_TOKEN_KEY, context.getHandler()) ? 'controlToken' : null;
    return next.handle().pipe(map((body) => redact(body, 0, keep)));
  }
}
