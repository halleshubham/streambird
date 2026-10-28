-- Pricing refresh: a cheaper entry plan, a more generous Free plan, and a fair-use cap on Pro and Business.
--
-- * Lite (Rs 299): fills the gap between Free and Starter (8 hours a month, 1 destination, 3 guests, Full HD, no
--   watermark). A normal, admin-editable plan row; INSERT only if it is not there yet, so an admin's later edits stay.
-- * Free goes from 2 to 5 hours a month.
-- * Pro and Business were "unlimited"; they now include 200 hours a month (grace multiplier unchanged), so a 24/7 loop
--   cannot cost more than the plan earns. Hours had been left unlimited only because they are nearly free in normal use.
-- Plans are only moved while they still have the values earlier migrations seeded, so anything an admin changed in
-- Admin -> Plans is left alone.
INSERT INTO plans (key, name, kind, included_hours_per_month, grace_multiplier, max_destinations, max_guests, max_resolution,
                   max_session_hours, validity_hours, price_inr, price_usd, sort_order, asset_storage_mb, watermark)
VALUES ('lite', 'Lite', 'monthly', 8, 1.2, 1, 3, 'fhd', NULL, NULL, 299, 4, 15, 0, false)
ON CONFLICT (key) DO NOTHING;

UPDATE plans SET included_hours_per_month = 5, updated_at = now()
 WHERE key = 'free' AND included_hours_per_month = 2;

UPDATE plans SET included_hours_per_month = 200, updated_at = now()
 WHERE key IN ('pro', 'enterprise') AND included_hours_per_month IS NULL;

-- The usage meters read this mirror column (override, else plan hours, 0 = unlimited).
UPDATE accounts a
   SET included_hours_per_month = COALESCE(a.included_hours_override, p.included_hours_per_month, 0)
  FROM plans p
 WHERE p.key = a.plan_key AND a.plan_key IN ('free', 'pro', 'enterprise');
