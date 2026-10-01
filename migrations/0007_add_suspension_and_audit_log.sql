-- Foundation for the superadmin panel's expanded feature set (company
-- directory, cross-company user management, subscription management,
-- analytics, audit log -- see SuperadminController/AccountGuard):
--
-- 1. Suspension, at two independent granularities. An Account-level
--    suspension blocks every user in that company; a User-level
--    suspension blocks just that one person (e.g. one abusive team
--    member, without taking down their whole company). Nullable
--    timestamp rather than a boolean, consistent with approved_at's
--    existing "null = not done" convention elsewhere on these same
--    tables -- also records *when* for free.
ALTER TABLE accounts ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN suspended_at TIMESTAMPTZ;

-- 2. A durable audit trail of every superadmin action (approvals,
--    suspensions, subscription edits, rejections) -- see
--    AuditLogService.log(). actor_user_id is ON DELETE SET NULL rather
--    than CASCADE: a superadmin's own user row being removed someday
--    must never silently erase the history of what they did.
CREATE TABLE superadmin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      UUID,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_superadmin_audit_log_target ON superadmin_audit_log(target_type, target_id);
CREATE INDEX ix_superadmin_audit_log_created_at ON superadmin_audit_log(created_at DESC);
