import * as crypto from 'crypto';
import { io, type Socket } from 'socket.io-client';
import { describeE2E, bootApp, Client, Harness } from './harness';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { StudioSignalingGateway } from '../../src/studio/studio-signaling.gateway';
import { IMPERSONATION_ACT_ALLOWED, BLOCKED_WHEN_IMPERSONATING_KEY } from '../../src/impersonation/blocked-when-impersonating';
import { SupportControlController } from '../../src/studio/support/support-control.controller';
import { StudioSessionsController } from '../../src/studio/studio-sessions.controller';

// Remote control of a LIVE studio by a superadmin support session (act mode): token mint, the support socket on the
// signaling gateway, the command whitelist / relay / ack flow, isolation from guests and media signaling, session end,
// and the audit trail. Real Postgres, real app, real socket.io clients.

interface Conn {
  socket: Socket;
  events: Array<{ ev: string; args: any[] }>;
  id: string;
  got: (ev: string) => any[][];
  wait: (ev: string, pred?: (...a: any[]) => boolean, ms?: number) => Promise<any[]>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A complete, valid host snapshot (the server rebuilds it from a strict shape and drops anything else). */
const noAd = { hasMedia: false, name: null, enabled: false, schedule: { mode: 'continuous' }, manual: null };
const validState = (layout = 'grid') => ({
  v: 1,
  layout,
  orientation: 'landscape',
  adsPlan: 'custom',
  ads: { lower_third: noAd, side_third: noAd, full_screen: noAd, l_shape: noAd },
  adsShrink: true,
  kits: [{ id: 'k1', name: 'Kit one' }],
  activeKitId: null,
  ticker: { text: '', on: false },
  lowerThird: { name: '', title: '', live: false, allowed: true },
  clock: { enabled: false, position: 'top_right', format: '12h', showDate: true, showSeconds: false, timezone: null, size: 'small', style: 'text', alternate: true },
  logo: { position: 'left', size: 90, has: false },
  wallpaper: { dim: 0, has: false },
});

describeE2E('support control: snapshots, limits and the admin re-check', () => {
  let h: Harness;
  let admin: Client;
  let gateway: StudioSignalingGateway;
  const open: Socket[] = [];

  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    admin = (await h.signIn({ superadmin: true })).client;
    gateway = h.app.get(StudioSignalingGateway);
    gateway.supportAckTimeoutMs = 600;
    await admin.patch('/superadmin/plans/free', { maxDestinations: 3, maxGuests: 3, assetStorageMb: 20 });
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', { maxDestinations: 1, maxGuests: 2, assetStorageMb: 0 });
    // The gateway's "host left, end the stream in 60 s" timers must not keep the test process alive.
    for (const t of (gateway as any).pendingHostEndTimers.values()) clearTimeout(t);
    await h.close();
  });
  afterEach(async () => {
    for (const s of open.splice(0)) s.disconnect();
    await admin.del('/superadmin/impersonation');
    jest.restoreAllMocks();
  });

