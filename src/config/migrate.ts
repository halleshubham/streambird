import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

/**
 * Minimal migration runner: applies migrations/*.sql in filename order,
 * tracking what's been applied in schema_migrations. The schema is owned
 * by these hand-written SQL files, not by TypeORM (synchronize is off).
 */
/**
 * `upTo` (a migration filename or its numeric prefix, inclusive) stops early --
 * used by tests to reproduce "production before migration N" and then apply
 * the rest. Omit it for the normal "apply everything" behaviour.
 */
export async function runMigrations(databaseUrl: string | undefined = process.env.DATABASE_URL, opts: { upTo?: string; quiet?: boolean } = {}) {
  const log = (msg: string) => {
    if (!opts.quiet) console.log(msg);
  };
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const migrationsDir = join(__dirname, '..', '..', 'migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => !opts.upTo || f <= opts.upTo || f.startsWith(opts.upTo));

    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(rows.map((r: { filename: string }) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        log(`skip  ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      log(`apply ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

// Run as a script (`npm run migrate`, the container's start command), not when imported by tests.
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('migrations up to date');
      process.exit(0);
    })
    .catch((err) => {
      console.error('migration failed:', err);
      process.exit(1);
    });
}
