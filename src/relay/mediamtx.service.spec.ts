import { of, throwError } from 'rxjs';
import { MediaMtxService } from './mediamtx.service';

describe('MediaMtxService', () => {
  function buildService(httpImpl: Partial<Record<'post' | 'patch' | 'delete', jest.Mock>>) {
    const http = {
      post: httpImpl.post ?? jest.fn().mockReturnValue(of({})),
      patch: httpImpl.patch ?? jest.fn().mockReturnValue(of({})),
      delete: httpImpl.delete ?? jest.fn().mockReturnValue(of({})),
    } as any;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'mediamtx.apiUrl') return 'https://mtx-api.example.com';
        if (key === 'mediamtx.apiUser') return 'user';
        if (key === 'mediamtx.apiPassword') return 'pass';
        if (key === 'mediamtx.whipBaseUrl') return 'https://whip.example.com';
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
});
