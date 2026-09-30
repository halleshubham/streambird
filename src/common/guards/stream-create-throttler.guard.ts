import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthenticatedRequest } from './api-key.guard';

/**
 * Rate-limits POST /streams per account (not per IP — multiple creators
 * can share an office IP, and a single abusive account rotating IPs must
 * still be capped). Relies on ApiKeyGuard having already resolved
 * request.account; must run after it in the guard chain.
 */
@Injectable()
export class StreamCreateThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: AuthenticatedRequest): Promise<string> {
    return req.account?.id ?? req.ip ?? 'unknown';
  }
}
