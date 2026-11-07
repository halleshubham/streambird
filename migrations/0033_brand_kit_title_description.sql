-- Default stream title and description in the brand kit. A stream created (go live now, scheduled, from a preset, or by
-- the Android app) with a blank title/description takes the text of its brand kit; the text is COPIED onto the stream,
-- so later kit edits never change existing streams. Limits mirror the stream's own (title 200, description 5000, see
-- CreateStreamDto); the API trims and stores blank as NULL.
-- Backward compatible: two nullable columns that the previous release never reads or writes. Re-running changes nothing.

ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS title VARCHAR(200);
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS description TEXT;
