-- Razorpay Subscriptions (autopay) for monthly plans.

-- Razorpay plans are immutable, so remember the one we created and the price it carries;
-- a changed price makes us create a new one (existing subscribers keep the old price).
ALTER TABLE plans
  ADD COLUMN razorpay_plan_id TEXT,
  ADD COLUMN razorpay_plan_amount_paise INTEGER;

CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id                  UUID REFERENCES users(id) ON DELETE SET NULL,
  plan_key                 TEXT NOT NULL REFERENCES plans(key),
  razorpay_subscription_id TEXT NOT NULL UNIQUE,
  razorpay_plan_id         TEXT NOT NULL,
  -- What each cycle charges, fixed when the subscription was created.
  amount_paise             INTEGER NOT NULL CHECK (amount_paise > 0),
  -- Razorpay's own states: created, authenticated, active, pending, halted, cancelled, completed, expired.
  status                   TEXT NOT NULL DEFAULT 'created',
  -- The customer cancelled autopay; the plan runs to the end of the paid cycle.
  cancel_at_cycle_end      BOOLEAN NOT NULL DEFAULT FALSE,
  current_end              TIMESTAMPTZ,
  paid_count               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_account_idx ON subscriptions (account_id, created_at DESC);

-- Autopay charges are payments too (history, receipts, idempotency by payment id),
-- but they have no order we created.
ALTER TABLE payments
  ALTER COLUMN razorpay_order_id DROP NOT NULL,
  ADD COLUMN razorpay_subscription_id TEXT;
