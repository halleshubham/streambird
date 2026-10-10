import { describeE2E, bootApp, Client, Harness, ids } from './harness';
import { ApprovalDigestService } from '../../src/superadmin/approval-digest.service';
import { EMAIL_SERVICE } from '../../src/email/email.interface';

const root = `${ids('digest-root')('a')}@e2e.test`.toLowerCase();
const HOUR = 3_600_000;

describeE2E('approval digest: one consolidated email to the superadmin while accounts are waiting', () => {
  let h: Harness;
  let service: ApprovalDigestService;
  let previousSuperadmin: string | undefined;

  beforeAll(async () => {
    previousSuperadmin = process.env.SUPERADMIN_EMAIL;
    process.env.SUPERADMIN_EMAIL = root;
    h = await bootApp();
    service = h.app.get(ApprovalDigestService);
  });
  afterAll(async () => {
    if (previousSuperadmin === undefined) delete process.env.SUPERADMIN_EMAIL;
    else process.env.SUPERADMIN_EMAIL = previousSuperadmin;
    await h.close();
  });

  const clearState = async () => {
    await h.db.query(`DELETE FROM app_settings WHERE key = 'approval_digest_last_sent'`);
    // Other specs leave unapproved users behind in the shared database.
    await h.db.query(`UPDATE users SET approved_at = now() WHERE approved_at IS NULL AND role <> 'superadmin'`);
    h.mailbox.digests.length = 0;
  };

  /** A user who signed in by email code and is now waiting (nobody approves them). */
  const signUpAndWait = async (name: string) => {
    const email = `${ids('digest')(name)}@e2e.test`.toLowerCase();
    const c = new Client(h.baseUrl);
    await c.post('/auth/request-code', { email });
    const res = await c.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) });
    expect(res.status).toBe(200);
    expect(res.body.user.approvedAt).toBeNull();
    return email;
  };

  it('sends nothing while nobody is waiting', async () => {
    await clearState();
    expect(await service.run({ intervalHours: 12 })).toMatchObject({ sent: false, reason: 'none-waiting' });
    expect(h.mailbox.digests).toHaveLength(0);
  });

  it('lists everyone waiting in one email to the configured superadmin, repeats after the interval, and stops when all are decided', async () => {
    await clearState();
    const a = await signUpAndWait('one');
    const b = await signUpAndWait('two');
    const now = new Date();

    expect(await service.run({ now, intervalHours: 12 })).toMatchObject({ sent: true, count: 2 });
    expect(h.mailbox.digests).toHaveLength(1);
    expect(h.mailbox.digests[0].to).toBe(root);
    expect(h.mailbox.digests[0].data.users.map((u: any) => u.email)).toEqual(expect.arrayContaining([a, b]));
    expect(h.mailbox.digests[0].data).toMatchObject({ totalPending: 2, newSinceLast: 2 });
    expect(h.mailbox.digests[0].data.adminUrl).toBe(`${h.baseUrl}/admin`);

    // Within the interval: nothing more, however often it is asked.
    expect(await service.run({ now: new Date(now.getTime() + 1 * HOUR), intervalHours: 12 })).toMatchObject({ sent: false, reason: 'not-due' });
    expect(await service.run({ now: new Date(now.getTime() + 11 * HOUR), intervalHours: 12 })).toMatchObject({ sent: false, reason: 'not-due' });
    expect(h.mailbox.digests).toHaveLength(1);

    // A day on, someone is still waiting and one more has arrived.
    const c = await signUpAndWait('three');
    expect(await service.run({ now: new Date(now.getTime() + 13 * HOUR), intervalHours: 12 })).toMatchObject({ sent: true });
    expect(h.mailbox.digests).toHaveLength(2);
    expect(h.mailbox.digests[1].data.users.map((u: any) => u.email)).toEqual(expect.arrayContaining([a, b, c]));

    // Everyone approved or rejected: silence.
    await h.db.query(`UPDATE users SET approved_at = now() WHERE approved_at IS NULL AND role <> 'superadmin'`);
    expect(await service.run({ now: new Date(now.getTime() + 40 * HOUR), intervalHours: 12 })).toMatchObject({ sent: false, reason: 'none-waiting' });
    expect(h.mailbox.digests).toHaveLength(2);
  });

  it('two checks at the same moment send exactly one email (the claim is atomic)', async () => {
    await clearState();
    await signUpAndWait('race');
    const results = await Promise.all([service.run({ intervalHours: 12 }), service.run({ intervalHours: 12 }), service.run({ intervalHours: 12 })]);
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(h.mailbox.digests).toHaveLength(1);
  });

  it('a failed send does not use up the interval', async () => {
    await clearState();
    await signUpAndWait('retry');
    const mail = h.app.get(EMAIL_SERVICE) as any;
    const original = mail.sendPendingApprovalsDigest;
    mail.sendPendingApprovalsDigest = async () => {
      throw new Error('mail provider down');
    };
    expect(await service.run({ intervalHours: 12 })).toMatchObject({ sent: false, reason: 'send-failed' });
    mail.sendPendingApprovalsDigest = original;
    expect(await service.run({ intervalHours: 12 })).toMatchObject({ sent: true });
    expect(h.mailbox.digests).toHaveLength(1);
  });

  it('is off when the interval is 0 (the timers never start)', async () => {
    // The harness boots with APPROVAL_DIGEST_INTERVAL_HOURS=0, so nothing has emailed on its own during this file.
    expect(h.mailbox.digests.every((d) => d.to === root)).toBe(true);
    expect((h.app.get(ApprovalDigestService) as any).timer).toBeNull();
  });
});
