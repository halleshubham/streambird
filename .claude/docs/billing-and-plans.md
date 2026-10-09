# Plans, limits and billing

## Plans (`plans` table, migrations 0012 + 0015)
Every limit is data, edited in **Admin → Plans**: included hours (null = unlimited), grace multiplier, max destinations, max simultaneous guests, max quality (`sd|hd|fhd`), max session hours, INR/USD prices, visibility, type (`monthly` | `day_pass`). Accounts hold `plan_key`, optional per-account overrides (hours, destinations, guests) and `plan_expires_at` (null = no expiry).

Current ladder (seeded by 0015; admin can change it): **Free** (2 h, 1 destination, 2 guests) · **Starter** ₹999/mo (20 h) · **Pro** ₹1,999/mo (unlimited, fair use) · **Business** key `enterprise`, ₹4,999/mo (unlimited, most destinations/guests) · **Day Pass** ₹199 (12 h session, 4 destinations, 10 guests). USD display prices: $0/$19/$39/$59/$3. Custom/enterprise: email support@shackyapps.in (mailto link with a prefilled template on the landing page). `PRICING.md` holds the founder's cost analysis (infrastructure ~ one VPS; margin math); the landing page and the docs site (other repo) show the same ladder — change all three together.

## Effective limits: `PlansService.effectiveLimits(account)`
1. plan = `account.planKey`; if `planExpiresAt` has passed (non-free) → fall back to the `free` plan **and drop the account's overrides**.
2. `computeLimits` (pure, unit-tested) applies the account overrides over the plan.
3. An active **day pass** (`day_pass_expires_at`) can only *raise* limits (max of pass and plan; null session cap/hours = unlimited).
Result fields: `includedHours, graceMultiplier, maxDestinations, maxGuests, maxResolution, maxSessionHours, planExpiresAt, planExpired`. `accounts.included_hours_per_month` is only a **mirror** for meters/analytics (`syncAccountHoursMirror`, `activatePlan`) — enforcement never reads it.

| Limit | Enforced in |
|---|---|
| Hours (+grace) | `AccountsService.assertCanStartStream` on create/start (never cuts a running stream) |
| Destinations | `assertDestinationCount` (create, schedule, start) |
| Guests at once | `StudioSignalingGateway.assertGuestCapacity` ("This studio is full") |
| Session length | `SessionLimitService` (every 60 s) |
| Max quality | **client-side only** (host quality menu); the server just exposes it via `GET plans/me|public` |

Usage: `recordStreamUsage(hours)` at end; no cron — `rolloverIfNeeded` resets lazily every 30 days.

## Razorpay (live keys in production env; admin switch `app_settings.payments_enabled`, off by default)
- `BillingService.isEnabled()` = switch on **and** keys present. Off → Buy buttons hidden, no orders/subscriptions possible.
- **One-time order** (Day Pass, or "pay once for 30 days"): `POST billing/orders` (price from `plan.priceInr`, never from the client) → Checkout → `POST billing/verify` (HMAC `order_id|payment_id`) → `fulfill`: an atomic conditional UPDATE to `paid` makes the callback and the webhook idempotent; applies `activatePlan` (30 days, extended from current expiry if same plan still active) or `grantDayPass`; emails a receipt; on failure releases the claim.
- **Autopay** (default for monthly plans): `createSubscription` → `ensureRazorpayPlan` (re-created when the price changes; `total_count` 120) → Checkout collects the mandate → `POST billing/subscriptions/verify` (HMAC `payment_id|subscription_id`) and the `subscription.charged` webhook both call `applySubscriptionCharge`, whose insert with `ON CONFLICT DO NOTHING` on `razorpay_payment_id` is the lock — each charge extends the plan exactly once. Plan runs to Razorpay's `current_end` + `RAZORPAY_GRACE_DAYS` (default 3). `halted` → autopay stops, customer emailed, plan lapses to Free after grace. `cancelled/completed` → `capPlanExpiry` trims to the paid cycle end (never extends). Upgrade cancels the old autopay only after the new first charge succeeds. A charge on an already-ended subscription is recorded, not applied, and logged.
- **Webhook** `POST /billing/webhook` (no guard, HMAC over the **raw body**, needs `RAZORPAY_WEBHOOK_SECRET`): `payment.captured`, `order.paid`, `payment.failed`, `subscription.authenticated|activated|pending|charged|halted|cancelled|completed`. Amount/currency must match what we asked for or it is ignored. URL to register in Razorpay: `https://streambird.app/api/billing/webhook`.
- Rules: no downgrade to a cheaper plan while unexpired; no one-time monthly purchase while autopay is live. Not built: refunds (use the Razorpay dashboard), GST invoices, proration.
- Tests: `test/e2e/payments|autopay|plans.e2e-spec.ts` with `mock-razorpay.ts`. Never call real Razorpay in tests; `RAZORPAY_API_BASE` redirects the client to the mock.
