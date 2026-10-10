import { ApprovalDigestService } from './approval-digest.service';

const HOUR = 3_600_000;
const T0 = new Date('2026-10-10T00:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * HOUR);

function pendingUser(email: string, createdAt: Date, over: Record<string, unknown> = {}) {
  return { email, role: 'user', createdAt, account: null, ...over } as any;
}

function build(opts: { recipient?: string; fail?: boolean } = {}) {
  let pending: any[] = [];
  // app_settings, emulated just enough for the claim SQL: an upsert that only moves the timestamp when it is old enough.
  let stored: string | null = null;
  const settings: any = {
    findOne: jest.fn(async () => (stored === null ? null : { key: 'approval_digest_last_sent', value: stored })),
    delete: jest.fn(async () => {
      stored = null;
    }),
    query: jest.fn(async (sql: string, params: string[]) => {
      if (sql.includes('INSERT INTO app_settings')) {
        const [, nowIso, dueBeforeIso] = params;
        if (stored === null || new Date(stored) <= new Date(dueBeforeIso)) {
          stored = nowIso;
          return [{ key: 'approval_digest_last_sent' }];
        }
        return [];
      }
      stored = params[1]; // the release: put the previous timestamp back
      return [];
    }),
  };
  const sent: Array<{ to: string; data: any }> = [];
  const email: any = {
    sendPendingApprovalsDigest: jest.fn(async (to: string, data: any) => {
      if (opts.fail) throw new Error('resend down');
      sent.push({ to, data });
    }),
  };
  const users: any = { listPendingApprovals: jest.fn(async () => pending) };
  const cfg: Record<string, unknown> = { superadminEmail: opts.recipient ?? 'root@streambird.test', publicBaseUrl: 'https://streambird.test', approvalDigestIntervalHours: 12 };
  const config: any = { get: (k: string) => cfg[k] };
  const service = new ApprovalDigestService(settings, users, config, email);
  return { service, sent, email, setPending: (p: any[]) => (pending = p), stored: () => stored };
}

describe('ApprovalDigestService', () => {
  it('sends nothing while nobody is waiting', async () => {
    const { service, sent } = build();
    expect(await service.run({ now: at(0) })).toEqual({ sent: false, reason: 'none-waiting' });
    expect(sent).toHaveLength(0);
  });

  it('sends one consolidated email to the configured superadmin, then waits out the interval', async () => {
    const t = build();
    t.setPending([pendingUser('a@x.test', at(-1)), pendingUser('b@x.test', at(-0.5))]);

    expect(await t.service.run({ now: at(0) })).toEqual({ sent: true, count: 2 });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toBe('root@streambird.test');
    expect(t.sent[0].data).toMatchObject({ totalPending: 2, newSinceLast: 2, adminUrl: 'https://streambird.test/admin' });
    expect(t.sent[0].data.users.map((u: any) => u.email)).toEqual(['a@x.test', 'b@x.test']);

    expect(await t.service.run({ now: at(11.9) })).toEqual({ sent: false, reason: 'not-due' });
    expect(t.sent).toHaveLength(1);

    // Twelve hours on, still waiting: again, and it says who is new since the last one.
    t.setPending([pendingUser('a@x.test', at(-1)), pendingUser('b@x.test', at(-0.5)), pendingUser('c@x.test', at(5))]);
    expect(await t.service.run({ now: at(12.1) })).toEqual({ sent: true, count: 3 });
    expect(t.sent[1].data).toMatchObject({ totalPending: 3, newSinceLast: 1 });
  });

  it('stops once everyone is approved or rejected, and starts again when someone new arrives', async () => {
    const t = build();
    t.setPending([pendingUser('a@x.test', at(-1))]);
    await t.service.run({ now: at(0) });
    t.setPending([]);
    expect(await t.service.run({ now: at(13) })).toEqual({ sent: false, reason: 'none-waiting' });
    t.setPending([pendingUser('late@x.test', at(20))]);
    expect(await t.service.run({ now: at(25) })).toEqual({ sent: true, count: 1 });
    expect(t.sent).toHaveLength(2);
  });

  it('does not email when no superadmin address is configured', async () => {
    const t = build({ recipient: '' });
    t.setPending([pendingUser('a@x.test', at(-1))]);
    expect(await t.service.run({ now: at(0) })).toEqual({ sent: false, reason: 'no-recipient' });
    expect(t.stored()).toBeNull();
  });

  it('releases the slot when sending fails, so the very next check retries', async () => {
    const t = build({ fail: true });
    t.setPending([pendingUser('a@x.test', at(-1))]);
    expect(await t.service.run({ now: at(0) })).toEqual({ sent: false, reason: 'send-failed' });
    expect(t.stored()).toBeNull(); // nothing recorded as sent
    // Email recovers: the same minute is allowed to send.
    t.email.sendPendingApprovalsDigest.mockImplementation(async (to: string, data: any) => void t.sent.push({ to, data }));
    expect(await t.service.run({ now: at(0.1) })).toEqual({ sent: true, count: 1 });
  });

  it('restores the previous timestamp when a later send fails', async () => {
    const t = build();
    t.setPending([pendingUser('a@x.test', at(-1))]);
    await t.service.run({ now: at(0) });
    t.email.sendPendingApprovalsDigest.mockRejectedValueOnce(new Error('down'));
    expect(await t.service.run({ now: at(13) })).toEqual({ sent: false, reason: 'send-failed' });
    expect(t.stored()).toBe(at(0).toISOString());
  });

  it('lists at most 50 accounts but reports the real total', async () => {
    const t = build();
    t.setPending(Array.from({ length: 70 }, (_, i) => pendingUser(`u${i}@x.test`, at(-2))));
    await t.service.run({ now: at(0) });
    expect(t.sent[0].data.users).toHaveLength(50);
    expect(t.sent[0].data.totalPending).toBe(70);
  });

  it('carries the company name for a company admin', async () => {
    const t = build();
    t.setPending([pendingUser('boss@acme.test', at(-1), { role: 'company_admin', account: { name: 'Acme Ltd' } })]);
    await t.service.run({ now: at(0) });
    expect(t.sent[0].data.users[0]).toMatchObject({ role: 'company_admin', companyName: 'Acme Ltd' });
  });
});
