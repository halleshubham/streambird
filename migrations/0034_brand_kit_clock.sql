-- On-air date and time (clock) overlay in the brand kit. The studio draws it on the broadcast picture when the kit is
-- applied; the host can override it per stream. Seven settings shared by the 16:9 and 9:16 sets (like logo_position).
-- clock_timezone is an IANA zone name; NULL = the streamer's own device timezone. The API validates every value
-- (the CHECKs are the safety net). Off by default (clock_enabled = false), so every existing kit is unchanged.
-- Backward compatible: all columns have defaults, the previous release never reads or writes them (its insert shape
-- still works). Re-running changes nothing (IF NOT EXISTS; constraints dropped and re-added).

ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_position TEXT NOT NULL DEFAULT 'top_right';
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_format TEXT NOT NULL DEFAULT '12h';
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_show_date BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_show_seconds BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_timezone VARCHAR(64);
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_size TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS brand_kits_clock_position_check;
ALTER TABLE brand_kits ADD CONSTRAINT brand_kits_clock_position_check CHECK (clock_position IN ('top_left', 'top_right', 'bottom_left', 'bottom_right'));
ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS brand_kits_clock_format_check;
ALTER TABLE brand_kits ADD CONSTRAINT brand_kits_clock_format_check CHECK (clock_format IN ('12h', '24h'));
ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS brand_kits_clock_size_check;
ALTER TABLE brand_kits ADD CONSTRAINT brand_kits_clock_size_check CHECK (clock_size IN ('small', 'medium', 'large'));
