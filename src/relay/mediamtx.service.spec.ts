import { of, throwError } from 'rxjs';
import { MediaMtxService } from './mediamtx.service';

describe('MediaMtxService', () => {
  function buildService(httpImpl: Partial<Record<'post' | 'patch' | 'delete' | 'get', jest.Mock>>, configOverrides: Record<string, string> = {}) {
    const http = {
      post: httpImpl.post ?? jest.fn().mockReturnValue(of({})),
      patch: httpImpl.patch ?? jest.fn().mockReturnValue(of({})),
      delete: httpImpl.delete ?? jest.fn().mockReturnValue(of({})),
      get: httpImpl.get ?? jest.fn().mockReturnValue(of({ data: { items: [] } })),
    } as any;
    const config = {
      get: jest.fn((key: string) => {
        if (key in configOverrides) return configOverrides[key];
        if (key === 'mediamtx.apiUrl') return 'https://mtx-api.example.com';
        if (key === 'mediamtx.apiUser') return 'user';
        if (key === 'mediamtx.apiPassword') return 'pass';
        if (key === 'mediamtx.whipBaseUrl') return 'https://whip.example.com';
        if (key === 'publicBaseUrl') return 'https://app.example.com';
        return undefined;
      }),
    } as any;
    return new MediaMtxService(http, config);
  }

  it('registers a path with a runOnReady ffmpeg command teeing every destination, single-quoted', async () => {
    const post = jest.fn().mockReturnValue(of({}));
    const service = buildService({ post });

    const whipUrl = await service.registerForward('stream-1', [
      'rtmp://live.twitch.tv/app/twitch-key',
      'rtmps://live.cloudflare.com:443/live/cf-key',
    ]);

    expect(whipUrl).toBe('https://whip.example.com/stream-1/whip');
    const [, body] = post.mock.calls[0];
    expect(body.source).toBe('publisher');
    expect(body.runOnReadyRestart).toBe(true);
    expect(body.runOnReady).toContain('-rtsp_transport tcp');
    // A short timeout + probe budget so a corrupted-keyframe attempt (lost
    // RTP fragment, not a late arrival) fails fast and lets
    // runOnReadyRestart retry quickly instead of burning a minute-plus on
    // data that was never going to resolve. See buildRunOnReady's docstring.
    expect(body.runOnReady).toContain('-timeout 5000000');
    expect(body.runOnReady).toContain('-analyzeduration 3M -probesize 3M');
    expect(body.runOnReady).toContain('-i "rtsp://127.0.0.1:$RTSP_PORT/$MTX_PATH"');
    expect(body.runOnReady).toContain('-map 0:v:0 -map 0:a:0');
    expect(body.runOnReady).toContain('-c:v copy -c:a aac');
    expect(body.runOnReady).toContain(
      "-f tee '[f=flv]rtmp://live.twitch.tv/app/twitch-key|[f=flv]rtmps://live.cloudflare.com:443/live/cf-key'",
    );
  });

  it('single-quote-escapes a destination containing a single quote, neutralizing shell metacharacters', async () => {
    const post = jest.fn().mockReturnValue(of({}));
    const service = buildService({ post });

    await service.registerForward('stream-1', ["rtmp://evil.example.com/$(rm -rf /)/key'; echo pwned"]);

    const [, body] = post.mock.calls[0];
    // The whole malicious string stays inside a single-quoted shell literal
    // (the embedded `'` is escaped to `'\''`), so none of $(), ;, or echo
    // are ever interpreted by the shell MediaMTX runs this through.
    expect(body.runOnReady).toContain(
      "-f tee '[f=flv]rtmp://evil.example.com/$(rm -rf /)/key'\\''; echo pwned'",
    );
  });

  it('drops destinations with a non-RTMP(S) scheme and keeps the valid ones', async () => {
    const post = jest.fn().mockReturnValue(of({}));
    const service = buildService({ post });

    await service.registerForward('stream-1', [
      'rtmp://ok.example.com/app/key',
      'file:///etc/passwd',
    ]);

    const [, body] = post.mock.calls[0];
    expect(body.runOnReady).toContain('rtmp://ok.example.com/app/key');
    expect(body.runOnReady).not.toContain('etc/passwd');
  });

  it('returns null and never calls MediaMTX when every destination is invalid', async () => {
    const post = jest.fn().mockReturnValue(of({}));
    const service = buildService({ post });

    const whipUrl = await service.registerForward('stream-1', ['file:///etc/passwd']);

    expect(whipUrl).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('returns null when given zero destinations', async () => {
    const post = jest.fn().mockReturnValue(of({}));
    const service = buildService({ post });

    const whipUrl = await service.registerForward('stream-1', []);

    expect(whipUrl).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('returns null, never throwing, when MediaMTX is unreachable', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => new Error('ECONNREFUSED')));
    const service = buildService({ post });

    const whipUrl = await service.registerForward('stream-1', ['rtmp://ok.example.com/app/key']);

    expect(whipUrl).toBeNull();
  });

  it('updateForward PATCHes the path with a freshly built runOnReady for the full destination list', async () => {
    const patch = jest.fn().mockReturnValue(of({}));
    const service = buildService({ patch });

    await service.updateForward('stream-1', [
      'rtmp://a.example.com/app/key-a',
      'rtmp://b.example.com/app/key-b',
    ]);

    const [, body] = patch.mock.calls[0];
    expect(body.runOnReady).toContain('a.example.com/app/key-a');
    expect(body.runOnReady).toContain('b.example.com/app/key-b');
  });

  it('updateForward sends an empty runOnReady when every destination is now invalid', async () => {
    const patch = jest.fn().mockReturnValue(of({}));
    const service = buildService({ patch });

    await service.updateForward('stream-1', []);

    const [, body] = patch.mock.calls[0];
    expect(body.runOnReady).toBe('');
  });

  it('starts a slate path whose runOnInit loops the app-hosted image to every destination', async () => {
    const post = jest.fn().mockReturnValue(of({}));
    const service = buildService({ post });

    const ok = await service.startSlate('stream-1', ['rtmp://live.twitch.tv/app/k1', 'rtmps://b.example.com/live/k2']);

    expect(ok).toBe(true);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('https://mtx-api.example.com/v3/config/paths/add/stream-1-slate');
    expect(body.runOnInitRestart).toBe(true);
    // Fetched once to a local file (Range isn't reliable through the CDN), then looped from there.
    expect(body.runOnInit).toContain("-i 'https://app.example.com/glitch-slate.mp4' -c copy -f mp4");
    expect(body.runOnInit).toContain('-re -stream_loop -1 -i /tmp/glitch-slate.mp4');
    expect(body.runOnInit).toContain('-c:v copy -tag:v 7');
    // ...with the old encode as a fallback when the clip can't be fetched.
    expect(body.runOnInit).toContain("-loop 1 -framerate 30 -i 'https://app.example.com/glitch-slate.png'");
    expect(body.runOnInit).toMatch(/^if .*; then exec ffmpeg .*; else exec ffmpeg .*; fi$/);
    expect(body.runOnInit).toContain('anullsrc');
    expect(body.runOnInit).toContain("-f tee '[f=flv]rtmp://live.twitch.tv/app/k1|[f=flv]rtmps://b.example.com/live/k2'");
  });

  it('still encodes a still-image slate URL (legacy override) with libx264', async () => {
    const post = jest.fn().mockReturnValue(of({}));
    const service = buildService({ post }, { 'mediamtx.slateUrl': 'https://cdn.example.com/slate.png' });

    await service.startSlate('stream-1', ['rtmp://a/b']);

    const [, body] = post.mock.calls[0];
    expect(body.runOnInit).toContain("exec ffmpeg -nostdin -loglevel warning -re -loop 1 -framerate 30 -i 'https://cdn.example.com/slate.png'");
    expect(body.runOnInit).toContain('libx264');
    expect(body.runOnInit).not.toContain('stream_loop');
  });

  it('treats an already-running slate (400) as success and a missing one on stop (404) as fine', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 400 }, message: 'exists' })));
    const del = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 404 }, message: 'nope' })));
    const service = buildService({ post, delete: del });

    expect(await service.startSlate('stream-1', ['rtmp://a/b'])).toBe(true);
    await expect(service.stopSlate('stream-1')).resolves.toBeUndefined();
  });

  it('removeForward also stops the slate', async () => {
    const del = jest.fn().mockReturnValue(of({}));
    const service = buildService({ delete: del });

    await service.removeForward('stream-1');

    expect(del.mock.calls.map((c) => c[0])).toEqual([
      'https://mtx-api.example.com/v3/config/paths/delete/stream-1-slate',
      'https://mtx-api.example.com/v3/config/paths/delete/stream-1',
    ]);
  });

  it('lists paths with their ready flag, and returns null when MediaMTX is unreachable', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(of({ data: { items: [{ name: 'a', ready: true }, { name: 'b', ready: false }] } }))
      .mockReturnValueOnce(throwError(() => new Error('down')));
    const service = buildService({ get });

    expect([...(await service.listPaths())!]).toEqual([['a', true], ['b', false]]);
    expect(await service.listPaths()).toBeNull();
  });
});
