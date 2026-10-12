-- Recording the composited stream to the host's own computer is a Pro feature.
-- The recording itself happens in the browser; this flag only decides whether
-- the studio offers the button. Pro and Business get it; Free, Starter and the
-- day pass do not. An admin can flip it per plan in Admin -> Plans.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS can_record BOOLEAN NOT NULL DEFAULT false;

UPDATE plans SET can_record = true, updated_at = now() WHERE key IN ('pro', 'enterprise');
