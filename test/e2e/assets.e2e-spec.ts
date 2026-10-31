import { solidGif } from '../gif';
import { describeE2E, bootApp, Client, Harness } from './harness';

/** A real-enough PNG header (the server reads the signature and the size), padded to `bytes`. */
function fakePng(width: number, height: number, bytes = 200): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 7)]);
}

/** The error filter nests Nest's own body under `message`. */
const msg = (b: any): string => (typeof b.message === 'string' ? b.message : b.message?.message);

async function upload(c: Client, file: Buffer, kind: string, name?: string, fileType = 'image/png') {
  const boundary = `----sb${Date.now()}${Math.random().toString(16).slice(2)}`;
  const part = (n: string, v: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
  const body = Buffer.concat([
    Buffer.from(part('kind', kind) + (name ? part('name', name) : '')),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: ${fileType}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.call('POST', '/assets', { raw: body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}

describeE2E('assets and brand kits: the account library, plan allowance and sharing between brands', () => {
  let h: Harness;
  let admin: Client;
  beforeAll(async () => {
    h = await bootApp();
    admin = (await h.signIn({ superadmin: true })).client;
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 0 });
    await h.close();
  });

  it('the Free plan keeps assets in the browser: nothing can be uploaded or made into a kit', async () => {
    const { client } = await h.signIn();
    const lib = await client.get('/assets');
    expect(lib.status).toBe(200);
    expect(lib.body).toMatchObject({ enabled: true, quotaBytes: 0, usedBytes: 0, items: [] });
    const up = await upload(client, fakePng(100, 100), 'logo');
    expect(up.status).toBe(403);
    expect(msg(up.body)).toMatch(/paid plans/);
    expect((await client.post('/brand-kits', { name: 'Main' })).status).toBe(403);
  });

  it('a plan with storage: upload, list, read back, rename, quota, validation, isolation between accounts', async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 1 });
    const { client } = await h.signIn();
    const png = fakePng(640, 480, 600 * 1024);

    const created = await upload(client, png, 'logo', 'Main logo');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'logo', name: 'Main logo', contentType: 'image/png', width: 640, height: 480, sizeBytes: png.length });

    const lib = await client.get('/assets');
    expect(lib.body.quotaBytes).toBe(1024 * 1024);
    expect(lib.body.usedBytes).toBe(png.length);
    expect(lib.body.items[0]).toMatchObject({ id: created.body.id, usedBy: [] });

    const file = await client.getBytes(`/assets/${created.body.id}/file`);
    expect(file.status).toBe(200);
    expect(file.contentType).toBe('image/png');
    expect(file.data.equals(png)).toBe(true);

    expect((await client.patch(`/assets/${created.body.id}`, { name: 'Renamed' })).body.name).toBe('Renamed');

    // 600 KB used of 1 MB: a second 600 KB file does not fit; a small one does.
    expect((await upload(client, fakePng(10, 10, 600 * 1024), 'wallpaper')).status).toBe(403);
    expect((await upload(client, fakePng(10, 10, 1000), 'wallpaper')).status).toBe(201);

    // The bytes decide, not the filename or declared type.
    expect((await upload(client, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'logo')).status).toBe(400);
    expect((await upload(client, fakePng(9000, 10), 'logo')).status).toBe(400);
    expect((await upload(client, Buffer.alloc(0), 'logo')).status).toBe(400);
    expect((await upload(client, fakePng(10, 10, 4.5 * 1024 * 1024), 'logo')).status).toBe(400);
    expect((await upload(client, fakePng(10, 10), 'poster')).status).toBe(400); // unknown kind

    // Another account cannot see or fetch it.
    const other = await h.signIn();
    expect((await other.client.get('/assets')).body.items).toEqual([]);
    expect((await other.client.getBytes(`/assets/${created.body.id}/file`)).status).toBe(404);
    expect((await other.client.del(`/assets/${created.body.id}`)).status).toBe(404);

    expect((await client.del(`/assets/${created.body.id}`)).status).toBe(204);
    expect((await client.getBytes(`/assets/${created.body.id}/file`)).status).toBe(404);
  });

  it('an animated GIF is accepted as a logo or an ad (served as image/gif) and refused for every other kind', async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 5 });
    const { client } = await h.signIn();
    const gif = solidGif([[255, 0, 0], [0, 0, 255]], { width: 48, height: 24 });
    const logo = await upload(client, gif, 'logo', 'Spinner', 'image/gif');
    expect(logo.status).toBe(201);
    expect(logo.body).toMatchObject({ kind: 'logo', contentType: 'image/gif', width: 48, height: 24, sizeBytes: gif.length });
    const file = await client.getBytes(`/assets/${logo.body.id}/file`);
    expect(file.contentType).toBe('image/gif');
    expect(file.data.equals(gif)).toBe(true);
    const adGif = await upload(client, gif, 'ad', 'Spinning ad', 'image/gif');
    expect(adGif.status).toBe(201);
    expect(adGif.body).toMatchObject({ kind: 'ad', contentType: 'image/gif', width: 48, height: 24 });
    expect((await client.del(`/assets/${adGif.body.id}`)).status).toBe(204);
    for (const kind of ['wallpaper', 'background', 'other']) {
      const refused = await upload(client, gif, kind, 'Spinner', 'image/gif');
      expect(refused.status).toBe(400);
      expect(msg(refused.body)).toMatch(/GIF images can only be used as a logo or an ad/);
    }
    // The bytes decide, not the declared type.
    expect((await upload(client, gif, 'wallpaper', 'x', 'image/png')).status).toBe(400);
    const junk = await upload(client, Buffer.from('definitely not a picture'), 'logo', 'x', 'image/gif');
    expect(junk.status).toBe(400);
    expect(msg(junk.body)).toMatch(/PNG, JPG or WebP/);
    expect((await client.del(`/assets/${logo.body.id}`)).status).toBe(204);
  });

  it('brand kits: shared files, one default, connections may share a kit, a file in use cannot be deleted', async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 5 });
    const { client } = await h.signIn();
    const logo = (await upload(client, fakePng(300, 300), 'logo', 'Logo')).body;
    const wall = (await upload(client, fakePng(1920, 1080), 'wallpaper', 'Wall')).body;

    const main = await client.post('/brand-kits', { name: 'Main', logoAssetId: logo.id, wallpaperAssetId: wall.id, logoPosition: 'right', logoSize: 120 });
    expect(main.status).toBe(201);
    expect(main.body).toMatchObject({ name: 'Main', isDefault: true, logoPosition: 'right', logoSize: 120, connectionIds: [] }); // the first kit is the default
    // A second kit reuses the same logo file with a different wallpaper: one file, two kits.
    const hindi = await client.post('/brand-kits', { name: 'Hindi', logoAssetId: logo.id });
    expect(hindi.status).toBe(201);
    expect(hindi.body.isDefault).toBe(false);

    const lib = await client.get('/assets');
    expect(lib.body.items.find((a: any) => a.id === logo.id).usedBy.sort()).toEqual(['Hindi', 'Main']);
    const del = await client.del(`/assets/${logo.id}`);
    expect(del.status).toBe(409);
    expect(msg(del.body)).toMatch(/Main/);

    // Two channels, one kit; a third on the other kit.
    const mk = async (label: string) => (await client.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' })).body.id as string;
    const [c1, c2, c3] = [await mk('Ch1'), await mk('Ch2'), await mk('Ch3')];
    expect((await client.put(`/brand-kits/connections/${c1}`, { brandKitId: hindi.body.id })).status).toBe(200);
    expect((await client.put(`/brand-kits/connections/${c2}`, { brandKitId: hindi.body.id })).status).toBe(200);
    expect((await client.put(`/brand-kits/connections/${c3}`, { brandKitId: main.body.id })).status).toBe(200);
    const kits = (await client.get('/brand-kits')).body;
    expect(kits.find((k: any) => k.name === 'Hindi').connectionIds.sort()).toEqual([c1, c2].sort());
    expect(kits.find((k: any) => k.name === 'Main').connectionIds).toEqual([c3]);

    // Back to the account default, and a made-up kit is refused.
    expect((await client.put(`/brand-kits/connections/${c2}`, { brandKitId: null })).body.brandKitId).toBeNull();
    expect((await client.put(`/brand-kits/connections/${c2}`, { brandKitId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);

    // One default at a time.
    expect((await client.patch(`/brand-kits/${hindi.body.id}`, { isDefault: true })).body.isDefault).toBe(true);
    expect((await client.get('/brand-kits')).body.filter((k: any) => k.isDefault).map((k: any) => k.name)).toEqual(['Hindi']);

    // A file from another account cannot be put in a kit.
    const stranger = await h.signIn();
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 5 });
    const foreign = (await upload(stranger.client, fakePng(50, 50), 'logo')).body;
    expect((await client.post('/brand-kits', { name: 'Sneaky', logoAssetId: foreign.id })).status).toBe(400);
    expect((await stranger.client.put(`/brand-kits/connections/${c1}`, { brandKitId: null })).status).toBe(404);

    // Deleting a kit sends its connections back to the default, makes another kit the default, and frees the file.
    expect((await client.del(`/brand-kits/${hindi.body.id}`)).status).toBe(204);
    const after = (await client.get('/brand-kits')).body;
    expect(after.map((k: any) => [k.name, k.isDefault])).toEqual([['Main', true]]);
    expect(after[0].connectionIds).toEqual([c3]);
    expect((await client.del(`/brand-kits/${main.body.id}`)).status).toBe(204);
    expect((await client.del(`/assets/${logo.id}`)).status).toBe(204);
  });

  describe('brand kit ads', () => {
    const PLACEMENTS = ['lower_third', 'side_third', 'full_screen'];

    afterEach(async () => {
      await admin.patch('/superadmin/plans/free', { watermark: true, assetStorageMb: 5 });
    });

    it('the Free plan (with the mark) cannot save ads in a kit; clearing and kits without ads still work', async () => {
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: true });
      const { client } = await h.signIn();
      const ad = (await upload(client, fakePng(1280, 240), 'ad', 'Banner')).body;
      expect(ad.kind).toBe('ad');
      const refused = await client.post('/brand-kits', { name: 'With ads', ads: [{ placement: 'lower_third', assetId: ad.id }] });
      expect(refused.status).toBe(403);
      expect(msg(refused.body)).toMatch(/paid plans/);
      const kit = await client.post('/brand-kits', { name: 'Plain' });
      expect(kit.status).toBe(201);
      expect(kit.body.ads).toEqual([]);
      expect((await client.patch(`/brand-kits/${kit.body.id}`, { ads: [{ placement: 'lower_third', assetId: ad.id }] })).status).toBe(403);
      expect((await client.patch(`/brand-kits/${kit.body.id}`, { ads: [] })).status).toBe(200); // removing is always fine
    });

    it('create, read, replace-all, omit-keeps, clear: up to 3 ads, one per placement, with their schedules', async () => {
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
      const { client } = await h.signIn();
      const [a1, a2, a3] = [await upload(client, fakePng(1280, 240), 'ad', 'Lower'), await upload(client, fakePng(427, 720), 'ad', 'Side'), await upload(client, fakePng(1280, 720), 'ad', 'Full')].map((r) => r.body);

      const created = await client.post('/brand-kits', {
        name: 'Sponsors',
        ads: [
          { placement: 'full_screen', assetId: a3.id, enabled: false },
          { placement: 'lower_third', assetId: a1.id, mode: 'interval', showSec: 30, everySec: 600 },
          { placement: 'side_third', assetId: a2.id, mode: 'continuous', showSec: 5 }, // schedule numbers are dropped for continuous
        ],
      });
      expect(created.status).toBe(201);
      expect(created.body.ads).toEqual([
        { placement: 'lower_third', assetId: a1.id, enabled: true, mode: 'interval', showSec: 30, everySec: 600 },
        { placement: 'side_third', assetId: a2.id, enabled: true, mode: 'continuous', showSec: null, everySec: null },
        { placement: 'full_screen', assetId: a3.id, enabled: false, mode: 'continuous', showSec: null, everySec: null },
      ]);
      const id = created.body.id;
      expect((await client.get('/brand-kits')).body.find((k: any) => k.id === id).ads.map((a: any) => a.placement)).toEqual(PLACEMENTS);

      // The library shows which kit uses each file; a file used by an ad cannot be deleted (409 names the kit).
      const lib = await client.get('/assets');
      expect(lib.body.items.find((a: any) => a.id === a1.id).usedBy).toEqual(['Sponsors']);
      const del = await client.del(`/assets/${a1.id}`);
      expect(del.status).toBe(409);
      expect(msg(del.body)).toMatch(/Sponsors/);

      // Omitting `ads` leaves them; a list replaces them all.
      const renamed = await client.patch(`/brand-kits/${id}`, { name: 'Sponsors 2' });
      expect(renamed.body.ads).toHaveLength(3);
      const replaced = await client.patch(`/brand-kits/${id}`, { ads: [{ placement: 'side_third', assetId: a2.id, enabled: true, mode: 'interval', showSec: 1, everySec: 86400 }] });
      expect(replaced.status).toBe(200);
      expect(replaced.body.ads).toEqual([{ placement: 'side_third', assetId: a2.id, enabled: true, mode: 'interval', showSec: 1, everySec: 86400 }]);
      expect((await client.del(`/assets/${a1.id}`)).status).toBe(204); // no longer in use
      expect((await client.patch(`/brand-kits/${id}`, { ads: [] })).body.ads).toEqual([]);
      expect((await client.del(`/assets/${a2.id}`)).status).toBe(204);

      // Deleting the kit deletes its ads and frees the file.
      const again = await client.post('/brand-kits', { name: 'Again', ads: [{ placement: 'full_screen', assetId: a3.id }] });
      expect(again.status).toBe(201);
      expect((await client.del(`/assets/${a3.id}`)).status).toBe(409);
      expect((await client.del(`/brand-kits/${again.body.id}`)).status).toBe(204);
      expect((await client.del(`/assets/${a3.id}`)).status).toBe(204);
    });

    it('validation: placement, schedule ranges, interval needs both numbers, one per placement, max 3, owned files of kind ad', async () => {
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
      const { client } = await h.signIn();
      const ad = (await upload(client, fakePng(1280, 240), 'ad', 'Banner')).body;
      const logo = (await upload(client, fakePng(100, 100), 'logo', 'Logo')).body;
      const kit = (await client.post('/brand-kits', { name: 'Checks' })).body;
      const bad = async (ads: unknown, status = 400) => expect((await client.patch(`/brand-kits/${kit.id}`, { ads })).status).toBe(status);

      await bad([{ placement: 'top_banner', assetId: ad.id }]);
      await bad([{ placement: 'lower_third' }]); // no file
      await bad([{ placement: 'lower_third', assetId: 'not-a-uuid' }]);
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'sometimes' }]);
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'interval', showSec: 10 }]); // interval needs both
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'interval', everySec: 10 }]);
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'interval', showSec: 0, everySec: 10 }]);
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'interval', showSec: 3601, everySec: 10 }]);
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'interval', showSec: 10, everySec: 0 }]);
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'interval', showSec: 10, everySec: 86401 }]);
      await bad([{ placement: 'lower_third', assetId: ad.id, mode: 'interval', showSec: 1.5, everySec: 10 }]);
      await bad([{ placement: 'lower_third', assetId: ad.id }, { placement: 'lower_third', assetId: ad.id }]); // one per placement
      await bad([...PLACEMENTS.map((placement) => ({ placement, assetId: ad.id })), { placement: 'lower_third', assetId: ad.id }]); // max 3
      await bad([{ placement: 'lower_third', assetId: logo.id }]); // a logo is not an ad
      await bad([{ placement: 'lower_third', assetId: ad.id, surprise: true }]); // unknown field
      await bad('lower_third');
      const stranger = await h.signIn();
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
      const foreign = (await upload(stranger.client, fakePng(100, 100), 'ad')).body;
      await bad([{ placement: 'lower_third', assetId: foreign.id }]); // another account's file
      expect((await client.get('/brand-kits')).body.find((k: any) => k.id === kit.id).ads).toEqual([]); // nothing half-saved

      // The boundaries themselves are fine.
      const edges = await client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'lower_third', assetId: ad.id, mode: 'interval', showSec: 3600, everySec: 1 }] });
      expect(edges.status).toBe(200);
    });

    it('ads: null is "unchanged" (never a 500), another account\'s kit is 404, a foreign or non-ad file is 400, logo/wallpaper cannot be an ad file', async () => {
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
      const { client } = await h.signIn();
      const ad = (await upload(client, fakePng(1280, 240), 'ad', 'Banner')).body;
      const kit = (await client.post('/brand-kits', { name: 'Nulls', ads: [{ placement: 'lower_third', assetId: ad.id }] })).body;
      expect((await client.post('/brand-kits', { name: 'Null ads', ads: null })).status).toBe(201);
      const same = await client.patch(`/brand-kits/${kit.id}`, { ads: null });
      expect(same.status).toBe(200);
      expect(same.body.ads).toHaveLength(1); // null = unchanged
      // The kit editor sends every field; nothing else may change.
      const logo = (await upload(client, fakePng(100, 100), 'logo', 'L')).body;
      const wall = (await upload(client, fakePng(1920, 1080), 'wallpaper', 'W')).body;
      const full = await client.patch(`/brand-kits/${kit.id}`, { name: 'Nulls', logoAssetId: logo.id, logoPosition: 'right', logoSize: 120, wallpaperAssetId: wall.id, wallpaperDim: 30, lowerThirdStyle: 'glass', ads: kit.ads });
      expect(full.status).toBe(200);
      expect(full.body).toMatchObject({ logoAssetId: logo.id, wallpaperAssetId: wall.id, wallpaperDim: 30, lowerThirdStyle: 'glass', logoPosition: 'right', logoSize: 120, connectionIds: [] });
      expect(full.body.ads).toHaveLength(1);
      // An ad file is not a logo or a wallpaper.
      expect((await client.patch(`/brand-kits/${kit.id}`, { logoAssetId: ad.id })).status).toBe(400);
      expect((await client.post('/brand-kits', { name: 'Bad', wallpaperAssetId: ad.id })).status).toBe(400);

      const other = await h.signIn();
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
      expect((await other.client.patch(`/brand-kits/${kit.id}`, { ads: [] })).status).toBe(404);
      expect((await other.client.patch(`/brand-kits/${kit.id}`, { name: 'Mine now' })).status).toBe(404);
      const foreignAd = (await upload(other.client, fakePng(100, 100), 'ad')).body;
      expect((await client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'side_third', assetId: foreignAd.id }] })).status).toBe(400);
      expect((await client.get('/brand-kits')).body.find((k: any) => k.id === kit.id).ads).toHaveLength(1);
    });

    it('a plan downgrade: saved kit ads stay readable, can be cleared (then the file is deletable), but not replaced by new ones', async () => {
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
      const { client } = await h.signIn();
      const ad = (await upload(client, fakePng(1280, 240), 'ad', 'Banner')).body;
      const kit = (await client.post('/brand-kits', { name: 'Paid look', ads: [{ placement: 'lower_third', assetId: ad.id }] })).body;
      await admin.patch('/superadmin/plans/free', { watermark: true }); // the account is now on a plan with the mark
      const list = await client.get('/brand-kits');
      expect(list.body.find((k: any) => k.id === kit.id).ads).toHaveLength(1); // still readable
      expect((await client.patch(`/brand-kits/${kit.id}`, { name: 'Renamed' })).status).toBe(200); // other edits are fine
      expect((await client.patch(`/brand-kits/${kit.id}`, { name: 'Renamed' })).body.ads).toHaveLength(1);
      expect((await client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'full_screen', assetId: ad.id }] })).status).toBe(403);
      expect((await client.del(`/assets/${ad.id}`)).status).toBe(409); // locked while the kit uses it
      expect((await client.patch(`/brand-kits/${kit.id}`, { ads: [] })).status).toBe(200); // clearing always works
      expect((await client.del(`/assets/${ad.id}`)).status).toBe(204);
    });

    it('a day pass on a Free account allows kit ads, and they are refused again once it has expired', async () => {
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: true });
      const { client, accountId } = await h.signIn();
      const ad = (await upload(client, fakePng(1280, 240), 'ad', 'Banner')).body;
      const body = { name: 'Pass look', ads: [{ placement: 'lower_third', assetId: ad.id }] };
      expect((await client.post('/brand-kits', body)).status).toBe(403);
      await h.db.query(`UPDATE accounts SET day_pass_plan_key = 'day_pass', day_pass_expires_at = now() + interval '1 day' WHERE id = $1`, [accountId]);
      const made = await client.post('/brand-kits', body);
      expect(made.status).toBe(201);
      await h.db.query(`UPDATE accounts SET day_pass_expires_at = now() - interval '1 minute' WHERE id = $1`, [accountId]);
      expect((await client.patch(`/brand-kits/${made.body.id}`, { ads: [{ placement: 'side_third', assetId: ad.id }] })).status).toBe(403);
    });

    it('races: two saves of the same kit and an asset deleted at the same time never give a 500', async () => {
      await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
      const { client } = await h.signIn();
      const [a1, a2] = [(await upload(client, fakePng(1280, 240), 'ad', 'One')).body, (await upload(client, fakePng(1280, 240), 'ad', 'Two')).body];
      const kit = (await client.post('/brand-kits', { name: 'Race' })).body;
      const both = await Promise.all([
        client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'lower_third', assetId: a1.id }] }),
        client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'lower_third', assetId: a2.id }] }),
      ]);
      for (const r of both) expect(r.status).toBe(200);
      expect((await client.get('/brand-kits')).body.find((k: any) => k.id === kit.id).ads).toHaveLength(1); // one winner, never two rows

      const victim = (await upload(client, fakePng(1280, 240), 'ad', 'Victim')).body;
      const [save, del] = await Promise.all([
        client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'side_third', assetId: victim.id }] }),
        client.del(`/assets/${victim.id}`),
      ]);
      expect(save.status).toBeLessThan(500);
      expect(del.status).toBeLessThan(500);
      expect([200, 400]).toContain(save.status);
      expect([204, 409]).toContain(del.status);
    });
  });
});
