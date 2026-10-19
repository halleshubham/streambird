-- Brand storage (Cloudflare R2) is a paid feature: each plan gets a storage allowance in MB for uploaded logos,
-- wallpapers and pictures (0 = browser-only, as before). Free stays 0. A day pass never grants storage.
-- Free-plan streams also carry a small "Powered by StreamBird" mark; a plan opts in with `watermark`.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS asset_storage_mb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS watermark BOOLEAN NOT NULL DEFAULT false;

UPDATE plans SET asset_storage_mb = 50, updated_at = now() WHERE key = 'starter' AND asset_storage_mb = 0;
UPDATE plans SET asset_storage_mb = 500, updated_at = now() WHERE key = 'pro' AND asset_storage_mb = 0;
UPDATE plans SET asset_storage_mb = 2048, updated_at = now() WHERE key = 'enterprise' AND asset_storage_mb = 0;
UPDATE plans SET watermark = true, updated_at = now() WHERE key = 'free';
