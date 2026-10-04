import { describeE2E, bootApp, Client, Harness, ids } from './harness';

const planKey = ids('e2e')('creator');

describeE2E('plans: admin-configurable limits, enforced', () => {
  let h: Harness;
  let admin: Client;

  beforeAll(async () => {
    h = await bootApp();
    admin = (await h.signIn({ superadmin: true })).client;
  });
  afterAll(async () => {
    await h.db.query(`UPDATE plans SET max_destinations = 1 WHERE key = 'free'`);
    await h.db.query(`UPDATE accounts SET plan_key = 'free' WHERE plan_key = $1`, [planKey]);
    await h.db.query(`DELETE FROM plans WHERE key = $1`, [planKey]);
    await h.close();
  });

  const twitch = (c: Client, label: string) =>
    c.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: `key-${label}` }).then((r) => r.body.id as string);

  it('serves the seeded public plans without authentication', async () => {
    const plans = (await new Client(h.baseUrl).get('/plans/public')).body.filter((p: any) => !p.key.startsWith('e2e_'));
    expect(plans.map((p: any) => [p.key, p.priceInr, p.maxGuests, p.maxDestinations])).toEqual([
      ['free', 0, 2, 1],
      ['starter', 999, 4, 2],
      ['pro', 1999, 6, 4],
      ['enterprise', 6999, 8, 6],
      ['day_pass', 199, 10, 4],
    ]);
  });

  it('a Free account is refused a 2nd destination with a message that says what to do; one is fine', async () => {
    const { client } = await h.signIn();
    const a = await twitch(client, 'A');
    const b = await twitch(client, 'B');
    const refused = await client.post('/streams', { title: 't', destinationConnectionIds: [a, b] });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toMatch(/Free plan allows up to 1 destination per stream, but 2 were selected/);
    expect((await client.post('/streams', { title: 't', destinationConnectionIds: [a] })).status).toBe(201);
  });

  it('a day pass lifts the cap; revoking it puts it back', async () => {
    const { client, accountId } = await h.signIn();
    const a = await twitch(client, 'A');
    const b = await twitch(client, 'B');
    expect((await client.post('/streams', { title: 't', destinationConnectionIds: [a, b] })).status).toBe(403);

    expect((await admin.post(`/superadmin/accounts/${accountId}/day-pass`, {})).status).toBe(200);
    const limits = (await client.get('/plans/me')).body;
    expect(limits).toMatchObject({ maxDestinations: 4, maxGuests: 10 });
    expect(limits.dayPass.name).toBe('Day Pass');
    expect((await client.post('/streams', { title: 't2', destinationConnectionIds: [a, b] })).status).toBe(201);

    await admin.del(`/superadmin/accounts/${accountId}/day-pass`);
    expect((await client.get('/plans/me')).body.dayPass).toBeNull();
  });

  it("an admin edit applies immediately to everyone on the plan; per-account overrides beat the plan", async () => {
    const { client, accountId } = await h.signIn();
    const a = await twitch(client, 'A');
    const b = await twitch(client, 'B');
    expect((await client.post('/streams', { title: 't', destinationConnectionIds: [a, b] })).status).toBe(403);

    const edited = await admin.patch('/superadmin/plans/free', { maxDestinations: 3 });
    expect(edited.body.maxDestinations).toBe(3);
    expect((await client.post('/streams', { title: 't', destinationConnectionIds: [a, b] })).status).toBe(201);

    await admin.patch('/superadmin/plans/free', { maxDestinations: 1 });
    expect((await client.post('/streams', { title: 't', destinationConnectionIds: [a, b] })).status).toBe(403);
    await admin.patch(`/superadmin/accounts/${accountId}/subscription`, { maxDestinationsOverride: 2 });
    expect((await client.post('/streams', { title: 't', destinationConnectionIds: [a, b] })).status).toBe(201);
  });

  it('creates plans (validated), including unlimited hours and a session cap; unlimited never blocks on hours', async () => {
    expect((await admin.post('/superadmin/plans', { key: 'Bad Key', name: 'x', maxDestinations: 1, maxGuests: 1 })).status).toBe(400);
    const created = await admin.post('/superadmin/plans', { key: planKey, name: 'Creator', includedHoursPerMonth: null, maxDestinations: 3, maxGuests: 5, maxSessionHours: 12, priceInr: 1499 });
    expect(created.status).toBe(201);
    expect(created.body.includedHoursPerMonth).toBeNull();
    expect(Number(created.body.maxSessionHours)).toBe(12);

    const { client, accountId } = await h.signIn();
    await admin.patch(`/superadmin/accounts/${accountId}/subscription`, { planKey });
    await h.db.query(`UPDATE accounts SET stream_hour_usage_current_period = 9999 WHERE id = $1`, [accountId]);
    const a = await twitch(client, 'A');
    expect((await client.post('/streams', { title: 't', destinationConnectionIds: [a] })).status).toBe(201);
    expect((await client.get('/plans/me')).body).toMatchObject({ planKey, includedHours: null, maxSessionHours: 12 });
  });

  it('a Free account out of hours is stopped with a clear message', async () => {
    const { client, accountId } = await h.signIn();
    await h.db.query(`UPDATE accounts SET stream_hour_usage_current_period = 2 WHERE id = $1`, [accountId]);
    const a = await twitch(client, 'A');
    const r = await client.post('/streams', { title: 't', destinationConnectionIds: [a] });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toMatch(/Free plan/);
  });

  it('only superadmins can touch plans', async () => {
    const { client } = await h.signIn();
    expect((await client.patch('/superadmin/plans/free', { maxDestinations: 50 })).status).toBeGreaterThanOrEqual(401);
    expect((await client.get('/superadmin/plans')).status).toBeGreaterThanOrEqual(401);
  });
});
