import { Client as PgClient } from 'pg';
import { E2E_DATABASE_URL, describeE2E } from './harness';
import { runMigrations } from '../../src/config/migrate';

/**
 * Reproduces "production before migration N, with real rows" and applies the
 * rest -- the only way to know a migration is safe for existing data.
 */
describeE2E('migrations: applying 0012+ on top of existing data', () => {
  const dbName = `e2e_migrate_${Date.now()}`;
  const urlFor = (db: string) => {
    const u = new URL(E2E_DATABASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const adminUrl = urlFor('postgres');

  beforeAll(async () => {
    const admin = new PgClient({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
  });
  afterAll(async () => {
    const admin = new PgClient({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  it('keeps every existing account on its tier, turns a hand-edited allowance into an override, and is re-runnable', async () => {
    const url = urlFor(dbName);
    await runMigrations(url, { upTo: '0011', quiet: true });

    const db = new PgClient({ connectionString: url });
    await db.connect();
    await db.query(
      `INSERT INTO accounts (name, api_key_hash, current_tier, included_hours_per_month) VALUES
        ('a-free', 'h1', 'free', 2), ('b-pro-default', 'h2', 'pro', 30), ('c-pro-custom', 'h3', 'pro', 55), ('d-ent', 'h4', 'enterprise', 100)`,
    );

    await runMigrations(url, { quiet: true }); // 0012 onwards
    await runMigrations(url, { quiet: true }); // and again: nothing left to do, no error

    const { rows } = await db.query('SELECT name, plan_key, included_hours_override AS ov, plan_expires_at FROM accounts ORDER BY name');
    expect(rows.map((r) => [r.name, r.plan_key, r.ov === null ? null : Number(r.ov), r.plan_expires_at])).toEqual([
      ['a-free', 'free', null, null],
      ['b-pro-default', 'pro', null, null],
      ['c-pro-custom', 'pro', 55, null],
      ['d-ent', 'enterprise', null, null],
    ]);

    const plans = await db.query('SELECT key, included_hours_per_month AS h, max_destinations AS d, max_guests AS g, price_inr AS p FROM plans ORDER BY sort_order');
    expect(plans.rows.map((r) => [r.key, r.h === null ? null : Number(r.h), r.d, r.g, r.p])).toEqual([
      ['free', 2, 1, 2, 0],
      ['starter', 20, 2, 4, 999],
      ['pro', null, 4, 8, 1999],
      ['enterprise', null, 8, 10, 4999],
      ['day_pass', null, 4, 10, 199],
    ]);

    // The ladder is moved only while a plan still has its seeded values: an admin-edited plan is left alone.
    await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0015%'`);
    await db.query(`UPDATE plans SET included_hours_per_month = 25, price_inr = 1099 WHERE key = 'starter'`);
    await runMigrations(url, { quiet: true });
    const edited = await db.query(`SELECT included_hours_per_month AS h, price_inr AS p FROM plans WHERE key = 'starter'`);
    expect([Number(edited.rows[0].h), edited.rows[0].p]).toEqual([25, 1099]);

    const settings = await db.query(`SELECT value FROM app_settings WHERE key = 'payments_enabled'`);
    expect(settings.rows[0].value).toBe(false); // payments ship OFF
    await expect(db.query(`SELECT razorpay_plan_id, razorpay_plan_amount_paise FROM plans LIMIT 1`)).resolves.toBeDefined();
    await expect(db.query(`SELECT count(*) FROM subscriptions`)).resolves.toBeDefined();
    await db.end();
  });
});
