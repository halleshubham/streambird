import { describeE2E, bootApp, Client, Harness, ids } from './harness';
import { hashPassword } from '../../src/auth/password.util';

const email = `${ids('root')('a')}@e2e.test`.toLowerCase();
const PASSWORD = 'correct-horse-battery-staple';

describeE2E('superadmin login: password, then emailed code', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootApp();
    // A superadmin as the seed service creates it: a user with role + password hash.
    const { accountId } = await h.signIn({ email });
    await h.db.query(`UPDATE users SET role = 'superadmin', password_hash = $2 WHERE email = $1`, [email, hashPassword(PASSWORD)]);
    void accountId;
  });
  afterAll(() => h.close());

  const fresh = () => new Client(h.baseUrl);

  it('a correct password emails a code but signs nobody in', async () => {
    const c = fresh();
    h.mailbox.codes.delete(email);
    const res = await c.post('/auth/superadmin-login', { email, password: PASSWORD });
    expect(res.status).toBe(202);
    expect(h.mailbox.codes.get(email)).toMatch(/^\d{6}$/);
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('a wrong password is refused and no code is emailed', async () => {
    h.mailbox.codes.delete(email);
    const res = await fresh().post('/auth/superadmin-login', { email, password: 'nope' });
    expect(res.status).toBe(401);
    expect(h.mailbox.codes.has(email)).toBe(false);
  });

  it('password + code signs in, and the session is a superadmin one', async () => {
    const c = fresh();
    await c.post('/auth/superadmin-login', { email, password: PASSWORD });
    const code = h.mailbox.codes.get(email);

    expect((await c.post('/auth/superadmin-verify', { email, password: 'nope', code })).status).toBe(401);
    expect((await c.post('/auth/superadmin-verify', { email, password: PASSWORD, code: code === '000000' ? '111111' : '000000' })).status).toBe(400);

    const ok = await c.post('/auth/superadmin-verify', { email, password: PASSWORD, code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('superadmin');
    expect((await c.get('/superadmin/billing')).status).toBe(200);
  });

  it('the plain email-code login no longer lets the superadmin in', async () => {
    const c = fresh();
    await c.post('/auth/request-code', { email });
    const res = await c.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) });
    expect(res.status).toBe(403);
    expect((await c.get('/auth/me')).status).toBe(401);
  });
});
