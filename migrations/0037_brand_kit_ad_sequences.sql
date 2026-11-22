-- Ad sequences: a kit can run several ads in the SAME placement (up to 5 per placement per orientation), played in
-- order. `position` is the ad's place in its placement's sequence (0 = the first / the only one, which is what every
-- row written before this migration is). The uniqueness widens from (kit, orientation, placement) to
-- (kit, orientation, placement, position).
-- Backward compatible: the previous release (and cached web tabs / Android 1.0.x) only ever read and write position 0
-- (the API keeps `ads` / `adsPortrait` = position 0 and adds `adsMore` / `adsMorePortrait` for positions 1..4); with
-- DEFAULT 0 its inserts keep working, and it never creates two rows for one placement, so the old unique key it relied
-- on is never violated. Re-running changes nothing (IF NOT EXISTS / DROP IF EXISTS).

ALTER TABLE brand_kit_ads ADD COLUMN IF NOT EXISTS position SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE brand_kit_ads DROP CONSTRAINT IF EXISTS brand_kit_ads_position_check;
ALTER TABLE brand_kit_ads ADD CONSTRAINT brand_kit_ads_position_check CHECK (position BETWEEN 0 AND 4);

ALTER TABLE brand_kit_ads DROP CONSTRAINT IF EXISTS brand_kit_ads_one_per_placement_orientation;
ALTER TABLE brand_kit_ads DROP CONSTRAINT IF EXISTS brand_kit_ads_one_per_position;
ALTER TABLE brand_kit_ads ADD CONSTRAINT brand_kit_ads_one_per_position UNIQUE (brand_kit_id, orientation, placement, position);
