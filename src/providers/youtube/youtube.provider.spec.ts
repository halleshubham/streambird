import { YouTubeProvider } from './youtube.provider';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';
import { Platform } from '../../common/enums/platform.enum';

describe('YouTubeProvider', () => {
  const fakeCreds = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60 * 60_000, // an hour from now -- not near expiry
    channelId: 'yt_channel_1',
  };

  const conn = {
    id: 'conn_1',
    platform: Platform.YOUTUBE,
    credentialsCiphertext: Buffer.from('ciphertext'),
  } as PlatformConnection;

  let fetchMock: jest.Mock;

  function buildProvider() {
    const encryption = {
      decrypt: jest.fn().mockReturnValue(fakeCreds),
      encrypt: jest.fn().mockReturnValue(Buffer.from('new-ciphertext')),
    } as any;
    const googleOAuth = { refreshAccessToken: jest.fn() } as any;
    const connections = { update: jest.fn() } as any;
    return { provider: new YouTubeProvider(encryption, googleOAuth, connections), encryption, googleOAuth, connections };
  }

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('createBroadcast creates the broadcast, the stream, binds them, and returns the RTMP ingest/key', async () => {
    const { provider } = buildProvider();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'broadcast_1' })) // liveBroadcasts.insert
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'stream_1',
          cdn: { ingestionInfo: { ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', streamName: 'abcd-1234' } },
        }),
      ) // liveStreams.insert
      .mockResolvedValueOnce(jsonResponse({ id: 'broadcast_1' })); // liveBroadcasts.bind

    const result = await provider.createBroadcast(conn, { title: 'Test stream' });

    expect(result).toEqual({
      ingestUrl: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'abcd-1234',
      platformBroadcastId: 'broadcast_1',
      watchUrl: 'https://www.youtube.com/watch?v=broadcast_1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/liveBroadcasts?part=');
    expect(fetchMock.mock.calls[1][0]).toContain('/liveStreams?part=');
    expect(fetchMock.mock.calls[2][0]).toContain('/liveBroadcasts/bind?id=broadcast_1&streamId=stream_1');
  });

  it('createBroadcast refreshes an expired access token before calling the API, and persists the refreshed token', async () => {
    const { provider, encryption, googleOAuth, connections } = buildProvider();
    encryption.decrypt.mockReturnValue({ ...fakeCreds, expiresAt: Date.now() - 1000 }); // already expired
    googleOAuth.refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresInSeconds: 3600 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'b1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 's1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://x', streamName: 'k' } } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'b1' }));

    await provider.createBroadcast(conn, { title: 'Test stream' });

    expect(googleOAuth.refreshAccessToken).toHaveBeenCalledWith('refresh-token');
    expect(connections.update).toHaveBeenCalledWith('conn_1', {
      credentialsCiphertext: Buffer.from('new-ciphertext'),
    });
    // The API calls themselves must use the freshly refreshed token, not the stale one.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer new-token');
  });

  it('createBroadcast defaults to unlisted visibility when none is given', async () => {
    const { provider } = buildProvider();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'b1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 's1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://x', streamName: 'k' } } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'b1' }));

    await provider.createBroadcast(conn, { title: 'Test stream' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.status.privacyStatus).toBe('unlisted');
  });

  it('createBroadcast passes through an explicit visibility choice', async () => {
    const { provider } = buildProvider();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'b1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 's1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://x', streamName: 'k' } } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'b1' }));

    await provider.createBroadcast(conn, { title: 'Test stream', visibility: 'public' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.status.privacyStatus).toBe('public');
  });

  it('createBroadcast throws with a clear message when the YouTube API rejects the request', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'quota exceeded' }, false, 403));

    await expect(provider.createBroadcast(conn, { title: 'Test stream' })).rejects.toThrow(/403/);
  });

  it('endBroadcast transitions the broadcast to complete', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'broadcast_1' }));

    await provider.endBroadcast(conn, 'broadcast_1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/liveBroadcasts/transition?broadcastStatus=complete&id=broadcast_1'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('endBroadcast swallows a failure -- enableAutoStop may have already completed it', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 403));

    await expect(provider.endBroadcast(conn, 'broadcast_1')).resolves.toBeUndefined();
  });

  it('getViewerCount reads concurrentViewers from videos.list', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ liveStreamingDetails: { concurrentViewers: '17' } }] }),
    );

    const count = await provider.getViewerCount!(conn, 'broadcast_1');
    expect(count).toBe(17);
  });

  it('getViewerCount returns 0 when the broadcast has no liveStreamingDetails (not currently live)', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    const count = await provider.getViewerCount!(conn, 'broadcast_1');
    expect(count).toBe(0);
  });

  it("getBroadcastStatus reads YouTube's real lifecycleStatus -- distinct from this app's own optimistic LIVE status", async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ status: { lifeCycleStatus: 'testing' } }] }));

    const status = await provider.getBroadcastStatus(conn, 'broadcast_1');

    expect(status).toBe('testing');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/liveBroadcasts?part=status&id=broadcast_1'),
      expect.anything(),
    );
  });

  it('getBroadcastStatus returns null when the broadcast no longer exists', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    const status = await provider.getBroadcastStatus(conn, 'broadcast_1');
    expect(status).toBeNull();
  });

  it('createBroadcast schedules the broadcast at the given time (used when a scheduled stream pre-creates it)', async () => {
    const { provider } = buildProvider();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'b' }))
      .mockResolvedValueOnce(jsonResponse({ id: 's', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://x/live2', streamName: 'k' } } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'b' }));
    const at = new Date('2026-10-10T13:00:00Z');

    await provider.createBroadcast(conn, { title: 'T', scheduledAt: at, precreate: true });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).snippet.scheduledStartTime).toBe(at.toISOString());
  });

  it('updateBroadcast PUTs the new snippet (title + scheduledStartTime are mandatory) and privacy', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'b' }));
    const at = new Date('2026-10-11T09:30:00Z');

    await provider.updateBroadcast(conn, 'b', { title: 'New title', description: 'd', scheduledAt: at, visibility: 'public' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/liveBroadcasts?part=snippet,status');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      id: 'b',
      snippet: { title: 'New title', description: 'd', scheduledStartTime: at.toISOString() },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    });
  });

  it('deleteBroadcast DELETEs the broadcast and copes with the empty 204 response', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body'); }, text: async () => '' });

    await expect(provider.deleteBroadcast(conn, 'b')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toContain('/liveBroadcasts?id=b');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('setBroadcastThumbnail uploads the image bytes to thumbnails.set for the broadcast id', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const data = Buffer.from([1, 2, 3, 4]);

    await provider.setBroadcastThumbnail(conn, 'b_1', { contentType: 'image/png', data, width: 1280, height: 720 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=b_1&uploadType=media');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('image/png');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(Buffer.from(init.body)).toEqual(data);
  });

  it('setBroadcastThumbnail explains the verified-channel requirement on a 403', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, false, 403));

    await expect(
      provider.setBroadcastThumbnail(conn, 'b_1', { contentType: 'image/jpeg', data: Buffer.from([1]), width: 1280, height: 720 }),
    ).rejects.toThrow(/verified channel/);
  });
});
