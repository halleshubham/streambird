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

    await db.query(`INSERT INTO users (email, account_id) SELECT 'old-user@e2e.test', id FROM accounts WHERE name = 'a-free'`);

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
      ['free', 5, 1, 2, 0],
      ['lite', 8, 1, 3, 299],
      ['starter', 20, 2, 4, 999],
      ['pro', 200, 4, 8, 1999],
      ['enterprise', 200, 8, 10, 4999],
      ['day_pass', null, 4, 10, 199],
    ]);

    // The ladder is moved only while a plan still has its seeded values: an admin-edited plan is left alone.
    await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0015%'`);
    await db.query(`UPDATE plans SET included_hours_per_month = 25, price_inr = 1099 WHERE key = 'starter'`);
    await runMigrations(url, { quiet: true });
    const edited = await db.query(`SELECT included_hours_per_month AS h, price_inr AS p FROM plans WHERE key = 'starter'`);
    expect([Number(edited.rows[0].h), edited.rows[0].p]).toEqual([25, 1099]);

    // 2K tier (0017): Pro and Business move up from the seeded Full HD; the rest stay; an admin-edited plan is left alone.
    const q = await db.query(`SELECT key, max_resolution FROM plans ORDER BY sort_order`);
    expect(q.rows.map((r) => [r.key, r.max_resolution])).toEqual([['free', 'fhd'], ['lite', 'fhd'], ['starter', 'fhd'], ['pro', 'qhd'], ['enterprise', 'qhd'], ['day_pass', 'hd']]);
    await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0017%'`);
    await db.query(`UPDATE plans SET max_resolution = 'hd' WHERE key = 'pro'`);
    await db.query(`UPDATE plans SET max_resolution = 'fhd' WHERE key = 'enterprise'`);
    await runMigrations(url, { quiet: true });
    const q2 = await db.query(`SELECT key, max_resolution FROM plans WHERE key IN ('pro', 'enterprise') ORDER BY sort_order`);
    expect(q2.rows.map((r) => [r.key, r.max_resolution])).toEqual([['pro', 'hd'], ['enterprise', 'qhd']]);
    await expect(db.query(`UPDATE plans SET max_resolution = 'bogus' WHERE key = 'free'`)).rejects.toThrow();

    // Recording (0018): Pro and Business get it, the rest do not; an admin's later choice survives a re-run.
    const rec = await db.query(`SELECT key, can_record FROM plans ORDER BY sort_order`);
    expect(rec.rows.map((r) => [r.key, r.can_record])).toEqual([['free', false], ['lite', false], ['starter', false], ['pro', true], ['enterprise', true], ['day_pass', false]]);
    await db.query(`UPDATE plans SET can_record = false WHERE key = 'pro'`);
    await runMigrations(url, { quiet: true });
    expect((await db.query(`SELECT can_record FROM plans WHERE key = 'pro'`)).rows[0].can_record).toBe(false);

    // Green screen (0019): Pro and Business get it, the rest do not; an admin's later choice survives a re-run.
    const chroma = await db.query(`SELECT key, can_chroma_key FROM plans ORDER BY sort_order`);
    expect(chroma.rows.map((r) => [r.key, r.can_chroma_key])).toEqual([['free', false], ['lite', false], ['starter', false], ['pro', true], ['enterprise', true], ['day_pass', false]]);
    await db.query(`UPDATE plans SET can_chroma_key = false WHERE key = 'pro'`);
    await runMigrations(url, { quiet: true });
    expect((await db.query(`SELECT can_chroma_key FROM plans WHERE key = 'pro'`)).rows[0].can_chroma_key).toBe(false);

    // Lower thirds (0021): Pro and Business get them, the rest do not; an admin's later choice survives a re-run.
    const lt = await db.query(`SELECT key, can_lower_third FROM plans ORDER BY sort_order`);
    expect(lt.rows.map((r) => [r.key, r.can_lower_third])).toEqual([['free', false], ['lite', false], ['starter', false], ['pro', true], ['enterprise', true], ['day_pass', false]]);
    await db.query(`UPDATE plans SET can_lower_third = false WHERE key = 'pro'`);
    await runMigrations(url, { quiet: true });
    expect((await db.query(`SELECT can_lower_third FROM plans WHERE key = 'pro'`)).rows[0].can_lower_third).toBe(false);

    // Brand storage and the watermark (0022): paid plans get an allowance, Free shows the mark; an admin's edit survives a re-run.
    const st = await db.query(`SELECT key, asset_storage_mb, watermark FROM plans ORDER BY sort_order`);
    expect(st.rows.map((r) => [r.key, r.asset_storage_mb, r.watermark])).toEqual([['free', 0, true], ['lite', 0, false], ['starter', 50, false], ['pro', 500, false], ['enterprise', 2048, false], ['day_pass', 0, false]]);
    await db.query(`UPDATE plans SET asset_storage_mb = 800, watermark = false WHERE key IN ('pro', 'free')`);
    await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0022%'`);
    await runMigrations(url, { quiet: true });
    expect((await db.query(`SELECT asset_storage_mb FROM plans WHERE key = 'pro'`)).rows[0].asset_storage_mb).toBe(800);

    // Asset library and brand kits (0023, 0024): a file in use cannot be deleted, deleting a kit frees its connections.
    const acct = (await db.query(`SELECT id FROM accounts LIMIT 1`)).rows[0].id;
    const asset = (await db.query(`INSERT INTO assets (account_id, kind, name, content_type, size_bytes, width, height, storage_key) VALUES ($1, 'logo', 'l', 'image/png', 10, 1, 1, 'k') RETURNING id`, [acct])).rows[0].id;
    const kit = (await db.query(`INSERT INTO brand_kits (account_id, name, logo_asset_id, is_default) VALUES ($1, 'Main', $2, true) RETURNING id`, [acct, asset])).rows[0].id;
    await expect(db.query(`DELETE FROM assets WHERE id = $1`, [asset])).rejects.toThrow();
    await expect(db.query(`INSERT INTO brand_kits (account_id, name, is_default) VALUES ($1, 'Second default', true)`, [acct])).rejects.toThrow(); // one default per account
    await expect(db.query(`INSERT INTO assets (account_id, kind, name, content_type, size_bytes, width, height, storage_key) VALUES ($1, 'video', 'v', 'x', 1, 1, 1, 'k2')`, [acct])).rejects.toThrow();
    await db.query(`DELETE FROM brand_kits WHERE id = $1`, [kit]);
    await db.query(`DELETE FROM assets WHERE id = $1`, [asset]);
    await expect(db.query(`SELECT brand_kit_id FROM platform_connections LIMIT 1`)).resolves.toBeDefined();

    // Pricing refresh (0025): Lite exists, Free has 5 hours, Pro and Business include 200; an admin's edits survive a re-run.
    const ph = await db.query(`SELECT key, included_hours_per_month AS h FROM plans WHERE key IN ('free', 'lite', 'pro', 'enterprise') ORDER BY sort_order`);
    expect(ph.rows.map((r) => [r.key, Number(r.h)])).toEqual([['free', 5], ['lite', 8], ['pro', 200], ['enterprise', 200]]);
    expect((await db.query(`SELECT included_hours_per_month AS h FROM accounts WHERE name = 'a-free'`)).rows[0].h).toBe('5.00'); // the account mirror followed
    await db.query(`UPDATE plans SET included_hours_per_month = 3 WHERE key = 'free'`); // admin edits Free,
    await db.query(`UPDATE plans SET included_hours_per_month = 50 WHERE key = 'pro'`); // Pro,
    await db.query(`UPDATE plans SET price_inr = 349, included_hours_per_month = 12 WHERE key = 'lite'`); // and Lite
    await db.query(`UPDATE plans SET included_hours_per_month = NULL WHERE key = 'enterprise'`); // and leaves Business unlimited (still seeded: gets the cap)
    await db.query(`UPDATE accounts SET included_hours_override = 7 WHERE name = 'c-pro-custom'`);
    await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0025%'`);
    await runMigrations(url, { quiet: true });
    const kept = await db.query(`SELECT key, included_hours_per_month AS h, price_inr AS p FROM plans WHERE key IN ('free', 'lite', 'pro', 'enterprise') ORDER BY sort_order`);
    expect(kept.rows.map((r) => [r.key, Number(r.h), r.p])).toEqual([['free', 3, 0], ['lite', 12, 349], ['pro', 50, 1999], ['enterprise', 200, 4999]]); // edits kept, only the still-unlimited plan moved
    const mirror = await db.query(`SELECT name, included_hours_per_month AS h FROM accounts WHERE name IN ('a-free', 'b-pro-default', 'c-pro-custom') ORDER BY name`);
    expect(mirror.rows.map((r) => [r.name, Number(r.h)])).toEqual([['a-free', 3], ['b-pro-default', 50], ['c-pro-custom', 7]]); // override first, then the plan's hours
    expect((await db.query(`SELECT count(*)::int AS n FROM plans WHERE key = 'lite'`)).rows[0].n).toBe(1); // Lite is never duplicated

    // Mobile numbers (0020): people who signed up before are never flagged to be asked; the columns survive a re-run.
    const before = await db.query(`SELECT phone, phone_required FROM users`);
    expect(before.rows).toEqual([{ phone: null, phone_required: false }]);
    await db.query(`UPDATE users SET phone = '+919876543210'`);
    await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0020%'`);
    await runMigrations(url, { quiet: true });
    expect((await db.query(`SELECT DISTINCT phone FROM users`)).rows.map((r) => r.phone)).toEqual(['+919876543210']);

    const settings = await db.query(`SELECT value FROM app_settings WHERE key = 'payments_enabled'`);
    expect(settings.rows[0].value).toBe(false); // payments ship OFF
    await expect(db.query(`SELECT razorpay_plan_id, razorpay_plan_amount_paise FROM plans LIMIT 1`)).resolves.toBeDefined();
    await expect(db.query(`SELECT count(*) FROM subscriptions`)).resolves.toBeDefined();
    await db.end();
  });

  it('0026 gives every existing YouTube/Facebook connection a unique live-link slug, leaves Twitch without, and is re-runnable', async () => {
    const live = `${dbName}_slug`;
    const admin = new PgClient({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${live}`);
    await admin.end();
    const url = urlFor(live);
    try {
      await runMigrations(url, { upTo: '0025', quiet: true });
      const db = new PgClient({ connectionString: url });
      await db.connect();
      const acct = (await db.query(`INSERT INTO accounts (name, api_key_hash) VALUES ('slug-acct', 'slug-hash') RETURNING id`)).rows[0].id;
      const rows: [string, string, boolean][] = [];
      for (let i = 0; i < 60; i++) rows.push([i % 3 === 0 ? 'youtube' : i % 3 === 1 ? 'facebook' : 'twitch', `ext-${i}`, i % 10 !== 0]);
      for (const [platform, ext, active] of rows) {
        await db.query(
          `INSERT INTO platform_connections (account_id, platform, credentials_ciphertext, external_account_id, label, is_active)
           VALUES ($1, $2::platform_enum, '\\x00', $3, $3, $4)`,
          [acct, platform, ext, active],
        );
      }

      await runMigrations(url, { quiet: true });
      await runMigrations(url, { quiet: true }); // no-op the second time

      const all = await db.query(`SELECT platform, live_slug, is_active FROM platform_connections`);
      const linked = all.rows.filter((r) => r.platform !== 'twitch');
      expect(linked).toHaveLength(40);
      for (const r of linked) expect(r.live_slug).toMatch(/^[0-9a-f]{10}$/); // deactivated ones too: a reconnect keeps its link
      expect(new Set(linked.map((r) => r.live_slug)).size).toBe(40);
      expect(all.rows.filter((r) => r.platform === 'twitch').every((r) => r.live_slug === null)).toBe(true);

      // A re-run (or a forced re-apply) never changes an existing slug.
      const before = new Map((await db.query(`SELECT id, live_slug FROM platform_connections`)).rows.map((r) => [r.id, r.live_slug]));
      await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0026%'`);
      await runMigrations(url, { quiet: true });
      const after = (await db.query(`SELECT id, live_slug FROM platform_connections`)).rows;
      for (const r of after) expect(r.live_slug).toBe(before.get(r.id));

      // Unique, and many NULLs are fine (the twitch rows have none).
      await expect(db.query(`UPDATE platform_connections SET live_slug = $1 WHERE id = (SELECT id FROM platform_connections WHERE platform = 'twitch' LIMIT 1)`, [linked[0].live_slug])).rejects.toThrow();
      await db.end();
    } finally {
      const a2 = new PgClient({ connectionString: adminUrl });
      await a2.connect();
      await a2.query(`DROP DATABASE IF EXISTS ${live}`);
      await a2.end();
    }
  });

  it('0027 keeps existing library files and kits, allows the new asset kind "ad", and ads are one per placement and protect their file', async () => {
    const live = `e2e_migrate_ads_${Date.now()}`;
    const admin = new PgClient({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${live}`);
    await admin.end();
    try {
      const url = urlFor(live);
      await runMigrations(url, { upTo: '0026', quiet: true });
      const db = new PgClient({ connectionString: url });
      await db.connect();
      // Production before 0027: an account with a logo, a wallpaper and a kit using both.
      const acct = (await db.query(`INSERT INTO accounts (name, api_key_hash, current_tier, included_hours_per_month) VALUES ('ads-acct', 'hads', 'pro', 30) RETURNING id`)).rows[0].id;
      const logo = (await db.query(`INSERT INTO assets (account_id, kind, name, content_type, size_bytes, width, height, storage_key) VALUES ($1, 'logo', 'l', 'image/png', 10, 1, 1, 'k1') RETURNING id`, [acct])).rows[0].id;
      const wall = (await db.query(`INSERT INTO assets (account_id, kind, name, content_type, size_bytes, width, height, storage_key) VALUES ($1, 'wallpaper', 'w', 'image/png', 10, 1, 1, 'k2') RETURNING id`, [acct])).rows[0].id;
      const kit = (await db.query(`INSERT INTO brand_kits (account_id, name, logo_asset_id, wallpaper_asset_id, is_default) VALUES ($1, 'Main', $2, $3, true) RETURNING id`, [acct, logo, wall])).rows[0].id;
      await expect(db.query(`INSERT INTO assets (account_id, kind, name, content_type, size_bytes, width, height, storage_key) VALUES ($1, 'ad', 'a', 'image/png', 10, 1, 1, 'k3')`, [acct])).rejects.toThrow(); // not allowed yet

      await runMigrations(url, { quiet: true });
      await runMigrations(url, { quiet: true }); // re-run: no-op
      await db.query(`DELETE FROM schema_migrations WHERE filename LIKE '0027%'`);
      await runMigrations(url, { quiet: true }); // forced re-apply: still fine

      // Existing rows are untouched and the kit has no ads.
      expect((await db.query(`SELECT kind FROM assets WHERE account_id = $1 ORDER BY kind`, [acct])).rows.map((r) => r.kind)).toEqual(['logo', 'wallpaper']);
      expect((await db.query(`SELECT logo_asset_id, wallpaper_asset_id FROM brand_kits WHERE id = $1`, [kit])).rows[0]).toEqual({ logo_asset_id: logo, wallpaper_asset_id: wall });
      expect((await db.query(`SELECT count(*)::int AS n FROM brand_kit_ads`)).rows[0].n).toBe(0);
      await expect(db.query(`INSERT INTO assets (account_id, kind, name, content_type, size_bytes, width, height, storage_key) VALUES ($1, 'video', 'v', 'x', 1, 1, 1, 'k4')`, [acct])).rejects.toThrow(); // other kinds still refused

      const ad = (await db.query(`INSERT INTO assets (account_id, kind, name, content_type, size_bytes, width, height, storage_key) VALUES ($1, 'ad', 'a', 'image/gif', 10, 1, 1, 'k5') RETURNING id`, [acct])).rows[0].id;
      const insertAd = (placement: string, mode = 'continuous', show: number | null = null, every: number | null = null) =>
        db.query(`INSERT INTO brand_kit_ads (brand_kit_id, placement, asset_id, mode, show_sec, every_sec) VALUES ($1, $2, $3, $4, $5, $6)`, [kit, placement, ad, mode, show, every]);
      await insertAd('lower_third', 'interval', 15, 180);
      await expect(insertAd('lower_third')).rejects.toThrow(); // one ad per placement
      await expect(insertAd('top_banner')).rejects.toThrow(); // unknown placement
      await expect(insertAd('side_third', 'sometimes')).rejects.toThrow(); // unknown mode
      await expect(insertAd('side_third', 'interval', 15, null)).rejects.toThrow(); // interval needs both numbers
      await expect(insertAd('side_third', 'interval', 0, 10)).rejects.toThrow(); // range
      await expect(insertAd('side_third', 'interval', 10, 86401)).rejects.toThrow();
      await insertAd('side_third');
      await expect(db.query(`DELETE FROM assets WHERE id = $1`, [ad])).rejects.toThrow(); // RESTRICT: a file in use stays
      await db.query(`DELETE FROM brand_kits WHERE id = $1`, [kit]); // the kit's ads go with it
      expect((await db.query(`SELECT count(*)::int AS n FROM brand_kit_ads`)).rows[0].n).toBe(0);
      await db.query(`DELETE FROM assets WHERE id = $1`, [ad]);
      await db.end();
    } finally {
      const a2 = new PgClient({ connectionString: adminUrl });
      await a2.connect();
      await a2.query(`DROP DATABASE IF EXISTS ${live}`);
      await a2.end();
    }
  });
});
