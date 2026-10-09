import { describeE2E, bootApp, Client, Harness } from './harness';

describeE2E('guest invite password: checked on the join form before the room', () => {
  let h: Harness;
  let host: Client;
  let sessionId: string;
  let locked: string;
  let open: string;

  beforeAll(async () => {
    h = await bootApp();
    ({ client: host } = await h.signIn());
    const dest = await host.post('/platform-connections/twitch/manual', { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' });
    const stream = await host.post('/streams', { title: 'pw', destinationConnectionIds: [dest.body.id] });
    expect(stream.status).toBe(201);
    sessionId = stream.body.studioSessionId;
    locked = (await host.post(`/studio-sessions/${sessionId}/invites`, { password: 'open-sesame' })).body.token;
    open = (await host.post(`/studio-sessions/${sessionId}/invites`, {})).body.token;
  });
  afterAll(async () => {
    await h.close();
  });

  const check = (token: string, password?: string) => new Client(h.baseUrl).post(`/studio-sessions/invites/${token}/check-password`, password === undefined ? {} : { password });

  it('refuses a missing or wrong password and accepts the right one, with no login needed', async () => {
    expect((await check(locked)).status).toBe(400);
    expect((await check(locked, 'nope')).status).toBe(400);
    expect((await check(locked, 'open-sesame')).status).toBe(204);
  });

  it('an invite without a password always passes, and an unknown invite is not found', async () => {
    expect((await check(open)).status).toBe(204);
    expect((await check('no-such-token', 'x')).status).toBe(404);
  });

  it('is throttled, because it is an unauthenticated password check', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await check(locked, `guess-${i}`)).status);
    expect(statuses).toContain(429);
  });
});
