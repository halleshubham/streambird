-- Admin-configurable plans. Limits used to be hard-coded constants (hours per
-- tier) plus advertised-but-unenforced destination/guest counts. They now live
-- in this table, editable by a superadmin, and every enforcement point reads
-- them through PlansService.
CREATE TABLE plans (
  key                      TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  -- 'monthly': a subscription plan an account sits on. 'day_pass': a
  -- time-boxed entitlement granted on top of the account's plan.
  kind                     TEXT NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly', 'day_pass')),
  -- NULL = unlimited hours (still bounded by max_session_hours).
  included_hours_per_month NUMERIC(10,2),
  grace_multiplier         NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  max_destinations         INTEGER NOT NULL CHECK (max_destinations >= 1),
  -- Simultaneous guests in the studio (the host is not counted).
  max_guests               INTEGER NOT NULL CHECK (max_guests >= 0),
  max_resolution           TEXT NOT NULL DEFAULT 'fhd' CHECK (max_resolution IN ('sd', 'hd', 'fhd')),
  -- A single live session is ended after this many hours. NULL = no cap.
  max_session_hours        NUMERIC(5,2),
  -- day_pass only: how long a granted pass lasts.
  validity_hours           INTEGER,
  price_inr                INTEGER,
  price_usd                NUMERIC(8,2),
  is_public                BOOLEAN NOT NULL DEFAULT TRUE,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeded with exactly what the pricing page advertised (and the old
-- constants enforced for hours), so nothing changes until an admin edits them.
INSERT INTO plans (key, name, kind, included_hours_per_month, grace_multiplier, max_destinations, max_guests, max_resolution, max_session_hours, validity_hours, price_inr, price_usd, sort_order) VALUES
  ('free',       'Free',       'monthly',  2,   1.0, 1, 2, 'fhd', NULL, NULL, 0,    0,   10),
  ('starter',    'Starter',    'monthly',  10,  1.2, 2, 4, 'fhd', NULL, NULL, 999,  19,  20),
  ('pro',        'Pro',        'monthly',  30,  1.2, 4, 6, 'fhd', NULL, NULL, 1999, 39,  30),
  ('enterprise', 'Enterprise', 'monthly',  100, 1.2, 6, 8, 'fhd', NULL, NULL, 6999, 129, 40),
  ('day_pass',   'Day Pass',   'day_pass', NULL, 1.0, 4, 10, 'hd', 12,   24,   199,  3,   50);

ALTER TABLE accounts
  ADD COLUMN plan_key TEXT NOT NULL DEFAULT 'free' REFERENCES plans(key),
  -- Per-account exceptions; NULL = use the plan's value.
  ADD COLUMN included_hours_override NUMERIC(10,2),
  ADD COLUMN max_destinations_override INTEGER,
  ADD COLUMN max_guests_override INTEGER,
  ADD COLUMN day_pass_plan_key TEXT REFERENCES plans(key),
  ADD COLUMN day_pass_expires_at TIMESTAMPTZ;

-- Existing accounts keep their tier as their plan...
UPDATE accounts SET plan_key = current_tier::text;
-- ...and any hand-edited hours allowance (differs from the plan's) becomes an override.
UPDATE accounts a
   SET included_hours_override = a.included_hours_per_month
  FROM plans p
 WHERE p.key = a.plan_key
   AND a.included_hours_per_month IS DISTINCT FROM p.included_hours_per_month;
