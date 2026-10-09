---
name: streambird-add-migration
description: Add a database change to StreamBird (new column/table/index/constraint/seed) with a hand-written SQL migration, entity wiring and an existing-data test. Use whenever the schema changes.
---

# Adding a migration

Schema is owned by `migrations/*.sql` (TypeORM `synchronize` is **off**). `src/config/migrate.ts` applies unapplied files in filename order, each in a transaction, recorded in `schema_migrations`. The Docker CMD runs it on **every container start**, so a deploy applies your migration — and a bad one fails the deploy.

## Steps
1. **Name**: next number after the highest in `migrations/` (currently 0016 → `0017_<what>.sql`), lowercase snake case. Never edit an applied migration; add a new one.
2. **Write SQL** with a header comment saying *why*. Rules:
   - **Backward compatible** with the previous release (rollbacks do not undo schema): add columns nullable or with a `DEFAULT`; add `NOT NULL` only with a default/backfill in the same file; drop/rename in a later release.
   - Backfill existing rows explicitly (see `0015_plan_ladder.sql`, `0012_configurable_plans.sql`).
   - Constraints that mirror enums (`CHECK (x IN (…))`) must be updated when the enum gains a value (e.g. platforms).
   - Keep it a single transaction-safe script (no `CREATE INDEX CONCURRENTLY`).
3. **Entity**: update the TypeORM entity (snake_case naming strategy maps `fooBar` → `foo_bar`). A **new entity** must be added to the explicit list in `src/config/database.module.ts` **and** to `TypeOrmModule.forFeature([...])` in its module.
4. **Test** (`test/e2e/migrations.e2e-spec.ts` pattern): use `runMigrations(url, { upTo: '0016' })` to build "production before your migration", insert rows in the old shape, then run the rest and assert the data (defaults, backfill, constraints), and that re-running is a no-op. Add endpoint-level e2e for the feature itself.
5. **Run locally**: `export E2E_DATABASE_URL="$(.claude/skills/streambird-test/local-postgres.sh start)"; npm run test:e2e` (the harness migrates the DB).
6. **Docs**: mention new tables/columns in `.claude/docs/backend.md` (module table) and bump "next number" in `CLAUDE.md` rule 4 and the skill text above.
