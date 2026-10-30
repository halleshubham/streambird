import { STREAM_PROVIDERS } from '../../src/providers/provider.tokens';
import { describeE2E, bootApp, Client, Harness } from './harness';

/** A real-enough PNG header (the server reads the signature and the size). */
function fakePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(200, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const msg = (b: any): string => (typeof b.message === 'string' ? b.message : b.message?.message);

function put(c: Client, path: string, file: Buffer | null) {
  const boundary = `----sb${Date.now()}${Math.random().toString(16).slice(2)}`;
  const parts = file
    ? [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]
    : [Buffer.from(`--${boundary}--\r\n`)];
  return c.call('PUT', path, { raw: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}

describeE2E('thumbnail for a go-live-now stream', () => {
  let h: Harness;
  const setThumb = jest.fn(async (..._a: unknown[]) => undefined);

  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    // Stand in for a platform that can take a thumbnail: the manual Twitch provider with a broadcast id and a thumbnail hook.
    const twitch: any = (h.app.get(STREAM_PROVIDERS) as any[]).find((p) => p.identifier === 'twitch');
    twitch.createBroadcast = async () => ({ ingestUrl: 'rtmp://live.example.com/app', streamKey: 'k', platformBroadcastId: 'bc-1', watchUrl: null });
    twitch.setBroadcastThumbnail = setThumb;
    twitch.thumbnailAppliesWhenLive = true;
  });
  afterAll(() => h.close());

  async function liveStream(c: Client) {
    const conn = await c.post('/platform-connections/twitch/manual', { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'key-t' });
    const s = await c.post('/streams', { title: 'now', destinationConnectionIds: [conn.body.id] });
    expect(s.status).toBe(201);
    return s.body.id as string;
  }

  it('stores, serves and applies the image to the live broadcast; replaceable and owner-only', async () => {
    const { client } = await h.signIn();
    const id = await liveStream(client);
    expect((await client.getBytes(`/streams/${id}/thumbnail`)).status).toBe(404);

    setThumb.mockClear();
    const up = await put(client, `/streams/${id}/thumbnail`, fakePng(1280, 720));
    expect(up.status).toBe(200);
    expect(up.body.hasThumbnail).toBe(true);
    expect(up.body.platformWarnings).toBeUndefined();
    expect(setThumb).toHaveBeenCalledTimes(1);
    expect(setThumb.mock.calls[0][1]).toBe('bc-1');

    const got = await client.getBytes(`/streams/${id}/thumbnail`);
    expect(got.status).toBe(200);
    expect(got.contentType).toContain('image/png');
    expect(got.data.length).toBe(200);

    const other = (await h.signIn()).client;
    expect((await other.getBytes(`/streams/${id}/thumbnail`)).status).toBe(404);
    expect((await put(other, `/streams/${id}/thumbnail`, fakePng(1280, 720))).status).toBe(404);

    expect((await client.del(`/streams/${id}/thumbnail`)).body.hasThumbnail).toBe(false);
  });

  it('rejects invalid images with the friendly messages and keeps the previous one', async () => {
    const { client } = await h.signIn();
    const id = await liveStream(client);
    await put(client, `/streams/${id}/thumbnail`, fakePng(1280, 720));

    const small = await put(client, `/streams/${id}/thumbnail`, fakePng(320, 180));
    expect(small.status).toBe(400);
    expect(msg(small.body)).toMatch(/640/);
    const text = await put(client, `/streams/${id}/thumbnail`, Buffer.from('not an image at all, just some text bytes'));
    expect(text.status).toBe(400);
    expect(msg(text.body)).toMatch(/JPG|PNG|image/i);
    expect((await put(client, `/streams/${id}/thumbnail`, null)).status).toBe(400);
    expect((await client.getBytes(`/streams/${id}/thumbnail`)).status).toBe(200);
  });

  it('a platform refusing the image is a warning, not an error', async () => {
    const { client } = await h.signIn();
    const id = await liveStream(client);
    setThumb.mockRejectedValueOnce(new Error('403 verified channel'));
    const up = await put(client, `/streams/${id}/thumbnail`, fakePng(1280, 720));
    expect(up.status).toBe(200);
    expect(up.body.platformWarnings[0]).toContain('verified channel');
  });

  it('the scheduled routes still work for scheduled streams and a stream that ended no longer takes one', async () => {
    const { client } = await h.signIn();
    const conn = await client.post('/platform-connections/twitch/manual', { label: 'S', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'key-s' });
    const sched = await client.post('/streams/schedule', { title: 'later', scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(), timezone: 'UTC', destinationConnectionIds: [conn.body.id] });
    expect((await put(client, `/streams/${sched.body.id}/schedule/thumbnail`, fakePng(1280, 720))).body.hasThumbnail).toBe(true);
    expect((await client.getBytes(`/streams/${sched.body.id}/thumbnail`)).status).toBe(200); // same image via the generic route

    const id = await liveStream(client);
    await h.db.query(`UPDATE live_streams SET status = 'ended' WHERE id = $1`, [id]);
    expect((await put(client, `/streams/${id}/thumbnail`, fakePng(1280, 720))).status).toBe(422);
  });
});
