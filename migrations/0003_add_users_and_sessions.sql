-- Real auth: email + one-time-code login. A User owns exactly one Account
-- (1:1, enforced by the unique FK) in this phase; multi-user teams later
-- become an account_members join table without touching this column.
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  account_id   UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users(email);

-- Not a FK on email: the user may not exist yet on first-ever login.
CREATE TABLE login_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,          -- sha256(code), same technique as accounts.api_key_hash
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_login_codes_email ON login_codes(email);

CREATE TABLE user_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,         -- sha256 of an opaque random token, same pattern as api_key_hash
  user_agent   TEXT,
  ip_address   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX ix_user_sessions_user ON user_sessions(user_id);
