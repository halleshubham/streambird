-- Guest invites now live for the whole stream, not a fixed TTL: expires_at
-- becomes optional (null means "valid until the host ends the stream", the
-- only path going forward -- see StreamsService.end() revoking every
-- outstanding invite for the session instead of a timer ever firing), and
-- joining no longer consumes the invite, so a guest whose connection drops
-- can reconnect with the same link. password_hash is sha256(password), same
-- simple technique as login_codes.code_hash / user_sessions.token_hash --
-- this is an invite-access-guard, not a security-critical credential store.
ALTER TABLE studio_guest_invites ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE studio_guest_invites ADD COLUMN password_hash TEXT;
