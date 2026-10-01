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
});
