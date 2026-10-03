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

  it('createBroadcast includes Graph API\'s type/code/subcode/fbtrace_id in the thrown message -- its own "message" field alone (e.g. "Permissions error") is too generic to debug from', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 200,
            error_subcode: 1,
            type: 'OAuthException',
            message: 'Permissions error',
            fbtrace_id: 'AbCdEfGhIjK',
          },
        },
        false,
        400,
      ),
    );

    await expect(provider.createBroadcast(conn, { title: 'Test stream' })).rejects.toThrow(
      /OAuthException 200\/1.*fbtrace_id=AbCdEfGhIjK/,
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

  it('falls back to the plain-timestamp form of event_params when Facebook answers the object form with a generic error', async () => {
    const { provider } = buildProvider();
    const at = new Date('2026-10-10T13:00:00Z');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 1, type: 'OAuthException', message: 'An unknown error has occurred.' } }, false, 500))
      .mockResolvedValueOnce(jsonResponse({ id: 'v_sched', secure_stream_url: 'rtmps://h:443/rtmp/k' }));

    const result = await provider.createBroadcast(conn, { title: 'T', scheduledAt: at, precreate: true });

    expect(result.platformBroadcastId).toBe('v_sched');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('event_params')).toBe(JSON.stringify({ start_time: at.getTime() / 1000 }));
    expect(new URLSearchParams(fetchMock.mock.calls[1][1].body).get('event_params')).toBe(String(at.getTime() / 1000));
  });

  it('when both formats fail, reports the last error and mentions the other attempt', async () => {
    const { provider } = buildProvider();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 1, message: 'An unknown error has occurred.' } }, false, 500))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 100, message: 'Invalid parameter' } }, false, 400));

    await expect(provider.createBroadcast(conn, { title: 'T', scheduledAt: new Date(Date.now() + 3_600_000), precreate: true })).rejects.toThrow(
      /Invalid parameter.*alternative request format was tried first and failed too: .*An unknown error/s,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when Facebook says the app lacks the capability or the token is bad -- another format cannot fix that', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 3, message: '(#3) Application does not have the capability to make this API call.' } }, false, 400));

    await expect(provider.createBroadcast(conn, { title: 'T', scheduledAt: new Date(Date.now() + 3_600_000), precreate: true })).rejects.toThrow(/capability/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('go-live-now creation is a single LIVE_NOW call and never retried in another shape', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 1, message: 'An unknown error has occurred.' } }, false, 500));

    await expect(provider.createBroadcast(conn, { title: 'T' })).rejects.toThrow(/unknown error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('createBroadcast without precreate stays LIVE_NOW even when a scheduledAt is passed (go-live-now path is unchanged)', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'v', secure_stream_url: 'rtmps://h:443/rtmp/k' }));

    await provider.createBroadcast(conn, { title: 'T', scheduledAt: new Date(Date.now() + 3_600_000) });

    const sent = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(sent.get('status')).toBe('LIVE_NOW');
    expect(sent.get('event_params')).toBeNull();
  });

  it('createBroadcast with precreate makes a hidden scheduled live video with a planned start time', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'v', secure_stream_url: 'rtmps://h:443/rtmp/k' }));
    const at = new Date('2026-10-10T13:00:00Z');

    await provider.createBroadcast(conn, { title: 'T', scheduledAt: at, precreate: true, visibility: 'unlisted' });

    const sent = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(sent.get('status')).toBe('SCHEDULED_UNPUBLISHED');
    // Meta types event_params as an object -- that form is tried first.
    expect(sent.get('event_params')).toBe(JSON.stringify({ start_time: at.getTime() / 1000 }));
    expect(sent.get('planned_start_time')).toBeNull();
  });

  it('createBroadcast with precreate and public visibility also posts the upcoming live to the Page', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'v', secure_stream_url: 'rtmps://h:443/rtmp/k' }));

    await provider.createBroadcast(conn, { title: 'T', scheduledAt: new Date(Date.now() + 3_600_000), precreate: true, visibility: 'public' });

    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('status')).toBe('SCHEDULED_LIVE');
  });

  it('updateBroadcast sends title/description, then the start time as a separate best-effort call', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const at = new Date('2026-10-10T13:00:00Z');

    await provider.updateBroadcast(conn, 'video_9', { title: 'New', description: 'd', scheduledAt: at });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map((c) => new URLSearchParams(c[1].body));
    expect(fetchMock.mock.calls[0][0]).toContain('/video_9');
    expect(first.get('title')).toBe('New');
    expect(first.get('event_params')).toBeNull();
    expect(second.get('event_params')).toBe(JSON.stringify({ start_time: at.getTime() / 1000 }));
  });

  it('updateBroadcast keeps the new title even when Facebook rejects the new start time in either format, and says so', async () => {
    const { provider } = buildProvider();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true })) // title/description
      .mockResolvedValue(jsonResponse({ error: { code: 100, message: 'Invalid parameter' } }, false, 400)); // both time formats

    await expect(provider.updateBroadcast(conn, 'v', { title: 'New', scheduledAt: new Date(Date.now() + 3_600_000) })).rejects.toThrow(
      /title and description were updated, but Facebook did not accept the new start time/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('deleteBroadcast and prepareToGoLive hit the live video itself', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));

    await provider.deleteBroadcast(conn, 'video_9');
    await provider.prepareToGoLive(conn, 'video_9');

    const [del, live] = fetchMock.mock.calls;
    expect(del[1].method).toBe('DELETE');
    expect(new URLSearchParams(live[1].body).get('status')).toBe('LIVE_NOW');
  });

  it('explains Meta capability errors (code 3) and advertises the 7-day scheduling limit', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 3, type: 'OAuthException', message: '(#3) Application does not have the capability to make this API call.' } }, false, 400),
    );

    await expect(provider.createBroadcast(conn, { title: 'T', scheduledAt: new Date(Date.now() + 3_600_000), precreate: true })).rejects.toThrow(
      /lacks the capability for this call/,
    );
    expect(provider.maxPrescheduleLeadMs).toBe(7 * 24 * 60 * 60_000);
  });

  it('setBroadcastThumbnail posts the image as schedule_custom_profile_image in a multipart form', async () => {
    const { provider } = buildProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    await provider.setBroadcastThumbnail(conn, 'video_5', { contentType: 'image/jpeg', data: Buffer.from([9, 9, 9]), width: 1280, height: 720 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/video_5');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined(); // fetch sets the multipart boundary itself
    const form = init.body as FormData;
    expect(form.get('access_token')).toBe('page-token');
    const file = form.get('schedule_custom_profile_image') as File;
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('thumbnail.jpg');
    expect(file.size).toBe(3);
  });
});
