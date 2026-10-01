-- Broadens the Superadmin approval gate from "company_admin only" to
-- every non-superadmin role -- a brand-new solo signup (magic-code or
-- Google, role='user') now also sits pending until approved, not just a
-- new Company Admin (see AccountGuard, UsersService.listPendingApprovals/
-- approveUser/rejectUser).
--
-- Without this backfill, every already-existing role='user' row (created
-- under the old "users never need approval" rule, approved_at left NULL)
-- would suddenly get locked out of their own account the moment this
-- deploys. Grandfather them in by approving as of their own signup time --
-- this is a one-time migration of pre-existing rows, not a loophole: any
-- role='user' row created AFTER this migration runs still gets
-- approved_at = NULL like today, and is genuinely gated.
UPDATE users
SET approved_at = created_at
WHERE role = 'user' AND approved_at IS NULL;
