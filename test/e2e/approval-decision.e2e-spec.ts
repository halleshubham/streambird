import { describeE2E, bootApp, Client, Harness, ids } from './harness';
import { EMAIL_SERVICE } from '../../src/email/email.interface';

describeE2E('approval decisions: the user is emailed when a superadmin approves or rejects them', () => {
  let h: Harness;
  let admin: Client;

  beforeAll(async () => {
    h = await bootApp();
    ({ client: admin } = await h.signIn({ superadmin: true }));
  });
  afterAll(() => h.close());

  /** Someone who has signed in and is waiting for a decision. */
  const waiting = async (name: string) => {
    const email = `${ids('decision')(name)}@e2e.test`.toLowerCase();
    const c = new Client(h.baseUrl);
    await c.post('/auth/request-code', { email });
    const res = await c.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) });
    expect(res.status).toBe(200);
    return { email, id: res.body.user.id as string, client: c };
  };

  it('approval emails the user a "studio is ready" note with a login link, and lets them in', async () => {
    const u = await waiting('approve');
    h.mailbox.decisions.length = 0;

    const res = await admin.post(`/superadmin/users/${u.id}/approve`, {});
    expect(res.status).toBe(201);
    expect(h.mailbox.decisions).toHaveLength(1);
    expect(h.mailbox.decisions[0].to).toBe(u.email);
    expect(h.mailbox.decisions[0].data).toEqual({ decision: 'approved', loginUrl: `${h.baseUrl}/login` });
    expect((await u.client.get('/auth/me')).body.user.approvedAt).not.toBeNull();
  });

  it('rejection emails the user a polite decline (the address is read before the account is deleted)', async () => {
    const u = await waiting('reject');
    h.mailbox.decisions.length = 0;

    const res = await admin.post(`/superadmin/users/${u.id}/reject`, {});
    expect(res.status).toBe(204);
    expect(h.mailbox.decisions).toHaveLength(1);
    expect(h.mailbox.decisions[0].to).toBe(u.email);
    expect(h.mailbox.decisions[0].data.decision).toBe('rejected');
    const { rows } = await h.db.query('SELECT 1 FROM users WHERE id = $1', [u.id]);
    expect(rows).toHaveLength(0);
  });

  it('a broken mail provider never undoes or fails the decision', async () => {
    const a = await waiting('mailfail-a');
    const b = await waiting('mailfail-b');
    const mail = h.app.get(EMAIL_SERVICE) as any;
    const original = mail.sendApprovalDecision;
    mail.sendApprovalDecision = async () => {
      throw new Error('mail provider down');
    };
    try {
      expect((await admin.post(`/superadmin/users/${a.id}/approve`, {})).status).toBe(201);
      expect((await a.client.get('/auth/me')).body.user.approvedAt).not.toBeNull();
      expect((await admin.post(`/superadmin/users/${b.id}/reject`, {})).status).toBe(204);
    } finally {
      mail.sendApprovalDecision = original;
    }
  });

  it('nothing is emailed for a refused decision (an already approved user cannot be rejected)', async () => {
    const u = await waiting('already');
    await admin.post(`/superadmin/users/${u.id}/approve`, {});
    h.mailbox.decisions.length = 0;
    const res = await admin.post(`/superadmin/users/${u.id}/reject`, {});
    expect(res.status).toBe(403);
    expect(h.mailbox.decisions).toHaveLength(0);
  });
});
