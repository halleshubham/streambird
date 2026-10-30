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

  it('an animated GIF is accepted as a logo (served as image/gif) and refused for every other kind', async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 5 });
    const { client } = await h.signIn();
    const gif = solidGif([[255, 0, 0], [0, 0, 255]], { width: 48, height: 24 });
    const logo = await upload(client, gif, 'logo', 'Spinner', 'image/gif');
    expect(logo.status).toBe(201);
    expect(logo.body).toMatchObject({ kind: 'logo', contentType: 'image/gif', width: 48, height: 24, sizeBytes: gif.length });
    const file = await client.getBytes(`/assets/${logo.body.id}/file`);
    expect(file.contentType).toBe('image/gif');
    expect(file.data.equals(gif)).toBe(true);
    for (const kind of ['wallpaper', 'background', 'other']) {
      const refused = await upload(client, gif, kind, 'Spinner', 'image/gif');
      expect(refused.status).toBe(400);
      expect(msg(refused.body)).toMatch(/GIF images can only be used as a logo/);
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
});
