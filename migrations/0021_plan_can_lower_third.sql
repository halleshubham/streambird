-- Animated lower-third banners (a slide-in title / name / text over the picture) are a Pro feature. They are
-- drawn in the host's browser; this flag only decides whether the studio offers them. Pro and Business get
-- them; Free, Starter and the day pass do not. An admin can flip it per plan in Admin -> Plans.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS can_lower_third BOOLEAN NOT NULL DEFAULT false;

UPDATE plans SET can_lower_third = true, updated_at = now() WHERE key IN ('pro', 'enterprise');
