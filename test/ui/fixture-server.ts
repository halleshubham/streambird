/**
 * Test fixture for the browser tests (run by Playwright's webServer): boots the
 * REAL app on a fixed port against E2E_DATABASE_URL, serving the built SPA
 * (dist-web), with a captured mailbox and a mock Razorpay. A second tiny HTTP
 * server exposes the two things a browser can't get for itself:
 *   GET  /code?email=...      the latest login code "emailed" to that address
 *   POST /approve?email=...   approve that user (&superadmin=1 to promote)
 *   POST /set-usage?email=...&hours=N[&plan=key]   set that user's account hours used + plan
 *   POST /add-connection?email=...&platform=youtube|facebook&label=...   connect a (fake) channel/page to that user's account
 * It is test-only and never part of the product.
 */
import * as http from 'http';
import { bootApp } from '../e2e/harness';

const APP_PORT = Number(process.env.UI_APP_PORT ?? 4310);
const CONTROL_PORT = Number(process.env.UI_CONTROL_PORT ?? 4311);

import { hashPassword } from '../../src/auth/password.util';
import { PlatformConnectionsService } from '../../src/platform-connections/platform-connections.service';

async function main() {
  const h = await bootApp({ razorpay: true, mediamtx: true, port: APP_PORT });

  http
    .createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const email = url.searchParams.get('email') ?? '';
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/ready') return send(200, { ok: true });
      if (url.pathname === '/code') return send(200, { code: h.mailbox.codes.get(email) ?? null });
      if (url.pathname === '/approve' && req.method === 'POST') {
        const role = url.searchParams.get('superadmin') ? ", role = 'superadmin'" : '';
        const r = await h.db.query(`UPDATE users SET approved_at = now(), phone_required = false${role} WHERE email = $1`, [email]);
        return send(200, { updated: r.rowCount });
      }
      if (url.pathname === '/make-superadmin' && req.method === 'POST') {
        const r = await h.db.query(`UPDATE users SET role = 'superadmin', approved_at = now(), password_hash = $2 WHERE email = $1`, [email, hashPassword(url.searchParams.get('password') ?? '')]);
        return send(200, { updated: r.rowCount });
      }
      if (url.pathname === '/set-usage' && req.method === 'POST') {
        const r = await h.db.query(`UPDATE accounts SET stream_hour_usage_current_period = $2, plan_key = $3 WHERE id = (SELECT account_id FROM users WHERE email = $1)`, [email, url.searchParams.get('hours') ?? '0', url.searchParams.get('plan') ?? 'pro']);
        return send(200, { updated: r.rowCount });
      }
      if (url.pathname === '/add-connection' && req.method === 'POST') {
        const { rows } = await h.db.query('SELECT account_id FROM users WHERE email = $1', [email]);
        if (!rows.length) return send(404, { error: 'no such user' });
        const svc = h.app.get(PlatformConnectionsService);
        const label = url.searchParams.get('label') ?? 'Test channel';
        const ext = `ui${Date.now()}`;
        const c =
          url.searchParams.get('platform') === 'facebook'
            ? await svc.upsertFacebookConnection(rows[0].account_id, { pageId: ext, pageName: label }, 'page-token')
            : await svc.upsertYouTubeConnection(rows[0].account_id, { channelId: ext, channelTitle: label }, { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
        return send(200, { id: c.id, liveSlug: c.liveSlug });
      }
      send(404, { error: 'not found' });
    })
    .listen(CONTROL_PORT, '127.0.0.1');

  const stop = async () => {
    await h.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
