import { FacebookProvider } from './facebook.provider';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';
import { Platform } from '../../common/enums/platform.enum';

describe('FacebookProvider', () => {
  const fakeCreds = { pageAccessToken: 'page-token', pageId: 'page_1' };

  const conn = {
    id: 'conn_1',
    platform: Platform.FACEBOOK,
    credentialsCiphertext: Buffer.from('ciphertext'),
  } as PlatformConnection;

  let fetchMock: jest.Mock;

  function buildProvider() {
    const encryption = { decrypt: jest.fn().mockReturnValue(fakeCreds) } as any;
    return { provider: new FacebookProvider(encryption), encryption };
  }

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: async () => body };
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('createBroadcast creates the live video and splits secure_stream_url into ingestUrl/streamKey', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'video_1', secure_stream_url: 'rtmps://rtmp-api.facebook.com:443/rtmp/abcd-1234' }),
    );

    const result = await provider.createBroadcast(conn, { title: 'Test stream' });

    expect(result).toEqual({
      ingestUrl: 'rtmps://rtmp-api.facebook.com:443/rtmp',
      streamKey: 'abcd-1234',
      platformBroadcastId: 'video_1',
      watchUrl: 'https://www.facebook.com/video_1',
    });
    expect(fetchMock.mock.calls[0][0]).toContain('/page_1/live_videos');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    const sentParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(sentParams.get('status')).toBe('LIVE_NOW');
    expect(sentParams.get('access_token')).toBe('page-token');
  });

  it('createBroadcast splits a stream URL whose key segment carries a query string without corrupting it', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'video_2',
        secure_stream_url: 'rtmps://rtmp-api.facebook.com:443/rtmp/key-with-params?s_bl=1&s_sw=0',
      }),
    );

    const result = await provider.createBroadcast(conn, { title: 'Test stream' });

    expect(result.ingestUrl).toBe('rtmps://rtmp-api.facebook.com:443/rtmp');
    expect(result.streamKey).toBe('key-with-params?s_bl=1&s_sw=0');
    // Reassembling via this app's own ingestUrl + '/' + streamKey convention
    // must exactly reproduce Facebook's original URL.
    expect(`${result.ingestUrl}/${result.streamKey}`).toBe(
      'rtmps://rtmp-api.facebook.com:443/rtmp/key-with-params?s_bl=1&s_sw=0',
    );
  });

  it('createBroadcast throws with a reconnect hint when Graph API returns an expired-token error (code 190)', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 190, message: 'Error validating access token' } }, false, 400),
    );

    await expect(provider.createBroadcast(conn, { title: 'Test stream' })).rejects.toThrow(
      /reconnect this Facebook Page/,
    );
  });

  it('createBroadcast throws a plain error (no reconnect hint) for a non-auth failure', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 100, message: 'Invalid parameter' } }, false, 400),
    );

    await expect(provider.createBroadcast(conn, { title: 'Test stream' })).rejects.toThrow(
      /Invalid parameter/,
    );
    await expect(provider.createBroadcast(conn, { title: 'Test stream' })).rejects.not.toThrow(
      /reconnect/,
    );
  });

  it("getBroadcastStatus reads Facebook's raw status field", async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'LIVE' }));

    const status = await provider.getBroadcastStatus(conn, 'video_1');

    expect(status).toBe('LIVE');
    expect(fetchMock.mock.calls[0][0]).toContain('/video_1?fields=status');
  });

  it('getBroadcastStatus returns null when the status field is absent', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const status = await provider.getBroadcastStatus(conn, 'video_1');
    expect(status).toBeNull();
  });

  it('endBroadcast sends end_live_video=true', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    await provider.endBroadcast(conn, 'video_1');

    expect(fetchMock.mock.calls[0][0]).toContain('/video_1');
    const sentParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(sentParams.get('end_live_video')).toBe('true');
  });

  it('endBroadcast swallows a failure -- an already-ended broadcast is expected, not an error', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 100, message: 'already ended' } }, false, 400));

    await expect(provider.endBroadcast(conn, 'video_1')).resolves.toBeUndefined();
  });

  it('getViewerCount reads live_views', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ live_views: 42 }));

    const count = await provider.getViewerCount(conn, 'video_1');
    expect(count).toBe(42);
  });

  it('getViewerCount returns 0 when live_views is absent (not currently live)', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const count = await provider.getViewerCount(conn, 'video_1');
    expect(count).toBe(0);
  });
});
