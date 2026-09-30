import { of } from 'rxjs';
import { TwitchProvider } from './twitch.provider';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';
import { Platform } from '../../common/enums/platform.enum';

describe('TwitchProvider', () => {
  const fakeCreds = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    ingestServerUrl: 'rtmp://live.twitch.tv/app',
    streamKey: 'live_123_abc',
  };

  const conn = {
    id: 'conn_1',
    platform: Platform.TWITCH,
    externalAccountId: 'twitch_channel_1',
  } as PlatformConnection;

  function buildProvider(httpGetImpl?: jest.Mock) {
    const encryption = { decrypt: jest.fn().mockReturnValue(fakeCreds) } as any;
    const http = { get: httpGetImpl ?? jest.fn() } as any;
    const config = { get: jest.fn().mockReturnValue('client-id') } as any;
    return new TwitchProvider(encryption, http, config);
  }

  it('createBroadcast returns the static ingest URL/key with zero network calls', async () => {
    const httpGet = jest.fn();
    const provider = buildProvider(httpGet);

    const result = await provider.createBroadcast(conn, { title: 'Test stream' });

    expect(result).toEqual({
      ingestUrl: fakeCreds.ingestServerUrl,
      streamKey: fakeCreds.streamKey,
      platformBroadcastId: conn.externalAccountId,
    });
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('endBroadcast is a no-op', async () => {
    const provider = buildProvider();
    await expect(provider.endBroadcast(conn, conn.externalAccountId)).resolves.toBeUndefined();
  });

  it('getViewerCount reads from the Twitch Helix streams endpoint', async () => {
    const httpGet = jest.fn().mockReturnValue(
      of({ data: { data: [{ viewer_count: 42 }] } }),
    );
    const provider = buildProvider(httpGet);

    const count = await provider.getViewerCount!(conn, conn.externalAccountId);

    expect(count).toBe(42);
    expect(httpGet).toHaveBeenCalledWith(
      'https://api.twitch.tv/helix/streams',
      expect.objectContaining({
        params: { user_id: conn.externalAccountId },
        headers: expect.objectContaining({
          Authorization: `Bearer ${fakeCreds.accessToken}`,
        }),
      }),
    );
  });

  it('getViewerCount returns 0 when the channel is not currently live', async () => {
    const httpGet = jest.fn().mockReturnValue(of({ data: { data: [] } }));
    const provider = buildProvider(httpGet);

    const count = await provider.getViewerCount!(conn, conn.externalAccountId);

    expect(count).toBe(0);
  });
});
