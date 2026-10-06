import { describeE2E, bootApp, Client, Harness, ids } from './harness';

const reviewer = `${ids('review')('a')}@e2e.test`.toLowerCase();

describeE2E('review account: listed addresses can use the product without an admin step', () => {
  let h: Harness;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.REVIEW_ACCOUNT_EMAILS;
    process.env.REVIEW_ACCOUNT_EMAILS = `Someone-else@e2e.test, ${reviewer.toUpperCase()}`;
    h = await bootApp();
    // bootApp resets some env; set it again for the running app (the setting is read at sign-in).
    process.env.REVIEW_ACCOUNT_EMAILS = `Someone-else@e2e.test, ${reviewer.toUpperCase()}`;
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.REVIEW_ACCOUNT_EMAILS;
    else process.env.REVIEW_ACCOUNT_EMAILS = previous;
    await h.close();
  });

  const signInByCode = async (email: string) => {
    const c = new Client(h.baseUrl);
    await c.post('/auth/request-code', { email });
    const verified = await c.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) });
    expect(verified.status).toBe(200);
    return { c, verified };
  };

  it('a listed address is approved on its first sign-in and can create a stream straight away', async () => {
    const { c, verified } = await signInByCode(reviewer);
    expect(verified.body.user.approvedAt).not.toBeNull();

    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.approvedAt).not.toBeNull();

    // On the review plan (pro) with no expiry, and past the approval gate.
    const limits = await c.get('/plans/me');
    expect(limits.status).toBe(200);
    expect(limits.body.planKey).toBe('pro');
    expect(limits.body.planExpiresAt).toBeNull();

    const dest = await c.post('/platform-connections/twitch/manual', { label: 'R', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' });
    expect(dest.status).toBe(201);
    const stream = await c.post('/streams', { title: 'review', destinationConnectionIds: [dest.body.id] });
    expect(stream.status).toBe(201);
  });

  it('any other address is still held for approval', async () => {
    const { c, verified } = await signInByCode(`${ids('other')('b')}@e2e.test`.toLowerCase());
    expect(verified.body.user.approvedAt).toBeNull();
    const dest = await c.post('/platform-connections/twitch/manual', { label: 'X', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' });
    expect(dest.status).toBe(403);
  });
});
