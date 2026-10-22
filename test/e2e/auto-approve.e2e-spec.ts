import { describeE2E, bootApp, Client, Harness, ids } from './harness';

describeE2E('auto-approve: the superadmin can pause and resume open registration', () => {
  let h: Harness;
  let admin: Client;

  beforeAll(async () => {
    h = await bootApp();
    ({ client: admin } = await h.signIn({ superadmin: true }));
  });
  afterAll(async () => {
    await admin.put('/superadmin/registration', { autoApprove: false }); // never leak the switch into other suites
    await h.close();
  });

  const signup = async (tag: string) => {
    const email = `${ids('auto')(tag)}@e2e.test`.toLowerCase();
    const c = new Client(h.baseUrl);
    await c.post('/auth/request-code', { email });
    const res = await c.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) });
    expect(res.status).toBe(200);
    return { email, client: c, user: res.body.user };
  };
  const companySignup = async (tag: string) => {
    const email = `${ids('autoco')(tag)}@e2e.test`.toLowerCase();
    const c = new Client(h.baseUrl);
    await c.post('/auth/request-code', { email });
    const res = await c.post('/auth/signup-company', { companyName: `Co ${tag}`, email, code: h.mailbox.codes.get(email) });
    expect(res.status).toBe(200);
    return { email, user: res.body.user };
  };

  it('is off by default: a new signup waits for approval, as before', async () => {
    const status = await admin.get('/superadmin/registration');
    expect(status.status).toBe(200);
    expect(status.body.autoApprove).toBe(false);
    const u = await signup('default-off');
    expect(u.user.approvedAt).toBeNull();
  });

  it('only a superadmin can read or change it', async () => {
    const { client } = await h.signIn();
    expect((await client.get('/superadmin/registration')).status).toBe(403);
    expect((await client.put('/superadmin/registration', { autoApprove: true })).status).toBe(403);
    expect((await new Client(h.baseUrl).get('/superadmin/registration')).status).toBe(401);
    expect((await admin.put('/superadmin/registration', { autoApprove: 'yes' })).status).toBe(400);
  });

  it('on: solo and company signups get in immediately, with nobody recorded as approver; off again: they queue', async () => {
    const on = await admin.put('/superadmin/registration', { autoApprove: true });
    expect(on.status).toBe(200);
    expect(on.body.autoApprove).toBe(true);

    const solo = await signup('on-solo');
    expect(solo.user.approvedAt).not.toBeNull();
    expect((await solo.client.get('/plans/me')).status).toBe(200); // past the approval gate straight away
    const co = await companySignup('on-co');
    expect(co.user.approvedAt).not.toBeNull();
    const { rows } = await h.db.query('SELECT approved_by_id FROM users WHERE email = ANY($1)', [[solo.email, co.email]]);
    expect(rows.every((r) => r.approved_by_id === null)).toBe(true);

    await admin.put('/superadmin/registration', { autoApprove: false });
    const queued = await signup('off-again');
    expect(queued.user.approvedAt).toBeNull();
    expect((await queued.client.get('/plans/me')).status).toBe(403);
    // Anyone already let in stays in.
    expect((await solo.client.get('/plans/me')).status).toBe(200);
  });

  it('approve-all lets in the whole queue, tells each person, and is audited; the history counts signups', async () => {
    await admin.put('/superadmin/registration', { autoApprove: false });
    const a = await signup('queue-a');
    const b = await signup('queue-b');
    h.mailbox.decisions.length = 0;
    const before = (await admin.get('/superadmin/registration')).body;
    expect(before.waiting).toBeGreaterThanOrEqual(2);
    expect(before.last24h).toBeGreaterThanOrEqual(2);
    expect(before.last7d).toBeGreaterThanOrEqual(before.last24h);

    const res = await admin.post('/superadmin/pending-approvals/approve-all', {});
    expect(res.status).toBe(201);
    expect(res.body.approved).toBe(before.waiting);
    expect(h.mailbox.decisions.map((d) => d.to)).toEqual(expect.arrayContaining([a.email, b.email]));
    expect((await a.client.get('/plans/me')).status).toBe(200);
    expect((await admin.get('/superadmin/registration')).body.waiting).toBe(0);
    expect((await admin.post('/superadmin/pending-approvals/approve-all', {})).body.approved).toBe(0);

    const log = await admin.get('/superadmin/audit-log?limit=20');
    const actions = (log.body.items ?? log.body).map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['enable_auto_approve', 'disable_auto_approve', 'approve_all_pending']));
  });
});
