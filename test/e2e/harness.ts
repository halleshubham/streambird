import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as crypto from 'crypto';
import * as http from 'http';
import * as net from 'net';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { runMigrations } from '../../src/config/migrate';
import { EMAIL_SERVICE } from '../../src/email/email.interface';
import { MockRazorpay, RZP } from './mock-razorpay';

/**
 * End-to-end tests need a real Postgres: set E2E_DATABASE_URL (CI provides a
 * service container; locally e.g. postgres://user:pass@localhost:5432/streambird_e2e).
 * Without it they are skipped, so `npm test` and a fresh checkout stay green.
 */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
/** `describe` when a database is configured, else `describe.skip` (resolved when called, so non-Jest importers like the UI fixture are fine). */
export function describeE2E(name: string, fn: () => void): void {
  (E2E_DATABASE_URL ? describe : describe.skip)(name, fn);
}

/** Captures what the app would have emailed, instead of calling Resend. */
export class Mailbox {
  codes = new Map<string, string>();
  receipts: Array<{ to: string; data: any }> = [];
  notices: Array<{ to: string; subject: string; text: string }> = [];

  sendLoginCode = async (to: string, code: string) => void this.codes.set(to, code);
  sendTeamInvite = async () => undefined;
  sendStreamInvite = async () => undefined;
  sendPaymentReceipt = async (to: string, data: any) => void this.receipts.push({ to, data });
  sendBillingNotice = async (to: string, subject: string, text: string) => void this.notices.push({ to, subject, text });
}

export interface Reply<T = any> {
  status: number;
  body: T;
}

/** A browser-like HTTP client: keeps cookies, sends the Origin header the CSRF check requires. */
export class Client {
  private cookies = new Map<string, string>();
  constructor(private readonly baseUrl: string) {}

  async call<T = any>(
    method: string,
    path: string,
    opts: { body?: unknown; raw?: Buffer | string; headers?: Record<string, string> } = {},
  ): Promise<Reply<T>> {
    const headers: Record<string, string> = {
      Origin: this.baseUrl,
      'Content-Type': 'application/json',
      ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      ...opts.headers,
    };
    const payload = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const res = await fetch(`${this.baseUrl}/api${path}`, { method, headers, body: payload as any });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const text = await res.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: res.status, body };
  }

  get = <T = any>(path: string) => this.call<T>('GET', path);
  post = <T = any>(path: string, body?: unknown) => this.call<T>('POST', path, { body });
  patch = <T = any>(path: string, body?: unknown) => this.call<T>('PATCH', path, { body });
  del = <T = any>(path: string) => this.call<T>('DELETE', path);
}

export interface Harness {
  app: INestApplication;
  baseUrl: string;
  db: Pool;
  mailbox: Mailbox;
  razorpay: MockRazorpay | null;
  /** Signs a brand-new user in (email-code flow) and approves them; optionally as superadmin. */
  signIn(opts?: { superadmin?: boolean; email?: string }): Promise<{ client: Client; email: string; accountId: string }>;
  close(): Promise<void>;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

/** Boots the real AppModule + production pipeline on a free port, against E2E_DATABASE_URL (migrated first). */
export async function bootApp(opts: { razorpay?: boolean; port?: number; mediamtx?: boolean } = {}): Promise<Harness> {
  await runMigrations(E2E_DATABASE_URL, { quiet: true });

  const razorpay = opts.razorpay ? new MockRazorpay() : null;
  if (razorpay) await razorpay.start();
  // MediaMTX stand-in (path registration only): streams then get a publish URL, as in production.
  let mtx: http.Server | null = null;
  let mtxUrl = '';
  if (opts.mediamtx) {
    mtx = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => mtx!.listen(0, '127.0.0.1', r));
    mtxUrl = `http://127.0.0.1:${(mtx.address() as net.AddressInfo).port}`;
  }
  const port = opts.port ?? (await freePort());
  const baseUrl = `http://127.0.0.1:${port}`;

  Object.assign(process.env, {
    DATABASE_URL: E2E_DATABASE_URL,
    ENCRYPTION_KEY_BASE64: crypto.randomBytes(32).toString('base64'),
    PUBLIC_BASE_URL: baseUrl,
    NODE_ENV: 'test',
    LEGACY_HOSTS: '',
    RAZORPAY_KEY_ID: razorpay ? RZP.keyId : '',
    RAZORPAY_KEY_SECRET: razorpay ? RZP.keySecret : '',
    RAZORPAY_WEBHOOK_SECRET: razorpay ? RZP.webhookSecret : '',
    RAZORPAY_API_BASE: razorpay ? razorpay.url : 'https://api.razorpay.com/v1',
    RAZORPAY_GRACE_DAYS: '3',
    MEDIAMTX_API_URL: mtxUrl,
    MEDIAMTX_WHIP_BASE_URL: mtxUrl,
  });

  // NestFactory.create, exactly like main.ts (a Test module would pick the no-op static-file loader:
  // it is chosen before an HTTP adapter exists, so the SPA would not be served).
  const mailbox = new Mailbox();
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error'] });
  configureApp(app);
  // NODE_ENV is not 'production', so the app runs its logging FakeEmailService; capture instead of logging.
  Object.assign(app.get(EMAIL_SERVICE) as object, {
    sendLoginCode: mailbox.sendLoginCode,
    sendPaymentReceipt: mailbox.sendPaymentReceipt,
    sendBillingNotice: mailbox.sendBillingNotice,
  });
  await app.listen(port, '127.0.0.1');

  const db = new Pool({ connectionString: E2E_DATABASE_URL });

  const signIn: Harness['signIn'] = async (o = {}) => {
    const email = o.email ?? `e2e-${crypto.randomBytes(5).toString('hex')}@test.dev`;
    const client = new Client(baseUrl);
    await client.post('/auth/request-code', { email });
    const verified = await client.post('/auth/verify-code', { email, code: mailbox.codes.get(email) });
    if (verified.status !== 200) throw new Error(`sign-in failed: ${verified.status} ${JSON.stringify(verified.body)}`);
    await db.query(`UPDATE users SET approved_at = now()${o.superadmin ? ", role = 'superadmin'" : ''} WHERE email = $1`, [email]);
    const { rows } = await db.query('SELECT account_id FROM users WHERE email = $1', [email]);
    return { client, email, accountId: rows[0].account_id };
  };

  return {
    app,
    baseUrl,
    db,
    mailbox,
    razorpay,
    signIn,
    close: async () => {
      await app.close();
      await db.end();
      if (razorpay) await razorpay.stop();
      if (mtx) await new Promise((r) => mtx!.close(r));
    },
  };
}

/** A per-run id generator (`pay('A')` -> `pay_<run>_A`): a reused test database must never see a colliding Razorpay id. */
export function ids(prefix: string): (name: string | number) => string {
  const run = crypto.randomBytes(3).toString('hex');
  return (name) => `${prefix}_${run}_${name}`;
}

/** Puts the billing-related settings back to a known state so test files don't depend on each other's leftovers. */
export async function resetBillingState(db: Pool): Promise<void> {
  await db.query(`UPDATE app_settings SET value = 'false'::jsonb WHERE key = 'payments_enabled'`);
  await db.query('UPDATE plans SET razorpay_plan_id = NULL, razorpay_plan_amount_paise = NULL');
}
