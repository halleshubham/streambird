-- Account deletion (self-service "delete my account and data").
-- A deleted account normally disappears completely (every child row goes with it through ON DELETE CASCADE).
-- The one exception: an account that has payment records keeps an anonymous tombstone row, because the payment
-- rows (amounts, Razorpay ids) must be kept for accounting/tax and payments.account_id is NOT NULL. The tombstone
-- holds no name, email or key; deleted_at marks it so lists and analytics can skip it.
-- Backward compatible: one nullable column, no existing row changes, the previous release simply never sets it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
