import { describeE2E, bootApp, Client, Harness } from './harness';

const msg = (b: any): string => (typeof b.message === 'string' ? b.message : b.message?.message);
const randomUuid = () => '8d3c7f0e-1b2a-4c5d-9e6f-0a1b2c3d4e5f';

describeE2E('stream presets: saved go-live setups, per account, applied at use time', () => {
  let h: Harness;
  let admin: Client;
  let freePlan: { assetStorageMb: number; maxResolution: string; maxDestinations: number };
  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    admin = (await h.signIn({ superadmin: true })).client;
    const { rows } = await h.db.query(`SELECT asset_storage_mb, max_resolution, max_destinations FROM plans WHERE key = 'free'`);
    freePlan = { assetStorageMb: rows[0].asset_storage_mb, maxResolution: rows[0].max_resolution, maxDestinations: rows[0].max_destinations };
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', freePlan); // the plans table is shared with the other e2e files
    await h.close();
  });

  const twitch = (c: Client, label: string) =>
    c.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: `key-${label}` }).then((r) => r.body.id as string);

  it('needs a signed-in, approved account', async () => {
    const anon = new Client(h.baseUrl);
    expect((await anon.get('/presets')).status).toBe(401);
    expect((await anon.post('/presets', { name: 'x', config: {} })).status).toBe(401);
  });

  it('create, list (last used first, never used after), rename, replace config, delete', async () => {
    const { client } = await h.signIn();
    const dest = await twitch(client, 'L1');

    const a = await client.post('/presets', { name: '  Weekly show ', config: { orientation: 'landscape', destinationIds: [dest], quality: 'hd', tickerEnabled: true, tickerText: 'Welcome' } });
    expect(a.status).toBe(201);
    expect(a.body).toEqual({
      id: expect.any(String),
      name: 'Weekly show',
      config: { orientation: 'landscape', destinationIds: [dest], quality: 'hd', tickerEnabled: true, tickerText: 'Welcome' },
      lastUsedAt: null,
    });
    const b = await client.post('/presets', { name: 'Vertical', config: { orientation: 'portrait' } });
    const c = await client.post('/presets', { name: 'Empty', config: {} });
    expect(c.status).toBe(201);

    // Never used: oldest first.
    expect((await client.get('/presets')).body.map((p: any) => p.name)).toEqual(['Weekly show', 'Vertical', 'Empty']);

    const used = await client.post(`/presets/${b.body.id}/use`);
    expect(used.status).toBe(200);
    expect(used.body).toMatchObject({ id: b.body.id, name: 'Vertical', config: { orientation: 'portrait' } });
    expect(typeof used.body.lastUsedAt).toBe('string');
    expect((await client.get('/presets')).body.map((p: any) => p.name)).toEqual(['Vertical', 'Weekly show', 'Empty']);

    const renamed = await client.patch(`/presets/${a.body.id}`, { name: 'Friday show' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Friday show', config: a.body.config });

    // config is replaced, not merged.
    const replaced = await client.patch(`/presets/${a.body.id}`, { config: { quality: 'sd' } });
    expect(replaced.body.config).toEqual({ quality: 'sd' });

    expect((await client.call('DELETE', `/presets/${c.body.id}`)).status).toBe(204);
    expect((await client.get('/presets')).body).toHaveLength(2);
    expect((await client.call('DELETE', `/presets/${c.body.id}`)).status).toBe(404);
  });

  it('validation: unknown keys, bad values and ids are rejected', async () => {
    const { client } = await h.signIn();
    const bad = async (body: unknown) => (await client.post('/presets', body)).status;
    expect(await bad({ name: '', config: {} })).toBe(400);
    expect(await bad({ name: 'x'.repeat(81), config: {} })).toBe(400);
    expect(await bad({ name: 'x' })).toBe(400); // config required
    expect(await bad({ name: 'x', config: { surprise: 1 } })).toBe(400); // unknown key
    expect(await bad({ name: 'x', extra: 1, config: {} })).toBe(400);
    expect(await bad({ name: 'x', config: { orientation: 'square' } })).toBe(400);
    expect(await bad({ name: 'x', config: { quality: '4k' } })).toBe(400);
    expect(await bad({ name: 'x', config: { tickerEnabled: 'yes' } })).toBe(400);
    expect(await bad({ name: 'x', config: { tickerText: 'x'.repeat(201) } })).toBe(400);
    expect(await bad({ name: 'x', config: { destinationIds: ['nope'] } })).toBe(400);
    expect(await bad({ name: 'x', config: { brandKitId: 'nope' } })).toBe(400);
    expect((await client.patch('/presets/not-a-uuid', { name: 'x' })).status).toBe(400);
    // brandKitId null is allowed ("no kit").
    expect(await bad({ name: 'null kit', config: { brandKitId: null } })).toBe(201);
    expect((await client.get('/presets')).body[0].config).toEqual({ brandKitId: null });
  });

  it('one account never sees or touches another account\'s presets, destinations or kits', async () => {
    const owner = await h.signIn();
    const other = await h.signIn();
    const ownerDest = await twitch(owner.client, 'iso-o');
    const otherDest = await twitch(other.client, 'iso-x');
    const p = await owner.client.post('/presets', { name: 'Mine', config: { destinationIds: [ownerDest] } });

    expect((await other.client.get('/presets')).body).toEqual([]);
    for (const [method, path, body] of [
      ['PATCH', `/presets/${p.body.id}`, { name: 'hijack' }],
      ['DELETE', `/presets/${p.body.id}`, undefined],
      ['POST', `/presets/${p.body.id}/use`, undefined],
      ['POST', `/presets/${p.body.id}/start`, {}],
    ] as const) {
      expect((await other.client.call(method, path, { body })).status).toBe(404);
    }
    expect((await owner.client.get('/presets')).body[0].name).toBe('Mine');

    // A destination that belongs to somebody else cannot be put in a preset, nor can a kit that is not yours.
    const steal = await other.client.post('/presets', { name: 'steal', config: { destinationIds: [ownerDest] } });
    expect(steal.status).toBe(422);
    expect((await other.client.post('/presets', { name: 'kit', config: { brandKitId: randomUuid() } })).status).toBe(422);
    expect((await owner.client.patch(`/presets/${p.body.id}`, { config: { destinationIds: [otherDest] } })).status).toBe(422);
  });

  it('keeps at most 20 presets per account', async () => {
    const { client } = await h.signIn();
    for (let i = 0; i < 20; i++) expect((await client.post('/presets', { name: `p${i}`, config: {} })).status).toBe(201);
    const over = await client.post('/presets', { name: 'one too many', config: {} });
    expect(over.status).toBe(409);
    expect(msg(over.body)).toMatch(/up to 20 presets/);
    // Deleting one frees a slot; another account is unaffected.
    const first = (await client.get('/presets')).body[0];
    await client.call('DELETE', `/presets/${first.id}`);
    expect((await client.post('/presets', { name: 'fits now', config: {} })).status).toBe(201);
    const other = await h.signIn();
    expect((await other.client.post('/presets', { name: 'mine', config: {} })).status).toBe(201);
  });

  it('start creates the stream like POST /streams (same shape, orientation, destinations, studio session) and stamps the use', async () => {
    const { client } = await h.signIn();
    const dest = await twitch(client, 'S1');
    const p = await client.post('/presets', { name: 'Tall show', config: { orientation: 'portrait', destinationIds: [dest], quality: 'hd', tickerEnabled: true, tickerText: 'Hi' } });

    const started = await client.post(`/presets/${p.body.id}/start`, {});
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ title: 'Tall show', status: 'live', orientation: 'portrait' });
    expect(started.body.studioSessionId).toEqual(expect.any(String));
    expect(started.body.destinations).toHaveLength(1);
    expect(started.body.destinations[0].platformConnectionId).toBe(dest);
    expect(started.body.whipUrl).toEqual(expect.any(String));
    expect(started.body.preset).toMatchObject({ id: p.body.id, warnings: [], effectiveConfig: { quality: 'hd', tickerText: 'Hi', orientation: 'portrait' } });
    expect(typeof started.body.preset.lastUsedAt).toBe('string');

    // It is an ordinary stream afterwards.
    const got = await client.get(`/streams/${started.body.id}`);
    expect(got.body).toMatchObject({ orientation: 'portrait', title: 'Tall show' });
    expect((await client.get('/presets')).body[0].lastUsedAt).not.toBeNull();

    // A custom title overrides the preset name.
    const second = await client.post(`/presets/${p.body.id}/start`, { title: 'Night two' });
    expect(second.status).toBe(201);
    expect(second.body.title).toBe('Night two');
    expect((await client.post(`/presets/${p.body.id}/start`, { title: '' })).status).toBe(400);
    expect((await client.post(`/presets/${p.body.id}/start`, { nope: 1 })).status).toBe(400);
  });

  it('start without saved destinations uses every connected destination, and with none connected it is refused', async () => {
    await admin.patch('/superadmin/plans/free', { maxDestinations: 3 });
    const { client } = await h.signIn();
    const p = await client.post('/presets', { name: 'Everything', config: {} });
    const refused = await client.post(`/presets/${p.body.id}/start`, {});
    expect(refused.status).toBe(422);
    expect(msg(refused.body)).toMatch(/Connect/);
    expect((await client.get('/presets')).body[0].lastUsedAt).toBeNull();

    const d1 = await twitch(client, 'E1');
    const d2 = await twitch(client, 'E2');
    const started = await client.post(`/presets/${p.body.id}/start`, {});
    expect(started.status).toBe(201);
    expect(started.body.orientation).toBe('landscape');
    expect(started.body.destinations.map((d: any) => d.platformConnectionId).sort()).toEqual([d1, d2].sort());
  });

  it('start enforces the plan like the normal path (destination count) and skips destinations that were disconnected', async () => {
    await admin.patch('/superadmin/plans/free', { maxDestinations: 1 });
    const { client } = await h.signIn();
    const d1 = await twitch(client, 'P1');
    const d2 = await twitch(client, 'P2');
    const two = await client.post('/presets', { name: 'Two', config: { destinationIds: [d1, d2] } });
    const over = await client.post(`/presets/${two.body.id}/start`, {});
    expect(over.status).toBe(403);
    expect((await client.get('/presets')).body[0].lastUsedAt).toBeNull(); // a refused start is not a use

    // d2 gets disconnected after the preset was saved: it is skipped with a warning, not an error.
    expect((await client.call('DELETE', `/platform-connections/${d2}`)).status).toBeLessThan(300);
    const ok = await client.post(`/presets/${two.body.id}/start`, {});
    expect(ok.status).toBe(201);
    expect(ok.body.destinations).toHaveLength(1);
    expect(ok.body.preset.warnings.join(' ')).toMatch(/no longer connected/);
    // The stored preset is untouched.
    expect((await client.get('/presets')).body[0].config.destinationIds).toEqual([d1, d2]);
  });

  it('quality and brand kit are checked against the plan every time the preset is used, not only when it is saved', async () => {
    await admin.patch('/superadmin/plans/free', { maxResolution: 'fhd', assetStorageMb: 1, maxDestinations: 1 });
    const { client } = await h.signIn();
    const dest = await twitch(client, 'Q1');
    const kit = await client.post('/brand-kits', { name: 'Acme' });
    expect(kit.status).toBe(201);
    const p = await client.post('/presets', { name: 'Fancy', config: { destinationIds: [dest], quality: 'fhd', brandKitId: kit.body.id } });
    expect(p.status).toBe(201);

    const ok = await client.post(`/presets/${p.body.id}/use`);
    expect(ok.body.effectiveConfig).toMatchObject({ quality: 'fhd', brandKitId: kit.body.id });
    expect(ok.body.warnings).toEqual([]);

    // The plan is downgraded: lower quality, no brand storage.
    await admin.patch('/superadmin/plans/free', { maxResolution: 'sd', assetStorageMb: 0 });
    const down = await client.post(`/presets/${p.body.id}/use`);
    expect(down.body.config).toMatchObject({ quality: 'fhd', brandKitId: kit.body.id }); // what was saved
    expect(down.body.effectiveConfig).toMatchObject({ quality: 'sd', brandKitId: null });
    expect(down.body.warnings).toHaveLength(2);
    const started = await client.post(`/presets/${p.body.id}/start`, {});
    expect(started.status).toBe(201);
    expect(started.body.preset.effectiveConfig).toMatchObject({ quality: 'sd', brandKitId: null });

    // A deleted kit is dropped too (plan with storage again).
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 1, maxResolution: 'fhd' });
    expect((await client.call('DELETE', `/brand-kits/${kit.body.id}`)).status).toBeLessThan(300);
    const gone = await client.post(`/presets/${p.body.id}/use`);
    expect(gone.body.effectiveConfig.brandKitId).toBeNull();
    expect(gone.body.warnings.join(' ')).toMatch(/no longer exists/);
  });
});
