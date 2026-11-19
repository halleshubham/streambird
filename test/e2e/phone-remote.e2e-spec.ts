import * as crypto from 'crypto';
import { io, type Socket } from 'socket.io-client';
import { describeE2E, bootApp, Client, Harness } from './harness';
import { StudioSignalingGateway } from '../../src/studio/studio-signaling.gateway';
import { StudioSessionsService } from '../../src/studio/studio-sessions.service';
import { PhoneRemoteService } from '../../src/studio/support/phone-remote.service';
import { PhoneRemoteController } from '../../src/studio/support/phone-remote.controller';
import { IMPERSONATION_ACT_ALLOWED, BLOCKED_WHEN_IMPERSONATING_KEY } from '../../src/impersonation/blocked-when-impersonating';

// Remote support control of a stream started from the ANDROID APP: the phone long-polls the server (owner session),
// a support socket queues whitelisted commands for it, the phone acks and uploads its state. Real Postgres, real app,
// real HTTP + socket.io clients; the "phone" here is the owner's cookie session calling the three routes.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Conn {
  socket: Socket;
  events: Array<{ ev: string; args: any[] }>;
  got: (ev: string) => any[][];
  wait: (ev: string, pred?: (...a: any[]) => boolean, ms?: number) => Promise<any[]>;
}

const clock = { enabled: true, position: 'top_right', format: '24h', showDate: false, showSeconds: true, timezone: null, size: 'medium', style: 'pill', alternate: false };
const phoneState = (over: Record<string, unknown> = {}) => ({
  v: 1,
  platform: 'android',
  appVersion: '1.0.14',
  orientation: 'portrait',
  freePlan: false,
  ads: { lower_third: { present: true, enabled: true, manual: null, mode: 'continuous', showSec: 15, everySec: 180, source: 'phone' }, side_third: { present: false } },
  adsShrink: false,
  ticker: { text: null, on: false },
  clock,
  ...over,
});

/** The optional capability blocks of a phone app 1.0.15 snapshot. */
const capable = () => ({
  kits: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Studio' }],
  kit: null,
  logo: { present: true, position: 'left', size: 90 },
  lowerThird: { available: true, name: null, title: null, show: false },
});

