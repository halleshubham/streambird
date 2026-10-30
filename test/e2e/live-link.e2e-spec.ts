import { describeE2E, bootApp, Harness } from './harness';
import { PlatformConnectionsService } from '../../src/platform-connections/platform-connections.service';
import * as crypto from 'crypto';

describeE2E('permanent live link: /stream/<slug>', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootApp();
  });
  afterAll(() => h.close());

  const go = (slug: string) => fetch(`${h.baseUrl}/stream/${slug}`, { redirect: 'manual' });
  const rand = () => crypto.randomBytes(4).toString('hex');

  async function youtubeConnection(accountId: string, channelId = `UC${rand()}`) {
    const svc = h.app.get(PlatformConnectionsService);
    const c = await svc.upsertYouTubeConnection(accountId, { channelId, channelTitle: 'My Channel' }, { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
    return { id: c.id, slug: c.liveSlug!, channelId };
  }

  async function liveDestination(accountId: string, connectionId: string, o: { streamStatus: string; destStatus: string; watchUrl: string | null; createdAt?: string }) {
    const s = await h.db.query(`INSERT INTO live_streams (account_id, title, status) VALUES ($1, 'live link test', $2::stream_status_enum) RETURNING id`, [accountId, o.streamStatus]);
    await h.db.query(
      `INSERT INTO live_stream_destinations (live_stream_id, platform_connection_id, status, watch_url, created_at)
       VALUES ($1, $2, $3::destination_status_enum, $4, COALESCE($5::timestamptz, now()))`,
      [s.rows[0].id, connectionId, o.destStatus, o.watchUrl, o.createdAt ?? null],
    );
  }

  it('the connections API returns liveSlug and an absolute liveLinkUrl; Twitch has none', async () => {
    const { client, accountId } = await h.signIn();
    const yt = await youtubeConnection(accountId);
    const tw = await client.post('/platform-connections/twitch/manual', { label: 'My Twitch', ingestServerUrl: 'rtmp://live.example/app', streamKey: crypto.randomBytes(8).toString('hex') });
    expect(tw.status).toBe(201);
    expect(tw.body.liveSlug).toBeNull();
    expect(tw.body.liveLinkUrl).toBeNull();

    const list = await client.get('/platform-connections');
    const row = list.body.find((c: any) => c.id === yt.id);
    expect(row.liveSlug).toBe(yt.slug);
    expect(row.liveSlug).toMatch(/^[a-z2-7]{10}$/);
    expect(row.liveLinkUrl).toBe(`${h.baseUrl}/stream/${yt.slug}`);
    expect(JSON.stringify(list.body)).not.toContain('credentials');
  });

  it('a reconnect keeps the same slug', async () => {
    const { accountId } = await h.signIn();
    const first = await youtubeConnection(accountId);
    const again = await youtubeConnection(accountId, first.channelId);
    expect(again.id).toBe(first.id);
    expect(again.slug).toBe(first.slug);
  });

  it('redirects to the channel when nothing is live, with no-store, and shows no account data', async () => {
    const { accountId } = await h.signIn();
    const yt = await youtubeConnection(accountId);
    const res = await go(yt.slug);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://www.youtube.com/channel/${yt.channelId}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).not.toContain('My Channel');
    expect(body).not.toContain(accountId);

    // streams that are scheduled/ended, or a live stream whose destination is not live yet, do not count
    await liveDestination(accountId, yt.id, { streamStatus: 'ended', destStatus: 'ended', watchUrl: 'https://www.youtube.com/watch?v=ended' });
    await liveDestination(accountId, yt.id, { streamStatus: 'live', destStatus: 'ready', watchUrl: 'https://www.youtube.com/watch?v=ready' });
    await liveDestination(accountId, yt.id, { streamStatus: 'live', destStatus: 'live', watchUrl: null });
    expect((await go(yt.slug)).headers.get('location')).toBe(`https://www.youtube.com/channel/${yt.channelId}`);
  });

  it('redirects to the most recent live destination watch URL while live, and back to the channel after', async () => {
    const { accountId } = await h.signIn();
    const yt = await youtubeConnection(accountId);
    await liveDestination(accountId, yt.id, { streamStatus: 'live', destStatus: 'live', watchUrl: 'https://www.youtube.com/watch?v=older', createdAt: '2026-01-01T00:00:00Z' });
    await liveDestination(accountId, yt.id, { streamStatus: 'live', destStatus: 'live', watchUrl: 'https://www.youtube.com/watch?v=newest', createdAt: '2026-02-01T00:00:00Z' });
    const live = await go(yt.slug);
    expect(live.status).toBe(302);
    expect(live.headers.get('location')).toBe('https://www.youtube.com/watch?v=newest');
    expect(live.headers.get('cache-control')).toBe('no-store');

    await h.db.query(`UPDATE live_streams SET status = 'ended' WHERE account_id = $1`, [accountId]);
    expect((await go(yt.slug)).headers.get('location')).toBe(`https://www.youtube.com/channel/${yt.channelId}`);
  });

  it('only the connection that owns the slug is affected by another connection being live', async () => {
    const { accountId } = await h.signIn();
    const a = await youtubeConnection(accountId);
    const b = await youtubeConnection(accountId);
    await liveDestination(accountId, a.id, { streamStatus: 'live', destStatus: 'live', watchUrl: 'https://www.youtube.com/watch?v=onlya' });
    expect((await go(b.slug)).headers.get('location')).toBe(`https://www.youtube.com/channel/${b.channelId}`);
    expect((await go(a.slug)).headers.get('location')).toBe('https://www.youtube.com/watch?v=onlya');
  });

  it('a Facebook Page goes to the page', async () => {
    const { accountId } = await h.signIn();
    const pageId = `${Date.now()}${rand()}`.replace(/\D/g, '').slice(0, 15) || '12345';
    const c = await h.app.get(PlatformConnectionsService).upsertFacebookConnection(accountId, { pageId, pageName: 'My Page' }, 'page-token');
    const res = await go(c.liveSlug!);
    expect(res.headers.get('location')).toBe(`https://www.facebook.com/${pageId}`);
  });

  it('unknown, junk and removed connections go to the site home, revealing nothing', async () => {
    const { client, accountId } = await h.signIn();
    for (const slug of ['zzzzzzzzzz', 'ABCDEFGHIJ', '..%2F..%2Fapi', 'x']) {
      const res = await go(slug);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    const yt = await youtubeConnection(accountId);
    const del = await client.del(`/platform-connections/${yt.id}`);
    expect(del.status).toBe(204);
    expect((await go(yt.slug)).headers.get('location')).toBe('/');
  });

  it('is public (no sign-in) and not shadowed by the SPA fallback', async () => {
    const res = await go('zzzzzzzzzz');
    expect(res.status).toBe(302);
    expect((await res.text()).toLowerCase()).not.toContain('<html');
  });

  it('is throttled per client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) statuses.push((await go('zzzzzzzzzz')).status);
    expect(statuses).toContain(429);
    expect(statuses[0]).toBe(302);
  });
});
