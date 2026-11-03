-- Stream presets: a named, reusable "go live" setup per account (destinations, brand kit, orientation, quality,
-- ticker) so the host can start a stream in one tap (web dashboard, Android). The settings live in one jsonb
-- document validated by the API (src/presets), so adding a setting later needs no migration. Nothing else
-- references this table and no existing table changes, so the previous release keeps running unchanged.
-- Re-runnable (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS stream_presets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          VARCHAR(80) NOT NULL,
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stream_presets_account_idx ON stream_presets (account_id);
