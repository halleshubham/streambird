-- Advertisements on the broadcast picture, stored in brand kits (one per placement: lower_third, side_third,
-- full_screen). The ad image/GIF is a library asset of the new kind 'ad'. Backward compatible: the previous
-- release never reads brand_kit_ads, and it never writes kind 'ad' (it only ever sees the widened CHECK).
-- The asset FK is RESTRICT, so a file used by a kit's ad cannot be deleted ("file in use by brand kits" 409).
-- Re-running changes nothing (IF NOT EXISTS / DROP IF EXISTS).

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('logo', 'wallpaper', 'background', 'other', 'ad'));

CREATE TABLE IF NOT EXISTS brand_kit_ads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_kit_id  UUID NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
  placement     TEXT NOT NULL CHECK (placement IN ('lower_third', 'side_third', 'full_screen')),
  asset_id      UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  mode          TEXT NOT NULL DEFAULT 'continuous' CHECK (mode IN ('continuous', 'interval')),
  show_sec      INTEGER CHECK (show_sec IS NULL OR (show_sec BETWEEN 1 AND 3600)),
  every_sec     INTEGER CHECK (every_sec IS NULL OR (every_sec BETWEEN 1 AND 86400)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT brand_kit_ads_interval_ck CHECK (mode <> 'interval' OR (show_sec IS NOT NULL AND every_sec IS NOT NULL)),
  CONSTRAINT brand_kit_ads_one_per_placement UNIQUE (brand_kit_id, placement)
);
CREATE INDEX IF NOT EXISTS brand_kit_ads_asset_idx ON brand_kit_ads (asset_id);
