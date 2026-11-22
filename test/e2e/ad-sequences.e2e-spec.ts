import { describeE2E, bootApp, Client, Harness } from './harness';

/** A real-enough PNG header (the server reads the signature and the size). */
function fakePng(width: number, height: number, bytes = 200): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 7)]);
}
const msg = (b: any): string => (typeof b.message === 'string' ? b.message : b.message?.message);

async function upload(c: Client, file: Buffer, kind: string, name: string) {
  const boundary = `----sb${Date.now()}${Math.random().toString(16).slice(2)}`;
  const part = (n: string, v: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
  const body = Buffer.concat([
    Buffer.from(part('kind', kind) + part('name', name)),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.call('POST', '/assets', { raw: body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}

describeE2E('ad sequences: several ads of one placement, played in turn (brand kits)', () => {
  let h: Harness;
  let admin: Client;
  beforeAll(async () => {
    h = await bootApp();
    admin = (await h.signIn({ superadmin: true })).client;
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 5, watermark: false });
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 0, watermark: true });
    await h.close();
  });

  async function setup(n = 6) {
    const { client, accountId } = await h.signIn();
    const files: any[] = [];
    for (let i = 0; i < n; i++) files.push((await upload(client, fakePng(1280, 720), 'ad', `Frame ${i + 1}`)).body);
    return { client, accountId, files };
  }
  const frame = (assetId: string, extra: object = {}) => ({ placement: 'l_shape', assetId, ...extra });
  const view = (assetId: string, extra: object = {}) => ({ placement: 'l_shape', assetId, enabled: true, mode: 'continuous', showSec: null, everySec: null, ...extra });
  const ids = (list: any[]) => list.map((x) => x.assetId);

  it('new clients: ads = first ad of each placement, adsMore = positions 1..4 in play order; the kit read returns both', async () => {
    const { client, files } = await setup();
    const [a, b, c, d] = files;
    const created = await client.post('/brand-kits', {
      name: 'Sequences',
      ads: [frame(a.id, { mode: 'interval', showSec: 20, everySec: 120 }), { placement: 'lower_third', assetId: d.id }],
      adsMore: [frame(b.id, { mode: 'continuous', showSec: 30, enabled: false }), frame(c.id, { showSec: 45 })],
    });
    expect(created.status).toBe(201);
    // The first ads are exactly what an older client reads.
    expect(created.body.ads).toEqual([
      { placement: 'lower_third', assetId: d.id, enabled: true, mode: 'continuous', showSec: null, everySec: null },
      view(a.id, { mode: 'interval', showSec: 20, everySec: 120 }),
    ]);
    // Further ads take mode and everySec from the first ad of their placement; each keeps its own showSec and On flag.
    expect(created.body.adsMore).toEqual([view(b.id, { enabled: false, mode: 'interval', showSec: 30, everySec: 120 }), view(c.id, { mode: 'interval', showSec: 45, everySec: 120 })]);
    expect(created.body.adsPortrait).toEqual([]);
    expect(created.body.adsMorePortrait).toEqual([]);
    const read = (await client.get('/brand-kits')).body.find((k: any) => k.id === created.body.id);
    expect(read.ads).toEqual(created.body.ads);
    expect(read.adsMore).toEqual(created.body.adsMore);
    // Every file of the sequence is "in use" by the kit.
    const lib = (await client.get('/assets')).body.items;
    for (const f of [a, b, c, d]) expect(lib.find((x: any) => x.id === f.id).usedBy).toEqual(['Sequences']);
    expect((await client.del(`/assets/${c.id}`)).status).toBe(409);
  });

  it('always-on sequences: showSec is the time before the next ad (5..300); a lone always-on ad still stores no numbers', async () => {
    const { client, files } = await setup(3);
    const [a, b] = files;
    const kit = (await client.post('/brand-kits', { name: 'Dwell', ads: [frame(a.id, { showSec: 7 })] })).body;
    expect(kit.ads[0].showSec).toBeNull(); // single ad: as before sequences
    const seq = await client.patch(`/brand-kits/${kit.id}`, { ads: [frame(a.id, { showSec: 12 })], adsMore: [frame(b.id)] });
    expect(seq.status).toBe(200);
    expect(seq.body.ads[0].showSec).toBe(12);
    expect(seq.body.adsMore[0].showSec).toBeNull(); // clients play null as 20 s
    for (const bad of [4, 301]) {
      const r = await client.patch(`/brand-kits/${kit.id}`, { ads: [frame(a.id)], adsMore: [frame(b.id, { showSec: bad })] });
      expect(r.status).toBe(400);
      expect(msg(r.body)).toMatch(/5 to 300/);
    }
    // A timed sequence needs every ad's show time.
    const noShow = await client.patch(`/brand-kits/${kit.id}`, { ads: [frame(a.id, { mode: 'interval', showSec: 10, everySec: 60 })], adsMore: [frame(b.id)] });
    expect(noShow.status).toBe(400);
    expect(msg(noShow.body)).toMatch(/how long it is shown/);
  });

  it('OLD clients: a PUT of only `ads` replaces the first ads and leaves positions >= 1 alone; a removed first ad lets the next one move up', async () => {
    const { client, files } = await setup();
    const [a, b, c, d] = files;
    const kit = (await client.post('/brand-kits', { name: 'Old client', ads: [frame(a.id), { placement: 'side_third', assetId: d.id }], adsMore: [frame(b.id), frame(c.id)] })).body;
    // Saving the kit the way a cached tab / Android 1.0.x does: only `ads`.
    const renamed = await client.patch(`/brand-kits/${kit.id}`, { name: 'Old client 2', ads: kit.ads });
    expect(renamed.body.ads).toEqual(kit.ads);
    expect(ids(renamed.body.adsMore)).toEqual([b.id, c.id]);
    // Swapping the first ad's file keeps the rest of the sequence.
    const swapped = await client.patch(`/brand-kits/${kit.id}`, { ads: [frame(d.id, { enabled: false }), { placement: 'side_third', assetId: d.id }] });
    expect(swapped.body.ads.find((x: any) => x.placement === 'l_shape')).toEqual(view(d.id, { enabled: false }));
    expect(ids(swapped.body.adsMore)).toEqual([b.id, c.id]);
    // An old client that drops the placement removes "the ad": the next of the sequence moves up (nothing it never saw is wiped).
    const dropped = await client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'side_third', assetId: d.id }] });
    expect(dropped.body.ads.map((x: any) => `${x.placement}:${x.assetId}`)).toEqual([`side_third:${d.id}`, `l_shape:${b.id}`]);
    expect(ids(dropped.body.adsMore)).toEqual([c.id]);
    // ... and once only one is left, dropping it empties the placement.
    await client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'side_third', assetId: d.id }] });
    const empty = await client.patch(`/brand-kits/${kit.id}`, { ads: [{ placement: 'side_third', assetId: d.id }] });
    expect(empty.body.ads.map((x: any) => x.placement)).toEqual(['side_third']);
    expect(empty.body.adsMore).toEqual([]);
    // An old-style create (no adsMore) and the old "ads: []" clear both still work.
    expect((await client.post('/brand-kits', { name: 'Old create', ads: [frame(a.id)] })).body.adsMore).toEqual([]);
    expect((await client.patch(`/brand-kits/${kit.id}`, { ads: [] })).body.ads).toEqual([]);
  });

  it('NEW clients: sending adsMore (even []) replaces positions 1..4; adsMore alone keeps the first ads; ads null/omitted is unchanged', async () => {
    const { client, files } = await setup();
    const [a, b, c, d] = files;
    const kit = (await client.post('/brand-kits', { name: 'Replace', ads: [frame(a.id)], adsMore: [frame(b.id), frame(c.id)] })).body;
    // Reorder: the third becomes first.
    const reordered = await client.patch(`/brand-kits/${kit.id}`, { ads: [frame(c.id)], adsMore: [frame(a.id), frame(b.id)] });
    expect(ids(reordered.body.ads)).toEqual([c.id]);
    expect(ids(reordered.body.adsMore)).toEqual([a.id, b.id]);
    // adsMore alone: first ads stay.
    const more = await client.patch(`/brand-kits/${kit.id}`, { adsMore: [frame(d.id)] });
    expect(ids(more.body.ads)).toEqual([c.id]);
    expect(ids(more.body.adsMore)).toEqual([d.id]);
    // Omitted / null = unchanged.
    expect((await client.patch(`/brand-kits/${kit.id}`, { name: 'Replace 2' })).body.adsMore).toHaveLength(1);
    expect((await client.patch(`/brand-kits/${kit.id}`, { adsMore: null, ads: null })).body.adsMore).toHaveLength(1);
    // [] = no sequence, the first ad stays.
    const cleared = await client.patch(`/brand-kits/${kit.id}`, { ads: [frame(c.id)], adsMore: [] });
    expect(cleared.body.adsMore).toEqual([]);
    expect(cleared.body.ads).toHaveLength(1);
    // The file of a removed position is free again.
    expect((await client.del(`/assets/${b.id}`)).status).toBe(204);
  });

  it('portrait sets work the same and are independent of the landscape set', async () => {
    const { client, files } = await setup();
    const [a, b, c] = files;
    const kit = (await client.post('/brand-kits', { name: 'Both', ads: [frame(a.id)], adsPortrait: [frame(b.id)], adsMorePortrait: [frame(c.id, { showSec: 25 }), frame(a.id)] })).body;
    expect(kit.adsMore).toEqual([]);
    expect(ids(kit.adsPortrait)).toEqual([b.id]);
    expect(ids(kit.adsMorePortrait)).toEqual([c.id, a.id]);
    expect(kit.adsMorePortrait[0].showSec).toBe(25);
    const after = await client.patch(`/brand-kits/${kit.id}`, { adsMore: [frame(c.id)] }); // landscape only
    expect(after.body.adsMorePortrait).toHaveLength(2);
    expect(after.body.adsMore).toHaveLength(1);
  });

  it('limits: at most 5 per placement per orientation, 16 further ads in a request, a further ad needs its first ad', async () => {
    const { client, files } = await setup();
    const [a, b] = files;
    const ok = await client.post('/brand-kits', { name: 'Five', ads: [frame(a.id)], adsMore: [frame(b.id), frame(b.id), frame(b.id), frame(b.id)] });
    expect(ok.status).toBe(201);
    expect(ok.body.adsMore).toHaveLength(4);
    const six = await client.patch(`/brand-kits/${ok.body.id}`, { adsMore: [frame(b.id), frame(b.id), frame(b.id), frame(b.id), frame(b.id)] });
    expect(six.status).toBe(400);
    expect(msg(six.body)).toMatch(/at most 5/);
    expect((await client.patch(`/brand-kits/${ok.body.id}`, { adsMore: Array.from({ length: 17 }, () => frame(b.id)) })).status).toBe(400);
    // Other placements have their own five.
    const mixed = await client.patch(`/brand-kits/${ok.body.id}`, {
      ads: [frame(a.id), { placement: 'lower_third', assetId: a.id }],
      adsMore: [frame(b.id), { placement: 'lower_third', assetId: b.id }, { placement: 'lower_third', assetId: a.id }],
    });
    expect(mixed.status).toBe(200);
    expect(mixed.body.adsMore.map((x: any) => x.placement)).toEqual(['lower_third', 'lower_third', 'l_shape']);
    // A further ad without a first ad of its placement.
    const orphan = await client.patch(`/brand-kits/${ok.body.id}`, { ads: [frame(a.id)], adsMore: [{ placement: 'full_screen', assetId: b.id }] });
    expect(orphan.status).toBe(400);
    expect(msg(orphan.body)).toMatch(/first ad/);
    expect((await client.patch(`/brand-kits/${ok.body.id}`, { adsMore: [{ placement: 'side_third', assetId: b.id }] })).status).toBe(400);
    // Two first ads of one placement are refused (put the others in adsMore).
    expect((await client.patch(`/brand-kits/${ok.body.id}`, { ads: [frame(a.id), frame(b.id)] })).status).toBe(400);
    // Nothing of the refused saves was applied.
    expect((await client.get('/brand-kits')).body.find((k: any) => k.id === ok.body.id).adsMore).toHaveLength(3);
    // Bad shapes.
    expect((await client.patch(`/brand-kits/${ok.body.id}`, { adsMore: [{ placement: 'top_band', assetId: b.id }] })).status).toBe(400);
    expect((await client.patch(`/brand-kits/${ok.body.id}`, { adsMore: [{ placement: 'l_shape', assetId: 'nope' }] })).status).toBe(400);
    expect((await client.patch(`/brand-kits/${ok.body.id}`, { adsMore: 'x' })).status).toBe(400);
  });

  it("ownership and file kind are checked for every ad of a sequence; another account's kit is 404", async () => {
    const { client, files } = await setup(2);
    const other = await h.signIn();
    const foreign = (await upload(other.client, fakePng(1280, 720), 'ad', 'Theirs')).body;
    const logo = (await upload(client, fakePng(100, 100), 'logo', 'Logo')).body;
    const kit = (await client.post('/brand-kits', { name: 'Mine', ads: [frame(files[0].id)], adsMore: [frame(files[1].id)] })).body;
    expect((await client.patch(`/brand-kits/${kit.id}`, { adsMore: [frame(foreign.id)] })).status).toBe(400); // not my file
    expect((await client.patch(`/brand-kits/${kit.id}`, { adsMore: [frame(logo.id)] })).status).toBe(400); // not an ad file
    expect((await client.post('/brand-kits', { name: 'Bad', ads: [frame(files[0].id)], adsMore: [frame(foreign.id)] })).status).toBe(400);
    expect((await other.client.patch(`/brand-kits/${kit.id}`, { adsMore: [] })).status).toBe(404);
    expect((await client.get('/brand-kits')).body.find((k: any) => k.id === kit.id).adsMore).toHaveLength(1);
  });

  it('plans: Free (with the mark) is refused for sequences too, clearing works, a downgrade keeps the saved sequence readable', async () => {
    const { client, files } = await setup(3);
    const kit = (await client.post('/brand-kits', { name: 'Paid look', ads: [frame(files[0].id)], adsMore: [frame(files[1].id)] })).body;
    await admin.patch('/superadmin/plans/free', { watermark: true });
    try {
      expect((await client.patch(`/brand-kits/${kit.id}`, { adsMore: [frame(files[1].id), frame(files[2].id)] })).status).toBe(403);
      expect((await client.post('/brand-kits', { name: 'Nope', ads: [frame(files[0].id)], adsMore: [frame(files[1].id)] })).status).toBe(403);
      const read = (await client.get('/brand-kits')).body.find((k: any) => k.id === kit.id);
      expect(read.adsMore).toHaveLength(1); // still readable
      expect((await client.patch(`/brand-kits/${kit.id}`, { name: 'Renamed' })).body.adsMore).toHaveLength(1);
      expect((await client.patch(`/brand-kits/${kit.id}`, { adsMore: [] })).status).toBe(200); // clearing always works
      expect((await client.patch(`/brand-kits/${kit.id}`, { ads: [], adsMore: [] })).body.ads).toEqual([]);
    } finally {
      await admin.patch('/superadmin/plans/free', { watermark: false });
    }
  });

  it('deleting the kit removes the whole sequence and frees every file', async () => {
    const { client, files } = await setup(3);
    const kit = (await client.post('/brand-kits', { name: 'Gone', ads: [frame(files[0].id)], adsMore: [frame(files[1].id), frame(files[2].id)] })).body;
    expect((await client.del(`/brand-kits/${kit.id}`)).status).toBe(204);
    for (const f of files) expect((await client.del(`/assets/${f.id}`)).status).toBe(204);
  });

  it('the superadmin kit view lists every ad of a sequence with its position and a diagnostic line per switched-off ad', async () => {
    const { client, accountId, files } = await setup(3);
    const kit = (await client.post('/brand-kits', { name: 'Diag', ads: [frame(files[0].id)], adsMore: [frame(files[1].id, { enabled: false }), frame(files[2].id)] })).body;
    const res = await admin.get(`/superadmin/accounts/${accountId}/brand-kits`);
    expect(res.status).toBe(200);
    const k = res.body.kits.find((x: any) => x.id === kit.id);
    expect(k.landscape.ads.map((a: any) => [a.placement, a.position])).toEqual([['l_shape', 0], ['l_shape', 1], ['l_shape', 2]]);
    const texts: string[] = k.diagnostics.map((d: any) => d.text);
    expect(texts.some((t) => /L-shaped frame \(landscape \(16:9\)\) plays 3 ads in turn/.test(t))).toBe(true);
    expect(texts.some((t) => /L-shaped frame ad 2 of 3 \(landscape \(16:9\)\) is switched off: tick On to use it/.test(t))).toBe(true);
    expect(texts.some((t) => /ad 1 of 3 .*is switched off/.test(t))).toBe(false);
  });
});
