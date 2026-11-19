-- Superadmin support sessions ("view as / act as a customer"). One row per session, kept as history.
-- The row, not a cookie, is the authority: AccountGuard looks up an unended, unexpired row for the
-- admin's own login session (admin_session_id) and, only then, resolves the target customer as the
-- principal. No row = nothing changes for anyone. Backward compatible: a new table nothing else reads,
-- so the previous release simply ignores it. Re-running changes nothing.
--
-- mode: 'view' = read-only, 'act' = may change configuration (billing, credentials, channel
-- connections and going live stay blocked in code). expires_at = started_at + 30 min.
-- end_reason: exit | replaced (admin started another) | expired | logout | target_gone | invalid.
-- ip_address / user_agent_hash are the admin's, for the audit trail (the user agent only as a hash).
-- At most one active session per admin (partial unique index); starting another ends the old one first.

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- History must outlive the people it is about: the references go to NULL (never CASCADE) when a user, an
  -- account or a login session is deleted, and the readable facts are copied into the row (admin_email,
  -- target_email, target_account_name).
  admin_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_session_id    UUID REFERENCES user_sessions(id) ON DELETE SET NULL,
  target_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  target_account_id   UUID REFERENCES accounts(id) ON DELETE SET NULL,
  admin_email         TEXT,
  target_email        TEXT,
  target_account_name TEXT,
  mode                VARCHAR(4) NOT NULL CHECK (mode IN ('view', 'act')),
  reason              VARCHAR(200),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  end_reason          VARCHAR(16),
  ip_address          TEXT,
  user_agent_hash     VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS ix_impersonation_sessions_admin ON impersonation_sessions (admin_user_id, ended_at);
CREATE INDEX IF NOT EXISTS ix_impersonation_sessions_admin_session ON impersonation_sessions (admin_session_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_impersonation_sessions_one_active ON impersonation_sessions (admin_user_id) WHERE ended_at IS NULL;
