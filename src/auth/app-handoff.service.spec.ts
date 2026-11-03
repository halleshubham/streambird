import * as crypto from 'crypto';
import { APP_HANDOFF_MAX_ENTRIES, APP_HANDOFF_TTL_MS, AppHandoffService } from './app-handoff.service';

const verifier = crypto.randomBytes(32).toString('base64url');
const challengeOf = (v: string) => crypto.createHash('sha256').update(v).digest('base64url');
const session = (n = 1) => ({ token: `tok-${n}`, expiresAt: new Date(Date.now() + 1e6), userId: `u${n}`, accountId: `a${n}` });

describe('AppHandoffService', () => {
  let svc: AppHandoffService;
  beforeEach(() => {
    svc = new AppHandoffService();
  });
  afterEach(() => svc.onModuleDestroy());

  it('hands the session over once to the holder of the verifier', () => {
    const code = svc.create(challengeOf(verifier), session());
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(svc.redeem(code, verifier)).toMatchObject({ token: 'tok-1', userId: 'u1', accountId: 'a1' });
    expect(svc.redeem(code, verifier)).toBeNull(); // single use
    expect(svc.size).toBe(0);
  });

  it('burns the code on a wrong verifier', () => {
    const code = svc.create(challengeOf(verifier), session());
    expect(svc.redeem(code, crypto.randomBytes(32).toString('base64url'))).toBeNull();
    expect(svc.redeem(code, verifier)).toBeNull();
  });

  it('refuses an unknown code', () => {
    expect(svc.redeem('nope', verifier)).toBeNull();
  });

  it('expires after the TTL', () => {
    const t = 1_000_000;
    const code = svc.create(challengeOf(verifier), session(), t);
    expect(svc.redeem(code, verifier, t + APP_HANDOFF_TTL_MS + 1)).toBeNull();
    const code2 = svc.create(challengeOf(verifier), session(), t);
    expect(svc.redeem(code2, verifier, t + APP_HANDOFF_TTL_MS - 1)).not.toBeNull();
  });

  it('sweeps expired entries', () => {
    const t = 1_000_000;
    svc.create(challengeOf(verifier), session(1), t);
    svc.create(challengeOf(verifier), session(2), t + 100_000);
    svc.sweep(t + APP_HANDOFF_TTL_MS + 1);
    expect(svc.size).toBe(1);
  });

  it('caps the store by evicting the oldest entry', () => {
    const first = svc.create(challengeOf(verifier), session(0));
    for (let i = 1; i < APP_HANDOFF_MAX_ENTRIES + 5; i++) svc.create(challengeOf(verifier), session(i));
    expect(svc.size).toBe(APP_HANDOFF_MAX_ENTRIES);
    expect(svc.redeem(first, verifier)).toBeNull();
  });
});
