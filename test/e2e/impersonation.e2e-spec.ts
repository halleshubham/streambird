import { ModulesContainer } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import * as crypto from 'crypto';
import { describeE2E, bootApp, Client, Harness } from './harness';
import { ImpersonationService } from '../../src/impersonation/impersonation.service';
import {
  BLOCKED_WHEN_IMPERSONATING_KEY,
  IMPERSONATION_BLOCK_CATEGORIES,
  IMPERSONATION_EXEMPT_ROUTES,
} from '../../src/impersonation/blocked-when-impersonating';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const BLOCKED = 'Not allowed while acting as a customer';
/** Nest wraps the sentence: the filter's `message` is the exception response `{message, error, statusCode}`. */
const msg = (r: { body: any }): string => r.body?.message?.message ?? r.body?.message;

describeE2E('superadmin support sessions (impersonation)', () => {
  let h: Harness;
  let admin: Client;
  let adminEmail: string;
  let adminAccountId: string;
  beforeAll(async () => {
    h = await bootApp({ mediamtx: true });
    const a = await h.signIn({ superadmin: true });
    admin = a.client;
    adminEmail = a.email;
    adminAccountId = a.accountId;
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 20, watermark: false, maxDestinations: 3 });
  });
  afterAll(async () => {
    await admin.patch('/superadmin/plans/free', { assetStorageMb: 0, watermark: true, maxDestinations: 1 });
    await h.close();
  });
  // Every test starts with no open support session for the main admin.
  afterEach(async () => {
    await admin.del('/superadmin/impersonation');
  });

  const twitch = (c: Client, label: string) =>
    c.post('/platform-connections/twitch/manual', { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: `key-${label}` }).then((r) => r.body.id as string);
  const start = (c: Client, body: Record<string, unknown>) => c.post('/superadmin/impersonation', body);
  const audit = async (action: string, accountId: string) =>
    (await h.db.query('SELECT * FROM superadmin_audit_log WHERE action = $1 AND target_id = $2 ORDER BY created_at', [action, accountId])).rows;

  it('only a signed-in superadmin can start, read or end a session', async () => {
    const { accountId } = await h.signIn();
    const anon = new Client(h.baseUrl);
    expect((await start(anon, { accountId, mode: 'view' })).status).toBe(401);
    expect((await anon.get('/superadmin/impersonation')).status).toBe(401);
    const normal = (await h.signIn()).client;
    expect((await start(normal, { accountId, mode: 'view' })).status).toBe(403);
    expect((await normal.get('/superadmin/impersonation')).status).toBe(403);
    expect((await normal.del('/superadmin/impersonation')).status).toBe(403);
    // Nothing was created.
    const { rows } = await h.db.query('SELECT 1 FROM impersonation_sessions WHERE target_account_id = $1', [accountId]);
    expect(rows).toHaveLength(0);
  });

  it('validates the request and refuses forbidden targets', async () => {
    const { accountId } = await h.signIn();
    expect((await start(admin, { accountId })).status).toBe(400);
    expect((await start(admin, { accountId, mode: 'root' })).status).toBe(400);
    expect((await start(admin, { mode: 'view' })).status).toBe(400);
    expect((await start(admin, { accountId, userId: crypto.randomUUID(), mode: 'view' })).status).toBe(400);
    expect((await start(admin, { accountId, mode: 'view', reason: 'x'.repeat(201) })).status).toBe(400);
    expect((await start(admin, { accountId, mode: 'view', extra: 1 })).status).toBe(400);
    expect((await start(admin, { accountId: 'nope', mode: 'view' })).status).toBe(400);
    expect((await start(admin, { accountId: crypto.randomUUID(), mode: 'view' })).status).toBe(404);
    expect((await start(admin, { userId: crypto.randomUUID(), mode: 'view' })).status).toBe(404);
    // Your own account, and another superadmin: never.
    expect((await start(admin, { accountId: adminAccountId, mode: 'view' })).status).toBe(400);
    const other = await h.signIn({ superadmin: true });
    const otherUser = (await h.db.query('SELECT id FROM users WHERE email = $1', [other.email])).rows[0].id;
    const r = await start(admin, { userId: otherUser, mode: 'view' });
    expect(r.status).toBe(403);
    // A deleted account (tombstone) is gone for support too.
    await h.db.query('UPDATE accounts SET deleted_at = now() WHERE id = $1', [accountId]);
    expect((await start(admin, { accountId, mode: 'view' })).status).toBe(404);
    // A user still waiting for approval has to be approved first.
    const pending = new Client(h.baseUrl);
    const email = `pend-${crypto.randomBytes(4).toString('hex')}@test.dev`;
    await pending.post('/auth/request-code', { email });
    await pending.post('/auth/verify-code', { email, code: h.mailbox.codes.get(email) });
    const pendingAccount = (await h.db.query('SELECT account_id FROM users WHERE email = $1', [email])).rows[0].account_id;
    expect((await start(admin, { accountId: pendingAccount, mode: 'view' })).status).toBe(409);
  });

  it('VIEW-AS: the admin sees the customer, reads work, every write is refused, exit returns the admin to themselves', async () => {
    const mine = await admin.post('/brand-kits', { name: 'Admin own kit' });
    expect(mine.status).toBe(201);
    const cust = await h.signIn();
    const kit = (await cust.client.post('/brand-kits', { name: 'Customer kit' })).body;

    const started = await start(admin, { accountId: cust.accountId, mode: 'view', reason: 'ticket 42' });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ mode: 'view', reason: 'ticket 42', target: { email: cust.email, accountId: cust.accountId } });
    expect(Date.parse(started.body.expiresAt) - Date.parse(started.body.startedAt)).toBe(30 * 60_000);

    // The app learns who it is: the customer, plus the session for the banner.
    const me = await admin.get('/auth/me');
    expect(me.body.user.email).toBe(cust.email);
    expect(me.body.user.role).not.toBe('superadmin');
    expect(me.body.accountId).toBe(cust.accountId);
    expect(me.body.impersonation).toMatchObject({ mode: 'view', target: { email: cust.email } });

    // Principal = the customer's data, never the admin's.
    const kits = (await admin.get('/brand-kits')).body;
    expect(kits.map((k: any) => k.id)).toEqual([kit.id]);
    expect(JSON.stringify(kits)).not.toContain('Admin own kit');
    expect((await admin.get('/presets')).status).toBe(200);
    expect((await admin.get('/streams')).status).toBe(200);

    // Read-only: every non-read method is refused with the plain sentence.
    const post = await admin.post('/brand-kits', { name: 'Nope' });
    expect(post.status).toBe(403);
    expect(msg(post)).toBe('View-only support session');
    expect((await admin.patch(`/brand-kits/${kit.id}`, { name: 'Renamed' })).status).toBe(403);
    expect((await admin.del(`/brand-kits/${kit.id}`)).status).toBe(403);
    expect((await admin.post('/presets', { name: 'p', config: {} })).status).toBe(403);
    expect((await cust.client.get('/brand-kits')).body.map((k: any) => k.name)).toEqual(['Customer kit']);

    // The real admin routes keep working during the session (they authenticate as the admin) ...
    expect((await admin.get('/superadmin/accounts')).status).toBe(200);
    const cur = await admin.get('/superadmin/impersonation');
    expect(cur.body).toMatchObject({ active: true, mode: 'view', target: { accountId: cust.accountId } });
    // ... and the customer cannot use them.
    expect((await cust.client.get('/superadmin/accounts')).status).toBe(403);
    expect((await cust.client.get('/superadmin/impersonation')).status).toBe(403);

    // Exit.
    expect((await admin.del('/superadmin/impersonation')).status).toBe(204);
    expect((await admin.get('/superadmin/impersonation')).body).toEqual({ active: false });
    const back = await admin.get('/auth/me');
    expect(back.body.user.email).toBe(adminEmail);
    expect(back.body.impersonation).toBeUndefined();
    expect((await admin.get('/brand-kits')).body.map((k: any) => k.name)).toEqual(['Admin own kit']);
    // Idempotent.
    expect((await admin.del('/superadmin/impersonation')).status).toBe(204);
  });

  it('ACT-AS: configuration can be created, changed and deleted on the customer account, and the customer sees it', async () => {
    const cust = await h.signIn();
    const conn = await twitch(cust.client, 'Chan');
    expect((await start(admin, { userId: (await h.db.query('SELECT id FROM users WHERE email = $1', [cust.email])).rows[0].id, mode: 'act' })).status).toBe(201);

    const kit = await admin.post('/brand-kits', { name: 'Made by support', title: 'Default title' });
    expect(kit.status).toBe(201);
    expect((await admin.patch(`/brand-kits/${kit.body.id}`, { name: 'Renamed by support' })).status).toBe(200);
    const second = (await admin.post('/brand-kits', { name: 'Second' })).body;
    expect((await admin.put(`/brand-kits/connections/${conn}`, { brandKitId: second.id })).status).toBe(200);
    const preset = await admin.post('/presets', { name: 'Support preset', config: { orientation: 'landscape' } });
    expect(preset.status).toBe(201);
    expect((await admin.patch(`/presets/${preset.body.id}`, { name: 'Support preset 2', config: { orientation: 'landscape' } })).status).toBe(200);
    const sched = await admin.post('/streams/schedule', {
      title: 'Scheduled by support',
      scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      timezone: 'UTC',
      destinationConnectionIds: [conn],
    });
    expect(sched.status).toBe(201);
    expect((await admin.patch(`/streams/${sched.body.id}/schedule`, { title: 'Moved by support' })).status).toBe(200);
    expect((await admin.put(`/streams/${sched.body.id}/schedule/thumbnail`, undefined)).status).not.toBe(403);

    // The customer sees all of it, under their own login.
    expect((await cust.client.get('/brand-kits')).body.map((k: any) => k.name).sort()).toEqual(['Renamed by support', 'Second']);
    expect((await cust.client.get('/presets')).body.map((p: any) => p.name)).toEqual(['Support preset 2']);
    const theirs = await cust.client.get(`/streams/${sched.body.id}/schedule`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.title).toBe('Moved by support');

    // Deletes of configuration are allowed too.
    expect((await admin.del(`/presets/${preset.body.id}`)).status).toBe(204);
    expect((await admin.del(`/brand-kits/${kit.body.id}`)).status).toBe(204);
    expect((await admin.del(`/streams/${sched.body.id}/schedule`)).status).toBe(204);
    expect((await cust.client.get('/presets')).body).toEqual([]);
    expect((await cust.client.get('/brand-kits')).body.map((k: any) => k.name)).toEqual(['Second']);
  });

  describe('the blocked list (act mode)', () => {
    let custId: string;
    let custAccount: string;
    let conn: string;
    beforeAll(async () => {
      const cust = await h.signIn();
      custAccount = cust.accountId;
      custId = (await h.db.query('SELECT id FROM users WHERE email = $1', [cust.email])).rows[0].id;
      conn = await twitch(cust.client, 'Blocked');
    });
    beforeEach(async () => {
      expect((await start(admin, { userId: custId, mode: 'act' })).status).toBe(201);
    });

    const refused = (r: { status: number; body: any }, label: string) => {
      expect(r.status).toBe(403);
      expect(msg(r)).toBe(`${BLOCKED}: ${label}`);
    };

    it('payments and plan changes', async () => {
      const label = IMPERSONATION_BLOCK_CATEGORIES.billing;
      refused(await admin.post('/billing/orders', { planKey: 'pro' }), label);
      refused(await admin.post('/billing/verify', {}), label);
      refused(await admin.post('/billing/subscriptions', { planKey: 'pro' }), label);
      refused(await admin.post('/billing/subscriptions/verify', {}), label);
      refused(await admin.post('/billing/subscription/cancel'), label);
      // Reading the customer's billing state is fine (support needs it).
      expect((await admin.get('/billing/subscription')).status).toBe(200);
      expect((await admin.get('/billing/payments')).status).toBe(200);
      expect((await admin.get('/plans/me')).status).toBe(200);
    });

    it('customer emails: asking the customer for a deletion code is blocked (there is no password, email or API-key route to reach)', async () => {
      // Customers sign in by emailed code only, so the only authenticated credential-ish route is the emailed deletion code.
      refused(await admin.post('/account/delete/request'), IMPERSONATION_BLOCK_CATEGORIES['customer-email']);
    });

    it('team access', async () => {
      const label = IMPERSONATION_BLOCK_CATEGORIES['team-access'];
      refused(await admin.post('/team/invite', { email: 'x@test.dev' }), label);
      refused(await admin.del(`/team/${crypto.randomUUID()}`), label);
    });

    it('connecting and disconnecting channels, stream keys (both modes, GET redirects included)', async () => {
      const label = IMPERSONATION_BLOCK_CATEGORIES.connections;
      refused(await admin.post('/platform-connections/twitch/manual', { label: 'x', ingestServerUrl: 'rtmp://a/b', streamKey: 'k' }), label);
      refused(await admin.del(`/platform-connections/${conn}`), label);
      refused(await admin.get('/platform-connections/youtube/connect'), label);
      refused(await admin.get('/platform-connections/youtube/callback?code=a&state=b'), label);
      refused(await admin.get('/platform-connections/facebook/connect'), label);
      refused(await admin.get('/platform-connections/facebook/callback?code=a&state=b'), label);
      refused(await admin.post('/platform-connections/facebook/select', {}), label);
      // Listing the channels (no credentials in it) is still fine.
      const list = await admin.get('/platform-connections');
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toMatch(/key-Blocked|ciphertext/);
      // The connection is still there.
      expect(list.body.map((c: any) => c.id)).toContain(conn);
    });

    it('going live: start, go-live-now, retry, host token, preset start', async () => {
      const label = IMPERSONATION_BLOCK_CATEGORIES['go-live'];
      refused(await admin.post('/streams', { title: 't', destinationConnectionIds: [conn] }), label);
      refused(await admin.post(`/streams/${crypto.randomUUID()}/start`), label);
      refused(await admin.post(`/streams/${crypto.randomUUID()}/destinations/${crypto.randomUUID()}/retry`), label);
      refused(await admin.post(`/studio-sessions/${crypto.randomUUID()}/host-token`), label);
      refused(await admin.post(`/presets/${crypto.randomUUID()}/start`, {}), label);
      const { rows } = await h.db.query('SELECT 1 FROM live_streams WHERE account_id = $1', [custAccount]);
      expect(rows).toHaveLength(0);
    });

    it('also blocked in view mode', async () => {
      expect((await start(admin, { userId: custId, mode: 'view' })).status).toBe(201);
      expect((await admin.post('/studio-sessions/' + crypto.randomUUID() + '/host-token')).status).toBe(403);
      expect(msg(await admin.get('/platform-connections/youtube/connect'))).toContain(BLOCKED);
    });
  });

  it('a suspended customer can be viewed but not acted on', async () => {
    const cust = await h.signIn();
    await h.db.query('UPDATE accounts SET suspended_at = now() WHERE id = $1', [cust.accountId]);
    expect((await start(admin, { accountId: cust.accountId, mode: 'act' })).status).toBe(409);
    const view = await start(admin, { accountId: cust.accountId, mode: 'view' });
    expect(view.status).toBe(201);
    expect((await admin.get('/brand-kits')).status).toBe(200);
    // And the customer is still locked out themselves.
    expect((await cust.client.get('/brand-kits')).status).toBe(403);
  });

  it('expiry: after the time is up the admin is their own principal again, and it is recorded once', async () => {
    const cust = await h.signIn();
    await admin.post('/brand-kits', { name: 'Admin kit for expiry' });
    const s = await start(admin, { accountId: cust.accountId, mode: 'act' });
    expect((await admin.get('/brand-kits')).body).toEqual([]);
    await h.db.query(`UPDATE impersonation_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [s.body.id]);

    // The banner endpoint and /auth/me both say "over".
    expect((await admin.get('/superadmin/impersonation')).body).toEqual({ active: false });
    expect((await admin.get('/auth/me')).body.user.email).toBe(adminEmail);
    const kits = (await admin.get('/brand-kits')).body;
    expect(kits.map((k: any) => k.name)).toEqual(expect.arrayContaining(['Admin kit for expiry']));
    expect((await admin.post('/brand-kits', { name: 'back to own' })).status).toBe(201);
    const ended = await audit('impersonation_ended', cust.accountId);
    expect(ended).toHaveLength(1);
    expect(ended[0].metadata).toMatchObject({ endReason: 'expired', sessionId: s.body.id });
  });

  it('the sweeper records an expired session nobody came back to', async () => {
    const cust = await h.signIn();
    const s = await start(admin, { accountId: cust.accountId, mode: 'view' });
    await h.db.query(`UPDATE impersonation_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [s.body.id]);
    expect(await h.app.get(ImpersonationService).sweepExpired()).toBeGreaterThanOrEqual(1);
    const ended = await audit('impersonation_ended', cust.accountId);
    expect(ended).toHaveLength(1);
    expect(ended[0].metadata.endReason).toBe('expired');
  });

  it('a customer who disappears ends the session; starting another session replaces the first', async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    const first = await start(admin, { accountId: a.accountId, mode: 'view' });
    const second = await start(admin, { accountId: b.accountId, mode: 'act' });
    const rows = (await h.db.query('SELECT id, ended_at, end_reason FROM impersonation_sessions WHERE id = ANY($1)', [[first.body.id, second.body.id]])).rows;
    expect(rows.find((r) => r.id === first.body.id)).toMatchObject({ end_reason: 'replaced' });
    expect(rows.find((r) => r.id === second.body.id).ended_at).toBeNull();
    expect((await admin.get('/auth/me')).body.user.email).toBe(b.email);
    await h.db.query('UPDATE accounts SET deleted_at = now() WHERE id = $1', [b.accountId]);
    expect((await admin.get('/auth/me')).body.user.email).toBe(adminEmail);
    expect((await h.db.query('SELECT end_reason FROM impersonation_sessions WHERE id = $1', [second.body.id])).rows[0].end_reason).toBe('target_gone');
  });

  it('logout ends the support session; a browser without the admin login is not impersonating', async () => {
    const own = await h.signIn({ superadmin: true });
    const cust = await h.signIn();
    const s = await start(own.client, { accountId: cust.accountId, mode: 'act' });
    expect((await own.client.get('/brand-kits')).status).toBe(200);
    // A second browser (a different login) of the SAME admin kind of user is not impersonating: fresh client, no cookie.
    expect((await new Client(h.baseUrl).get('/brand-kits')).status).toBe(401);
    expect((await own.client.post('/auth/logout')).status).toBe(204);
    expect((await h.db.query('SELECT end_reason FROM impersonation_sessions WHERE id = $1', [s.body.id])).rows[0].end_reason).toBe('logout');
    expect((await own.client.get('/brand-kits')).status).toBe(401);
  });

  it('two admins and two customers stay isolated from each other', async () => {
    const admin2 = (await h.signIn({ superadmin: true })).client;
    const a = await h.signIn();
    const b = await h.signIn();
    await a.client.post('/brand-kits', { name: 'A kit' });
    await b.client.post('/brand-kits', { name: 'B kit' });
    await start(admin, { accountId: a.accountId, mode: 'view' });
    await start(admin2, { accountId: b.accountId, mode: 'act' });
    expect((await admin.get('/brand-kits')).body.map((k: any) => k.name)).toEqual(['A kit']);
    expect((await admin2.get('/brand-kits')).body.map((k: any) => k.name)).toEqual(['B kit']);
    expect((await admin2.post('/brand-kits', { name: 'B2' })).status).toBe(201);
    expect((await admin.post('/brand-kits', { name: 'A2' })).status).toBe(403);
    // Ending one does not end the other.
    await admin.del('/superadmin/impersonation');
    expect((await admin2.get('/brand-kits')).body.map((k: any) => k.name).sort()).toEqual(['B kit', 'B2']);
    await admin2.del('/superadmin/impersonation');
    // The customers never saw each other's data nor the admins'.
    expect((await a.client.get('/brand-kits')).body.map((k: any) => k.name)).toEqual(['A kit']);
    expect((await b.client.get('/brand-kits')).body.map((k: any) => k.name).sort()).toEqual(['B kit', 'B2']);
  });

  it('audit: start, every mutating action (also refused ones) and the end are recorded, without request data', async () => {
    const cust = await h.signIn();
    const secretName = `SecretKit-${crypto.randomBytes(4).toString('hex')}`;
    const s = await start(admin, { accountId: cust.accountId, mode: 'act', reason: 'audit check' });
    const kit = await admin.post('/brand-kits', { name: secretName, title: 'private title' });
    await admin.patch(`/brand-kits/${kit.body.id}`, { name: `${secretName}-2` });
    await admin.get('/brand-kits');
    await admin.post('/billing/orders', { planKey: 'pro' });
    await admin.del(`/brand-kits/${kit.body.id}`);
    await admin.del('/superadmin/impersonation');

    const started = await audit('impersonation_started', cust.accountId);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ target_type: 'account' });
    expect(started[0].actor_user_id).toBeTruthy();
    expect(started[0].metadata).toMatchObject({ mode: 'act', reason: 'audit check', sessionId: s.body.id, targetAccountId: cust.accountId });

    const actions = await audit('impersonated_action', cust.accountId);
    const seen = actions.map((a: any) => `${a.metadata.method} ${a.metadata.route} ${a.metadata.status}${a.metadata.blocked ? ' ' + a.metadata.blocked : ''}`);
    expect(seen).toEqual([
      'POST /api/brand-kits 201',
      'PATCH /api/brand-kits/:id 200',
      'POST /api/billing/orders 403 billing',
      'DELETE /api/brand-kits/:id 204',
    ]);
    // Which kit was changed / deleted is recorded (a uuid from the route); what was typed is not.
    expect(actions[1].metadata.resourceIds).toEqual([kit.body.id]);
    expect(actions[3].metadata.resourceIds).toEqual([kit.body.id]);
    expect(actions[0].metadata.resourceIds).toBeUndefined();
    // The GET was a read: not logged. Nothing the customer or admin typed is in the log.
    const dump = JSON.stringify([...started, ...actions, ...(await audit('impersonation_ended', cust.accountId))]);
    for (const secret of [secretName, 'private title', 'pro', 'key-', 'Cookie', 'sb_session']) {
      expect(dump).not.toContain(secret);
    }
    expect(actions.every((a: any) => a.metadata.sessionId === s.body.id && a.metadata.targetUserId && a.actor_user_id === started[0].actor_user_id)).toBe(true);
    const ended = await audit('impersonation_ended', cust.accountId);
    expect(ended).toHaveLength(1);
    expect(ended[0].metadata).toMatchObject({ endReason: 'exit', sessionId: s.body.id });
    // View-mode refusals are recorded as well.
    await start(admin, { accountId: cust.accountId, mode: 'view' });
    await admin.post('/presets', { name: 'x', config: {} });
    const later = await audit('impersonated_action', cust.accountId);
    expect(later[later.length - 1].metadata).toMatchObject({ method: 'POST', route: '/api/presets', status: 403, blocked: 'view-only', mode: 'view' });
  });

  it('the customer is not emailed by any support action that would normally email them', async () => {
    const cust = await h.signIn();
    const sentBefore = h.mailbox.notices.length + h.mailbox.deletionCodes.size + h.mailbox.receipts.length;
    await start(admin, { accountId: cust.accountId, mode: 'act' });
    await admin.post('/account/delete/request');
    await admin.post('/billing/subscription/cancel');
    await admin.post('/team/invite', { email: 'someone@test.dev' });
    expect(h.mailbox.notices.length + h.mailbox.deletionCodes.size + h.mailbox.receipts.length).toBe(sentBefore);
    expect(h.mailbox.deletionCodes.has(cust.email)).toBe(false);
  });

  describe('safety net: every sensitive route is marked', () => {
    const METHODS: Record<number, string> = {
      [RequestMethod.GET]: 'GET',
      [RequestMethod.POST]: 'POST',
      [RequestMethod.PUT]: 'PUT',
      [RequestMethod.DELETE]: 'DELETE',
      [RequestMethod.PATCH]: 'PATCH',
      [RequestMethod.ALL]: 'ALL',
      [RequestMethod.OPTIONS]: 'OPTIONS',
      [RequestMethod.HEAD]: 'HEAD',
    };
    const trim = (p: string) => (p ?? '').replace(/^\/+|\/+$/g, '');

    interface Route {
      key: string;
      method: string;
      controller: string;
      path: string;
      marker: string | undefined;
      superadmin: boolean;
      handler: Function;
    }
    function allRoutes(): Route[] {
      const out: Route[] = [];
      const modules = h.app.get(ModulesContainer);
      const seen = new Set<Function>();
      for (const mod of modules.values()) {
        for (const wrapper of mod.controllers.values()) {
          const ctrl = wrapper.metatype as Function;
          if (!ctrl || seen.has(ctrl)) continue;
          seen.add(ctrl);
          const base = trim(Reflect.getMetadata('path', ctrl));
          const classMarker = Reflect.getMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, ctrl);
          const classRoles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, ctrl);
          for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
            const handler = ctrl.prototype[name];
            const m = Reflect.getMetadata('method', handler);
            if (m === undefined) continue;
            const method = METHODS[m];
            const sub = trim(Reflect.getMetadata('path', handler));
            const roles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, handler) ?? classRoles;
            out.push({
              key: `${method} ${base}/${sub}`.replace(/^(\w+) \//, '$1 '),
              method,
              controller: base,
              path: sub,
              marker: Reflect.getMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, handler) ?? classMarker,
              superadmin: !!roles && roles.includes('superadmin'),
              handler,
            });
          }
        }
      }
      return out;
    }

    it('finds the controllers (sanity)', () => {
      const routes = allRoutes();
      expect(routes.length).toBeGreaterThan(80);
      expect(routes.map((r) => r.key)).toEqual(expect.arrayContaining(['POST billing/orders', 'POST streams/:id/start', 'POST accounts/']));
    });

    it('every superadmin controller is @Roles(SUPERADMIN): that is what keeps the admin as the real principal on them', () => {
      const bad = allRoutes().filter((r) => r.controller.startsWith('superadmin') && !r.superadmin);
      expect(bad.map((r) => r.key)).toEqual([]);
    });

    it('every mutating route of the sensitive modules has a marker or a documented exemption', () => {
      const SENSITIVE = ['billing', 'auth', 'accounts', 'account', 'platform-connections', 'team'];
      const unmarked = allRoutes().filter(
        (r) => SENSITIVE.includes(r.controller) && r.method !== 'GET' && r.method !== 'HEAD' && !r.marker && !IMPERSONATION_EXEMPT_ROUTES[r.key],
      );
      expect(unmarked.map((r) => r.key)).toEqual([]);
    });

    it('OAuth "connect"/"callback" GET routes (side effects on a GET) are marked too', () => {
      const bad = allRoutes().filter((r) => r.controller === 'platform-connections' && r.method === 'GET' && /connect|callback/.test(r.path) && !r.marker);
      expect(bad.map((r) => r.key)).toEqual([]);
    });

    it('go-live routes (stream start/create, retry, host token, preset start) are marked', () => {
      const must = [
        'POST streams/',
        'POST streams/:id/start',
        'POST streams/:id/destinations/:destinationId/retry',
        'POST studio-sessions/:id/host-token',
        'POST presets/:id/start',
      ];
      const routes = allRoutes();
      for (const key of must) {
        const r = routes.find((x) => x.key === key);
        expect(r?.key).toBe(key);
        expect(r?.marker).toBe('go-live');
      }
    });

    it('any other route whose path smells like start / token / password / key / credentials is marked or explicitly exempt', () => {
      const SMELLS = /(^|[/:-])(start|token|host-token|password|api-?key|credentials?|secret|mfa|otp|connect|disconnect|callback|login)($|[/-])/i;
      const EXEMPT_PUBLIC = new Set([
        // Public guest-link endpoints and the signature-checked webhook: no account principal at all.
        'POST studio-sessions/invites/:token/check-password',
        'GET studio-sessions/invites/:token',
        'GET studio-sessions/turn-credentials',
      ]);
      const hits = allRoutes().filter(
        (r) =>
          !r.superadmin &&
          !r.marker &&
          r.method !== 'HEAD' &&
          SMELLS.test(`${r.controller}/${r.path}`.replace(/^\//, '')) &&
          // Plain reads are covered by view/act mode; only things with side effects matter here.
          (r.method !== 'GET' || /connect|callback|start/.test(r.path)) &&
          !IMPERSONATION_EXEMPT_ROUTES[r.key] &&
          !EXEMPT_PUBLIC.has(r.key) &&
          // Sign-in routes live under auth/ and are listed (or fail the previous test).
          r.controller !== 'auth',
      );
      expect(hits.map((r) => r.key)).toEqual([]);
    });

    it('every exemption is a real route (no stale entries) and has a reason', () => {
      const keys = new Set(allRoutes().map((r) => r.key));
      for (const [key, reason] of Object.entries(IMPERSONATION_EXEMPT_ROUTES)) {
        expect(keys.has(key)).toBe(true);
        expect(reason.length).toBeGreaterThan(10);
      }
    });
  });

  // Throttle test goes last: the limit is per IP and shared by the whole file.
  it('starting sessions is rate limited', async () => {
    const { accountId } = await h.signIn();
    let limited = false;
    for (let i = 0; i < 80 && !limited; i++) {
      limited = (await start(admin, { accountId, mode: 'view' })).status === 429;
    }
    expect(limited).toBe(true);
  });
});
