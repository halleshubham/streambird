-- A stream thumbnail in the brand kit. One image per kit (shared by both orientations; vertical streams still use a 16:9
-- thumbnail). A stream created without its own thumbnail gets its destination's kit thumbnail, else the account default
-- kit's, sent to the platform when the broadcast is created. Also widens the asset kind with 'thumbnail' (uploads made
-- for this slot are checked with the stream-thumbnail limits).
-- Backward compatible: nullable column, the previous release never reads it. Deleting the file just empties the slot
-- (the API refuses to delete a file a kit uses first). Re-running changes nothing (IF NOT EXISTS / DROP IF EXISTS).

ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS thumbnail_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS brand_kits_thumbnail_asset_idx ON brand_kits (thumbnail_asset_id) WHERE thumbnail_asset_id IS NOT NULL;

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('logo', 'wallpaper', 'background', 'other', 'ad', 'thumbnail'));