  /** Connects a socket.io client; resolves once the server answered `ready` (joined / support:joined) or `error`. */
  function connect(auth: Record<string, unknown>, ready: string): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const socket = io(`${h.baseUrl}/studio`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
      open.push(socket);
      const events: Conn['events'] = [];
      socket.onAny((ev, ...args) => events.push({ ev, args }));
      const conn: Conn = {
        socket,
        events,
        get id() {
          return socket.id as string;
        },
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
      } as Conn;
      socket.once(ready, () => resolve(conn));
      socket.once('error', (e: { message: string }) => reject(new Error(e.message)));
      socket.once('connect_error', (e) => reject(e));
      socket.once('disconnect', () => reject(new Error('disconnected before ready')));
    });
  }
  const ask = (c: Conn, type: string, payload: unknown, id = `c${crypto.randomBytes(4).toString('hex')}`) =>
    new Promise<{ id: string; res: any }>((resolve) => c.socket.emit('support:command', { id, type, payload }, (res: any) => resolve({ id, res })));

  const twitch = (c: Client) =>
    c.post('/platform-connections/twitch/manual', { label: `t-${crypto.randomBytes(3).toString('hex')}`, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }).then((r) => r.body.id as string);

  /** A customer with a LIVE stream and a connected host studio socket (the customer's own host token). */
  async function customer(opts: { host?: boolean } = {}) {
    const cust = await h.signIn();
    const conn = await twitch(cust.client);
    const stream = (await cust.client.post('/streams', { title: 'On air', destinationConnectionIds: [conn] })).body;
    expect(stream.status).toBe('live');
    const sessionId = stream.studioSessionId as string;
    const hostToken = (await cust.client.post(`/studio-sessions/${sessionId}/host-token`)).body.token as string;
    const host = opts.host === false ? null : await connect({ role: 'host', sessionId, hostToken, displayName: 'Host' }, 'joined');
    return { ...cust, streamId: stream.id as string, sessionId, hostToken, host };
  }
  const startAct = (accountId: string, mode: 'act' | 'view' = 'act') => admin.post('/superadmin/impersonation', { accountId, mode });
  const mint = (streamId: string) => admin.post(`/streams/${streamId}/support-control-token`);
  async function support(c: { accountId: string; streamId: string; sessionId: string }) {
    await startAct(c.accountId);
    const m = await mint(c.streamId);
    expect(m.status).toBe(201);
    const conn = await connect({ role: 'support', sessionId: m.body.studioSessionId, controlToken: m.body.controlToken }, 'support:joined');
    return { conn, token: m.body.controlToken as string };
  }
  const auditRows = async (accountId: string, action: string) =>
    (await h.db.query('SELECT * FROM superadmin_audit_log WHERE action = $1 AND target_id = $2 ORDER BY created_at', [action, accountId])).rows;

  const hostTokenFor = async (c: { client: Client; sessionId: string }) => (await c.client.post(`/studio-sessions/${c.sessionId}/host-token`)).body.token as string;

  describe('host snapshots', () => {
    it('are re-stamped by the server, so a reloaded host (counter back at 0) never looks older; a gone host\'s state is forgotten', async () => {
      const c = await customer();
      const { conn } = await support(c);
      c.host!.socket.emit('support:state', { rev: 500, state: validState('grid') });
      expect((await conn.wait('support:state'))[0].rev).toBe(1);
      // The customer reloads the studio: old host socket gone, new one connects, its own counter restarts at 1.
      c.host!.socket.disconnect();
      await conn.wait('support:host', (m) => m.connected === false);
      // A control window opened while the host is away gets no stale replay.
      const m2 = await mint(c.streamId);
      const late = await connect({ role: 'support', sessionId: m2.body.studioSessionId, controlToken: m2.body.controlToken }, 'support:joined');
      await sleep(200);
      expect(late.got('support:state')).toHaveLength(0);
      const host2 = await connect({ role: 'host', sessionId: c.sessionId, hostToken: await hostTokenFor(c), displayName: 'Host' }, 'joined');
      await host2.wait('support:state-request');
      host2.socket.emit('support:state', { rev: 1, state: validState('spotlight') });
      const fresh = await conn.wait('support:state', (m) => m.state.layout === 'spotlight');
      expect(fresh[0].rev).toBeGreaterThan(1);
    });

    it('malformed or oversize snapshots are dropped, extra keys stripped, and a burst is coalesced to the latest', async () => {
      const c = await customer();
      const { conn } = await support(c);
      const bad = [{ v: 2 }, { ...validState(), ads: {} }, { ...validState(), clock: { ...validState().clock, format: '99h' } }, { ...validState(), kits: 'nope' }, { ...validState(), layout: 'Not Valid!' }, 'str', null];
      for (const state of bad) c.host!.socket.emit('support:state', { rev: 1, state });
      await sleep(400);
      expect(conn.got('support:state')).toHaveLength(0);
      c.host!.socket.emit('support:state', { rev: 1, state: { ...validState('grid'), hostToken: 'SECRET', extra: { deep: 1 } } });
      const [clean] = await conn.wait('support:state');
      expect(JSON.stringify(clean)).not.toMatch(/SECRET|extra/);
      await sleep(250);
      const before = conn.got('support:state').length;
      const layouts = ['grid', 'spotlight', 'podcast-split', 'podcast-center', 'podcast-pip', 'grid', 'spotlight', 'podcast-split', 'podcast-center', 'podcast-pip'];
      layouts.forEach((l, i) => c.host!.socket.emit('support:state', { rev: i, state: validState(l) }));
      await conn.wait('support:state', (m) => m.state.layout === 'podcast-pip');
      await sleep(500);
      expect(conn.got('support:state').length - before).toBeLessThanOrEqual(4);
      const revs = conn.got('support:state').map((a) => a[0].rev);
      expect([...revs].sort((a, b) => a - b)).toEqual(revs);
    });

    it('the host is told whether anyone is watching (support:watching), so it publishes only then', async () => {
      const c = await customer({ host: false });
      const host = await connect({ role: 'host', sessionId: c.sessionId, hostToken: await hostTokenFor(c), displayName: 'Host' }, 'joined');
      expect(host.got('support:watching')).toHaveLength(0);
      const { conn } = await support(c);
      await host.wait('support:watching', (m) => m.on === true);
      conn.socket.disconnect();
      await host.wait('support:watching', (m) => m.on === false);
    });

    it('at most 3 control windows per stream', async () => {
      const c = await customer();
      await startAct(c.accountId);
      for (let i = 0; i < 3; i++) {
        const m = await mint(c.streamId);
        await connect({ role: 'support', sessionId: m.body.studioSessionId, controlToken: m.body.controlToken }, 'support:joined');
      }
      const m = await mint(c.streamId);
      await expect(connect({ role: 'support', sessionId: m.body.studioSessionId, controlToken: m.body.controlToken }, 'support:joined')).rejects.toThrow(/Too many control windows/);
    });
  });

  describe('the ADMIN is re-checked too', () => {
    async function ownAdminSupport() {
      const a = await h.signIn({ superadmin: true });
      const c = await customer();
      const started = await a.client.post('/superadmin/impersonation', { accountId: c.accountId, mode: 'act' });
      expect(started.status).toBe(201);
      const m = await a.client.post(`/streams/${c.streamId}/support-control-token`);
      expect(m.status).toBe(201);
      const conn = await connect({ role: 'support', sessionId: m.body.studioSessionId, controlToken: m.body.controlToken }, 'support:joined');
      return { a, c, conn };
    }
    const cases: Array<[string, (email: string) => Promise<unknown>]> = [
      ['demoted from superadmin', (email) => h.db.query(`UPDATE users SET role = 'user' WHERE email = $1`, [email])],
      ['suspended', (email) => h.db.query(`UPDATE users SET suspended_at = now() WHERE email = $1`, [email])],
      ['login session revoked', (email) => h.db.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email])],
      ['login session expired', (email) => h.db.query(`UPDATE user_sessions SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email])],
    ];
    it.each(cases)('%s: the open support socket is cut off, later commands fail, the session is ended as invalid', async (_name, breakIt) => {
      const x = await ownAdminSupport();
      expect((await ask(x.conn, 'ads.shrink', { on: true })).res.ok).toBe(true);
      await breakIt(x.a.email);
      const { res } = await ask(x.conn, 'ads.shrink', { on: false });
      expect(res).toEqual({ ok: false, error: 'The support session has ended' });
      expect((await x.conn.wait('support:ended'))[0]).toMatchObject({ reason: 'invalid' });
      const row = (await h.db.query(`SELECT end_reason FROM impersonation_sessions WHERE admin_user_id = (SELECT id FROM users WHERE email = $1)`, [x.a.email])).rows[0];
      expect(row.end_reason).toBe('invalid');
      await sleep(200);
      expect(x.c.host!.got('support:command').map((a) => a[0].payload)).toEqual([{ on: true }]);
    });

    it('logging out ends the support session and cuts the socket', async () => {
      const x = await ownAdminSupport();
      expect((await x.a.client.post('/auth/logout')).status).toBeLessThan(300);
      expect((await x.conn.wait('support:ended', undefined, 3000))[0]).toMatchObject({ reason: 'logout' });
    });

    it('the periodic re-check (no command needed) also cuts off a demoted admin', async () => {
      const x = await ownAdminSupport();
      await h.db.query(`UPDATE users SET role = 'user' WHERE email = $1`, [x.a.email]);
      expect((await x.conn.wait('support:ended', undefined, 9000))[0]).toMatchObject({ reason: 'invalid' });
    }, 20_000);

    it('a demoted admin can no longer mint a token', async () => {
      const a = await h.signIn({ superadmin: true });
      const c = await customer({ host: false });
      await a.client.post('/superadmin/impersonation', { accountId: c.accountId, mode: 'act' });
      await h.db.query(`UPDATE users SET role = 'user' WHERE email = $1`, [a.email]);
      expect((await a.client.post(`/streams/${c.streamId}/support-control-token`)).status).toBe(403);
    });
  });

});
