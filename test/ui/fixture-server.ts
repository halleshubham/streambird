/**
 * Test fixture for the browser tests (run by Playwright's webServer): boots the
 * REAL app on a fixed port against E2E_DATABASE_URL, serving the built SPA
 * (dist-web), with a captured mailbox and a mock Razorpay. A second tiny HTTP
 * server exposes the two things a browser can't get for itself:
 *   GET  /code?email=...      the latest login code "emailed" to that address
 *   POST /approve?email=...   approve that user (&superadmin=1 to promote)
 * It is test-only and never part of the product.
 */
import * as http from 'http';
import { bootApp } from '../e2e/harness';

const APP_PORT = Number(process.env.UI_APP_PORT ?? 4310);
const CONTROL_PORT = Number(process.env.UI_CONTROL_PORT ?? 4311);

import { hashPassword } from '../../src/auth/password.util';

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
        const r = await h.db.query(`UPDATE users SET approved_at = now()${role} WHERE email = $1`, [email]);
        return send(200, { updated: r.rowCount });
      }
      if (url.pathname === '/make-superadmin' && req.method === 'POST') {
        const r = await h.db.query(`UPDATE users SET role = 'superadmin', approved_at = now(), password_hash = $2 WHERE email = $1`, [email, hashPassword(url.searchParams.get('password') ?? '')]);
        return send(200, { updated: r.rowCount });
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
