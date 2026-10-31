import { STREAM_PROVIDERS } from '../../src/providers/provider.tokens';
import { MediaMtxService } from '../../src/relay/mediamtx.service';
import { StaleStreamReaperService } from '../../src/streams/stale-stream-reaper.service';
import { describeE2E, bootApp, Client, Harness } from './harness';

const MIN = 60_000;

/** Streams that are marked live but have no moving picture are ended on their own (and the host can see why). */
describeE2E('stale live streams are ended automatically', () => {
  let h: Harness;
  let reaper: StaleStreamReaperService;
  let stats: Map<string, { ready: boolean; inboundBytes: number | null }> | null;

  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    const twitch: any = (h.app.get(STREAM_PROVIDERS) as any[]).find((p) => p.identifier === 'twitch');
    twitch.createBroadcast = async () => ({ ingestUrl: 'rtmp://live.example.com/app', streamKey: 'k', platformBroadcastId: 'bc-stale', watchUrl: null });
    reaper = h.app.get(StaleStreamReaperService);
    // MediaMTX answers with whatever path stats this test sets (the harness stand-in only registers paths).
    jest.spyOn(h.app.get(MediaMtxService), 'listPathStats').mockImplementation(async () => stats);
  });
  afterAll(() => h.close());
  beforeEach(() => {
    stats = new Map();
  });

  async function liveStream(c: Client, title: string) {
    const conn = await c.post('/platform-connections/twitch/manual', { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'key-t' });
    const s = await c.post('/streams', { title, destinationConnectionIds: [conn.body.id] });
    expect(s.status).toBe(201);
    expect(s.body.whipUrl).toBeTruthy();
    return s.body.id as string;
  }
  const status = async (c: Client, id: string) => (await c.get(`/streams/${id}`)).body;
  const usage = async (accountId: string) => Number((await h.db.query(`SELECT stream_hour_usage_current_period AS u FROM accounts WHERE id = $1`, [accountId])).rows[0].u);

  it('a stream no picture ever arrived for is ended after 30 minutes, bills no hours, and says why on its destinations', async () => {
    const { client, accountId } = await h.signIn();
    const id = await liveStream(client, 'never published');
    const t0 = Date.now();

    await reaper.tick(t0);
    await reaper.tick(t0 + 29 * MIN);
    expect((await status(client, id)).status).toBe('live');

    await reaper.tick(t0 + 31 * MIN);
    const ended = await status(client, id);
    expect(ended.status).toBe('ended');
    expect(ended.destinations[0].errorMessage).toMatch(/Ended automatically: no video arrived within 30 minutes/);
    expect(await usage(accountId)).toBe(0);
  });

  it('a connected publisher that sends nothing for 5 minutes is ended; one that keeps sending is not', async () => {
    const { client } = await h.signIn();
    const moving = await liveStream(client, 'moving');
    const frozen = await liveStream(client, 'frozen');
    const t0 = Date.now();

    stats = new Map([
      [moving, { ready: true, inboundBytes: 1000 }],
      [frozen, { ready: true, inboundBytes: 1000 }],
    ]);
    await reaper.tick(t0);
    for (let i = 1; i <= 7; i++) {
      stats = new Map([
        [moving, { ready: true, inboundBytes: 1000 + i * 5000 }],
        [frozen, { ready: true, inboundBytes: 1000 }],
      ]);
      await reaper.tick(t0 + i * MIN);
    }

    expect((await status(client, moving)).status).toBe('live');
    const ended = await status(client, frozen);
    expect(ended.status).toBe('ended');
    expect(ended.destinations[0].errorMessage).toMatch(/no video data arrived for 5 minutes/);
  });

  it('does nothing when MediaMTX cannot be reached, and leaves a stream that was publishing to the glitch recovery', async () => {
    const { client } = await h.signIn();
    const id = await liveStream(client, 'blip');
    const t0 = Date.now();

    stats = null;
    await reaper.tick(t0 + 120 * MIN);
    expect((await status(client, id)).status).toBe('live');

    stats = new Map([[id, { ready: true, inboundBytes: 10 }]]);
    await reaper.tick(t0 + 121 * MIN);
    stats = new Map(); // the publisher dropped: the slate/glitch recovery owns it now, not the reaper
    await reaper.tick(t0 + 200 * MIN);
    expect((await status(client, id)).status).toBe('live');
  });
});
