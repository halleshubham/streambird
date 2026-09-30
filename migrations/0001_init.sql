CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE platform_enum AS ENUM ('youtube','facebook','twitch','linkedin');
CREATE TYPE stream_status_enum AS ENUM ('scheduled','live','ended','failed');
CREATE TYPE destination_status_enum AS ENUM ('pending','ready','live','ended','failed');
CREATE TYPE plan_tier_enum AS ENUM ('free','starter','pro','enterprise');
CREATE TYPE compositing_mode_enum AS ENUM ('client','server_egress');
CREATE TYPE participant_role_enum AS ENUM ('host','co_host','guest');

CREATE TABLE accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  api_key_hash            TEXT NOT NULL,          -- sha256(apiKey); raw key never stored
  current_tier            plan_tier_enum NOT NULL DEFAULT 'free',
  included_hours_per_month NUMERIC(10,2) NOT NULL DEFAULT 0,
  stream_hour_usage_current_period NUMERIC(10,2) NOT NULL DEFAULT 0,
  billing_period_start    DATE,
  razorpay_customer_id    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_accounts_api_key_hash ON accounts(api_key_hash);

CREATE TABLE platform_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform              platform_enum NOT NULL,
  credentials_ciphertext BYTEA NOT NULL,          -- AES-256-GCM: nonce(12)||ciphertext||tag(16)
  credentials_key_version SMALLINT NOT NULL DEFAULT 1,
  external_account_id  TEXT NOT NULL,             -- platform's channel/page/user id
  label                 TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_platform_conn_account_platform_external
  ON platform_connections(account_id, platform, external_account_id);
CREATE INDEX ix_platform_conn_account ON platform_connections(account_id);

CREATE TABLE live_streams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  scheduled_at      TIMESTAMPTZ,
  status            stream_status_enum NOT NULL DEFAULT 'scheduled',
  relay_live_input_id TEXT,
  ingest_url        TEXT,        -- Cloudflare RTMPS or WHIP ingest URL returned to the client
  stream_key        TEXT,        -- Cloudflare stream key (RTMP path) or bearer token (WHIP path)
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_live_streams_account ON live_streams(account_id);
CREATE INDEX ix_live_streams_status ON live_streams(status);

CREATE TABLE live_stream_destinations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_stream_id        UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  platform_connection_id UUID NOT NULL REFERENCES platform_connections(id) ON DELETE RESTRICT,
  platform_broadcast_id TEXT,    -- null for Twitch
  ingest_url            TEXT,    -- platform-side ingest — server-side ONLY, never returned to client
  stream_key            TEXT,    -- platform-side key — server-side ONLY
  status                destination_status_enum NOT NULL DEFAULT 'pending',
  viewer_count          INTEGER,
  error_message         TEXT,
  cloudflare_output_uid TEXT,
  retry_count           SMALLINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_lsd_stream_connection ON live_stream_destinations(live_stream_id, platform_connection_id);
CREATE INDEX ix_lsd_live_stream ON live_stream_destinations(live_stream_id);
CREATE INDEX ix_lsd_status ON live_stream_destinations(status);

-- Studio / guest layer
CREATE TABLE studio_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_stream_id     UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  layout_config      JSONB NOT NULL DEFAULT '{}',   -- active layout + overlay/branding config
  compositing_mode   compositing_mode_enum NOT NULL DEFAULT 'client',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_studio_sessions_live_stream ON studio_sessions(live_stream_id);

CREATE TABLE studio_guest_invites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_session_id  UUID NOT NULL REFERENCES studio_sessions(id) ON DELETE CASCADE,
  token              TEXT NOT NULL,          -- single-use join token, opaque
  label              TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_studio_guest_invites_token ON studio_guest_invites(token);
CREATE INDEX ix_studio_guest_invites_session ON studio_guest_invites(studio_session_id);

CREATE TABLE studio_participants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_session_id  UUID NOT NULL REFERENCES studio_sessions(id) ON DELETE CASCADE,
  role               participant_role_enum NOT NULL,
  display_name       TEXT NOT NULL,
  joined_at          TIMESTAMPTZ,
  left_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_studio_participants_session ON studio_participants(studio_session_id);
