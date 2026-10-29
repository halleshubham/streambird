# Plans, limits and billing

## Plans (`plans` table, migrations 0012 + 0015)
Every limit is data, edited in **Admin → Plans**: included hours (null = unlimited), grace multiplier, max destinations, max simultaneous guests, max quality (`sd|hd|fhd`), max session hours, INR/USD prices, visibility, type (`monthly` | `day_pass`). Accounts hold `plan_key`, optional per-account overrides (hours, destinations, guests) and `plan_expires_at` (null = no expiry).

Current ladder (seeded by 0015 and refreshed by 0025; admin can change it): **Free** (5 h, 1 destination, 2 guests) · **Lite** ₹299/mo (key `lite`, 8 h, 1 destination, 3 guests, no watermark) · **Starter** ₹999/mo (20 h) · **Pro** ₹1,999/mo (200 h fair use) · **Business** key `enterprise`, ₹4,999/mo (200 h fair use, most destinations/guests) · **Day Pass** ₹199 (12 h session, 4 destinations, 10 guests). USD display prices: $0/$4/$19/$39/$59/$3. Prices are listed without GST and checkout currently charges exactly the listed price (GST is not added or invoiced yet; see the open question in the PR that introduced Lite). Custom/enterprise: email support@shackyapps.in (mailto link with a prefilled template on the landing page). `PRICING.md` holds the founder's cost analysis (infrastructure ~ one VPS; margin math); the landing page and the docs site (other repo) show the same ladder — change all three together.

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

**Upgrade nudges** (never hardcode plan names or prices): `PlansService.nextPlanUp(planKey, 'destinations'|'hours', current)` returns the nearest active, public, paid monthly plan above the account's plan (by `sort_order`) that raises the limit being hit; `upgradeHint` formats " Starter (₹999/mo) allows 2 destinations and 20 hours: see Billing." and `assertDestinationCount` / `assertCanStartStream` append it after their original text (e2e regexes match the leading text). Empty on the top plan or unlimited hours. Web: `components/UpgradeNudge.tsx` on the dashboard shows a banner (`data-testid="upgrade-nudge"`, links to `/billing`) at >= 80% of finite included hours, computed from `GET plans/me` + `GET plans/public`; hidden on the top plan or unlimited hours. Guest-capacity refusals are not nudged (the person refused is the guest, not the host).

Usage: `recordStreamUsage(hours)` at end; no cron — `rolloverIfNeeded` resets lazily every 30 days.

## Razorpay (live keys in production env; admin switch `app_settings.payments_enabled`, off by default)
- `BillingService.isEnabled()` = switch on **and** keys present. Off → Buy buttons hidden, no orders/subscriptions possible.
- **One-time order** (Day Pass, or "pay once for 30 days"): `POST billing/orders` (price from `plan.priceInr`, never from the client) → Checkout → `POST billing/verify` (HMAC `order_id|payment_id`) → `fulfill`: an atomic conditional UPDATE to `paid` makes the callback and the webhook idempotent; applies `activatePlan` (30 days, extended from current expiry if same plan still active) or `grantDayPass`; emails a receipt; on failure releases the claim.
- **Autopay** (default for monthly plans): `createSubscription` → `ensureRazorpayPlan` (re-created when the price changes; `total_count` 120) → Checkout collects the mandate → `POST billing/subscriptions/verify` (HMAC `payment_id|subscription_id`) and the `subscription.charged` webhook both call `applySubscriptionCharge`, whose insert with `ON CONFLICT DO NOTHING` on `razorpay_payment_id` is the lock — each charge extends the plan exactly once. Plan runs to Razorpay's `current_end` + `RAZORPAY_GRACE_DAYS` (default 3). `halted` → autopay stops, customer emailed, plan lapses to Free after grace. `cancelled/completed` → `capPlanExpiry` trims to the paid cycle end (never extends). Upgrade cancels the old autopay only after the new first charge succeeds. A charge on an already-ended subscription is recorded, not applied, and logged.
- **Webhook** `POST /billing/webhook` (no guard, HMAC over the **raw body**, needs `RAZORPAY_WEBHOOK_SECRET`): `payment.captured`, `order.paid`, `payment.failed`, `subscription.authenticated|activated|pending|charged|halted|cancelled|completed`. Amount/currency must match what we asked for or it is ignored. URL to register in Razorpay: `https://streambird.app/api/billing/webhook`.
- Rules: no downgrade to a cheaper plan while unexpired; no one-time monthly purchase while autopay is live. Not built: refunds (use the Razorpay dashboard), GST invoices, proration.
- Tests: `test/e2e/payments|autopay|plans.e2e-spec.ts` with `mock-razorpay.ts`. Never call real Razorpay in tests; `RAZORPAY_API_BASE` redirects the client to the mock.

- **Quality tiers** (`maxResolution`): `sd`/`hd`/`fhd`/`qhd` (2K, 2560x1440, 10 Mbps cap). Seeded on Pro + Business by migration 0017 (Free/Starter stay Full HD, day pass HD). The relay copies video, so nothing server-side changes; the order list lives in `plan.entity.ts`, `useHostStudio.ts` and `HostStudioPage.tsx`.

- **`canRecord`** (plan column `can_record`, default false; migration 0018 turns it on for Pro + Business): local recording in the studio. A day pass that allows it adds it, never removes it. Editable per plan in Admin → Plans.
- **`assetStorageMb`** (plan column `asset_storage_mb`, migration 0022: Starter 50, Pro 500, Business 2048, Free and day pass 0): Brand-library storage allowance in Cloudflare R2 (0 = browser-only). A day pass never adds storage. **`watermark`** (true for Free): the "Powered by StreamBird" mark on the picture and description line; a day pass removes it. Both editable in Admin → Plans.
- **`canLowerThird`** (plan column `can_lower_third`, default false; migration 0021 turns it on for Pro + Business): the animated lower-third banner in the studio. Same rules as `canRecord`/`canChromaKey` (UI-level gate, day pass adds, editable in Admin → Plans).
- **`canChromaKey`** (plan column `can_chroma_key`, default false; migration 0019 turns it on for Pro + Business): removing the background in the studio (green screen and the any-background cut-out). Same rules as `canRecord` (day pass adds, never removes; editable in Admin → Plans).
