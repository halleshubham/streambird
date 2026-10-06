import { describeE2E, bootApp, Harness } from './harness';

describeE2E('stream orientation: landscape by default, portrait on request', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
  });
  afterAll(() => h.close());

  const twitch = (c: { post: (p: string, b: unknown) => Promise<any> }, label: string) =>
    c.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: `key-${label}` }).then((r) => r.body.id as string);

  it('a stream is landscape unless the host asks for vertical, and the API says which', async () => {
    const { client } = await h.signIn();
    const dest = await twitch(client, 'A');

    const normal = await client.post('/streams', { title: 'wide', destinationConnectionIds: [dest] });
    expect(normal.status).toBe(201);
    expect(normal.body.orientation).toBe('landscape');

    const vertical = await client.post('/streams', { title: 'tall', orientation: 'portrait', destinationConnectionIds: [dest] });
    expect(vertical.status).toBe(201);
    expect(vertical.body.orientation).toBe('portrait');
    // ...and it comes back the same when the studio loads the stream.
    expect((await client.get(`/streams/${vertical.body.id}`)).body.orientation).toBe('portrait');
  });

  it('only landscape and portrait are accepted', async () => {
    const { client } = await h.signIn();
    const dest = await twitch(client, 'B');
    const res = await client.post('/streams', { title: 'odd', orientation: 'square', destinationConnectionIds: [dest] });
    expect(res.status).toBe(400);
  });

  it('a scheduled stream can be vertical too, and shows it in its details', async () => {
    const { client } = await h.signIn();
    const dest = await twitch(client, 'C');
    const when = new Date(Date.now() + 3 * 3600_000).toISOString();
    const res = await client.post('/streams/schedule', {
      title: 'tall later',
      scheduledAt: when,
      timezone: 'UTC',
      orientation: 'portrait',
      destinationConnectionIds: [dest],
    });
    expect(res.status).toBe(201);
    expect(res.body.orientation).toBe('portrait');
    expect((await client.get(`/streams/${res.body.id}/schedule`)).body.orientation).toBe('portrait');

    // The shape is fixed once created: editing the schedule doesn't take an orientation.
    const edit = await client.patch(`/streams/${res.body.id}/schedule`, { orientation: 'landscape' });
    expect(edit.status).toBe(400);
  });

  it('streams that existed before the column was added are landscape', async () => {
    const { rows } = await h.db.query(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'live_streams' AND column_name = 'orientation'`);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].column_default).toContain('landscape');
  });
});
