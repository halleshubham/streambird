import { describeE2E, bootApp, Client, Harness, ids } from './harness';

describeE2E('mobile number: collected from people who register from now on', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootApp();
  });
  afterAll(async () => {
    await h.close();
  });

  const register = async (tag: string) => {
    const email = `${ids('phone')(tag)}@e2e.test`.toLowerCase();
    const c = new Client(h.baseUrl);
    await c.post('/auth/request-code', { email });
    const v = await c.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) });
    expect(v.status).toBe(200);
    return { c, email, verified: v };
  };

  it('a new sign-up needs a number, can save one (normalised), and then no longer does', async () => {
    const { c, verified } = await register('a');
    expect(verified.body.user.needsPhone).toBe(true);
    expect(verified.body.user.phone).toBeNull();

    const bad = await c.patch('/auth/me/phone', { phone: '12345' });
    expect(bad.status).toBe(400);
    expect((await c.get('/auth/me')).body.user.needsPhone).toBe(true);

    const ok = await c.patch('/auth/me/phone', { phone: '98765 43210' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.phone).toBe('+919876543210');
    expect(ok.body.user.needsPhone).toBe(false);
    expect((await c.get('/auth/me')).body.user.phone).toBe('+919876543210');
  });

  it('shows the number to the superadmin in the approvals list', async () => {
    const { c, email } = await register('b');
    await c.patch('/auth/me/phone', { phone: '+1 415 555 2671' });
    const admin = await h.signIn({ superadmin: true });
    const list = await admin.client.get('/superadmin/pending-approvals');
    expect(list.status).toBe(200);
    expect(list.body.find((p: any) => p.email === email).phone).toBe('+14155552671');
  });

  it('an existing account (not flagged) is never asked, and a signed-out caller cannot set a number', async () => {
    const { client, email } = await h.signIn();
    await h.db.query(`UPDATE users SET phone_required = false, phone = NULL WHERE email = $1`, [email]);
    expect((await client.get('/auth/me')).body.user.needsPhone).toBe(false);
    expect((await new Client(h.baseUrl).patch('/auth/me/phone', { phone: '9876543210' })).status).toBe(401);
  });
});
