-- Compact clock look (follow-up to 0034). clock_style: 'text' = plain white text with a shadow, no box, placed under the
-- logo (the default); 'pill' = the dark rounded plate of the first release. clock_alternate: the date and the time take
-- turns in the same small spot (true) or both show at once on one line (false). The default size becomes 'small' so the
-- default look is compact. Backward compatible: new columns have defaults, the previous release never reads them.
-- Existing kits keep their stored clock_size (only the column DEFAULT for new rows changes). Re-running changes nothing.

ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_style VARCHAR(8) NOT NULL DEFAULT 'text';
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS clock_alternate BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE brand_kits ALTER COLUMN clock_size SET DEFAULT 'small';

ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS brand_kits_clock_style_check;
ALTER TABLE brand_kits ADD CONSTRAINT brand_kits_clock_style_check CHECK (clock_style IN ('text', 'pill'));
