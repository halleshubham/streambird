-- A 2K (1440p) quality tier above Full HD. Pro and Business get it; Free,
-- Starter and the day pass stay as they are. Plans an admin already edited
-- (anything other than the seeded 'fhd') are left alone.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_max_resolution_check;
ALTER TABLE plans ADD CONSTRAINT plans_max_resolution_check CHECK (max_resolution IN ('sd', 'hd', 'fhd', 'qhd'));

UPDATE plans SET max_resolution = 'qhd', updated_at = now()
 WHERE key IN ('pro', 'enterprise') AND max_resolution = 'fhd';
