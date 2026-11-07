import { STREAM_PROVIDERS } from '../../src/providers/provider.tokens';
import { solidGif } from '../gif';
import { describeE2E, bootApp, Client, Harness } from './harness';

/** A real-enough PNG header (the server reads the signature and the size), padded to `bytes`. */
function fakePng(width: number, height: number, bytes = 200, fill = 7): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), fill)]);
}
/** A JPEG header with a start-of-frame segment (what the server reads for the size). */
function fakeJpeg(width: number, height: number, bytes = 300): Buffer {
  const b = Buffer.alloc(bytes, 9);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xc0; // SOF0
  b.writeUInt16BE(17, 4);
  b[6] = 8;
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}
/** A tiny WebP header. */
function fakeWebp(width: number, height: number): Buffer {
  const b = Buffer.alloc(40, 0);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

const msg = (b: any): string => (typeof b.message === 'string' ? b.message : b.message?.message);

async function upload(c: Client, file: Buffer, kind: string, name?: string, fileType = 'image/png') {
  const boundary = `----sb${Date.now()}${Math.random().toString(16).slice(2)}`;
  const part = (n: string, v: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
  const body = Buffer.concat([
    Buffer.from(part('kind', kind) + (name ? part('name', name) : '')),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.bin"\r\nContent-Type: ${fileType}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.call('POST', '/assets', { raw: body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}
function putThumb(c: Client, path: string, file: Buffer) {
  const boundary = `----sb${Date.now()}${Math.random().toString(16).slice(2)}`;
  const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)];
  return c.call('PUT', path, { raw: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}

describeE2E('L-shaped frame ads and the brand kit thumbnail', () => {
  let h: Harness;
  let admin: Client;
  const setThumb = jest.fn(async (..._a: unknown[]) => undefined);
  let broadcastSeq = 0;

  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    admin = (await h.signIn({ superadmin: true })).client;
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 20, watermark: false, maxDestinations: 3 });
    // A platform that takes a thumbnail: the manual Twitch provider with a broadcast id and a thumbnail hook.
    const twitch: any = (h.app.get(STREAM_PROVIDERS) as any[]).find((p) => p.identifier === 'twitch');
    twitch.createBroadcast = async () => ({ ingestUrl: 'rtmp://live.example.com/app', streamKey: 'k', platformBroadcastId: `bc-${++broadcastSeq}`, watchUrl: null });
    twitch.setBroadcastThumbnail = setThumb;
    twitch.thumbnailAppliesWhenLive = true;
    twitch.canPrescheduleBroadcast = true;
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 0, watermark: true, maxDestinations: 1 });
    await h.close();
  });

  const ADS = ['lower_third', 'side_third', 'full_screen', 'l_shape'];

  describe('l_shape placement', () => {
    it('is accepted in both orientation sets, returned in a fixed order, and a kit may hold all four', async () => {
      const { client } = await h.signIn();
      const [a1, a2, a3, frame, framePortrait] = (
        await Promise.all([
          upload(client, fakePng(1280, 240), 'ad', 'Lower'),
          upload(client, fakePng(427, 720), 'ad', 'Side'),
          upload(client, fakePng(1280, 720), 'ad', 'Full'),
          upload(client, fakePng(1920, 1080), 'ad', 'Frame'),
          upload(client, fakePng(1080, 1920), 'ad', 'Frame tall'),
        ])
      ).map((r) => r.body);
      const created = await client.post('/brand-kits', {
        name: 'News',
        ads: [
          { placement: 'l_shape', assetId: frame.id },
          { placement: 'full_screen', assetId: a3.id },
          { placement: 'lower_third', assetId: a1.id, mode: 'interval', showSec: 20, everySec: 300 },
          { placement: 'side_third', assetId: a2.id },
        ],
        adsPortrait: [{ placement: 'l_shape', assetId: framePortrait.id, mode: 'interval', showSec: 30, everySec: 120 }],
      });
      expect(created.status).toBe(201);
      expect(created.body.ads.map((a: any) => a.placement)).toEqual(ADS);
      expect(created.body.ads[3]).toEqual({ placement: 'l_shape', assetId: frame.id, enabled: true, mode: 'continuous', showSec: null, everySec: null });
      expect(created.body.adsPortrait).toEqual([{ placement: 'l_shape', assetId: framePortrait.id, enabled: true, mode: 'interval', showSec: 30, everySec: 120 }]);
      const listed = (await client.get('/brand-kits')).body.find((k: any) => k.id === created.body.id);
      expect(listed.ads.map((a: any) => a.placement)).toEqual(ADS);
      expect(listed.adsPortrait.map((a: any) => a.placement)).toEqual(['l_shape']);

      // The library shows the frame as used; deleting it is refused until the kit lets go.
      expect((await client.get('/assets')).body.items.find((a: any) => a.id === frame.id).usedBy).toEqual(['News']);
      expect((await client.del(`/assets/${frame.id}`)).status).toBe(409);
      // Replace-all: dropping l_shape from the landscape list removes it, the portrait one stays.
      const dropped = await client.patch(`/brand-kits/${created.body.id}`, { ads: created.body.ads.filter((a: any) => a.placement !== 'l_shape') });
      expect(dropped.body.ads.map((a: any) => a.placement)).toEqual(['lower_third', 'side_third', 'full_screen']);
      expect(dropped.body.adsPortrait).toHaveLength(1);
      expect((await client.del(`/assets/${frame.id}`)).status).toBe(204);
      expect((await client.del(`/assets/${framePortrait.id}`)).status).toBe(409);
    });

    it('validation: up to four ads, one per placement, owned files of kind ad; an old client that never sends l_shape is unaffected', async () => {
      const { client } = await h.signIn();
      const ad = (await upload(client, fakePng(1280, 720), 'ad', 'Frame')).body;
      const logo = (await upload(client, fakePng(100, 100), 'logo', 'Logo')).body;
      const kit = (await client.post('/brand-kits', { name: 'Checks' })).body;
      const bad = async (ads: unknown, status = 400) => expect((await client.patch(`/brand-kits/${kit.id}`, { ads })).status).toBe(status);
      await bad([...ADS.map((placement) => ({ placement, assetId: ad.id })), { placement: 'l_shape', assetId: ad.id }]); // five
      await bad([{ placement: 'l_shape', assetId: ad.id }, { placement: 'l_shape', assetId: ad.id }]); // twice
      await bad([{ placement: 'l_shape', assetId: logo.id }]); // a logo is not an ad
      await bad([{ placement: 'frame', assetId: ad.id }]); // unknown placement
      await bad([{ placement: 'l_shape', assetId: ad.id, mode: 'interval', showSec: 10 }]); // interval needs both numbers
      expect((await client.patch(`/brand-kits/${kit.id}`, { ads: ADS.map((placement) => ({ placement, assetId: ad.id })) })).status).toBe(200); // exactly four
      // An old client sends its three placements back: that is a valid replace-all (and drops the frame, as replace-all does).
      const old = await client.patch(`/brand-kits/${kit.id}`, { ads: ADS.slice(0, 3).map((placement) => ({ placement, assetId: ad.id })) });
      expect(old.status).toBe(200);
      expect(old.body.ads.map((a: any) => a.placement)).toEqual(ADS.slice(0, 3));
      // ...and one that omits `ads` leaves everything as it is.
      await client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'l_shape', assetId: ad.id }] });
      expect((await client.patch(`/brand-kits/${kit.id}`, { name: 'Renamed' })).body.ads.map((a: any) => a.placement)).toEqual(['l_shape']);
    });

    it('stays a paid feature: the plan with the Powered-by mark cannot save a frame', async () => {
      await admin.patch('/superadmin/plans/free', { watermark: true });
      try {
        const { client } = await h.signIn();
        const ad = (await upload(client, fakePng(1280, 720), 'ad', 'Frame')).body;
        const refused = await client.post('/brand-kits', { name: 'Free frame', ads: [{ placement: 'l_shape', assetId: ad.id }] });
        expect(refused.status).toBe(403);
        expect((await client.post('/brand-kits', { name: 'Free plain' })).status).toBe(201);
      } finally {
        await admin.patch('/superadmin/plans/free', { watermark: false });
      }
    });
  });

  describe('thumbnail slot of a brand kit', () => {
    it('upload kind "thumbnail" applies the stream-thumbnail limits (JPG/PNG, 2 MB, 640 px wide)', async () => {
      const { client } = await h.signIn();
      const ok = await upload(client, fakePng(1280, 720), 'thumbnail', 'Cover');
      expect(ok.status).toBe(201);
      expect(ok.body.kind).toBe('thumbnail');
      expect((await upload(client, fakeJpeg(1280, 720), 'thumbnail', 'Cover jpg', 'image/jpeg')).status).toBe(201);
      const small = await upload(client, fakePng(320, 180), 'thumbnail');
      expect(small.status).toBe(400);
      expect(msg(small.body)).toMatch(/640/);
      const big = await upload(client, fakePng(1280, 720, 2 * 1024 * 1024 + 10), 'thumbnail');
      expect(big.status).toBe(400);
      expect(msg(big.body)).toMatch(/2 MB/);
      expect((await upload(client, fakeWebp(1280, 720), 'thumbnail', 'w', 'image/webp')).status).toBe(400);
      expect((await upload(client, solidGif([[1, 2, 3]], { width: 16, height: 16 }), 'thumbnail', 'g', 'image/gif')).status).toBe(400);
    });

    it('thumbnailAssetId: set, keep when omitted, clear with null, validated, listed as used, and the file cannot be deleted while used', async () => {
      const { client } = await h.signIn();
      const cover = (await upload(client, fakePng(1280, 720), 'thumbnail', 'Cover')).body;
      const created = await client.post('/brand-kits', { name: 'With cover', thumbnailAssetId: cover.id });
      expect(created.status).toBe(201);
      expect(created.body.thumbnailAssetId).toBe(cover.id);
      expect((await client.post('/brand-kits', { name: 'No cover' })).body.thumbnailAssetId).toBeNull();
      const id = created.body.id;

      expect((await client.get('/brand-kits')).body.find((k: any) => k.id === id).thumbnailAssetId).toBe(cover.id);
      expect((await client.get('/assets')).body.items.find((a: any) => a.id === cover.id).usedBy).toEqual(['With cover']);
      const del = await client.del(`/assets/${cover.id}`);
      expect(del.status).toBe(409);
      expect(msg(del.body)).toMatch(/With cover/);

      // undefined = unchanged; null = cleared.
      expect((await client.patch(`/brand-kits/${id}`, { name: 'Renamed' })).body.thumbnailAssetId).toBe(cover.id);
      expect((await client.patch(`/brand-kits/${id}`, { thumbnailAssetId: null })).body.thumbnailAssetId).toBeNull();
      expect((await client.del(`/assets/${cover.id}`)).status).toBe(204);
    });

    it('validation: a library JPG/PNG in range only; foreign, GIF, WebP, too small and too big files are refused', async () => {
      const { client } = await h.signIn();
      const kit = (await client.post('/brand-kits', { name: 'Checks' })).body;
      const set = (thumbnailAssetId: unknown) => client.patch(`/brand-kits/${kit.id}`, { thumbnailAssetId });
      // Any library picture of the right kind of file can be chosen (it need not have been uploaded as a thumbnail).
      const wall = (await upload(client, fakePng(1920, 1080), 'wallpaper', 'Wall')).body;
      expect((await set(wall.id)).status).toBe(200);
      expect((await set(null)).status).toBe(200);
      const gif = (await upload(client, solidGif([[1, 2, 3]], { width: 16, height: 16 }), 'logo', 'Gif logo', 'image/gif')).body;
      expect(gif.contentType).toBe('image/gif');
      expect((await set(gif.id)).status).toBe(400);
      const webp = (await upload(client, fakeWebp(1280, 720), 'wallpaper', 'Webp', 'image/webp')).body;
      expect((await set(webp.id)).status).toBe(400);
      const small = (await upload(client, fakePng(320, 180), 'other', 'Small')).body;
      const refusedSmall = await set(small.id);
      expect(refusedSmall.status).toBe(400);
      expect(msg(refusedSmall.body)).toMatch(/640/);
      const big = (await upload(client, fakePng(1280, 720, 3 * 1024 * 1024), 'other', 'Big')).body;
      const refusedBig = await set(big.id);
      expect(refusedBig.status).toBe(400);
      expect(msg(refusedBig.body)).toMatch(/2 MB/);
      expect((await set('not-a-uuid')).status).toBe(400);
      expect((await set('00000000-0000-4000-8000-000000000000')).status).toBe(400);
      const other = await h.signIn();
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 20, watermark: false });
      const foreign = (await upload(other.client, fakePng(1280, 720), 'thumbnail')).body;
      expect((await set(foreign.id)).status).toBe(400);
      expect((await client.get('/brand-kits')).body.find((k: any) => k.id === kit.id).thumbnailAssetId).toBeNull(); // nothing half-saved
      // The Free plan without storage cannot have kits at all (unchanged rule).
      expect((await client.post('/brand-kits', { name: 'Create with bad', thumbnailAssetId: gif.id })).status).toBe(400);
    });
  });

  describe('a stream without its own thumbnail gets its destination kit thumbnail', () => {
    async function conn(c: Client, label: string) {
      return (await c.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: `key-${label}` })).body.id as string;
    }
    async function kitWith(c: Client, name: string, size: number, isDefault = false) {
      const file = (await upload(c, fakePng(1280, 720, size), 'thumbnail', `${name} cover`)).body;
      const kit = (await c.post('/brand-kits', { name, thumbnailAssetId: file.id, ...(isDefault ? { isDefault: true } : {}) })).body;
      return { kit, bytes: size };
    }
    const sentSizes = () => setThumb.mock.calls.map((c) => (c[2] as { data: Buffer }).data.length);

    beforeEach(() => setThumb.mockClear());

    it('go live now: the destination\'s kit wins over the account default; the default is used when the destination has no kit; none -> nothing is sent', async () => {
      const { client } = await h.signIn();
      const def = await kitWith(client, 'Default kit', 1001, true);
      const own = await kitWith(client, 'Channel kit', 1002);
      const c1 = await conn(client, 'a');
      const c2 = await conn(client, 'b');
      await client.put(`/brand-kits/connections/${c1}`, { brandKitId: own.kit.id });

      const a = await client.post('/streams', { title: 'with channel kit', destinationConnectionIds: [c1] });
      expect(a.status).toBe(201);
      expect(sentSizes()).toEqual([own.bytes]);
      expect(a.body.thumbnailKit).toEqual({ id: own.kit.id, name: 'Channel kit' });
      expect(a.body.thumbnailWarnings).toBeUndefined();
      await client.post(`/streams/${a.body.id}/end`);

      setThumb.mockClear();
      const b = await client.post('/streams', { title: 'default kit', destinationConnectionIds: [c2] });
      expect(sentSizes()).toEqual([def.bytes]);
      expect(b.body.thumbnailKit.name).toBe('Default kit');
      await client.post(`/streams/${b.body.id}/end`);

      // Each destination gets its OWN kit's thumbnail (the provider call is per destination).
      setThumb.mockClear();
      const both = await client.post('/streams', { title: 'two destinations', destinationConnectionIds: [c1, c2] });
      expect(both.status).toBe(201);
      expect(sentSizes().sort()).toEqual([def.bytes, own.bytes].sort());
      await client.post(`/streams/${both.body.id}/end`);

      // A kit without a thumbnail gives none (no fall-through to another kit).
      const bare = (await client.post('/brand-kits', { name: 'Bare' })).body;
      const c3 = await conn(client, 'c');
      await client.put(`/brand-kits/connections/${c3}`, { brandKitId: bare.id });
      setThumb.mockClear();
      const c = await client.post('/streams', { title: 'bare kit', destinationConnectionIds: [c3] });
      expect(c.status).toBe(201);
      expect(setThumb).not.toHaveBeenCalled();
      expect(c.body.thumbnailKit).toBeNull();
    });

    it('thumbnailBrandKitId: omitted = automatic, a kit id = that kit, null = none (explicit upload or "No brand kit")', async () => {
      const { client } = await h.signIn();
      const def = await kitWith(client, 'Default kit', 1101, true);
      const pick = await kitWith(client, 'Picked kit', 1102);
      const c1 = await conn(client, 'a');

      const picked = await client.post('/streams', { title: 'picked', destinationConnectionIds: [c1], thumbnailBrandKitId: pick.kit.id });
      expect(sentSizes()).toEqual([pick.bytes]);
      await client.post(`/streams/${picked.body.id}/end`);

      setThumb.mockClear();
      const none = await client.post('/streams', { title: 'none', destinationConnectionIds: [c1], thumbnailBrandKitId: null });
      expect(none.status).toBe(201);
      expect(setThumb).not.toHaveBeenCalled();
      expect(none.body.thumbnailKit).toBeUndefined();
      await client.post(`/streams/${none.body.id}/end`);

      expect((await client.post('/streams', { title: 'bad', destinationConnectionIds: [c1], thumbnailBrandKitId: 'nope' })).status).toBe(400);
      // Someone else's kit id gives nothing (never their file).
      const stranger = await h.signIn();
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 20, watermark: false });
      const theirs = await kitWith(stranger.client, 'Theirs', 1199);
      setThumb.mockClear();
      const s = await client.post('/streams', { title: 'foreign', destinationConnectionIds: [c1], thumbnailBrandKitId: theirs.kit.id });
      expect(s.status).toBe(201);
      expect(setThumb).not.toHaveBeenCalled();
      void def;
    });

    it('an explicit per-stream thumbnail always wins: it is uploaded after going live and lands last', async () => {
      const { client } = await h.signIn();
      const def = await kitWith(client, 'Default kit', 1201, true);
      const c1 = await conn(client, 'a');
      const s = await client.post('/streams', { title: 'explicit', destinationConnectionIds: [c1] });
      expect(sentSizes()).toEqual([def.bytes]);
      const up = await putThumb(client, `/streams/${s.body.id}/thumbnail`, fakePng(1280, 720, 777));
      expect(up.status).toBe(200);
      expect(sentSizes()).toEqual([def.bytes, 777]); // the host's file was sent last, so it is what the platform keeps
      expect((await client.getBytes(`/streams/${s.body.id}/thumbnail`)).data.length).toBe(777);
    });

    it('a platform refusing the kit thumbnail never blocks going live: 201, warning surfaced, stream is live', async () => {
      const { client } = await h.signIn();
      await kitWith(client, 'Default kit', 1301, true);
      const c1 = await conn(client, 'a');
      setThumb.mockRejectedValueOnce(new Error('403 verified channel'));
      const s = await client.post('/streams', { title: 'refused', destinationConnectionIds: [c1] });
      expect(s.status).toBe(201);
      expect(s.body.status).toBe('live');
      expect(s.body.thumbnailWarnings[0]).toContain('verified channel');
    });

    it('an unreadable kit file (gone from storage) is skipped quietly: going live still works', async () => {
      const { client } = await h.signIn();
      const def = await kitWith(client, 'Default kit', 1401, true);
      const c1 = await conn(client, 'a');
      await h.db.query(`UPDATE assets SET storage_key = 'acct/missing/none' WHERE id = $1`, [def.kit.thumbnailAssetId]);
      const s = await client.post('/streams', { title: 'missing file', destinationConnectionIds: [c1] });
      expect(s.status).toBe(201);
      expect(setThumb).not.toHaveBeenCalled();
    });

    it('scheduled with "create on platforms": the kit thumbnail goes to the pre-created broadcast; an explicit one replaces it', async () => {
      const { client } = await h.signIn();
      const def = await kitWith(client, 'Default kit', 1501, true);
      const c1 = await conn(client, 'a');
      const sched = await client.post('/streams/schedule', {
        title: 'later',
        scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        timezone: 'UTC',
        destinationConnectionIds: [c1],
        createOnPlatforms: true,
      });
      expect(sched.status).toBe(201);
      expect(sentSizes()).toEqual([def.bytes]);
      // The stream itself still reports no thumbnail of its own (the kit's is applied on the platform, not stored on the stream).
      expect(sched.body.hasThumbnail).toBe(false);
      const up = await putThumb(client, `/streams/${sched.body.id}/schedule/thumbnail`, fakePng(1280, 720, 888));
      expect(up.body.hasThumbnail).toBe(true);
      expect(sentSizes()).toEqual([def.bytes, 888]);
    });

    it('scheduled, created at start: the kit thumbnail is sent to the broadcast created when the stream starts; with an explicit one that one is sent', async () => {
      const { client } = await h.signIn();
      const def = await kitWith(client, 'Default kit', 1601, true);
      const c1 = await conn(client, 'a');
      const later = () => new Date(Date.now() + 3 * 3600_000).toISOString();
      const plain = await client.post('/streams/schedule', { title: 'plain', scheduledAt: later(), timezone: 'UTC', destinationConnectionIds: [c1] });
      expect(setThumb).not.toHaveBeenCalled(); // nothing on a platform yet
      const started = await client.post(`/streams/${plain.body.id}/start`);
      expect(started.status).toBe(201);
      expect(sentSizes()).toEqual([def.bytes]);
      await client.post(`/streams/${plain.body.id}/end`);

      setThumb.mockClear();
      const withOwn = await client.post('/streams/schedule', { title: 'own', scheduledAt: later(), timezone: 'UTC', destinationConnectionIds: [c1] });
      await putThumb(client, `/streams/${withOwn.body.id}/schedule/thumbnail`, fakePng(1280, 720, 999));
      setThumb.mockClear();
      await client.post(`/streams/${withOwn.body.id}/start`);
      expect(sentSizes()).toEqual([999]);
    });

    it('a deleted kit file or kit: the connection falls back to the default kit, never to someone else\'s', async () => {
      const { client } = await h.signIn();
      const def = await kitWith(client, 'Default kit', 1701, true);
      const own = await kitWith(client, 'Channel kit', 1702);
      const c1 = await conn(client, 'a');
      await client.put(`/brand-kits/connections/${c1}`, { brandKitId: own.kit.id });
      await client.del(`/brand-kits/${own.kit.id}`); // the connection goes back to the account default
      const s = await client.post('/streams', { title: 'after delete', destinationConnectionIds: [c1] });
      expect(s.status).toBe(201);
      expect(sentSizes()).toEqual([def.bytes]);
    });
  });
});
