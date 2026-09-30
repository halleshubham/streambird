import { of } from 'rxjs';
import { CloudflareRelayService } from './cloudflare-relay.service';

describe('CloudflareRelayService', () => {
  function buildService(httpImpl: Partial<Record<'post' | 'get' | 'delete', jest.Mock>>) {
    const http = {
      post: httpImpl.post ?? jest.fn(),
      get: httpImpl.get ?? jest.fn(),
      delete: httpImpl.delete ?? jest.fn(),
    } as any;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'cloudflare.accountId') return 'test-account';
        if (key === 'cloudflare.apiToken') return 'test-token';
        return undefined;
      }),
    } as any;
    return new CloudflareRelayService(http, config);
  }

  it('createLiveInput posts to the live_inputs endpoint with auth and recording config', async () => {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          result: { uid: 'input-1', rtmps: { url: 'rtmps://x', streamKey: 'key-1' } },
        },
      }),
    );
    const service = buildService({ post });

    const result = await service.createLiveInput({ name: 'test stream' });

    expect(post).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account/stream/live_inputs',
      { meta: { name: 'test stream' }, recording: { mode: 'off' } },
      { headers: { Authorization: 'Bearer test-token' } },
    );
    expect(result).toEqual({ uid: 'input-1', ingestUrl: 'rtmps://x', streamKey: 'key-1' });
  });

  it('addOutput posts to the outputs sub-resource for the given live input', async () => {
    const post = jest.fn().mockReturnValue(of({ data: { result: { uid: 'output-1' } } }));
    const service = buildService({ post });

    const result = await service.addOutput('input-1', {
      url: 'rtmp://dest', streamKey: 'dest-key',
    });

    expect(post).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account/stream/live_inputs/input-1/outputs',
      { url: 'rtmp://dest', streamKey: 'dest-key', enabled: true },
      { headers: { Authorization: 'Bearer test-token' } },
    );
    expect(result).toEqual({ uid: 'output-1', url: 'rtmp://dest', streamKey: 'dest-key' });
  });

  it('removeOutput deletes the specific output resource', async () => {
    const del = jest.fn().mockReturnValue(of({}));
    const service = buildService({ delete: del });

    await service.removeOutput('input-1', 'output-1');

    expect(del).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account/stream/live_inputs/input-1/outputs/output-1',
      { headers: { Authorization: 'Bearer test-token' } },
    );
  });

  it('getLiveInputStatus maps a connected status and outputs list', async () => {
    const get = jest.fn().mockReturnValue(
      of({
        data: {
          result: { status: { current: 'connected' }, outputs: [{ uid: 'o1', status: 'live' }] },
        },
      }),
    );
    const service = buildService({ get });

    const status = await service.getLiveInputStatus('input-1');

    expect(status).toEqual({ status: 'connected', outputs: [{ uid: 'o1', status: 'live' }] });
  });

  it('getLiveInputStatus defaults to idle when not connected', async () => {
    const get = jest.fn().mockReturnValue(
      of({ data: { result: { status: { current: 'disconnected' } } } }),
    );
    const service = buildService({ get });

    const status = await service.getLiveInputStatus('input-1');

    expect(status).toEqual({ status: 'idle', outputs: [] });
  });
});
