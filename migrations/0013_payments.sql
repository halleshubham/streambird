-- Razorpay payments. Admin-togglable (app_settings.payments_enabled), keys in env.
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Off until an admin turns it on.
INSERT INTO app_settings (key, value) VALUES ('payments_enabled', 'false'::jsonb);

-- A purchased monthly plan lasts until this instant, after which the account
-- falls back to Free limits. NULL = no expiry (Free, or assigned by an admin).
ALTER TABLE accounts ADD COLUMN plan_expires_at TIMESTAMPTZ;

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  plan_key            TEXT NOT NULL REFERENCES plans(key),
  -- 'plan': a monthly plan period; 'day_pass': a day-pass entitlement.
  kind                TEXT NOT NULL CHECK (kind IN ('plan', 'day_pass')),
  -- Fixed when the order is created, from the plan's price; never taken from the client.
  amount_paise        INTEGER NOT NULL CHECK (amount_paise > 0),
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  razorpay_order_id   TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  receipt             TEXT NOT NULL,
  failure_reason      TEXT,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_account_created_idx ON payments (account_id, created_at DESC);
