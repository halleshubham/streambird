-- L-shaped (frame) ads: a fourth ad placement, 'l_shape'. The ad image is a full-frame graphic (coloured column and/or
-- band around a clear window) and the studio puts the live picture into the window. Only the placement CHECK widens;
-- the table, the one-ad-per-placement-per-orientation unique key and the 'ad' asset kind are unchanged.
-- Backward compatible: the previous release only ever writes the first three placements, which stay valid.
-- Re-running changes nothing (DROP IF EXISTS then ADD).

ALTER TABLE brand_kit_ads DROP CONSTRAINT IF EXISTS brand_kit_ads_placement_check;
ALTER TABLE brand_kit_ads ADD CONSTRAINT brand_kit_ads_placement_check CHECK (placement IN ('lower_third', 'side_third', 'full_screen', 'l_shape'));
