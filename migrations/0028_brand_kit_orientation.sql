-- Brand kits get a landscape (16:9) set and a portrait (9:16) set of materials. Existing rows ARE the landscape set:
-- logo_asset_id / wallpaper_asset_id / the existing ads keep their meaning, so older clients (web, Android 0.3.x) that
-- only know those fields keep working unchanged. The portrait set is new columns / a new orientation value.
-- Also adds the per-kit "shrink the picture while an ad shows" switch (default on).
-- Backward compatible and re-runnable (IF NOT EXISTS / DROP IF EXISTS). Portrait files are RESTRICTed like the others.

ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS logo_asset_id_portrait UUID REFERENCES assets(id) ON DELETE RESTRICT;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS wallpaper_asset_id_portrait UUID REFERENCES assets(id) ON DELETE RESTRICT;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS ads_shrink_picture BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE brand_kit_ads ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'landscape';
ALTER TABLE brand_kit_ads DROP CONSTRAINT IF EXISTS brand_kit_ads_orientation_check;
ALTER TABLE brand_kit_ads ADD CONSTRAINT brand_kit_ads_orientation_check CHECK (orientation IN ('landscape', 'portrait'));

-- One ad per placement PER orientation.
ALTER TABLE brand_kit_ads DROP CONSTRAINT IF EXISTS brand_kit_ads_one_per_placement;
ALTER TABLE brand_kit_ads DROP CONSTRAINT IF EXISTS brand_kit_ads_one_per_placement_orientation;
ALTER TABLE brand_kit_ads ADD CONSTRAINT brand_kit_ads_one_per_placement_orientation UNIQUE (brand_kit_id, orientation, placement);
