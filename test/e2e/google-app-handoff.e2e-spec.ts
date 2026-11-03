import * as crypto from 'crypto';
import { describeE2E, bootApp, Client, Harness } from './harness';

const verifier = () => crypto.randomBytes(48).toString('base64url');
const challengeOf = (v: string) => crypto.createHash('sha256').update(v).digest('base64url');

describeE2E('Google sign-in browser fallback for the Android app (one-time handoff)', () => {
  let h: Harness;
  const realFetch = globalThis.fetch;
  const rnd = crypto.randomBytes(4).toString('hex');
  // Email the stubbed Google profile returns next; verified flag too.
  let googleEmail = '';
  let googleVerified = true;
  let googleFails = false;

  beforeAll(async () => {
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url ?? String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        if (googleFails) return new Response('{}', { status: 400 });
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return new Response(JSON.stringify({ email: googleEmail, email_verified: googleVerified }), { headers: { 'content-type': 'application/json' } });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    process.env.REVIEW_ACCOUNT_EMAILS = `gapp-review-${rnd}@e2e.test`;
    h = await bootApp();
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    delete process.env.REVIEW_ACCOUNT_EMAILS;
    await h.close();
  });

  interface Start { state: string; cookies: string; setCookies: string[]; location: string }
  async function start(path: string): Promise<Start> {
    const res = await fetch(`${h.baseUrl}/api${path}`, { redirect: 'manual' });
    const setCookies = res.headers.getSetCookie();
    const location = res.headers.get('location') ?? '';
    const cookies = setCookies.map((l) => l.split(';')[0]).join('; ');
    return { state: new URL(location, 'http://x').searchParams.get('state') ?? '', cookies, setCookies, location };
  }
  const callback = async (s: Start, email: string, opts: { state?: string; verified?: boolean; fail?: boolean } = {}) => {
    googleEmail = email;
    googleVerified = opts.verified ?? true;
    googleFails = opts.fail ?? false;
    const res = await fetch(`${h.baseUrl}/api/auth/google/callback?code=gcode&state=${opts.state ?? s.state}`, {
      redirect: 'manual',
      headers: { Cookie: s.cookies },
    });
    return { status: res.status, headers: res.headers, setCookies: res.headers.getSetCookie(), html: await res.text() };
  };
  const codeOf = (html: string) => /streambird:\/\/auth\?code=([A-Za-z0-9_-]{43})/.exec(html)?.[1] ?? '';
  const redeem = (c: Client, body: unknown) => c.post('/auth/google/app/redeem', body);

  async function appSignIn(email: string) {
    const v = verifier();
    const s = await start(`/auth/google/app?challenge=${challengeOf(v)}`);
    const cb = await callback(s, email);
    return { v, s, cb, code: codeOf(cb.html) };
  }

  it('starts like the web flow and adds the httpOnly challenge cookie', async () => {
    const v = verifier();
    const s = await start(`/auth/google/app?challenge=${challengeOf(v)}`);
    expect(s.location).toContain('accounts.google.com');
    expect(s.location).toContain(encodeURIComponent(`${h.baseUrl}/api/auth/google/callback`));
    expect(s.location).toContain('prompt=select_account');
    const app = s.setCookies.find((c) => c.startsWith('sb_google_app='))!;
    expect(app).toContain(challengeOf(v));
    expect(app).toMatch(/HttpOnly/i);
    expect(app).toMatch(/SameSite=Lax/i);
    expect(app).toContain('Path=/api/auth/google');
    expect(app).toMatch(/Max-Age=600/);
    expect(s.setCookies.some((c) => c.startsWith('sb_oauth_state='))).toBe(true);
  });

  it('rejects a bad challenge with 400', async () => {
    for (const q of ['', '?challenge=short', `?challenge=${'a'.repeat(44)}`, `?challenge=${'a'.repeat(42)}+`, `?challenge=${'a'.repeat(42)}=`]) {
      const res = await fetch(`${h.baseUrl}/api/auth/google/app${q}`, { redirect: 'manual' });
      expect(res.status).toBe(400);
    }
  });

  it('new user: callback sets no session cookie, shows the app link, redeem sets the cookie and /auth/me works', async () => {
    const email = `gapp-new-${rnd}@e2e.test`;
    const { v, cb, code } = await appSignIn(email);
    expect(cb.status).toBe(200);
    expect(cb.headers.get('content-type')).toContain('text/html');
    expect(cb.headers.get('cache-control')).toContain('no-store');
    expect(cb.setCookies.some((c) => c.startsWith('sb_session='))).toBe(false);
    expect(cb.setCookies.find((c) => c.startsWith('sb_google_app='))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(cb.setCookies.find((c) => c.startsWith('sb_oauth_state='))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(cb.html).toContain('<title>Return to StreamBird</title>');
    expect(cb.html).toContain(`href="streambird://auth?code=${code}"`);
    expect(cb.html).toContain('Open StreamBird');
    expect(cb.html).toContain('If the app did not open, tap the button.');
    expect(code).toHaveLength(43);

    const c = new Client(h.baseUrl);
    const res = await redeem(c, { code, verifier: v });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accountId', 'user']);
    expect(res.body.user).toMatchObject({ email, approvedAt: null, needsPhone: expect.any(Boolean) });
    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.accountId).toBe(res.body.accountId); // pending users still log in
  });

  it('existing user keeps their account', async () => {
    const existing = `gapp-existing-${rnd}@e2e.test`;
    const { accountId } = await h.signIn({ email: existing });
    const { v, code } = await appSignIn(existing.toUpperCase());
    const c = new Client(h.baseUrl);
    const res = await redeem(c, { code, verifier: v });
    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe(accountId);
    expect(res.body.user.approvedAt).not.toBeNull();
    expect((await c.get('/auth/me')).status).toBe(200);
  });

  it('review account is approved on sign-in', async () => {
    const { v, code } = await appSignIn(`gapp-review-${rnd}@e2e.test`);
    const c = new Client(h.baseUrl);
    const res = await redeem(c, { code, verifier: v });
    expect(res.status).toBe(200);
    expect(res.body.user.approvedAt).not.toBeNull();
  });

  it('superadmin is refused with the failure page and no code', async () => {
    const { email } = await h.signIn({ superadmin: true });
    const { cb, code } = await appSignIn(email);
    expect(cb.status).toBe(200);
    expect(code).toBe('');
    expect(cb.html).toContain('streambird://auth?error=google_failed');
    expect(cb.html).toContain('Sign-in failed. Close this tab and try again or use the email code.');
    expect(cb.setCookies.some((c) => c.startsWith('sb_session='))).toBe(false);
  });

  it('shows the failure page for state mismatch, unverified email and a Google error', async () => {
    const mk = async () => start(`/auth/google/app?challenge=${challengeOf(verifier())}`);
    const mismatch = await callback(await mk(), `gapp-x-${rnd}@e2e.test`, { state: 'wrong' });
    const unverified = await callback(await mk(), `gapp-y-${rnd}@e2e.test`, { verified: false });
    const failed = await callback(await mk(), `gapp-z-${rnd}@e2e.test`, { fail: true });
    for (const r of [mismatch, unverified, failed]) {
      expect(r.status).toBe(200);
      expect(r.html).toContain('streambird://auth?error=google_failed');
      expect(r.html).not.toContain('?code=');
      expect(r.setCookies.some((c) => c.startsWith('sb_session='))).toBe(false);
    }
    const { rows } = await h.db.query('SELECT 1 FROM users WHERE email = ANY($1)', [[`gapp-y-${rnd}@e2e.test`, `gapp-z-${rnd}@e2e.test`, `gapp-x-${rnd}@e2e.test`]]);
    expect(rows).toHaveLength(0); // no account is created on a failed app flow
  });

  it('a wrong verifier is a generic 401 and burns the code', async () => {
    const { v, code } = await appSignIn(`gapp-wrong-${rnd}@e2e.test`);
    const c = new Client(h.baseUrl);
    const bad = await redeem(c, { code, verifier: verifier() });
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).toContain('Invalid sign-in');
    expect((await c.get('/auth/me')).status).toBe(401);
    expect((await redeem(c, { code, verifier: v })).status).toBe(401);
  });

  it('reuse is refused', async () => {
    const { v, code } = await appSignIn(`gapp-reuse-${rnd}@e2e.test`);
    expect((await redeem(new Client(h.baseUrl), { code, verifier: v })).status).toBe(200);
    expect((await redeem(new Client(h.baseUrl), { code, verifier: v })).status).toBe(401);
  });

  it('an expired code is refused', async () => {
    const { v, code } = await appSignIn(`gapp-exp-${rnd}@e2e.test`);
    const real = Date.now;
    Date.now = () => real() + 121_000;
    try {
      expect((await redeem(new Client(h.baseUrl), { code, verifier: v })).status).toBe(401);
    } finally {
      Date.now = real;
    }
  });

  it('an unknown code is 401 and a bad body is 400', async () => {
    const c = new Client(h.baseUrl);
    expect((await redeem(c, { code: 'x'.repeat(43), verifier: verifier() })).status).toBe(401);
    expect((await redeem(c, {})).status).toBe(400);
    expect((await redeem(c, { code: 'abc', verifier: 'short' })).status).toBe(400);
    expect((await redeem(c, { code: 'abc', verifier: 'a'.repeat(129) })).status).toBe(400);
    expect((await redeem(c, { code: 'abc', verifier: `${'a'.repeat(42)}!` })).status).toBe(400);
    expect((await redeem(c, { code: 5, verifier: verifier() })).status).toBe(400);
  });

  it('the plain web flow is unchanged: session cookie and redirect to /', async () => {
    const email = `gapp-web-${rnd}@e2e.test`;
    const s = await start('/auth/google');
    expect(s.setCookies.some((c) => c.startsWith('sb_google_app='))).toBe(false);
    googleEmail = email;
    googleVerified = true;
    googleFails = false;
    const res = await fetch(`${h.baseUrl}/api/auth/google/callback?code=gcode&state=${s.state}`, { redirect: 'manual', headers: { Cookie: s.cookies } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sb_session='))).toBe(true);
  });

  it('redeem and the start route are throttled', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await redeem(new Client(h.baseUrl), { code: 'x', verifier: verifier() })).status);
    expect(statuses).toContain(429);
    const starts: number[] = [];
    for (let i = 0; i < 30; i++) starts.push((await fetch(`${h.baseUrl}/api/auth/google/app?challenge=${challengeOf(verifier())}`, { redirect: 'manual' })).status);
    expect(starts).toContain(429);
  });
});
