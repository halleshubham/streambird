import { describeE2E, bootApp, Client, Harness, ids } from './harness';

describeE2E('superadmin: heavy usage watch', () => {
  let h: Harness;
  let admin: Client;
  const unlimitedKey = ids('unl')('plan').toLowerCase().replace(/[^a-z0-9_]/g, '_');

  beforeAll(async () => {
    h = await bootApp();
    admin = (await h.signIn({ superadmin: true })).client;
  });
  afterAll(async () => {
    // Other specs assert the exact public plan list, so leave no plan of ours behind.
    await h.db.query(`UPDATE accounts SET plan_key = 'free' WHERE plan_key = $1`, [unlimitedKey]);
    await h.db.query(`DELETE FROM plans WHERE key = $1`, [unlimitedKey]);
    await h.close();
  });

  async function account(planKey: string, hours: number, override?: number) {
    const s = await h.signIn();
    await h.db.query(
      `UPDATE accounts SET plan_key = $2, stream_hour_usage_current_period = $3, included_hours_override = $4,
              billing_period_start = (now() - interval '5 days')::date WHERE id = $1`,
      [s.accountId, planKey, hours, override ?? null],
    );
    return s;
  }

  it('is superadmin only', async () => {
    const user = await h.signIn();
    expect((await user.client.get('/superadmin/analytics/heavy-usage')).status).toBe(403);
    expect((await new Client(h.baseUrl).get('/superadmin/analytics/heavy-usage')).status).toBeGreaterThanOrEqual(401);
    expect((await admin.get('/superadmin/analytics/heavy-usage')).status).toBe(200);
  });

  it('ranks by percent used, does the percent maths, derives destination-hours and lists unlimited plans after', async () => {
    expect((await admin.post('/superadmin/plans', { key: unlimitedKey, name: 'Unl', includedHoursPerMonth: null, maxDestinations: 3, maxGuests: 5 })).status).toBe(201);
    // The list is capped at 20 and the database is shared with other specs: start from nobody having used hours.
    await h.db.query(`UPDATE accounts SET stream_hour_usage_current_period = 0`);
    const half = await account('pro', 100); // 50% of 200
    const near = await account('pro', 190); // 95%
    const custom = await account('pro', 30, 40); // override 40h -> 75%
    const unl = await account(unlimitedKey, 500);
    await h.db.query(`UPDATE accounts SET name = 'Heavy Co' WHERE id = $1`, [near.accountId]);

    // near: one 1h stream with 3 destinations, 1 of them failed -> 2 destination-hours -> Rs 4.8
    const conn = async (label: string) =>
      (await near.client.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' })).body.id as string;
    const [c1, c2, c3] = [await conn('A'), await conn('B'), await conn('C')];
    const stream = await h.db.query(
      `INSERT INTO live_streams (account_id, title, status, started_at, ended_at)
       VALUES ($1, 't', 'ended', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`,
      [near.accountId],
    );
    for (const [c, status] of [[c1, 'ended'], [c2, 'ended'], [c3, 'failed']]) {
      await h.db.query(`INSERT INTO live_stream_destinations (live_stream_id, platform_connection_id, status) VALUES ($1, $2, $3)`, [stream.rows[0].id, c, status]);
    }

    const res = await admin.get('/superadmin/analytics/heavy-usage');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(20);
    const mine = [near, custom, half, unl].map((s) => res.body.find((r: any) => r.accountId === s.accountId));
    expect(mine.every(Boolean)).toBe(true);
    const order = res.body.map((r: any) => r.accountId);
    expect(order.indexOf(near.accountId)).toBeLessThan(order.indexOf(custom.accountId));
    expect(order.indexOf(custom.accountId)).toBeLessThan(order.indexOf(half.accountId));
    expect(order.indexOf(half.accountId)).toBeLessThan(order.indexOf(unl.accountId));

    expect(mine[0]).toMatchObject({ accountName: 'Heavy Co', ownerEmail: near.email, planKey: 'pro', hoursUsed: 190, includedHours: 200, percentUsed: 95 });
    expect(mine[0].destinationHours).toBeCloseTo(2, 1);
    expect(mine[0].estimatedBandwidthCostInr).toBeCloseTo(4.8, 1);
    expect(mine[1]).toMatchObject({ includedHours: 40, percentUsed: 75, destinationHours: 0, estimatedBandwidthCostInr: 0 });
    expect(mine[2]).toMatchObject({ percentUsed: 50 });
    expect(mine[3]).toMatchObject({ planKey: unlimitedKey, hoursUsed: 500, includedHours: null, percentUsed: null });
  });

  it('leaves out accounts that have used no hours', async () => {
    const idle = await h.signIn();
    const res = await admin.get('/superadmin/analytics/heavy-usage');
    expect(res.body.some((r: any) => r.accountId === idle.accountId)).toBe(false);
  });
});
