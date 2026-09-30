-- Reusable-until-expiry host credential for the studio signaling socket,
-- so the browser's Socket.IO handshake never carries the account's real
-- API key. Generalizes studio_guest_invites' opaque-token pattern but
-- with host-appropriate semantics: not single-use (a live show's page may
-- reconnect the socket repeatedly), one active token per session (minting
-- a new one revokes the prior one).
CREATE TABLE studio_host_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_session_id UUID NOT NULL REFERENCES studio_sessions(id) ON DELETE CASCADE,
  token             TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_studio_host_tokens_token ON studio_host_tokens(token);
CREATE INDEX ix_studio_host_tokens_session ON studio_host_tokens(studio_session_id);