describeE2E('phone remote control (Android app long poll)', () => {
  let h: Harness;
  let admin: Client;
  let gateway: StudioSignalingGateway;
  let phoneSvc: PhoneRemoteService;
  const open: Socket[] = [];

  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    admin = (await h.signIn({ superadmin: true })).client;
    gateway = h.app.get(StudioSignalingGateway);
    phoneSvc = h.app.get(PhoneRemoteService);
    gateway.supportAckTimeoutMs = 600;
    await admin.patch('/superadmin/plans/free', { maxDestinations: 3, maxGuests: 3, assetStorageMb: 20 });
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', { maxDestinations: 1, maxGuests: 2, assetStorageMb: 0 });
    for (const t of (gateway as any).pendingHostEndTimers.values()) clearTimeout(t);
    await h.close();
  });
  afterEach(async () => {
    for (const s of open.splice(0)) s.disconnect();
    await admin.del('/superadmin/impersonation');
    phoneSvc.now = () => Date.now();
    jest.restoreAllMocks();
  });

  function connect(auth: Record<string, unknown>, ready: string): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const socket = io(`${h.baseUrl}/studio`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
      open.push(socket);
      const events: Conn['events'] = [];
      socket.onAny((ev, ...args) => events.push({ ev, args }));
      const conn: Conn = {
        socket,
        events,
        got: (ev) => events.filter((e) => e.ev === ev).map((e) => e.args),
        wait: async (ev, pred = () => true, ms = 4000) => {
          const end = Date.now() + ms;
          while (Date.now() < end) {
            const hit = events.find((e) => e.ev === ev && pred(...e.args));
            if (hit) return hit.args;
            await sleep(20);
          }
          throw new Error(`timed out waiting for ${ev}; saw ${events.map((e) => e.ev).join(',')}`);
        },
      };
      socket.once(ready, () => resolve(conn));
      socket.once('error', (e: { message: string }) => reject(new Error(e.message)));
      socket.once('connect_error', (e) => reject(e));
    });
  }
  const ask = (c: Conn, type: string, payload: unknown, id = `c${crypto.randomBytes(4).toString('hex')}`) =>
    new Promise<{ id: string; res: any }>((resolve) => c.socket.emit('support:command', { id, type, payload }, (res: any) => resolve({ id, res })));

  const twitch = (c: Client) =>
    c.post('/platform-connections/twitch/manual', { label: `t-${crypto.randomBytes(3).toString('hex')}`, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }).then((r) => r.body.id as string);

  /** A customer whose stream is LIVE and has NO web host socket: the "phone" is the customer's own session. */
  async function customer() {
    const cust = await h.signIn();
    const conn = await twitch(cust.client);
    const stream = (await cust.client.post('/streams', { title: 'From the phone', destinationConnectionIds: [conn] })).body;
    expect(stream.status).toBe('live');
    const rc = `/streams/${stream.id}/remote-control`;
    return {
      ...cust,
      streamId: stream.id as string,
      sessionId: stream.studioSessionId as string,
      rc,
      poll: (after = 0, wait = 1) => cust.client.get(`${rc}?after=${after}&wait=${wait}`),
      ack: (body: unknown) => cust.client.post(`${rc}/ack`, body),
      putState: (body: unknown) => cust.client.put(`${rc}/state`, body),
    };
  }
  type Cust = Awaited<ReturnType<typeof customer>>;

  async function support(c: Cust) {
    await admin.post('/superadmin/impersonation', { accountId: c.accountId, mode: 'act' });
    const m = await admin.post(`/streams/${c.streamId}/support-control-token`);
    expect(m.status).toBe(201);
    return connect({ role: 'support', sessionId: m.body.studioSessionId, controlToken: m.body.controlToken }, 'support:joined');
  }
  const auditRows = async (accountId: string) =>
    (await h.db.query(`SELECT * FROM superadmin_audit_log WHERE action = 'impersonated_studio_command' AND target_id = $1 ORDER BY created_at, id`, [accountId])).rows;

  describe('access', () => {
    it('is owner-only: 401 without a session, 404 for another account\'s stream, 400 for a bad id or numbers', async () => {
      const a = await customer();
      const b = await customer();
      const anon = new Client(h.baseUrl);
      expect((await anon.get(`${a.rc}?after=0&wait=0`)).status).toBe(401);
      expect((await anon.post(`${a.rc}/ack`, { id: 'x', ok: true })).status).toBe(401);
      expect((await anon.put(`${a.rc}/state`, {})).status).toBe(401);
      expect((await b.client.get(`${a.rc}?after=0&wait=0`)).status).toBe(404);
      expect((await b.client.post(`${a.rc}/ack`, { id: 'x', ok: true })).status).toBe(404);
      expect((await b.client.put(`${a.rc}/state`, { rev: 1, state: phoneState() })).status).toBe(404);
      expect((await a.client.get(`/streams/${crypto.randomUUID()}/remote-control?wait=0`)).status).toBe(404);
      expect((await a.client.get('/streams/nope/remote-control?wait=0')).status).toBe(400);
      expect((await a.client.get(`${a.rc}?after=-1&wait=0`)).status).toBe(400);
      expect((await a.client.get(`${a.rc}?after=abc`)).status).toBe(400);
    });

    it('409 when the stream is not LIVE (the phone stops polling); 200/204 only while live', async () => {
      const c = await customer();
      expect((await c.poll(0, 0)).status).toBe(204);
      await c.client.post(`/streams/${c.streamId}/end`);
      expect((await c.poll(0, 0)).status).toBe(409);
      expect((await c.ack({ id: 'x', ok: true })).status).toBe(409);
      expect((await c.putState({ rev: 1, state: phoneState() })).status).toBe(409);
      expect(phoneSvc.isActive(c.streamId)).toBe(false);
    });

    it('403 for an impersonated principal on all 3 routes, in act AND view mode (a support person never reads or answers the channel)', async () => {
      const c = await customer();
      expect((await c.poll(0, 0)).status).toBe(204); // the phone is on
      for (const mode of ['act', 'view'] as const) {
        await admin.post('/superadmin/impersonation', { accountId: c.accountId, mode });
        const g = await admin.get(`${c.rc}?after=0&wait=0`);
        expect(g.status).toBe(403);
        expect(JSON.stringify(g.body)).toContain('remote-control channel');
        expect((await admin.post(`${c.rc}/ack`, { id: 'x', ok: true })).status).toBe(403);
        expect((await admin.put(`${c.rc}/state`, { rev: 1, state: phoneState() })).status).toBe(403);
        await admin.del('/superadmin/impersonation');
      }
      // markers: the registry marks them, and they are not in the act-allowed list
      for (const fn of ['poll', 'ack', 'putState'] as const) {
        expect(Reflect.getMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, PhoneRemoteController)).toBe('phone-channel');
        expect(typeof PhoneRemoteController.prototype[fn]).toBe('function');
      }
      expect(Object.keys(IMPERSONATION_ACT_ALLOWED).filter((k) => k.includes('remote-control'))).toEqual([]);
    });

    it('answers with Cache-Control: no-store and the poll body shape', async () => {
      const c = await customer();
      expect((await c.poll(0, 0)).status).toBe(204);
      const raw = await c.client.getBytes(`${c.rc}?after=0&wait=0`);
      expect(raw.status).toBe(204);
      expect(raw.cacheControl).toBe('no-store');
    });
  });

  describe('commands', () => {
    it('support socket -> queue -> phone poll (mapped, ordered seq) -> ack -> support gets the result; audit: intent before relay, result hostReported', async () => {
      const c = await customer();
      expect((await c.poll(0, 0)).status).toBe(204); // the phone is on
      const sup = await support(c);
      // joined said the host is the phone
      expect(sup.got('support:joined')[0][0]).toMatchObject({ hostConnected: true, hostKind: 'phone' });

      // a held poll is already waiting when the command arrives
      const held = c.poll(0, 5);
      await sleep(100);
      const r1 = await ask(sup, 'ads.manual', { placement: 'lower_third', manual: 'shown' });
      expect(r1.res).toEqual({ ok: true });
      const answer = await held;
      expect(answer.status).toBe(200);
      expect(answer.body.commands).toHaveLength(1);
      const cmd = answer.body.commands[0];
      expect(cmd).toMatchObject({ type: 'ads.manual', payload: { placement: 'lower_third', mode: 'shown' } });
      expect(cmd.id).toMatch(/^[0-9a-f-]{36}$/); // the phone-side id is generated by the server
      expect(cmd.id).not.toBe(r1.id);
      expect(Number.isInteger(cmd.seq)).toBe(true);
      expect(new Date(cmd.at).toISOString()).toBe(cmd.at);
      expect(new Date(answer.body.now).toISOString()).toBe(answer.body.now);

      // two more, then everything newer than the first seq comes back in order
      const r2 = await ask(sup, 'ads.enabled', { placement: 'lower_third', enabled: false });
      const r3 = await ask(sup, 'ticker.set', { text: 'Hello', on: true });
      const next = await c.poll(cmd.seq, 1);
      expect(next.body.commands).toHaveLength(2);
      const [p2, p3] = next.body.commands.map((x: any) => x.id as string);
      expect(p3).not.toBe(p2);
      expect(next.body.commands[0].seq).toBeGreaterThan(cmd.seq);
      expect(next.body.commands[1].seq).toBeGreaterThan(next.body.commands[0].seq);
      expect(next.body.commands[0]).toMatchObject({ type: 'ads.enabled', payload: { placement: 'lower_third', on: false } });
      expect(next.body.commands[1]).toMatchObject({ type: 'ticker.set', payload: { text: 'Hello', on: true } });

      // ack
      expect((await c.ack({ id: cmd.id, ok: true, appliedAt: new Date().toISOString() })).status).toBe(204);
      const a1 = await sup.wait('support:ack', (m) => m.id === r1.id);
      expect(a1[0]).toMatchObject({ id: r1.id, ok: true });
      expect((await c.ack({ id: p2, ok: false, error: 'host changed it just now' })).status).toBe(204);
      const a2 = await sup.wait('support:ack', (m) => m.id === r2.id);
      expect(a2[0]).toMatchObject({ ok: false, error: 'host changed it just now' });
      // a replay of the same ack is ignored
      expect((await c.ack({ id: cmd.id, ok: false, error: 'again' })).status).toBe(204);
      expect((await c.ack({ id: r1.id, ok: true })).status).toBe(204); // the CLIENT's id means nothing to the phone channel
      await sleep(100);
      expect(sup.got('support:ack').filter((m) => m[0].id === r1.id)).toHaveLength(1);

      const rows = (await auditRows(c.accountId)).filter((r) => r.metadata.commandId === r1.id);
      expect(rows.map((r) => r.metadata.phase)).toEqual(['intent', 'result']);
      expect(rows[0].metadata.summary).toBe('ads.manual{placement=lower_third,manual=shown}');
      expect(rows[1].metadata).toMatchObject({ applied: true, hostReported: true });
      expect(new Date(rows[0].created_at).getTime()).toBeLessThanOrEqual(new Date(rows[1].created_at).getTime());
      const failed = (await auditRows(c.accountId)).find((r) => r.metadata.commandId === r2.id && r.metadata.phase === 'result');
      expect(failed.metadata).toMatchObject({ applied: false, hostReported: true, error: 'host changed it just now' });
      expect(JSON.stringify(rows)).not.toContain('Hello'); // free text is audited by length only
      expect(p3).toBeDefined();
    });

    it('layout and wallpaper are never relayed: answered by the server at once, audited, and never reach the phone', async () => {
      const c = await customer();
      await c.poll(0, 0);
      await c.putState({ rev: 1, state: phoneState(capable()) }); // even a fully capable phone has no layouts or wallpaper
      const sup = await support(c);
      for (const [type, payload] of [
        ['layout.set', { mode: 'grid' }],
        ['wallpaper.dim', { n: 20 }],
      ] as const) {
        const r = await ask(sup, type, payload);
        expect(r.res).toEqual({ ok: true });
        const a = await sup.wait('support:ack', (m) => m.id === r.id);
        expect(a[0]).toMatchObject({ ok: false, error: 'Not supported on the phone app' });
      }
      expect((await c.poll(0, 0)).status).toBe(204);
      const results = (await auditRows(c.accountId)).filter((r) => r.metadata.phase === 'result');
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.metadata.hostReported === false && r.metadata.applied === false)).toBe(true);
    });

    describe('kit.apply, logo.set and the name banner (phone app 1.0.15+)', () => {
      const UPDATE = 'This phone app version does not support that: update the app';

      it('a phone that never reported the capabilities (older app) gets "update the app" at once: audited, not queued', async () => {
        const c = await customer();
        await c.poll(0, 0);
        expect((await c.putState({ rev: 1, state: phoneState() })).status).toBe(204); // 1.0.14: no kits / logo / lowerThird
        const own = (await c.client.post('/brand-kits', { name: 'Mine' })).body;
        const sup = await support(c);
        for (const [type, payload] of [
          ['kit.apply', { kitId: own.id }],
          ['logo.set', { position: 'right' }],
          ['lowerThird.set', { name: 'Jo', show: true }],
        ] as const) {
          const r = await ask(sup, type, payload);
          expect(r.res).toEqual({ ok: true });
          expect((await sup.wait('support:ack', (m) => m.id === r.id))[0]).toMatchObject({ ok: false, error: UPDATE });
        }
        expect((await c.poll(0, 0)).status).toBe(204);
        expect(phoneSvc.pendingCount(c.streamId)).toBe(0);
        const rows = await auditRows(c.accountId);
        expect(rows.filter((r) => r.metadata.phase === 'intent')).toHaveLength(3);
        const results = rows.filter((r) => r.metadata.phase === 'result');
        expect(results).toHaveLength(3);
        expect(results.every((r) => r.metadata.applied === false && r.metadata.hostReported === false && r.metadata.error === UPDATE)).toBe(true);
      });

      it('capabilities are per feature and follow the LAST snapshot', async () => {
        const c = await customer();
        await c.poll(0, 0);
        const sup = await support(c);
        await c.putState({ rev: 1, state: phoneState({ logo: { present: false, position: 'left', size: 90 } }) });
        const logo = await ask(sup, 'logo.set', { size: 100 });
        expect((await c.poll(0, 1)).body.commands[0]).toMatchObject({ type: 'logo.set', payload: { size: 100 } });
        expect(logo.res).toEqual({ ok: true });
        const banner = await ask(sup, 'lowerThird.set', { show: false });
        expect((await sup.wait('support:ack', (m) => m.id === banner.id))[0]).toMatchObject({ ok: false, error: UPDATE });
        // the phone is updated mid-stream: a new snapshot with the name banner switches it on
        await c.putState({ rev: 2, state: phoneState({ lowerThird: { available: true, name: null, title: null, show: false } }) });
        await sleep(50);
        expect((await ask(sup, 'lowerThird.set', { show: false })).res).toEqual({ ok: true });
        // ... and one without logo switches the logo off again
        const gone = await ask(sup, 'logo.set', { position: 'left' });
        expect((await sup.wait('support:ack', (m) => m.id === gone.id))[0]).toMatchObject({ ok: false, error: UPDATE });
      });

      it('kit.apply of the customer\'s own kit is relayed unchanged and audited; a kit of another account is refused BEFORE the relay (IDOR)', async () => {
        const c = await customer();
        const other = await customer();
        await c.poll(0, 0);
        await c.putState({ rev: 1, state: phoneState(capable()) });
        const own = (await c.client.post('/brand-kits', { name: 'Mine' })).body;
        const foreign = (await other.client.post('/brand-kits', { name: 'Not yours' })).body;
        const sup = await support(c);

        const bad = await ask(sup, 'kit.apply', { kitId: foreign.id });
        expect(bad.res).toEqual({ ok: false, error: 'Unknown brand kit' });
        expect(phoneSvc.pendingCount(c.streamId)).toBe(0);
        expect((await c.poll(0, 0)).status).toBe(204); // never queued
        expect((await ask(sup, 'kit.apply', { kitId: '00000000-0000-4000-8000-000000000000' })).res).toEqual({ ok: false, error: 'Unknown brand kit' });

        const ok = await ask(sup, 'kit.apply', { kitId: own.id });
        expect(ok.res).toEqual({ ok: true });
        const got = (await c.poll(0, 1)).body.commands[0];
        expect(got).toMatchObject({ type: 'kit.apply', payload: { kitId: own.id } });
        expect(Object.keys(got.payload)).toEqual(['kitId']);
        expect((await c.ack({ id: got.id, ok: true })).status).toBe(204);
        expect((await sup.wait('support:ack', (m) => m.id === ok.id))[0]).toMatchObject({ ok: true });
        await sleep(150); // the result audit row is written right after the ack goes out
        const rows = (await auditRows(c.accountId)).filter((r) => r.metadata.commandId === ok.id);
        expect(rows.map((r) => r.metadata.phase)).toEqual(['intent', 'result']);
        expect(rows[0].metadata.summary).toBe(`kit.apply{kitId=${own.id}}`);
        expect(rows[1].metadata).toMatchObject({ applied: true, hostReported: true });
        // the refused ones are audited as rejected, not as relayed
        const rejected = (await auditRows(c.accountId)).filter((r) => r.metadata.phase === 'rejected' && r.metadata.error === 'Unknown brand kit');
        expect(rejected).toHaveLength(2);
      });

      it('logo.set and lowerThird.set reach the phone with the payloads unchanged; out-of-range values never do', async () => {
        const c = await customer();
        await c.poll(0, 0);
        await c.putState({ rev: 1, state: phoneState(capable()) });
        const sup = await support(c);
        const payloads: Array<[string, Record<string, unknown>]> = [
          ['logo.set', { position: 'right', size: 200 }],
          ['logo.set', { size: 16 }],
          ['lowerThird.set', { name: 'Ada Lovelace', title: 'Guest', show: true }],
          ['lowerThird.set', { title: null }],
          ['lowerThird.set', { show: false }],
        ];
        for (const [type, payload] of payloads) expect((await ask(sup, type, payload)).res).toEqual({ ok: true });
        const cmds = (await c.poll(0, 1)).body.commands as Array<{ type: string; payload: unknown }>;
        expect(cmds.map((x) => [x.type, x.payload])).toEqual(payloads);
        // whitelist ranges are enforced before anything is queued
        for (const [type, payload] of [
          ['logo.set', { size: 15 }],
          ['logo.set', { size: 601 }],
          ['logo.set', { position: 'top' }],
          ['logo.set', {}],
          ['lowerThird.set', { name: 'x'.repeat(81) }],
          ['lowerThird.set', { title: 'x'.repeat(121) }],
          ['lowerThird.set', { name: 'a\u0000b' }],
          ['kit.apply', { kitId: 'nope' }],
        ] as const) {
          expect((await ask(sup, type, payload)).res).toMatchObject({ ok: false });
        }
        expect(phoneSvc.pendingCount(c.streamId)).toBe(5);
      });

      it('the state snapshot is rebuilt strictly: caps, sanitising, and the support page sees the same fields the web host uses', async () => {
        const c = await customer();
        await c.poll(0, 0);
        const sup = await support(c);
        const K1 = '11111111-1111-4111-8111-111111111111';
        const K2 = '22222222-2222-4222-8222-222222222222';
        const evil = '‮gnp.exe\u0000' + 'x'.repeat(200);
        expect(
          (
            await c.putState({
              rev: 1,
              state: phoneState({
                kits: [{ id: K1, name: 'Studio' }, { id: 'javascript:1', name: 'bad' }, { id: K2, name: evil, secret: 's3cr3t' }],
                kit: { id: K2 },
                logo: { present: true, position: 'right', size: 150, path: '/etc/passwd' },
                lowerThird: { available: true, name: evil, title: null, show: true },
                extra: 'dropped',
              }),
            })
          ).status,
        ).toBe(204);
        const snap = (await sup.wait('support:state', (m) => m.state.phoneCaps?.kit === true))[0].state;
        expect(snap).toMatchObject({ platform: 'android', phoneCaps: { kit: true, logo: true, lowerThird: true }, activeKitId: K2, logo: { position: 'right', size: 150, has: true } });
        expect(snap.kits.map((k: any) => k.id)).toEqual([K1, K2]);
        expect(snap.kits[1].name.length).toBeLessThanOrEqual(80);
        expect(snap.lowerThird).toMatchObject({ allowed: true, live: true, title: '' });
        expect(snap.lowerThird.name.length).toBeLessThanOrEqual(80);
        const wire = JSON.stringify(snap);
        for (const leaked of ['s3cr3t', '/etc/passwd', 'dropped', 'javascript:']) expect(wire).not.toContain(leaked);
        expect(wire).not.toMatch(/[\u0000‮]/);
        // too many kits: the kit capability is not offered, the rest of the state still is
        expect((await c.putState({ rev: 2, state: phoneState({ kits: new Array(51).fill({ id: K1, name: 'k' }) }) })).status).toBe(204);
        const capped = (await sup.wait('support:state', (m) => m.rev >= 2 && m.state.phoneCaps?.kit === false))[0].state;
        expect(capped).toMatchObject({ phoneCaps: { kit: false, logo: false, lowerThird: false }, kits: [] });
      });
    });

    it('validation, the whitelist and the rate limit still apply before anything is queued', async () => {
      const c = await customer();
      await c.poll(0, 0);
      const sup = await support(c);
      expect((await ask(sup, 'stream.end', {})).res).toMatchObject({ ok: false });
      expect((await ask(sup, 'ads.manual', { placement: 'nope', manual: 'shown' })).res).toMatchObject({ ok: false });
      expect((await ask(sup, 'ticker.set', { text: 'x', extra: 1 })).res).toMatchObject({ ok: false });
      expect((await c.poll(0, 0)).status).toBe(204);
      expect(phoneSvc.pendingCount(c.streamId)).toBe(0);
    });

    it('a phone that does not answer: the support socket gets a timeout, and the late command / ack are gone', async () => {
      const c = await customer();
      await c.poll(0, 0);
      const sup = await support(c);
      const r = await ask(sup, 'ads.shrink', { on: true });
      const phoneId = (await c.poll(0, 0)).body.commands[0].id as string; // the phone fetched it, then goes silent
      const a = await sup.wait('support:ack', (m) => m.id === r.id);
      expect(a[0]).toMatchObject({ ok: false, error: 'The phone app did not respond' });
      expect((await c.poll(0, 0)).status).toBe(204); // taken out of the queue: the phone never applies it late
      expect((await c.ack({ id: phoneId, ok: true })).status).toBe(204); // ignored
      await sleep(100);
      expect(sup.got('support:ack').filter((m) => m[0].id === r.id)).toHaveLength(1);
      const result = (await auditRows(c.accountId)).find((x) => x.metadata.commandId === r.id && x.metadata.phase === 'result');
      expect(result.metadata).toMatchObject({ applied: false, hostReported: false });
    });

    it('phone offline: "The phone app is not connected" once it polled and went quiet; the web wording when no phone ever polled', async () => {
      const c = await customer();
      const sup = await support(c);
      const never = await ask(sup, 'ads.shrink', { on: true });
      expect(never.res).toEqual({ ok: false, error: 'The host studio is not connected' });
      await c.poll(0, 0);
      const ok = await ask(sup, 'ads.shrink', { on: true });
      expect(ok.res).toEqual({ ok: true });
      await sup.wait('support:ack', (m) => m.id === ok.id); // timeout
      // 61 s later (clock shifted), the sweep marks the phone gone
      phoneSvc.now = () => Date.now() + 61_000;
      phoneSvc.sweepNow();
      await sup.wait('support:host', (m) => m.connected === false && m.kind === 'phone');
      const off = await ask(sup, 'ads.shrink', { on: false });
      expect(off.res).toEqual({ ok: false, error: 'The phone app is not connected' });
      const rejected = (await auditRows(c.accountId)).filter((r) => r.metadata.phase === 'rejected');
      expect(rejected.map((r) => r.metadata.error)).toEqual(['The host studio is not connected', 'The phone app is not connected']);
    });

    it('pending commands fail at once when the phone drops', async () => {
      const c = await customer();
      await c.poll(0, 0);
      const sup = await support(c);
      const r = await ask(sup, 'ads.shrink', { on: true });
      phoneSvc.now = () => Date.now() + 61_000;
      phoneSvc.sweepNow();
      const a = await sup.wait('support:ack', (m) => m.id === r.id);
      expect(a[0]).toMatchObject({ ok: false, error: 'The phone app is not connected' });
    });

    it('an ack for another stream (or from another account) is ignored and never completes a command', async () => {
      const a = await customer();
      const b = await customer();
      await a.poll(0, 0);
      await b.poll(0, 0);
      const sup = await support(a);
      const r = await ask(sup, 'ads.shrink', { on: true });
      const phoneId = (await a.poll(0, 0)).body.commands[0].id as string;
      // account B answers A's command id on B's own stream: 204, no effect
      expect((await b.ack({ id: phoneId, ok: true })).status).toBe(204);
      // B cannot reach A's stream at all
      expect((await b.client.post(`${a.rc}/ack`, { id: phoneId, ok: true })).status).toBe(404);
      const timeout = await sup.wait('support:ack', (m) => m.id === r.id);
      expect(timeout[0]).toMatchObject({ ok: false, error: 'The phone app did not respond' });
      // and B's phone never sees A's command
      expect((await b.poll(0, 0)).status).toBe(204);
    });

    it('a new poll supersedes the held one (204 to the old one)', async () => {
      const c = await customer();
      const first = c.poll(0, 10);
      await sleep(150);
      const second = c.poll(0, 1);
      expect((await first).status).toBe(204);
      expect((await second).status).toBe(204);
    });

    it('the held-poll cap per account answers 429', async () => {
      const c = await customer();
      // The same account is already holding 10 polls elsewhere (the held counter is shared by all of the account's streams).
      (phoneSvc as any).heldByAccount.set(c.accountId, 10);
      const r = await c.poll(0, 5);
      expect(r.status).toBe(429);
      (phoneSvc as any).heldByAccount.delete(c.accountId);
      expect((await c.poll(0, 0)).status).toBe(204);
    });

    it('204 after the wait with nothing queued, and the hold is freed when the phone hangs up', async () => {
      const c = await customer();
      const t0 = Date.now();
      expect((await c.poll(0, 1)).status).toBe(204);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
      expect(phoneSvc.heldCount()).toBe(0);
      const ctl = new AbortController();
      const cookie = (c.client as any).cookies as Map<string, string>;
      const p = fetch(`${h.baseUrl}/api${c.rc}?after=0&wait=20`, { signal: ctl.signal, headers: { Origin: h.baseUrl, Cookie: [...cookie].map(([k, v]) => `${k}=${v}`).join('; ') } }).catch(() => null);
      await sleep(200);
      expect(phoneSvc.heldCount()).toBe(1);
      ctl.abort();
      await p;
      await sleep(200);
      expect(phoneSvc.heldCount()).toBe(0);
    });

    it('seq never goes backwards across a (simulated) restart of the in-memory queue', async () => {
      const c = await customer();
      await c.poll(0, 0);
      const sup = await support(c);
      const r1 = await ask(sup, 'ads.shrink', { on: true });
      const first = (await c.poll(0, 1)).body.commands[0];
      expect(first).toBeDefined();
      await c.ack({ id: first.id, ok: true });
      expect(r1.id).toBeDefined();
      // the backend "restarts": queue and counters are gone; the phone keeps its last handled seq
      phoneSvc.resetForTests();
      expect((await c.poll(first.seq, 0)).status).toBe(204); // re-seeds from max(clock, after) and the phone is connected again
      const r2 = await ask(sup, 'ads.shrink', { on: false });
      const second = (await c.poll(first.seq, 1)).body.commands[0];
      expect(r2.id).toBeDefined();
      expect(second.seq).toBeGreaterThan(first.seq);
    });
  });

  describe('state', () => {
    it('is rebuilt strictly, relayed to support sockets with a server rev, coalesced, capped and rate limited; cleared when the phone is gone', async () => {
      const c = await customer();
      await c.poll(0, 0);
      const sup = await support(c);
      // before any state the page waits
      expect((await c.putState({ rev: 1, state: phoneState({ secret: 'nope', ads: { lower_third: { present: true, enabled: true, manual: 'shown', mode: 'interval', showSec: 20, everySec: 100, source: 'kit', url: 'https://x' }, side_third: { present: false } } }) })).status).toBe(204);
      const [snap] = await sup.wait('support:state');
      expect(snap.rev).toBeGreaterThan(0);
      expect(snap.state).toMatchObject({ v: 1, platform: 'android', appVersion: '1.0.14', adsPlan: 'custom', orientation: 'portrait' });
      expect(snap.state.ads.lower_third).toEqual({ hasMedia: true, name: 'Kit ad', enabled: true, schedule: { mode: 'interval', showSec: 20, everySec: 100 }, manual: 'shown' });
      expect(JSON.stringify(snap)).not.toMatch(/nope|https:\/\/x/);

      // malformed -> 400 and nothing relayed; oversize -> 413
      const before = sup.got('support:state').length;
      expect((await c.putState({ rev: 1, state: { v: 1 } })).status).toBe(400);
      expect((await c.putState({ rev: 1, state: { ...phoneState(), appVersion: '<b>' } })).status).toBe(400);
      expect((await c.putState('nonsense')).status).toBe(400);
      expect((await c.putState({ rev: 1, state: phoneState({ pad: 'x'.repeat(40 * 1024) }) })).status).toBe(413);
      expect(sup.got('support:state').length).toBe(before);
      await sleep(1100);

      // a burst: at most 5 accepted per second (429 after), and coalesced to at most one relay per 200 ms
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await c.putState({ rev: 2 + i, state: phoneState({ adsShrink: i % 2 === 0 }) })).status);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === 204).length).toBeLessThanOrEqual(5 + 1);
      await sleep(500);
      const relayed = sup.got('support:state').length - before;
      expect(relayed).toBeGreaterThanOrEqual(1);
      expect(relayed).toBeLessThanOrEqual(3);
      const revs = sup.got('support:state').map((a) => a[0].rev);
      expect([...revs].sort((x, y) => x - y)).toEqual(revs); // monotonic

      // a support socket that connects later gets the last snapshot straight away
      const late = await connect({ role: 'support', sessionId: c.sessionId, controlToken: (await admin.post(`/streams/${c.streamId}/support-control-token`)).body.controlToken }, 'support:joined');
      expect((await late.wait('support:state'))[0].state.platform).toBe('android');

      // the phone stops polling for > 60 s: the snapshot is cleared and the page is told
      phoneSvc.now = () => Date.now() + 61_000;
      phoneSvc.sweepNow();
      await sup.wait('support:host', (m) => m.connected === false);
      expect(phoneSvc.getState(c.streamId)).toBeNull();
    });

    it('a web-host snapshot can never claim to be the phone: platform is dropped', async () => {
      const c = await customer();
      const hostToken = (await c.client.post(`/studio-sessions/${c.sessionId}/host-token`)).body.token as string;
      const host = await connect({ role: 'host', sessionId: c.sessionId, hostToken, displayName: 'Host' }, 'joined');
      const sup = await support(c);
      const noAd = { hasMedia: false, name: null, enabled: false, schedule: { mode: 'continuous' }, manual: null };
      host.socket.emit('support:state', {
        rev: 1,
        state: {
          platform: 'android', appVersion: '9', v: 1, layout: 'grid', orientation: 'landscape', adsPlan: 'custom',
          ads: { lower_third: noAd, side_third: noAd, full_screen: noAd, l_shape: noAd }, adsShrink: true, kits: [], activeKitId: null,
          ticker: { text: '', on: false }, lowerThird: { name: '', title: '', live: false, allowed: true }, clock, logo: { position: 'left', size: 90, has: false }, wallpaper: { dim: 0, has: false },
        },
      });
      const [snap] = await sup.wait('support:state');
      expect(snap.state.platform).toBeUndefined();
      expect(snap.state.appVersion).toBeUndefined();
      expect(sup.got('support:joined')[0][0]).toMatchObject({ hostConnected: true, hostKind: 'web' });
      // while a web host is connected, commands go to IT, not to a phone queue
      const r = await ask(sup, 'ads.shrink', { on: false });
      expect(r.res).toEqual({ ok: true });
      await host.wait('support:command', (m) => m.id === r.id);
      expect(phoneSvc.pendingCount(c.streamId)).toBe(0);
    });
  });
  describe('review hardening', () => {
    it('a client that hangs up while the server is still resolving the stream never takes a hold (accounting returns to zero)', async () => {
      const c = await customer();
      const sessions = h.app.get(StudioSessionsService);
      const original = sessions.findByLiveStreamId.bind(sessions);
      jest.spyOn(sessions, 'findByLiveStreamId').mockImplementation(async (id: string) => {
        await sleep(400);
        return original(id);
      });
      const ctl = new AbortController();
      const cookie = (c.client as any).cookies as Map<string, string>;
      const p = fetch(`${h.baseUrl}/api${c.rc}?after=0&wait=20`, { signal: ctl.signal, headers: { Origin: h.baseUrl, Cookie: [...cookie].map(([k, v]) => `${k}=${v}`).join('; ') } }).catch(() => null);
      await sleep(100);
      ctl.abort(); // hung up during the lookups
      await p;
      await sleep(700);
      expect(phoneSvc.heldCount()).toBe(0);
      expect((phoneSvc as any).heldByAccount.get(c.accountId)).toBeUndefined();
      expect(phoneSvc.isActive(c.streamId)).toBe(false); // no poll was registered for the gone client
    });

    it('rejects an `after` far beyond any real sequence number (400) so the counter cannot be poisoned', async () => {
      const c = await customer();
      expect((await c.poll(Date.now() + 2e9, 0)).status).toBe(400);
      expect((await c.poll(Number.MAX_SAFE_INTEGER, 0)).status).toBe(400);
      expect((await c.poll(Date.now() + 1000, 0)).status).toBe(204); // a little ahead is fine
      const sup = await support(c);
      const r = await ask(sup, 'ads.shrink', { on: true });
      const got = (await c.poll(0, 1)).body.commands[0];
      expect(got.seq).toBeLessThan(Date.now() + 2e9);
      expect(r.res).toEqual({ ok: true });
    });

    it('ack hygiene: appliedAt is clamped to [now-5min, now]; bidi / control characters are stripped from the phone\'s error before support and the audit', async () => {
      const c = await customer();
      await c.poll(0, 0);
      const sup = await support(c);
      const r = await ask(sup, 'ads.shrink', { on: true });
      const phoneId = (await c.poll(0, 0)).body.commands[0].id;
      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect((await c.ack({ id: phoneId, ok: false, error: 'bad\u202Ething\u0007 \u200Bhere\n', appliedAt: future })).status).toBe(204);
      const [ack] = await sup.wait('support:ack', (m) => m.id === r.id);
      expect(ack.error).toBe('badthing here');
      expect(ack.appliedAt).toBeLessThanOrEqual(Date.now());
      expect(ack.appliedAt).toBeGreaterThan(Date.now() - 60_000);
      let result: any;
      for (let i = 0; i < 40 && !result; i++) {
        result = (await auditRows(c.accountId)).find((x) => x.metadata.commandId === r.id && x.metadata.phase === 'result');
        if (!result) await sleep(50);
      }
      expect(result.metadata.error).toBe('badthing here');
    });

    it('two support sockets sending the SAME client command id never collide or cancel each other', async () => {
      const c = await customer();
      await c.poll(0, 0);
      await admin.post('/superadmin/impersonation', { accountId: c.accountId, mode: 'act' });
      const mk = async () => {
        const m = await admin.post(`/streams/${c.streamId}/support-control-token`);
        return connect({ role: 'support', sessionId: m.body.studioSessionId, controlToken: m.body.controlToken }, 'support:joined');
      };
      const s1 = await mk();
      const s2 = await mk();
      const same = 'dup-id-1';
      const [r1, r2] = await Promise.all([ask(s1, 'ads.shrink', { on: true }, same), ask(s2, 'ads.shrink', { on: false }, same)]);
      expect(r1.res).toEqual({ ok: true });
      expect(r2.res).toEqual({ ok: true });
      const cmds = (await c.poll(0, 1)).body.commands as Array<{ id: string; payload: { on: boolean } }>;
      expect(cmds).toHaveLength(2);
      expect(new Set(cmds.map((x) => x.id)).size).toBe(2);
      const forS1 = cmds.find((x) => x.payload.on === true)!;
      const forS2 = cmds.find((x) => x.payload.on === false)!;
      expect((await c.ack({ id: forS1.id, ok: true })).status).toBe(204);
      expect((await s1.wait('support:ack', (m) => m.id === same))[0]).toMatchObject({ ok: true });
      await sleep(150);
      expect(s2.got('support:ack')).toHaveLength(0); // still pending for socket 2
      expect((await c.ack({ id: forS2.id, ok: false, error: 'nope' })).status).toBe(204);
      expect((await s2.wait('support:ack', (m) => m.id === same))[0]).toMatchObject({ ok: false, error: 'nope' });
      expect(s1.got('support:ack')).toHaveLength(1);
    });

    it('web host wins: phone presence and phone state are ignored while a web host socket is connected', async () => {
      const c = await customer();
      const hostToken = (await c.client.post(`/studio-sessions/${c.sessionId}/host-token`)).body.token as string;
      await connect({ role: 'host', sessionId: c.sessionId, hostToken, displayName: 'Host' }, 'joined');
      const sup = await support(c);
      expect(sup.got('support:joined')[0][0]).toMatchObject({ hostKind: 'web' });
      await c.poll(0, 0); // a phone polls the same stream
      expect((await c.putState({ rev: 1, state: phoneState() })).status).toBe(204);
      await sleep(500);
      expect(sup.got('support:state').filter((a) => a[0].state.platform === 'android')).toHaveLength(0);
      expect(sup.got('support:host').filter((a) => a[0].kind === 'phone')).toHaveLength(0);
      // the phone going quiet must not tell the page the (web) host is gone
      phoneSvc.now = () => Date.now() + 61_000;
      phoneSvc.sweepNow();
      await sleep(300);
      expect(sup.got('support:host').filter((a) => a[0].connected === false)).toHaveLength(0);
    });

    it('account-level request budget: a wait=0 flood gets 429 before any database read, normal polling is untouched', async () => {
      const flood = await customer();
      const normal = await customer();
      for (let i = 0; i < 5; i++) expect((await normal.poll(0, 0)).status).toBe(204); // a normal phone does ~2.4 polls a minute
      const statuses: number[] = [];
      for (let b = 0; b < 6; b++) statuses.push(...(await Promise.all(Array.from({ length: 50 }, () => flood.poll(0, 0)))).map((r) => r.status));
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === 204).length).toBeLessThanOrEqual(240 + 5);
      expect((await normal.poll(0, 0)).status).toBe(204); // another account is not affected
    });
  });
});
