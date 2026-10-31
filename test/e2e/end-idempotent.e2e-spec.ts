import { STREAM_PROVIDERS } from '../../src/providers/provider.tokens';
import { describeE2E, bootApp, Harness } from './harness';

/** Ending a stream twice (a retry, two clients, the phone's stale-stream card plus its own End) must bill the hours once. */
describeE2E('POST /streams/:id/end is idempotent', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    const twitch: any = (h.app.get(STREAM_PROVIDERS) as any[]).find((p) => p.identifier === 'twitch');
    twitch.createBroadcast = async () => ({ ingestUrl: 'rtmp://live.example.com/app', streamKey: 'k', platformBroadcastId: 'bc-end', watchUrl: null });
  });
  afterAll(() => h.close());

  const usage = async (accountId: string) =>
    Number((await h.db.query(`SELECT stream_hour_usage_current_period AS u FROM accounts WHERE id = $1`, [accountId])).rows[0].u);

  it('the first End records the elapsed hours; a second End returns the ended stream and changes nothing', async () => {
    const { client, accountId } = await h.signIn();
    const conn = await client.post('/platform-connections/twitch/manual', { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'key-t' });
    const created = await client.post('/streams', { title: 'twice', destinationConnectionIds: [conn.body.id] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await h.db.query(`UPDATE live_streams SET started_at = now() - interval '2 hours' WHERE id = $1`, [id]);

    const before = await usage(accountId);
    const first = await client.post(`/streams/${id}/end`, {});
    expect(first.status).toBeLessThan(300);
    expect(first.body.status).toBe('ended');
    const afterFirst = await usage(accountId);
    expect(afterFirst - before).toBeGreaterThan(1.9);
    expect(afterFirst - before).toBeLessThan(2.1);

    const second = await client.post(`/streams/${id}/end`, {});
    expect(second.status).toBeLessThan(300);
    expect(second.body.status).toBe('ended');
    expect(second.body.endedAt).toBe(first.body.endedAt);
    expect(await usage(accountId)).toBeCloseTo(afterFirst, 5);
  });
});
