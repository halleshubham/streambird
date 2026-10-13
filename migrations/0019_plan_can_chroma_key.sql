-- Green screen (chroma key) in the studio is a Pro feature. The keying itself runs in the
-- host's browser; this flag only decides whether the studio offers it. Pro and Business get
-- it; Free, Starter and the day pass do not. An admin can flip it per plan in Admin -> Plans.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS can_chroma_key BOOLEAN NOT NULL DEFAULT false;

UPDATE plans SET can_chroma_key = true, updated_at = now() WHERE key IN ('pro', 'enterprise');
