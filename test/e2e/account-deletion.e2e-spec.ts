import * as crypto from 'crypto';
import { OBJECT_STORAGE, MemoryObjectStorage } from '../../src/assets/object-storage';
import { StreamsService } from '../../src/streams/streams.service';
import { describeE2E, bootApp, Client, Harness, ids, resetBillingState } from './harness';

const pay = ids('delpay');

function fakePng(width: number, height: number, bytes = 400): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 7)]);
}

async function upload(c: Client, file: Buffer, kind: string) {
  const boundary = `----sb${Date.now()}${Math.random().toString(16).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.call('POST', '/assets', { raw: body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}

describeE2E('account deletion: code, preview, member vs whole company, cleanup, isolation', () => {
  let h: Harness;
  let superadmin: Client;
  let storage: MemoryObjectStorage;
  const rzp = () => h.razorpay!;
  const n = async (sql: string, args: unknown[] = []) => (await h.db.query(sql, args)).rows[0].n as number;
  const ask = async (c: Client, email: string) => {
    const r = await c.post('/account/delete/request');
    expect(r.status).toBe(204);
    return h.mailbox.deletionCodes.get(email)!;
  };
  const del = (c: Client, body: unknown) => c.call('DELETE', '/account', { body });
  const login = async (email: string) => {
    const c = new Client(h.baseUrl);
    await c.post('/auth/request-code', { email });
    expect((await c.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) })).status).toBe(200);
    return c;
  };
  const userExists = async (email: string) => (await n('SELECT count(*)::int AS n FROM users WHERE email = $1', [email])) === 1;

  /** A company: a company admin plus the given number of normal members (all approved, all signed in). */
  async function company(members = 2) {
    const admin = await h.signIn();
    await h.db.query(`UPDATE users SET role = 'company_admin' WHERE email = $1`, [admin.email]);
    await h.db.query(`INSERT INTO companies (name, account_id) VALUES ('Acme', $1)`, [admin.accountId]);
    const people: Array<{ email: string; client: Client }> = [];
    for (let i = 0; i < members; i++) {
      const email = `member-${crypto.randomBytes(4).toString('hex')}@test.dev`;
      expect((await admin.client.post('/team/invite', { email })).status).toBe(201);
      people.push({ email, client: await login(email) });
    }
    return { admin, people };
  }

  /** Everything an account can own, so a deletion has something to remove. */
  async function fill(c: Client, accountId: string) {
    const conn = await c.post('/platform-connections/twitch/manual', { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'key-secret-1' });
    expect(conn.status).toBe(201);
    const live = await c.post('/streams', { title: 'live now', destinationConnectionIds: [conn.body.id] });
    expect(live.status).toBe(201);
    const later = await c.post('/streams/schedule', { title: 'later', scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(), timezone: 'UTC', destinationConnectionIds: [conn.body.id] });
    expect(later.status).toBe(201);
    expect((await c.post('/presets', { name: 'Friday', config: { orientation: 'landscape' } })).status).toBe(201);
    const asset = await upload(c, fakePng(100, 100), 'logo');
    expect(asset.status).toBe(201);
    expect((await c.post('/brand-kits', { name: 'Main', logoAssetId: asset.body.id })).status).toBe(201);
    const key = (await h.db.query('SELECT storage_key FROM assets WHERE account_id = $1', [accountId])).rows[0].storage_key as string;
    expect(storage.objects.has(key)).toBe(true);
    return { liveId: live.body.id as string, scheduledId: later.body.id as string, storageKey: key };
  }

  const rowsOf = async (accountId: string) => ({
    users: await n('SELECT count(*)::int AS n FROM users WHERE account_id = $1', [accountId]),
    streams: await n('SELECT count(*)::int AS n FROM live_streams WHERE account_id = $1', [accountId]),
    connections: await n('SELECT count(*)::int AS n FROM platform_connections WHERE account_id = $1', [accountId]),
    kits: await n('SELECT count(*)::int AS n FROM brand_kits WHERE account_id = $1', [accountId]),
    assets: await n('SELECT count(*)::int AS n FROM assets WHERE account_id = $1', [accountId]),
    presets: await n('SELECT count(*)::int AS n FROM stream_presets WHERE account_id = $1', [accountId]),
    subscriptions: await n('SELECT count(*)::int AS n FROM subscriptions WHERE account_id = $1', [accountId]),
    companies: await n('SELECT count(*)::int AS n FROM companies WHERE account_id = $1', [accountId]),
    accounts: await n('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [accountId]),
  });

  beforeAll(async () => {
    h = await bootApp({ razorpay: true, mediamtx: true });
    await resetBillingState(h.db);
    storage = h.app.get(OBJECT_STORAGE) as MemoryObjectStorage;
    superadmin = (await h.signIn({ superadmin: true })).client;
    await superadmin.patch('/superadmin/plans/free', { assetStorageMb: 1 });
    await superadmin.patch('/superadmin/billing/settings', { paymentsEnabled: true });
  });
  afterAll(async () => {
    await superadmin.patch('/superadmin/plans/free', { assetStorageMb: 0 });
    await resetBillingState(h.db);
    delete process.env.REVIEW_ACCOUNT_EMAILS;
    await h.close();
  });

  describe('the code', () => {
    it('needs a signed-in person; an API key and an anonymous caller are refused', async () => {
      const anon = new Client(h.baseUrl);
      expect((await anon.post('/account/delete/request')).status).toBe(401);
      expect((await anon.get('/account/delete/preview')).status).toBe(401);
      expect((await del(anon, { code: '123456' })).status).toBe(401);

      const created = await anon.post('/accounts', { name: 'api-only' });
      expect(created.status).toBe(201);
      const viaKey = await anon.call('GET', '/account/delete/preview', { headers: { 'x-api-key': created.body.apiKey } });
      expect(viaKey.status).toBe(403);
    });

    it('a login code cannot delete an account, and a deletion code cannot log anyone in', async () => {
      const { client, email } = await h.signIn();
      const other = new Client(h.baseUrl);
      await other.post('/auth/request-code', { email });
      const loginCode = h.mailbox.codes.get(email)!;

      const deletionCode = await ask(client, email);
      expect(deletionCode).toMatch(/^\d{6}$/);
      // The deletion code is not a login code ...
      const asLogin = await new Client(h.baseUrl).post('/auth/verify-code', { email, code: deletionCode === loginCode ? '000000' : deletionCode });
      expect(asLogin.status).toBe(400);
      // ... and the (still unused) login code is not a deletion code.
      if (loginCode !== deletionCode) expect((await del(client, { code: loginCode })).status).toBe(400);
      expect(await userExists(email)).toBe(true);
    });

    it('a wrong code changes nothing; five wrong guesses burn the code; the right one then needs a fresh code', async () => {
      const { client, email } = await h.signIn();
      const code = await ask(client, email);
      const wrong = code === '111111' ? '222222' : '111111';
      for (let i = 0; i < 5; i++) expect((await del(client, { code: wrong })).status).toBe(400);
      expect(await userExists(email)).toBe(true);
      expect((await del(client, { code })).status).toBe(400); // burnt
      expect(await userExists(email)).toBe(true);
      const fresh = await ask(client, email);
      expect((await del(client, { code: fresh })).status).toBe(204);
      expect(await userExists(email)).toBe(false);
    });

    it('rejects a malformed body and throttles requests per account', async () => {
      const { client } = await h.signIn();
      expect((await del(client, {})).status).toBe(400);
      expect((await del(client, { code: '12' })).status).toBe(400);
      expect((await del(client, { code: '123456', extra: 1 })).status).toBe(400);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await client.post('/account/delete/request')).status);
      expect(statuses.slice(0, 3)).toEqual([204, 204, 204]);
      expect(statuses.at(-1)).toBe(429);
    });

    it('is never skipped for a review account, which signs in without a code', async () => {
      const email = `review-${crypto.randomBytes(4).toString('hex')}@e2e.test`;
      process.env.REVIEW_ACCOUNT_EMAILS = email;
      try {
        const client = new Client(h.baseUrl);
        expect((await client.post('/auth/verify-code', { email, code: '000000' })).status).toBe(200); // listed: no login code needed
        expect(h.mailbox.codes.get(email)).toBeUndefined();

        expect((await del(client, { code: '000000' })).status).toBe(400); // no deletion code asked for yet
        expect(await userExists(email)).toBe(true);
        const code = await ask(client, email);
        expect(code).toMatch(/^\d{6}$/); // a real code was emailed to it
        expect((await del(client, { code: code === '000000' ? '123456' : '000000' })).status).toBe(400);
        expect(await userExists(email)).toBe(true);
        expect((await del(client, { code })).status).toBe(204);
        expect(await userExists(email)).toBe(false);
      } finally {
        delete process.env.REVIEW_ACCOUNT_EMAILS;
      }
    });

    it('a superadmin cannot delete their account through this endpoint', async () => {
      const sa = await h.signIn({ superadmin: true });
      expect((await sa.client.get('/account/delete/preview')).status).toBe(403);
      expect((await sa.client.post('/account/delete/request')).status).toBe(403);
      expect(h.mailbox.deletionCodes.get(sa.email)).toBeUndefined();
      expect((await del(sa.client, { code: '123456' })).status).toBe(403);
      expect(await userExists(sa.email)).toBe(true);
    });
  });

  describe('a solo account', () => {
    it('preview is counts only; deleting removes everything, clears the cookie, ends the live stream, emails a notice', async () => {
      const { client, email, accountId } = await h.signIn();
      const mine = await fill(client, accountId);
      const endSpy = jest.spyOn(h.app.get(StreamsService), 'end');

      const preview = await client.get('/account/delete/preview');
      expect(preview.status).toBe(200);
      expect(preview.body).toEqual({ isOnlyAdmin: true, memberCount: 1, activeSubscription: null, liveStream: true, connectionsCount: 1, assetsCount: 1 });
      expect(JSON.stringify(preview.body)).not.toContain(email);

      const code = await ask(client, email);
      const res = await del(client, { code });
      expect(res.status).toBe(204);

      // The live stream was ended through the normal end logic, and the scheduled one was cancelled (which also ends it).
      const ended = endSpy.mock.calls.map((c) => c[0]);
      expect(ended).toEqual(expect.arrayContaining([mine.liveId, mine.scheduledId]));
      endSpy.mockRestore();

      expect(await rowsOf(accountId)).toEqual({ users: 0, streams: 0, connections: 0, kits: 0, assets: 0, presets: 0, subscriptions: 0, companies: 0, accounts: 0 });
      expect(storage.objects.has(mine.storageKey)).toBe(false);
      expect(await n('SELECT count(*)::int AS n FROM login_codes WHERE email IN ($1, $2)', [email, `delete:${email}`])).toBe(0);
      expect(await n('SELECT count(*)::int AS n FROM user_sessions')).toBeGreaterThanOrEqual(0);
      expect(h.mailbox.deleted).toContainEqual({ to: email, companyDeleted: false });

      // Logged out: the cookie is cleared and the old session is dead.
      expect((await client.get('/auth/me')).status).toBe(401);
      expect((await client.post('/account/delete/request')).status).toBe(401);

      // The audit row has ids only.
      const audit = (await h.db.query(`SELECT actor_user_id, action, target_id, metadata FROM superadmin_audit_log WHERE action = 'account_delete_company' AND target_id = $1`, [accountId])).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].actor_user_id).toBeNull();
      expect(JSON.stringify(audit[0].metadata)).not.toContain(email);

      // The same address can come back as a brand-new account.
      const again = await login(email);
      expect((await again.get('/auth/me')).status).toBe(200);
    });

    it('autopay is cancelled at Razorpay first; payments are kept without a name or email on an anonymous shell account', async () => {
      const { client, email, accountId } = await h.signIn();
      const sub = (await client.post('/billing/subscriptions', { planKey: 'starter' })).body.subscriptionId as string;
      const paymentId = pay(sub);
      expect(
        (await client.post('/billing/subscriptions/verify', { razorpay_subscription_id: sub, razorpay_payment_id: paymentId, razorpay_signature: rzp().subscriptionSignature(paymentId, sub) })).status,
      ).toBe(200);
      expect((await client.get('/account/delete/preview')).body.activeSubscription).toMatchObject({ plan: expect.any(String) });
      const renewal = (await client.get('/account/delete/preview')).body.activeSubscription.nextRenewal;
      expect(new Date(renewal).getTime()).toBeGreaterThan(Date.now());

      const before = rzp().callsTo(`/subscriptions/${sub}/cancel`).length;
      expect((await del(client, { code: await ask(client, email) })).status).toBe(204);
      const cancels = rzp().callsTo(`/subscriptions/${sub}/cancel`);
      expect(cancels).toHaveLength(before + 1);
      expect(cancels.at(-1)!.body).toEqual({ cancel_at_cycle_end: 0 });

      const rows = await rowsOf(accountId);
      expect(rows).toMatchObject({ users: 0, subscriptions: 0, accounts: 1 }); // the shell stays because a payment exists
      const shell = (await h.db.query('SELECT name, deleted_at, suspended_at, razorpay_customer_id, plan_key FROM accounts WHERE id = $1', [accountId])).rows[0];
      expect(shell).toMatchObject({ name: 'Deleted account', razorpay_customer_id: null, plan_key: 'free' });
      expect(shell.deleted_at).not.toBeNull();
      const payment = (await h.db.query('SELECT user_id, amount_paise, razorpay_payment_id FROM payments WHERE account_id = $1', [accountId])).rows;
      expect(payment).toHaveLength(1);
      expect(payment[0]).toMatchObject({ user_id: null, razorpay_payment_id: paymentId });
      expect(payment[0].amount_paise).toBeGreaterThan(0);

      // The shell does not show up in the superadmin directory.
      const dir = await superadmin.get('/superadmin/accounts?limit=200');
      expect(JSON.stringify(dir.body)).not.toContain(accountId);
    });

    it('if Razorpay cannot cancel the autopay, nothing is deleted and the same code still works afterwards', async () => {
      const { client, email, accountId } = await h.signIn();
      await fill(client, accountId);
      const sub = (await client.post('/billing/subscriptions', { planKey: 'starter' })).body.subscriptionId as string;
      await client.post('/billing/subscriptions/verify', { razorpay_subscription_id: sub, razorpay_payment_id: pay(sub), razorpay_signature: rzp().subscriptionSignature(pay(sub), sub) });

      const code = await ask(client, email);
      rzp().failCancels = true;
      try {
        const failed = await del(client, { code });
        expect(failed.status).toBe(502);
        expect(JSON.stringify(failed.body)).toMatch(/nothing was deleted/);
      } finally {
        rzp().failCancels = false;
      }
      const rows = await rowsOf(accountId);
      expect(rows).toMatchObject({ users: 1, streams: 2, connections: 1, assets: 1, kits: 1, presets: 1, subscriptions: 1, accounts: 1 });
      expect((await client.get('/auth/me')).status).toBe(200);

      expect((await del(client, { code })).status).toBe(204); // the code was not used up
      expect(await rowsOf(accountId)).toMatchObject({ users: 0, streams: 0, connections: 0, assets: 0, subscriptions: 0 });
    });
  });

  describe('a company', () => {
    it('a normal member deletes only themselves; the company, its data and the other people stay', async () => {
      const { admin, people } = await company(2);
      const mine = await fill(admin.client, admin.accountId);
      const [a, b] = people;

      expect((await a.client.get('/account/delete/preview')).body).toEqual({ isOnlyAdmin: false, memberCount: 3, activeSubscription: null, liveStream: false, connectionsCount: 0, assetsCount: 0 });
      expect((await del(a.client, { code: await ask(a.client, a.email) })).status).toBe(204);

      expect(await userExists(a.email)).toBe(false);
      expect(await userExists(b.email)).toBe(true);
      expect(await userExists(admin.email)).toBe(true);
      expect(await rowsOf(admin.accountId)).toMatchObject({ users: 2, streams: 2, connections: 1, assets: 1, kits: 1, presets: 1, accounts: 1, companies: 1 });
      expect(storage.objects.has(mine.storageKey)).toBe(true);
      expect((await a.client.get('/auth/me')).status).toBe(401);
      expect((await b.client.get('/auth/me')).status).toBe(200);
      expect((await admin.client.get('/streams')).status).toBe(200);
      expect(h.mailbox.deleted).toContainEqual({ to: a.email, companyDeleted: false });
    });

    it('one of two company admins deletes only themselves', async () => {
      const { admin, people } = await company(1);
      await h.db.query(`UPDATE users SET role = 'company_admin' WHERE email = $1`, [people[0].email]);
      expect((await admin.client.get('/account/delete/preview')).body).toMatchObject({ isOnlyAdmin: false, memberCount: 2 });
      expect((await del(admin.client, { code: await ask(admin.client, admin.email) })).status).toBe(204);
      expect(await userExists(admin.email)).toBe(false);
      expect(await userExists(people[0].email)).toBe(true);
      expect((await rowsOf(admin.accountId)).accounts).toBe(1);
    });

    it('the only admin must confirm the company deletion (409 without, code kept); with it the whole company goes', async () => {
      const { admin, people } = await company(2);
      const mine = await fill(admin.client, admin.accountId);
      const preview = await admin.client.get('/account/delete/preview');
      expect(preview.body).toMatchObject({ isOnlyAdmin: true, memberCount: 3, liveStream: true, connectionsCount: 1, assetsCount: 1 });

      const code = await ask(admin.client, admin.email);
      const refused = await del(admin.client, { code });
      expect(refused.status).toBe(409);
      expect(JSON.stringify(refused.body)).toMatch(/whole company/);
      expect((await del(admin.client, { code, confirmCompanyDeletion: false })).status).toBe(409);
      expect((await rowsOf(admin.accountId)).users).toBe(3);

      // A wrong code is a 400 even with the confirmation.
      expect((await del(admin.client, { code: code === '123456' ? '654321' : '123456', confirmCompanyDeletion: true })).status).toBe(400);
      expect((await rowsOf(admin.accountId)).users).toBe(3);

      expect((await del(admin.client, { code, confirmCompanyDeletion: true })).status).toBe(204);
      expect(await rowsOf(admin.accountId)).toEqual({ users: 0, streams: 0, connections: 0, kits: 0, assets: 0, presets: 0, subscriptions: 0, companies: 0, accounts: 0 });
      expect(storage.objects.has(mine.storageKey)).toBe(false);
      for (const p of people) {
        expect(await userExists(p.email)).toBe(false);
        expect((await p.client.get('/auth/me')).status).toBe(401);
        expect(h.mailbox.deleted).toContainEqual({ to: p.email, companyDeleted: true });
      }
      expect(h.mailbox.deleted).toContainEqual({ to: admin.email, companyDeleted: false });
    });

    it('a company with only its admin needs no extra confirmation', async () => {
      const { admin } = await company(0);
      expect((await admin.client.get('/account/delete/preview')).body).toMatchObject({ isOnlyAdmin: true, memberCount: 1 });
      expect((await del(admin.client, { code: await ask(admin.client, admin.email) })).status).toBe(204);
      expect((await rowsOf(admin.accountId)).accounts).toBe(0);
    });
  });

  it('deleting one account leaves every other account untouched', async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    await fill(a.client, a.accountId);
    const theirs = await fill(b.client, b.accountId);
    const before = await rowsOf(b.accountId);

    expect((await del(a.client, { code: await ask(a.client, a.email) })).status).toBe(204);

    expect(await rowsOf(b.accountId)).toEqual(before);
    expect(storage.objects.has(theirs.storageKey)).toBe(true);
    expect((await b.client.get('/streams')).status).toBe(200);
    expect((await b.client.get('/assets')).body.items).toHaveLength(1);
  });
});
