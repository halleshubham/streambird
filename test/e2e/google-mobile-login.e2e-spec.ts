import * as crypto from 'crypto';
import { describeE2E, bootApp, Client, Harness } from './harness';

// Same Web client id the harness configures as GOOGLE_CLIENT_ID.
const WEB = 'e2e-google-client';
const ANDROID = 'e2e-android-client';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'e2e-kid';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: WEB, sub: 'g-sub-1', email_verified: true, iat: now, exp: now + 3600, ...claims });
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

describeE2E('POST /auth/google/mobile: native Google sign-in with an ID token', () => {
  let h: Harness;
  const realFetch = globalThis.fetch;
  const rnd = crypto.randomBytes(4).toString('hex');
  const newEmail = `gm-new-${rnd}@e2e.test`;
  const existingEmail = `gm-existing-${rnd}@e2e.test`;

  beforeAll(async () => {
    process.env.GOOGLE_ANDROID_CLIENT_IDS = ` ${ANDROID} ,`;
    // Google's key set is the only outbound call this flow makes; stub it, pass everything else through.
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url ?? String(input);
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    h = await bootApp();
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    delete process.env.GOOGLE_ANDROID_CLIENT_IDS;
    await h.close();
  });

  const post = (c: Client, body: unknown) => c.post('/auth/google/mobile', body);

  it('creates a new user like the web flow, answers like verify-code and sets the session cookie', async () => {
    const c = new Client(h.baseUrl);
    const res = await post(c, { idToken: idToken({ email: newEmail }) });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: newEmail, approvedAt: null, needsPhone: expect.any(Boolean) });
    expect(typeof res.body.accountId).toBe('string');
    expect(Object.keys(res.body).sort()).toEqual(['accountId', 'user']);

    // The Client is a cookie jar like the Android app's: /auth/me only works if sb_session was set.
    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(newEmail);

    const { rows } = await h.db.query('SELECT role FROM users WHERE email = $1', [newEmail]);
    expect(rows).toHaveLength(1);
  });

  it('logs an existing user in without creating a second account', async () => {
    const { accountId } = await h.signIn({ email: existingEmail });
    const c = new Client(h.baseUrl);
    const res = await post(c, { idToken: idToken({ email: existingEmail.toUpperCase() }) });
    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe(accountId);
    expect(res.body.user.approvedAt).not.toBeNull();
    expect((await c.get('/auth/me')).status).toBe(200);
    const { rows } = await h.db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [existingEmail]);
    expect(rows).toHaveLength(1);
  });

  it('accepts a token minted for a listed Android client id', async () => {
    const res = await post(new Client(h.baseUrl), { idToken: idToken({ email: newEmail, aud: ANDROID }) });
    expect(res.status).toBe(200);
  });

  it('refuses a bad body with 400', async () => {
    const c = new Client(h.baseUrl);
    expect((await post(c, {})).status).toBe(400);
    expect((await post(c, { idToken: '' })).status).toBe(400);
    expect((await post(c, { idToken: 42 })).status).toBe(400);
  });

  it('refuses invalid tokens with a generic 401 and no session', async () => {
    const c = new Client(h.baseUrl);
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      'not-a-jwt',
      idToken({ email: newEmail, aud: 'another-client' }),
      idToken({ email: newEmail, exp: now - 600 }),
      idToken({ email: newEmail, iss: 'https://evil.example.com' }),
      idToken({ email: newEmail, email_verified: false }),
      idToken({}), // no email
      idToken({ email: newEmail, sub: undefined }),
      // Tampered signature: change a character in the MIDDLE of the signature. (The last base64 character of a 256-byte signature carries only
      // 2 real bits, so swapping it can change nothing but padding and leave the signature valid: a flaky test.)
      (() => {
        const [head, body, sig] = idToken({ email: newEmail }).split('.');
        const i = Math.floor(sig.length / 2);
        return [head, body, sig.slice(0, i) + (sig[i] === 'A' ? 'B' : 'A') + sig.slice(i + 1)].join('.');
      })(),
    ];
    for (const t of bad) {
      const res = await post(c, { idToken: t });
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).toContain('Invalid Google sign-in');
      expect(JSON.stringify(res.body)).not.toMatch(/aud|expired|issuer|signature|verified/i);
    }
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('is throttled, because it is an unauthenticated endpoint', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await post(new Client(h.baseUrl), { idToken: 'not-a-jwt' })).status);
    expect(statuses).toContain(429);
  });
});
