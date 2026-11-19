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

describeE2E('support control of a live studio', () => {
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

  describe('the control token', () => {
    it('is minted only for an ACT-mode support session, on a LIVE stream of the impersonated customer', async () => {
      const c = await customer({ host: false });
      const other = await customer({ host: false });
      // Not in a support session at all: the admin is themselves; a customer has no such right either.
      expect((await mint(c.streamId)).status).toBe(403);
      expect((await c.client.post(`/streams/${c.streamId}/support-control-token`)).status).toBe(403);
      expect((await new Client(h.baseUrl).post(`/streams/${c.streamId}/support-control-token`)).status).toBe(401);
      // View mode: refused (every POST is read-only there).
      await startAct(c.accountId, 'view');
      const view = await mint(c.streamId);
      expect(view.status).toBe(403);
      expect(JSON.stringify(view.body)).toContain('View-only support session');
      // Act mode, another account's stream: not found. Malformed id: 400.
      await startAct(c.accountId);
      expect((await mint(other.streamId)).status).toBe(404);
      expect((await mint('not-a-uuid')).status).toBe(400);
      // Success.
      const ok = await mint(c.streamId);
      expect(ok.status).toBe(201);
      expect(typeof ok.body.controlToken).toBe('string');
      expect(ok.body.studioSessionId).toBe(c.sessionId);
      expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
      expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
      // Renewable while the session is active, and never past the session itself.
      await h.db.query(`UPDATE impersonation_sessions SET expires_at = now() + interval '2 minutes' WHERE ended_at IS NULL`);
      const short = await mint(c.streamId);
      expect(short.status).toBe(201);
      expect(Date.parse(short.body.expiresAt) - Date.now()).toBeLessThanOrEqual(2 * 60_000);
      // The host token is still blocked for support, and is not what this route returns.
      const hostTok = await admin.post(`/studio-sessions/${c.sessionId}/host-token`);
      expect(hostTok.status).toBe(403);
      expect(JSON.stringify(ok.body)).not.toContain(c.hostToken);
      // A stream that is not live any more: refused.
      await c.client.post(`/streams/${c.streamId}/end`);
      const ended = await mint(c.streamId);
      expect(ended.status).toBe(409);
      expect(JSON.stringify(ended.body)).toContain('not live');
    });

    it('is refused once the support session expired or ended (and the stale screen is told)', async () => {
      const c = await customer({ host: false });
      const started = (await startAct(c.accountId)).body;
      await h.db.query(`UPDATE impersonation_sessions SET expires_at = now() - interval '1 minute' WHERE ended_at IS NULL`);
      const stale = await admin.call('POST', `/streams/${c.streamId}/support-control-token`, { headers: { 'X-Support-Session': started.id } });
      expect(stale.status).toBe(409);
      expect(JSON.stringify(stale.body)).toContain('support_session_ended');
      expect((await mint(c.streamId)).status).toBe(403);
    });

    it('is not stored or logged anywhere but the mint response; the route is allowlisted, host-token stays blocked', async () => {
      const c = await customer({ host: false });
      await startAct(c.accountId);
      const m = await mint(c.streamId);
      const token = m.body.controlToken as string;
      const rows = (await h.db.query('SELECT metadata FROM superadmin_audit_log WHERE target_id = $1', [c.accountId])).rows;
      expect(JSON.stringify(rows)).not.toContain(token);
      expect((await auditRows(c.accountId, 'impersonated_studio_control')).map((r) => r.metadata.event)).toEqual(['token_minted']);
      // Any other response of the same session never carries a control token key.
      expect(JSON.stringify((await admin.get(`/streams/${c.streamId}`)).body)).not.toMatch(/controlToken/);
      expect(IMPERSONATION_ACT_ALLOWED['POST streams/:id/support-control-token']).toBeTruthy();
      expect(Reflect.getMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, SupportControlController.prototype.mint)).toBeUndefined();
      expect(Reflect.getMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, StudioSessionsController.prototype.mintHostToken)).toBe('go-live');
    });

    it('is refused (503) when the audit log cannot record it', async () => {
      const c = await customer({ host: false });
      await startAct(c.accountId);
      jest.spyOn(h.app.get(AuditLogService), 'logStrict').mockRejectedValue(new Error('db down'));
      expect((await mint(c.streamId)).status).toBe(503);
    });
  });

  describe('the support socket', () => {
    it('needs a valid token for exactly this studio session and a live act session', async () => {
      const c = await customer();
      const { token } = await support(c);
      await expect(connect({ role: 'support', sessionId: c.sessionId, controlToken: 'nope-nope-nope-nope-nope' }, 'support:joined')).rejects.toThrow(/Invalid or expired/);
      await expect(connect({ role: 'support', sessionId: c.sessionId }, 'support:joined')).rejects.toThrow(/require/);
      const otherCust = await customer({ host: false });
      await expect(connect({ role: 'support', sessionId: otherCust.sessionId, controlToken: token }, 'support:joined')).rejects.toThrow(/Invalid or expired/);
      // The host token is not a control token and the control token is not a host token.
      await expect(connect({ role: 'support', sessionId: c.sessionId, controlToken: c.hostToken }, 'support:joined')).rejects.toThrow(/Invalid or expired/);
      await expect(connect({ role: 'host', sessionId: c.sessionId, hostToken: token }, 'joined')).rejects.toThrow();
      // The session ends: the token is dead.
      await admin.del('/superadmin/impersonation');
      await expect(connect({ role: 'support', sessionId: c.sessionId, controlToken: token }, 'support:joined')).rejects.toThrow(/Invalid or expired|no longer active/);
    });

    it('is not a participant: no media signaling, no peer events, invisible to guests, never sees invite or host tokens', async () => {
      const c = await customer();
      const invite = (await c.client.post(`/studio-sessions/${c.sessionId}/invites`, {})).body;
      const guest = await connect({ role: 'guest', token: invite.token, displayName: 'Guest Gita' }, 'joined');
      await c.host!.wait('peer-joined');
      const { conn } = await support(c);
      await sleep(200);
      // The guest never hears about the support socket, and neither does the host as a peer.
      expect(guest.got('peer-joined')).toHaveLength(0);
      expect(c.host!.got('peer-joined').filter((a) => a[0].socketId === conn.id)).toHaveLength(0);
      // Signaling to / from it goes nowhere.
      conn.socket.emit('signal', { to: c.host!.id, type: 'request-offer', payload: {} });
      conn.socket.emit('signal', { to: guest.id, type: 'offer', payload: { sdp: 'x' } });
      guest.socket.emit('signal', { to: conn.id, type: 'offer', payload: { sdp: 'y' } });
      c.host!.socket.emit('signal', { to: conn.id, type: 'offer', payload: { sdp: 'z' } });
      conn.socket.emit('rtc-state', { about: 'x', iceConnectionState: 'failed', connectionState: 'failed' });
      await sleep(300);
      expect(c.host!.got('signal')).toHaveLength(0);
      expect(guest.got('signal')).toHaveLength(0);
      expect(conn.got('signal')).toHaveLength(0);
      // Nothing the support socket received contains an invite token or a host token.
      const seen = JSON.stringify(conn.events);
      expect(seen).not.toContain(invite.token);
      expect(seen).not.toContain(c.hostToken);
      // No participant row for it, and the host's participant list shows host + guest only.
      const list = (await c.client.get(`/studio-sessions/${c.sessionId}/participants`)).body as Array<{ role: string }>;
      expect(list.map((p) => p.role).sort()).toEqual(['guest', 'host']);
      // It cannot join as a participant by connecting as a guest or host with the control token either.
    });

    it('reports host presence and relays the host snapshot to support sockets ONLY', async () => {
      const c = await customer();
      const invite = (await c.client.post(`/studio-sessions/${c.sessionId}/invites`, {})).body;
      const guest = await connect({ role: 'guest', token: invite.token, displayName: 'Guest' }, 'joined');
      const { conn } = await support(c);
      expect(conn.got('support:joined')[0][0]).toMatchObject({ streamId: c.streamId, hostConnected: true });
      // The host is asked (by the server) for a snapshot, and answers.
      await c.host!.wait('support:state-request');
      c.host!.socket.emit('support:state', { rev: 1, state: validState('grid') });
      const [snap] = await conn.wait('support:state');
      expect(snap).toEqual({ rev: 1, state: validState('grid') });
      // A guest forging a snapshot is dropped; an oversize one too.
      guest.socket.emit('support:state', { rev: 99, state: validState('evil') });
      c.host!.socket.emit('support:state', { rev: 2, state: { pad: 'x'.repeat(30_000) } });
      await sleep(300);
      expect(conn.got('support:state')).toHaveLength(1);
      expect(guest.got('support:state')).toHaveLength(0);
      expect(guest.events.filter((e) => e.ev.startsWith('support:'))).toHaveLength(0);
      // A second support socket (e.g. a reload of the control page) gets the last snapshot at once.
      const m2 = await mint(c.streamId);
      const again = await connect({ role: 'support', sessionId: m2.body.studioSessionId, controlToken: m2.body.controlToken }, 'support:joined');
      expect((await again.wait('support:state'))[0]).toEqual({ rev: 1, state: validState('grid') });
      // Host leaves / returns: support learns it.
      c.host!.socket.disconnect();
      await conn.wait('support:host', (m) => m.connected === false);
    });

    it('a support socket without a host studio is told so, and its commands fail', async () => {
      const c = await customer({ host: false });
      const { conn } = await support(c);
      expect(conn.got('support:joined')[0][0].hostConnected).toBe(false);
      const { res } = await ask(conn, 'layout.set', { mode: 'grid' });
      expect(res).toEqual({ ok: false, error: 'The host studio is not connected' });
    });
  });

  describe('commands', () => {
    it('relays a whitelisted command ONLY to the host, and the host ack comes back to the support socket', async () => {
      const c = await customer();
      const invite = (await c.client.post(`/studio-sessions/${c.sessionId}/invites`, {})).body;
      const guest = await connect({ role: 'guest', token: invite.token, displayName: 'Guest' }, 'joined');
      const { conn } = await support(c);
      const { id, res } = await ask(conn, 'ticker.set', { text: 'Breaking: TOPSECRET-TEXT', on: true });
      expect(res).toEqual({ ok: true });
      const [cmd] = await c.host!.wait('support:command');
      expect(cmd).toMatchObject({ id, type: 'ticker.set', payload: { text: 'Breaking: TOPSECRET-TEXT', on: true }, source: 'support-session' });
      expect(typeof cmd.at).toBe('number');
      await sleep(200);
      expect(guest.events.filter((e) => e.ev.startsWith('support:'))).toHaveLength(0);
      // The host's own result goes back through the server.
      c.host!.socket.emit('support:ack', { id, ok: true, appliedAt: 1234 });
      const [ack] = await conn.wait('support:ack');
      expect(ack).toMatchObject({ id, ok: true, appliedAt: 1234 });
      // Audit: intent (strict) before the relay, result after; free text only as a length; never the token.
      await sleep(200);
      const rows = await auditRows(c.accountId, 'impersonated_studio_command');
      expect(rows.map((r) => r.metadata.phase)).toEqual(['intent', 'result']);
      expect(rows[0].metadata).toMatchObject({ command: 'ticker.set', summary: 'ticker.set{text[len=24],on=true}', streamId: c.streamId, commandId: id });
      expect(rows[1].metadata).toMatchObject({ applied: true, hostReported: true, command: 'ticker.set' }); // host-reported: the intent entry is the trusted record
      const all = JSON.stringify((await h.db.query('SELECT metadata FROM superadmin_audit_log WHERE target_id = $1', [c.accountId])).rows);
      expect(all).not.toContain('TOPSECRET');
      expect(rows[0].actor_user_id).toBeTruthy();
      // A failing result is reported too.
      const second = await ask(conn, 'layout.set', { mode: 'podcast-split' });
      await c.host!.wait('support:command', (m) => m.id === second.id);
      c.host!.socket.emit('support:ack', { id: second.id, ok: false, error: 'host changed it just now' });
      expect((await conn.wait('support:ack', (m) => m.id === second.id))[0]).toMatchObject({ ok: false, error: 'host changed it just now' });
    });

    it('drops a forged support:command / ack from a guest or the host itself', async () => {
      const c = await customer();
      const invite = (await c.client.post(`/studio-sessions/${c.sessionId}/invites`, {})).body;
      const guest = await connect({ role: 'guest', token: invite.token, displayName: 'Guest' }, 'joined');
      const { conn } = await support(c);
      const before = (await auditRows(c.accountId, 'impersonated_studio_command')).length;
      guest.socket.emit('support:command', { id: 'forged1', type: 'layout.set', payload: { mode: 'grid' } });
      c.host!.socket.emit('support:command', { id: 'forged2', type: 'layout.set', payload: { mode: 'grid' } });
      // A guest answering a real pending command must not resolve it either.
      const real = await ask(conn, 'ads.shrink', { on: false });
      await c.host!.wait('support:command', (m) => m.id === real.id);
      guest.socket.emit('support:ack', { id: real.id, ok: true });
      await sleep(250);
      expect(c.host!.got('support:command').map((a) => a[0].id)).toEqual([real.id]);
      expect(conn.got('support:ack')).toHaveLength(0);
      // Only the host's answer (or the timeout) resolves it.
      c.host!.socket.emit('support:ack', { id: real.id, ok: true });
      await conn.wait('support:ack', (m) => m.id === real.id && m.ok === true);
      expect(guest.events.filter((e) => e.ev.startsWith('support:'))).toHaveLength(0);
      expect((await auditRows(c.accountId, 'impersonated_studio_command')).filter((r) => r.metadata.commandId?.startsWith('forged'))).toHaveLength(0);
      expect(before).toBe(0);
    });

    it('rejects unknown commands, extra or oversize payloads, a foreign kit; nothing reaches the host', async () => {
      const c = await customer();
      const { conn } = await support(c);
      for (const [type, payload] of [
        ['stream.stop', {}],
        ['publish', {}],
        ['mic.mute', {}],
        ['guest.kick', {}],
        ['layout.set', { mode: 'grid', extra: 1 }],
        ['layout.set', {}],
        ['ticker.set', { text: 'x'.repeat(201) }],
        ['ticker.set', { text: 'x', pad: 'y'.repeat(2000) }],
        ['wallpaper.dim', { n: 99 }],
      ] as Array<[string, unknown]>) {
        const { res } = await ask(conn, type, payload);
        expect([type, res.ok]).toEqual([type, false]);
      }
      const otherKit = (await (await customer({ host: false })).client.post('/brand-kits', { name: 'Not yours' })).body;
      const foreign = await ask(conn, 'kit.apply', { kitId: otherKit.id });
      expect(foreign.res).toEqual({ ok: false, error: 'Unknown brand kit' });
      const own = (await c.client.post('/brand-kits', { name: 'Mine' })).body;
      expect((await ask(conn, 'kit.apply', { kitId: own.id })).res).toEqual({ ok: true });
      await c.host!.wait('support:command', (m) => m.type === 'kit.apply');
      expect(c.host!.got('support:command')).toHaveLength(1);
      // Rejections are on record, without payload content.
      const rejected = (await auditRows(c.accountId, 'impersonated_studio_command')).filter((r) => r.metadata.phase === 'rejected');
      expect(rejected.length).toBeGreaterThanOrEqual(9);
      expect(JSON.stringify(rejected)).not.toContain('xxxxxxxx');
      // A duplicate id while pending is refused.
      const dup = await ask(conn, 'ads.shrink', { on: true }, 'same-id');
      expect(dup.res.ok).toBe(true);
      expect((await ask(conn, 'ads.shrink', { on: true }, 'same-id')).res).toEqual({ ok: false, error: 'Duplicate command id' });
    });

    it('is rate limited (20 per 10 s per session)', async () => {
      const c = await customer();
      const { conn } = await support(c);
      let limited = 0;
      let accepted = 0;
      for (let i = 0; i < 26; i++) {
        const { res } = await ask(conn, 'ads.shrink', { on: i % 2 === 0 });
        if (res.ok) accepted++;
        else if (/Too many commands/.test(res.error)) limited++;
      }
      expect(accepted).toBe(20);
      expect(limited).toBe(6);
    });

    it('tells the support socket when the host never answers or leaves mid-command', async () => {
      const c = await customer();
      const { conn } = await support(c);
      const slow = await ask(conn, 'ads.shrink', { on: false });
      expect(slow.res.ok).toBe(true);
      expect((await conn.wait('support:ack', (m) => m.id === slow.id))[0]).toMatchObject({ ok: false, error: 'The host studio did not respond' });
      const gone = await ask(conn, 'ads.shrink', { on: true });
      c.host!.socket.disconnect();
      expect((await conn.wait('support:ack', (m) => m.id === gone.id))[0]).toMatchObject({ ok: false, error: 'The host studio disconnected' });
    });

    it('is refused (not relayed) when the audit log cannot record the intent', async () => {
      const c = await customer();
      const { conn } = await support(c);
      jest.spyOn(h.app.get(AuditLogService), 'logStrict').mockRejectedValue(new Error('db down'));
      const { res } = await ask(conn, 'layout.set', { mode: 'grid' });
      expect(res).toEqual({ ok: false, error: 'Audit log unavailable; command refused' });
      await sleep(200);
      expect(c.host!.got('support:command')).toHaveLength(0);
    });
  });

  describe('when the support session ends', () => {
    it('Exit cuts the socket with support:ended, and later commands fail', async () => {
      const c = await customer();
      const { conn, token } = await support(c);
      expect((await ask(conn, 'ads.shrink', { on: true })).res.ok).toBe(true);
      await admin.del('/superadmin/impersonation');
      expect((await conn.wait('support:ended', undefined, 3000))[0]).toMatchObject({ reason: 'exit' });
      await sleep(400);
      expect(conn.socket.connected).toBe(false);
      await expect(connect({ role: 'support', sessionId: c.sessionId, controlToken: token }, 'support:joined')).rejects.toThrow();
      await sleep(300);
      const events = (await auditRows(c.accountId, 'impersonated_studio_control')).map((r) => r.metadata.event);
      expect(events).toEqual(['token_minted', 'connected', 'disconnected']);
    });

    it('expiry cuts it off on the next command (and by the timer), host-less commands never reach the studio', async () => {
      const c = await customer();
      const { conn } = await support(c);
      await h.db.query(`UPDATE impersonation_sessions SET expires_at = now() - interval '1 second' WHERE ended_at IS NULL`);
      const { res } = await ask(conn, 'layout.set', { mode: 'grid' });
      expect(res).toEqual({ ok: false, error: 'The support session has ended' });
      expect((await conn.wait('support:ended'))[0]).toMatchObject({ reason: 'expired' });
      expect(c.host!.got('support:command')).toHaveLength(0);
    });

    it('the stream ending ends the control too', async () => {
      const c = await customer();
      const { conn } = await support(c);
      await c.client.post(`/streams/${c.streamId}/end`);
      const { res } = await ask(conn, 'layout.set', { mode: 'grid' });
      expect(res.ok).toBe(false);
      expect((await conn.wait('support:ended'))[0]).toMatchObject({ reason: 'stream_ended' });
    });

    it('a view-mode session never gets as far as a token or a socket', async () => {
      const c = await customer();
      await startAct(c.accountId, 'view');
      expect((await mint(c.streamId)).status).toBe(403);
      await expect(connect({ role: 'support', sessionId: c.sessionId, controlToken: 'x'.repeat(30) }, 'support:joined')).rejects.toThrow();
    });
  });
});
