import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { ImpersonationRedactionInterceptor } from './impersonation-redaction.interceptor';
import { ReturnsSupportControlToken } from './blocked-when-impersonating';

class Handlers {
  @ReturnsSupportControlToken()
  mint() {}
  other() {}
}

function run(handler: () => void, body: unknown, impersonating = true) {
  const ctx: any = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Handlers,
    switchToHttp: () => ({ getRequest: () => ({ impersonation: impersonating ? { sessionId: 's' } : undefined }) }),
  };
  return lastValueFrom(new ImpersonationRedactionInterceptor(new Reflector()).intercept(ctx, { handle: () => of(body) }));
}

describe('ImpersonationRedactionInterceptor and the support control token', () => {
  const mintBody = { controlToken: 'tok_abcdefghijklmnopqrstuvwxyz', expiresAt: 'x', studioSessionId: 'sess', nested: { controlToken: 'tok_nested_xxxxxxxxxxxxxxxxxxxx', hostToken: 'h' } };

  it('keeps the control token in the mint response only (top level), still redacting everything else', async () => {
    const out: any = await run(new Handlers().mint, mintBody);
    expect(out.controlToken).toBe(mintBody.controlToken);
    expect(out.nested.controlToken).toBeNull();
    expect(out.nested.hostToken).toBeNull();
    expect(out.studioSessionId).toBe('sess');
  });

  it('redacts a control token in the response of any other route of a support session', async () => {
    const out: any = await run(new Handlers().other, mintBody);
    expect(out.controlToken).toBeNull();
    expect(out.nested.controlToken).toBeNull();
  });

  it('leaves non-support requests alone', async () => {
    const out: any = await run(new Handlers().other, mintBody, false);
    expect(out.controlToken).toBe(mintBody.controlToken);
  });
});
