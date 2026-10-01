-- 3-tier role system (superadmin / company_admin / user) + Company.
--
-- A User no longer owns exactly one Account 1:1 -- many Users can now
-- share one Account, which becomes a company's shared billing + tenant-
-- scoping unit (see accounts.current_tier etc., untouched). The old 1:1
-- unique constraint (from 0003_add_users_and_sessions.sql's inline
-- `account_id UUID NOT NULL UNIQUE`) is dropped; every existing
-- controller that already scopes its queries by account_id keeps working
-- unchanged for both old (solo, single-user) accounts and new
-- (multi-user company) accounts.
ALTER TABLE users DROP CONSTRAINT users_account_id_key;
CREATE INDEX ix_users_account ON users(account_id);

CREATE TYPE user_role_enum AS ENUM ('superadmin', 'company_admin', 'user');

ALTER TABLE users
  ADD COLUMN role user_role_enum NOT NULL DEFAULT 'user',
  ADD COLUMN password_hash TEXT,
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN approved_by_id UUID REFERENCES users(id) ON DELETE SET NULL;
-- Every pre-existing row defaults to role='user' with approved_at left
-- NULL -- harmless, since the approval gate only ever checks approved_at
-- when role='company_admin' (see AccountGuard), so every user created
-- under the old single-user-per-account model keeps working exactly as
-- before, with no migration backfill needed for these new columns.

-- The tenant/organizational identity a Company Admin signs up with --
-- deliberately not reusing "Account" (the billing/usage-tracking unit;
-- see accounts.current_tier/included_hours_per_month/etc.), to keep the
-- distinction explicit. Today always a strict 1:1 with Account, created
-- together at company-signup time (see UsersService.createCompanyAdmin) --
-- kept as its own table so a future decoupling never has to touch this
-- shape. Not every Account has a Company row: solo accounts created by
-- the pre-existing magic-code/Google first-login path have none.
CREATE TABLE companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
