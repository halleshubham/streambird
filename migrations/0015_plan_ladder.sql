-- New plan ladder, priced against what competitors charge for the same
-- features: hours are nearly free for us (flat-rate server), so Pro and Business
-- become unlimited fair use, capped per session instead. 'enterprise' keeps its
-- key (accounts and Razorpay records point at it) and is shown as "Business".
--
-- Each plan is only moved if it is still exactly as migration 0012 seeded it,
-- so anything an admin already edited in Admin -> Plans is left alone.
UPDATE plans SET included_hours_per_month = 20, updated_at = now()
 WHERE key = 'starter' AND included_hours_per_month = 10 AND max_destinations = 2 AND max_guests = 4 AND price_inr = 999;

UPDATE plans SET included_hours_per_month = NULL, max_guests = 8, max_session_hours = 12, updated_at = now()
 WHERE key = 'pro' AND included_hours_per_month = 30 AND max_destinations = 4 AND max_guests = 6 AND price_inr = 1999;

UPDATE plans SET name = 'Business', included_hours_per_month = NULL, max_destinations = 8, max_guests = 10,
                 max_session_hours = 24, price_inr = 4999, price_usd = 59, updated_at = now()
 WHERE key = 'enterprise' AND name = 'Enterprise' AND included_hours_per_month = 100 AND max_destinations = 6
   AND max_guests = 8 AND price_inr = 6999;

-- The usage meters read this mirror column (override, else plan hours, 0 = unlimited).
UPDATE accounts a
   SET included_hours_per_month = COALESCE(a.included_hours_override, p.included_hours_per_month, 0)
  FROM plans p
 WHERE p.key = a.plan_key AND a.plan_key IN ('starter', 'pro', 'enterprise');
