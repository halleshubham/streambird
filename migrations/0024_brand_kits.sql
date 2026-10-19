-- A brand kit is a reusable look (logo and where it sits, wallpaper, lower-third style) made of library assets.
-- A platform connection (a YouTube channel or Facebook Page) may point at one kit; several connections can share
-- a kit, and one account-wide default covers the rest. Assets are RESTRICTed so a file in use cannot be deleted.
CREATE TABLE IF NOT EXISTS brand_kits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  logo_asset_id       UUID REFERENCES assets(id) ON DELETE RESTRICT,
  logo_position       TEXT NOT NULL DEFAULT 'left' CHECK (logo_position IN ('left', 'right')),
  logo_size           INTEGER NOT NULL DEFAULT 90,
  wallpaper_asset_id  UUID REFERENCES assets(id) ON DELETE RESTRICT,
  wallpaper_dim       INTEGER NOT NULL DEFAULT 0,
  lower_third_style   TEXT NOT NULL DEFAULT 'accent' CHECK (lower_third_style IN ('bar', 'accent', 'glass')),
  is_default          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brand_kits_account_idx ON brand_kits (account_id);
-- At most one default kit per account.
CREATE UNIQUE INDEX IF NOT EXISTS brand_kits_one_default_idx ON brand_kits (account_id) WHERE is_default;

ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS brand_kit_id UUID REFERENCES brand_kits(id) ON DELETE SET NULL;
