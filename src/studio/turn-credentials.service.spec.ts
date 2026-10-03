import { TurnCredentialsService } from './turn-credentials.service';

describe('TurnCredentialsService', () => {
  let fetchMock: jest.Mock;
  const originalDateNow = Date.now;

  function buildService(configured = true) {
    const config = {
      get: jest.fn((key: string) => {
        if (!configured) return '';
        if (key === 'cloudflareTurn.tokenId') return 'token_id_1';
        if (key === 'cloudflareTurn.apiToken') return 'api_token_1';
        return '';
      }),
    };
    return new TurnCredentialsService(config as any);
  }

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  it('falls back to STUN only when no Cloudflare credentials are configured -- never calls fetch', async () => {
    const service = buildService(false);

    const result = await service.getIceServers();

    expect(result).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and returns Cloudflare-generated ICE servers, sending the API token only server-side', async () => {
    const service = buildService();
    const iceServers = [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ iceServers }));

    const result = await service.getIceServers();

    expect(result).toEqual(iceServers);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rtc.live.cloudflare.com/v1/turn/keys/token_id_1/credentials/generate-ice-servers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer api_token_1' }),
      }),
    );
  });

  it('caches the result -- a second call within the cache window does not call fetch again', async () => {
    const service = buildService();
    fetchMock.mockResolvedValueOnce(jsonResponse({ iceServers: [{ urls: 'turn:x' }] }));

    await service.getIceServers();
    await service.getIceServers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes once the cache window has elapsed', async () => {
    const service = buildService();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ iceServers: [{ urls: 'turn:first' }] }))
      .mockResolvedValueOnce(jsonResponse({ iceServers: [{ urls: 'turn:second' }] }));

    let now = 1_000_000;
    Date.now = () => now;

    const first = await service.getIceServers();
    now += 4 * 60 * 60 * 1000; // past the 3h cache window
    const second = await service.getIceServers();

    expect(first).toEqual([{ urls: 'turn:first' }]);
    expect(second).toEqual([{ urls: 'turn:second' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves a stale cached value instead of STUN-only if a refresh attempt fails', async () => {
    const service = buildService();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ iceServers: [{ urls: 'turn:cached' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500));

    let now = 1_000_000;
    Date.now = () => now;
    await service.getIceServers();
    now += 4 * 60 * 60 * 1000;

    const result = await service.getIceServers();

    expect(result).toEqual([{ urls: 'turn:cached' }]);
  });

  it('falls back to STUN only if the very first fetch fails (nothing cached yet)', async () => {
    const service = buildService();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500));

    const result = await service.getIceServers();

    expect(result).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });
});
