import { PNG } from 'pngjs';
import { describeE2E, bootApp, Client, Harness } from './harness';

/** A real PNG frame graphic: opaque colour with a transparent window in the middle (or no window at all). */
function framePng(width: number, height: number, withWindow: boolean): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = withWindow && x >= width * 0.1 && x < width * 0.9 && y >= height * 0.1 && y < height * 0.9;
      png.data.set(inside ? [0, 0, 0, 0] : [30, 60, 200, 255], (y * width + x) * 4);
    }
  }
  return PNG.sync.write(png);
}
/** A PNG header only (the server reads the signature and size): the bytes cannot be decoded. */
function fakePng(width: number, height: number): Buffer {
  const head = Buffer.alloc(200, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

async function upload(c: Client, file: Buffer, kind: string, name: string) {
  const boundary = `----sb${Date.now()}${Math.random().toString(16).slice(2)}`;
  const part = (n: string, v: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
  const body = Buffer.concat([
    Buffer.from(part('kind', kind) + part('name', name)),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.call('POST', '/assets', { raw: body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}

describeE2E('superadmin: read-only brand kit view for support', () => {
  let h: Harness;
  let admin: Client;
  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    admin = (await h.signIn({ superadmin: true })).client;
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 20, watermark: false, maxDestinations: 3 });
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 0, watermark: true, maxDestinations: 1 });
    await h.close();
  });

  const twitch = (c: Client, label: string) =>
    c.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: `key-${label}` }).then((r) => r.body.id as string);

  async function setup() {
    const { client, accountId } = await h.signIn();
    const frame = (await upload(client, framePng(320, 180, true), 'ad', 'Good frame')).body;
    const solid = (await upload(client, framePng(320, 180, false), 'ad', 'Solid frame')).body;
    const broken = (await upload(client, fakePng(1280, 720), 'ad', 'Broken frame')).body;
    const main = (
      await client.post('/brand-kits', {
        name: 'Main',
        title: 'T'.repeat(150),
        description: 'D'.repeat(400),
        isDefault: true,
        adsShrinkPicture: false,
        ads: [{ placement: 'l_shape', assetId: frame.id, mode: 'interval', showSec: 20, everySec: 180 }],
      })
    ).body;
    const other = (await client.post('/brand-kits', { name: 'Other', ads: [{ placement: 'l_shape', assetId: solid.id }], adsPortrait: [{ placement: 'l_shape', assetId: broken.id }] })).body;
    const conn = await twitch(client, 'Chan');
    await client.put(`/brand-kits/connections/${conn}`, { brandKitId: other.id });
    const conn2 = await twitch(client, 'Plain');
    return { client, accountId, main, other, conn, conn2 };
  }

  it('returns kits with channels, sets, ads, window checks and diagnostics', async () => {
    const { accountId, main, other, conn } = await setup();
    const res = await admin.get(`/superadmin/accounts/${accountId}/brand-kits`);
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ key: 'free', watermark: false });
    expect(res.body.kits).toHaveLength(2);
    const m = res.body.kits.find((k: any) => k.id === main.id);
    expect(m).toMatchObject({ name: 'Main', isDefault: true, adsShrinkPicture: false, logoPosition: 'left' });
    expect(m.clock).toHaveProperty('clockAlternate');
    expect(m.title).toHaveLength(150); // under the 200 limit: kept in full
    expect(m.description.length).toBe(201); // truncated at 200 plus an ellipsis
    expect(m.landscape.ads[0]).toMatchObject({ placement: 'l_shape', fileName: 'Good frame', mime: 'image/png', width: 320, height: 180, enabled: true, mode: 'interval', showSec: 20, everySec: 180 });
    expect(m.landscape.ads[0].windowCheck.status).toBe('found');
    expect(m.landscape.ads[0].windowCheck.w).toBeCloseTo(0.8, 1);
    const texts = m.diagnostics.map((d: any) => d.text).join('\n');
    expect(texts).toContain('Shrink picture while ads show is OFF: this only affects Lower third and Left third ads');
    expect(texts).not.toContain('will not run');
    expect(texts).toContain('hidden for the first 180 s of each cycle');
    expect(texts).toContain('Portrait (9:16) set has no L-shaped frame');

    const o = res.body.kits.find((k: any) => k.id === other.id);
    expect(o.connections).toEqual([{ id: conn, platform: 'twitch', displayName: 'Chan' }]);
    expect(o.landscape.ads[0].windowCheck.status).toBe('none');
    expect(o.portrait.ads[0].windowCheck).toMatchObject({ status: 'not_checked' });
    expect(o.diagnostics.map((d: any) => d.text).join('\n')).toContain('NO CLEAR WINDOW FOUND');
  });

  it('exposes no credentials, storage keys or tokens', async () => {
    const { accountId } = await setup();
    const kits = await admin.get(`/superadmin/accounts/${accountId}/brand-kits`);
    const text = JSON.stringify(kits.body);
    for (const forbidden of ['credentialsCiphertext', 'credentialsKeyVersion', 'streamKey', 'ingestUrl', 'storageKey', 'acct/', 'accessToken', 'refreshToken', 'key-Chan', 'key-Plain']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('is superadmin only: 403 for a normal user, 401 anonymous, 404 for an unknown account', async () => {
    const { client, accountId } = await setup();
    expect((await client.get(`/superadmin/accounts/${accountId}/brand-kits`)).status).toBe(403);
    expect((await client.get('/superadmin/streams/00000000-0000-4000-8000-000000000000/brand-kit')).status).toBe(403);
    expect((await new Client(h.baseUrl).get(`/superadmin/accounts/${accountId}/brand-kits`)).status).toBe(401);
    expect((await admin.get('/superadmin/accounts/00000000-0000-4000-8000-000000000000/brand-kits')).status).toBe(404);
    expect((await admin.get('/superadmin/accounts/not-a-uuid/brand-kits')).status).toBe(400);
  });

  it('writes an audit entry for the view', async () => {
    const { accountId } = await setup();
    await admin.get(`/superadmin/accounts/${accountId}/brand-kits`);
    const { rows } = await h.db.query(`SELECT action, target_type FROM superadmin_audit_log WHERE target_id = $1`, [accountId]);
    expect(rows).toEqual(expect.arrayContaining([{ action: 'view_brand_kits', target_type: 'account' }]));
  });

  it('an account with no kits returns an empty list', async () => {
    const { accountId } = await h.signIn();
    const res = await admin.get(`/superadmin/accounts/${accountId}/brand-kits`);
    expect(res.status).toBe(200);
    expect(res.body.kits).toEqual([]);
  });

  it('stream lookup: the destination kit first, then the account default; orientation decides the set', async () => {
    const { client, main, other, conn, conn2 } = await setup();
    const wide = (await client.post('/streams', { title: 'wide', destinationConnectionIds: [conn, conn2] })).body;
    const res = await admin.get(`/superadmin/streams/${wide.id}/brand-kit`);
    expect(res.status).toBe(200);
    expect(res.body.stream).toMatchObject({ id: wide.id, orientation: 'landscape', title: 'wide' });
    const byName = Object.fromEntries(res.body.destinations.map((d: any) => [d.displayName, d]));
    expect(byName.Chan).toMatchObject({ platform: 'twitch', kitId: other.id, kitSource: 'channel' });
    expect(byName.Plain).toMatchObject({ kitId: main.id, kitSource: 'account_default' });
    expect(res.body.kits.map((k: any) => k.id).sort()).toEqual([main.id, other.id].sort());
    expect(JSON.stringify(res.body)).not.toContain('key-Chan');

    const tall = (await client.post('/streams', { title: 'tall', orientation: 'portrait', destinationConnectionIds: [conn2] })).body;
    const t = await admin.get(`/superadmin/streams/${tall.id}/brand-kit`);
    expect(t.body.stream.orientation).toBe('portrait');
    expect(t.body.kits.map((k: any) => k.id)).toEqual([main.id]);
    expect(t.body.diagnostics.map((d: any) => d.text).join('\n')).toContain('The portrait set has no L-shaped frame');
  });

  it('stream lookup: 404 for an unknown stream', async () => {
    expect((await admin.get('/superadmin/streams/00000000-0000-4000-8000-000000000000/brand-kit')).status).toBe(404);
  });
});
