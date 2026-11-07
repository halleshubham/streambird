import { describeE2E, bootApp, Client, Harness } from './harness';

const msg = (b: any): string => (typeof b.message === 'string' ? b.message : b.message?.message);
const later = () => new Date(Date.now() + 3 * 3600_000).toISOString();

describeE2E('brand kit default title and description', () => {
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

  async function conn(c: Client, label: string) {
    return (await c.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: `key-${label}` })).body.id as string;
  }
  const kit = async (c: Client, body: Record<string, unknown>) => {
    const r = await c.post('/brand-kits', body);
    expect(r.status).toBe(201);
    return r.body;
  };

  describe('GET/POST/PATCH /brand-kits', () => {
    it('title and description: null when unset, trimmed, returned everywhere, omitted = unchanged, null or blank = cleared', async () => {
      const { client } = await h.signIn();
      const plain = await kit(client, { name: 'Plain' });
      expect(plain).toMatchObject({ title: null, description: null });

      const k = await kit(client, { name: 'Weekly', title: '  Friday show  ', description: '  Join us live.\nSecond line.  ' });
      expect(k).toMatchObject({ title: 'Friday show', description: 'Join us live.\nSecond line.' });
      const listed = (await client.get('/brand-kits')).body.find((x: any) => x.id === k.id);
      expect(listed).toMatchObject({ title: 'Friday show', description: 'Join us live.\nSecond line.' });

      // Omitted = unchanged (an old client that never sends them keeps the text).
      const renamed = await client.patch(`/brand-kits/${k.id}`, { name: 'Weekly 2' });
      expect(renamed.body).toMatchObject({ name: 'Weekly 2', title: 'Friday show', description: 'Join us live.\nSecond line.' });
      // Only one of them.
      const t = await client.patch(`/brand-kits/${k.id}`, { title: ' New title ' });
      expect(t.body).toMatchObject({ title: 'New title', description: 'Join us live.\nSecond line.' });
      // null clears, blank (and whitespace) clears.
      const nulled = await client.patch(`/brand-kits/${k.id}`, { title: null });
      expect(nulled.body).toMatchObject({ title: null, description: 'Join us live.\nSecond line.' });
      const blank = await client.patch(`/brand-kits/${k.id}`, { description: '   ' });
      expect(blank.body).toMatchObject({ title: null, description: null });
      expect((await kit(client, { name: 'Blank on create', title: '', description: '  ' }))).toMatchObject({ title: null, description: null });
    });

    it('limits mirror a stream (title 200, description 5000) and errors are 400 with a plain sentence', async () => {
      const { client } = await h.signIn();
      const ok = await kit(client, { name: 'Max', title: 'x'.repeat(200), description: 'y'.repeat(5000) });
      expect(ok.title).toHaveLength(200);
      expect(ok.description).toHaveLength(5000);
      const longTitle = await client.post('/brand-kits', { name: 'Long', title: 'x'.repeat(201) });
      expect(longTitle.status).toBe(400);
      expect(JSON.stringify(longTitle.body)).toContain('The default title can be at most 200 characters.');
      const longDesc = await client.patch(`/brand-kits/${ok.id}`, { description: 'y'.repeat(5001) });
      expect(longDesc.status).toBe(400);
      expect(JSON.stringify(longDesc.body)).toContain('The default description can be at most 5000 characters.');
      const notText = await client.patch(`/brand-kits/${ok.id}`, { title: 12 });
      expect(notText.status).toBe(400);
      expect(JSON.stringify(notText.body)).toContain('The default title must be text.');
      // Nothing half-saved by the refused requests.
      const after = (await client.get('/brand-kits')).body.find((x: any) => x.id === ok.id);
      expect(after.title).toHaveLength(200);
      expect(after.description).toHaveLength(5000);
    });
  });

  describe('go live now (POST /streams)', () => {
    it('a blank or omitted title/description takes the kit defaults and says so; an explicit one wins', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      const k = await kit(client, { name: 'Acme', title: 'Acme weekly', description: 'About Acme', isDefault: true });

      const omitted = await client.post('/streams', { destinationConnectionIds: [c1] });
      expect(omitted.status).toBe(201);
      expect(omitted.body).toMatchObject({
        title: 'Acme weekly',
        description: 'About Acme',
        titleFromKit: true,
        descriptionFromKit: true,
        titleKit: { id: k.id, name: 'Acme' },
        descriptionKit: { id: k.id, name: 'Acme' },
      });
      await client.post(`/streams/${omitted.body.id}/end`);

      const blank = await client.post('/streams', { title: '   ', description: '', destinationConnectionIds: [c1] });
      expect(blank.body).toMatchObject({ title: 'Acme weekly', description: 'About Acme', titleFromKit: true });
      await client.post(`/streams/${blank.body.id}/end`);

      // Explicit title, blank description: independent.
      const mixed = await client.post('/streams', { title: ' My own ', destinationConnectionIds: [c1] });
      expect(mixed.body).toMatchObject({ title: 'My own', description: 'About Acme', titleFromKit: false, descriptionFromKit: true, titleKit: null });
      await client.post(`/streams/${mixed.body.id}/end`);

      const explicit = await client.post('/streams', { title: 'Mine', description: 'Mine too', destinationConnectionIds: [c1] });
      expect(explicit.body).toMatchObject({ title: 'Mine', description: 'Mine too', titleFromKit: false, descriptionFromKit: false });
      await client.post(`/streams/${explicit.body.id}/end`);
    });

    it('no title and no kit text is still 400 "A title is required"; so is a kit with only a description', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      const none = await client.post('/streams', { destinationConnectionIds: [c1] });
      expect(none.status).toBe(400);
      expect(msg(none.body)).toBe('A title is required.');
      await kit(client, { name: 'Only about', description: 'No title here', isDefault: true });
      const onlyDesc = await client.post('/streams', { title: ' ', destinationConnectionIds: [c1] });
      expect(onlyDesc.status).toBe(400);
      expect(msg(onlyDesc.body)).toBe('A title is required.');
      // Nothing was created by the refusals.
      expect((await client.get('/streams')).body.items).toHaveLength(0);
    });

    it('several destinations: the first one (in request order) whose kit has a value supplies it, independently for title and description', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      const c2 = await conn(client, 'b');
      const onlyDesc = await kit(client, { name: 'Desc only', description: 'From A' });
      const full = await kit(client, { name: 'Full', title: 'Title B', description: 'From B' });
      await client.put(`/brand-kits/connections/${c1}`, { brandKitId: onlyDesc.id });
      await client.put(`/brand-kits/connections/${c2}`, { brandKitId: full.id });

      const ab = await client.post('/streams', { destinationConnectionIds: [c1, c2] });
      expect(ab.status).toBe(201);
      expect(ab.body).toMatchObject({ title: 'Title B', description: 'From A', titleKit: { name: 'Full' }, descriptionKit: { name: 'Desc only' } });
      await client.post(`/streams/${ab.body.id}/end`);

      const ba = await client.post('/streams', { destinationConnectionIds: [c2, c1] });
      expect(ba.body).toMatchObject({ title: 'Title B', description: 'From B', titleKit: { name: 'Full' }, descriptionKit: { name: 'Full' } });
      await client.post(`/streams/${ba.body.id}/end`);
    });

    it('thumbnailBrandKitId picks the kit (a kit id) or turns it off (null); another account\'s kit gives nothing', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      await kit(client, { name: 'Default', title: 'Default title', isDefault: true });
      const picked = await kit(client, { name: 'Picked', title: 'Picked title' });

      const withPick = await client.post('/streams', { destinationConnectionIds: [c1], thumbnailBrandKitId: picked.id });
      expect(withPick.body).toMatchObject({ title: 'Picked title', titleKit: { id: picked.id } });
      await client.post(`/streams/${withPick.body.id}/end`);

      const noKit = await client.post('/streams', { destinationConnectionIds: [c1], thumbnailBrandKitId: null });
      expect(noKit.status).toBe(400); // "No brand kit": no default text either
      expect(msg(noKit.body)).toBe('A title is required.');
      const noKitTitled = await client.post('/streams', { title: 'Typed', destinationConnectionIds: [c1], thumbnailBrandKitId: null });
      expect(noKitTitled.body).toMatchObject({ title: 'Typed', titleFromKit: false });
      await client.post(`/streams/${noKitTitled.body.id}/end`);

      const stranger = await h.signIn();
      const theirs = await kit(stranger.client, { name: 'Theirs', title: 'Not yours' });
      const foreign = await client.post('/streams', { destinationConnectionIds: [c1], thumbnailBrandKitId: theirs.id });
      expect(foreign.status).toBe(400);
    });

    it('the text is copied: editing or deleting the kit afterwards never changes existing streams', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      const k = await kit(client, { name: 'Copy', title: 'Original title', description: 'Original text', isDefault: true });
      const s = await client.post('/streams', { destinationConnectionIds: [c1] });
      expect(s.body.title).toBe('Original title');
      await client.post(`/streams/${s.body.id}/end`);

      await client.patch(`/brand-kits/${k.id}`, { title: 'Edited title', description: null });
      const read = (await client.get(`/streams/${s.body.id}`)).body;
      expect(read).toMatchObject({ title: 'Original title', description: 'Original text' });
      // The next stream sees the edit.
      const next = await client.post('/streams', { destinationConnectionIds: [c1] });
      expect(next.body).toMatchObject({ title: 'Edited title', description: null, descriptionFromKit: false });
      await client.post(`/streams/${next.body.id}/end`);
      expect((await client.del(`/brand-kits/${k.id}`)).status).toBe(204);
      expect((await client.get(`/streams/${s.body.id}`)).body.title).toBe('Original title');
    });
  });

  describe('scheduled streams (POST /streams/schedule)', () => {
    it('a blank title/description takes the kit defaults (flags in the response), an explicit one wins, and editing the kit later changes nothing', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      const k = await kit(client, { name: 'Sched', title: 'Kit show', description: 'Kit about', isDefault: true });
      const fromKit = await client.post('/streams/schedule', { scheduledAt: later(), timezone: 'UTC', destinationConnectionIds: [c1] });
      expect(fromKit.status).toBe(201);
      expect(fromKit.body).toMatchObject({ title: 'Kit show', description: 'Kit about', titleFromKit: true, descriptionFromKit: true, titleKit: { id: k.id, name: 'Sched' } });
      const own = await client.post('/streams/schedule', { title: ' Own ', description: ' Own text ', scheduledAt: later(), timezone: 'UTC', destinationConnectionIds: [c1] });
      expect(own.body).toMatchObject({ title: 'Own', description: 'Own text', titleFromKit: false, descriptionFromKit: false, titleKit: null });

      await client.patch(`/brand-kits/${k.id}`, { title: 'Changed', description: 'Changed too' });
      const detail = (await client.get(`/streams/${fromKit.body.id}/schedule`)).body;
      expect(detail).toMatchObject({ title: 'Kit show', description: 'Kit about' });
      expect(detail.titleFromKit).toBeUndefined(); // only the create response says where the text came from
      // Starting it later uses the stored (copied) title.
      const started = await client.post(`/streams/${fromKit.body.id}/start`);
      expect(started.body.title).toBe('Kit show');
    });

    it('without a title and without a kit default it is a 400', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      const r = await client.post('/streams/schedule', { scheduledAt: later(), timezone: 'UTC', destinationConnectionIds: [c1] });
      expect(r.status).toBe(400);
      expect(msg(r.body)).toBe('A title is required.');
    });
  });

  describe('presets', () => {
    it('go live from a preset: a typed title wins, else the kit default, else the preset name', async () => {
      const { client } = await h.signIn();
      const c1 = await conn(client, 'a');
      const bare = await client.post('/presets', { name: 'Friday preset', config: { destinationIds: [c1] } });
      expect(bare.status).toBe(201);

      // No kit text anywhere: the preset name, exactly as before.
      const named = await client.post(`/presets/${bare.body.id}/start`, {});
      expect(named.status).toBe(201);
      expect(named.body.title).toBe('Friday preset');
      await client.post(`/streams/${named.body.id}/end`);

      const k = await kit(client, { name: 'Preset kit', title: 'Kit title for presets', description: 'Kit about', isDefault: true });
      const fromKit = await client.post(`/presets/${bare.body.id}/start`, {});
      expect(fromKit.body).toMatchObject({ title: 'Kit title for presets', description: 'Kit about', titleFromKit: true });
      await client.post(`/streams/${fromKit.body.id}/end`);

      const typed = await client.post(`/presets/${bare.body.id}/start`, { title: 'Typed for tonight' });
      expect(typed.body).toMatchObject({ title: 'Typed for tonight', titleFromKit: false, description: 'Kit about' });
      await client.post(`/streams/${typed.body.id}/end`);

      // A preset that names a kit uses that kit's text; "No brand kit" (null) uses none.
      const other = await kit(client, { name: 'Other', title: 'Other kit title' });
      const withKit = await client.post('/presets', { name: 'With kit', config: { destinationIds: [c1], brandKitId: other.id } });
      const a = await client.post(`/presets/${withKit.body.id}/start`, {});
      expect(a.body.title).toBe('Other kit title');
      await client.post(`/streams/${a.body.id}/end`);
      const noKit = await client.post('/presets', { name: 'Plain look', config: { destinationIds: [c1], brandKitId: null } });
      const b = await client.post(`/presets/${noKit.body.id}/start`, {});
      expect(b.body).toMatchObject({ title: 'Plain look', description: null, titleFromKit: false });
      await client.post(`/streams/${b.body.id}/end`);
      void k;
    });
  });
});
