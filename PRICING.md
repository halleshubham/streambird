# StreamBird Pricing Strategy

Internal document for the founder. Purpose: decide what the pricing tiers
should be and show the cost math that proves they're profitable, given the
*actual* infrastructure this repo runs today. Billing/payment processing
(Stripe/Razorpay/invoicing) is explicitly out of scope here — `Account`
already has a `razorpayCustomerId` column, so whatever processor ends up
wired in later, this document only needs to hand it four numbers per tier:
price, included hours, and the two usage counters (`includedHoursPerMonth`,
`streamHourUsageCurrentPeriod`) already on the entity.

Throughout, **[FACT]** marks something read directly out of this codebase,
**[ASSUMPTION]** marks a number I picked because it wasn't in the repo (VM
price, bandwidth price, vendor pricing, etc. — all clearly reasoned, all
easy to swap out), and **[RECOMMENDATION]** marks a judgment call this
document is arguing for.

---

## 1. What actually costs money

### 1.1 The real architecture (from the code, not guesswork)

**[FACT]** One VM ("SM-L4") runs both the NestJS backend and a self-hosted
MediaMTX instance (`deploy/mediamtx/docker-compose.yaml`). Per stream
(`src/relay/mediamtx.service.ts`):

- The host's browser publishes one WHIP (WebRTC) stream to MediaMTX — this
  is the *already-composited* output (canvas grid/spotlight, logo, ticker,
  mixed audio). Guests never touch the server: they mesh directly to the
  host's browser over WebRTC (mix-minus audio, full video), so guest count
  is a cost to the **host's own laptop**, not to StreamBird's VM.
- MediaMTX pulls that one path back over loopback RTSP and runs a single
  `ffmpeg` process per active stream that **tees** it to every configured
  destination as RTMP: `-c:v copy` (video is never re-encoded — pure
  remux) and `-c:a aac -b:a 128k` (only the audio is transcoded, because
  RTMP/FLV has no Opus slot). CPU cost per destination is therefore tiny —
  one shared audio encode, copied out N times — not "encode video N times."
- If a `RelayProvider` (Cloudflare Stream Live or Mux) is configured, it
  gets one more copy of that same ffmpeg tee, purely for its own value-add
  (hosted preview, recording) — it is **not** in the platform-delivery
  critical path (`relay-provider.interface.ts`). This is the only place a
  metered third-party bill can appear; if no provider is configured,
  `isConfigured()` skips it entirely and the cost doesn't exist.

**[FACT]** There is no per-minute cloud-transcoding API in the critical
path. This is the single biggest structural difference from a service
built on Mux/Cloudflare Stream Live as its core delivery mechanism: the
marginal cost here is "a slice of one VM's CPU and its egress bandwidth,"
not a metered vendor invoice that scales directly with usage.

**[FACT]** `Account` already has `currentTier` (`PlanTier`: `free`,
`starter`, `pro`, `enterprise` — `src/common/enums/plan-tier.enum.ts`),
`includedHoursPerMonth`, and `streamHourUsageCurrentPeriod`, but nothing
enforces them yet. This document keeps those four tier names (no
renaming needed) and just fills in what each one should mean.

**[FACT]** Checked for scenes/screen-share/RBAC gates before pricing
around them, as instructed: none exist in this repo yet (no
`getDisplayMedia`, no scene system, no role-based permissions beyond
host/guest studio roles, which are structural not a premium feature).
Real, built differentiators to price around instead: mix-minus audio +
room monitor, client-side canvas compositing (grid/spotlight), and
logo + news-ticker branding (`web-app/src/routes/studio/HostStudioPage.tsx`,
`useHostStudio.ts`).

### 1.2 Assumptions that turn "architecture" into "dollars"

These are the numbers this whole document's math depends on. Revisit them
first if real usage data disagrees.

| # | Assumption | Value | Reasoning |
|---|---|---|---|
| A1 | VM cost | **$80/month** | A 4 vCPU / 8 GB RAM dedicated-CPU VM (DigitalOcean/Linode/Vultr class) is a reasonable stand-in for "SM-L4" — this repo doesn't record its actual spec/price, so this is deliberately a conservative (higher-than-necessary) figure; the same workload would cost less on e.g. Hetzner. |
| A2 | VM capacity | **~40 concurrent live broadcasts** | The ffmpeg tee is `-c:v copy` (no video encode) plus one cheap AAC audio encode — this is CPU-light per stream. 40 concurrent is a conservative planning ceiling for a 4-vCPU box running NestJS + MediaMTX + 40 such ffmpeg processes; not load-tested in this repo, so treat as a modeling assumption, not a measured limit. |
| A3 | Egress bandwidth price | **$0.02/GB** | A blended mid-point: cheap providers (Hetzner-class bundled bandwidth) are closer to $0.01/GB-equivalent or less; AWS/GCP retail egress is $0.05–0.09/GB. $0.02 is a deliberately middle-of-the-road planning number. |
| A4 | Composited stream bitrate | **3 Mbps video + 128 kbps AAC ≈ 3.13 Mbps** | 128 kbps is hard-coded in `mediamtx.service.ts`'s `runOnReady` command (`-b:a 128k`) — that part is fact. 3 Mbps video is a reasonable assumption for a 1080p30 canvas-composited webcam stream; since video is `-c:v copy`, every forwarded copy carries exactly this bitrate regardless of destination. |
| A5 | Relay-provider (Cloudflare Stream Live) metered cost | **~$5 / 1,000 minutes stored (recording) + ~$1 / 1,000 minutes delivered (preview)** | General vendor-pricing knowledge, not fetched live in this session — same caveat `cloudflare-relay.service.ts` itself already flags about the `whipUrl` field: treat as unverified until checked against Cloudflare's current published pricing. |
| A6 | Guest count cost | **$0 server cost** | Guests mesh directly to the host's own browser (confirmed in README + `useGuestStudio.ts`/signaling gateway — only JSON SDP/ICE crosses the server). Guest-count tiering below is a **value** lever, not a cost lever: it's capped by the host's own laptop CPU/bandwidth, which is why the README already calls the mesh workable only "at up to a handful of guests." |

### 1.3 The resulting cost model

Two very different kinds of cost fall out of this:

**Compute (VM) — effectively a fixed cost, not a per-stream-hour one.**
$80/month ÷ 730 hours/month ÷ 40 concurrent-stream capacity ≈ **$0.0027 of
VM-time per stream-hour** at full utilization. That's small enough to be
noise next to bandwidth — the VM is closer to "rent for a shared facility"
than "a metered input." For the margin math below it's folded in as a
flat **per-active-paying-customer allocation** of $80 ÷ 40 = **$2/month**
($3/month for Enterprise, reflecting heavier expected usage), rather than
multiplied by stream-hours — that's the more honest way to represent a
fixed cost against a customer base that will never *all* be streaming at
once.

**Egress bandwidth — the real linear, marginal cost.** Every destination
a stream fans out to is a full independent copy of the bitrate leaving
the VM (that's what "tee" means). Per destination, per hour:

```
3.13 Mbps × 3600 s ÷ 8 bits/byte ÷ 1024 = 1.375 GB/hour
1.375 GB × $0.02/GB = $0.0275 per destination-hour
```

So: **cost per stream-hour ≈ $0.0275 × (number of destinations + 1 if the
optional relay is active)** — the relay leg is just one more tee branch
from our own egress meter's point of view.

**Optional relay provider — the one genuinely metered, unbounded-if-
unmanaged cost.** Recording storage compounds monthly if nothing expires
it (a customer who never deletes a recording is billed for it again next
month, on top of that month's new recording). **[RECOMMENDATION]**
auto-purge relay recordings after 30 days by default (configurable) —
this is what keeps the worst-case math below a single month's usage
instead of an ever-growing tail. Per relay-hour, worst case (30-day
retention, light preview usage assumed equal to stream duration):

```
storage: 60 min × $5/1,000 min = $0.30/hour
delivery: 60 min × $1/1,000 min = $0.06/hour
+ our own egress leg: $0.0275/hour
≈ $0.39/relay-hour, vendor-metered cost
```

---

## 2. Proposed tiers

Keeping the existing `PlanTier` names (`free`/`starter`/`pro`/`enterprise`)
— no reason to rename an enum that already says the right thing.

**[RECOMMENDATION]**

| | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| Price/month | $0 | $19 | $39 | $129 |
| Included stream-hours/mo | 2 | 10 | 30 | 100 |
| Max guests in studio | 2 (host + 1) | 4 | 6 | 8 |
| Simultaneous destinations | 1 | 2 | 4 | 6 |
| Cloudflare/Mux relay (hosted preview + recording) | Not available | Add-on, pay-as-you-go | **Included**, 10 relay-hrs/mo fair-use, 30-day retention | **Included**, 40 relay-hrs/mo fair-use, 30-day retention |
| Relay overage (beyond fair-use / on Starter) | — | $0.75/relay-hour | $0.75/relay-hour | $0.75/relay-hour |
| Branding (logo + news ticker) | Included | Included | Included | Included |
| Mix-minus audio + room monitor | Included | Included | Included | Included |
| Canvas compositing (grid/spotlight) | Included | Included | Included | Included |
| Stream-hour overage | Hard stop, upgrade prompt | $2.50/hour | $2.00/hour | $1.25/hour |
| Support | Community | Email | Email, priority queue | Priority + onboarding |

Notes on the design:

- Branding, mix-minus, and compositing are **included at every paid tier**
  (and even Free) because they cost StreamBird nothing — they run on the
  host's own browser. Gating them would be gating a feature with zero
  marginal cost, which is a bad trade against conversion. The tiers
  differentiate on the things that actually cost or constrain something:
  stream-hours (bandwidth), destinations (bandwidth, multiplicatively),
  guests (host-side quality ceiling, a value lever), and the relay add-on
  (the one real metered third-party cost).
- 4 destinations on Pro isn't arbitrary — it covers all four platforms
  this repo targets (Twitch live today; YouTube/Facebook/LinkedIn once
  their adapters land per the README), so Pro is explicitly "every
  platform at once, live."
- The relay is deliberately **not bundled unmetered** — it's the only
  cost driver here that's a genuine external, metered vendor bill rather
  than "our own bandwidth," so it gets its own fair-use cap and its own
  overage price, instead of being absorbed silently into the base price
  the way the (much cheaper, self-hosted) destination fan-out is.

---

## 3. Profitability math

Worst case means: every included hour used, every destination slot
filled simultaneously, and (where included) relay fair-use maxed out —
the actual ceiling of what the plan promises, not a typical customer.

### 3.1 Pro — $39/month, 30 hours, 4 destinations, 10 relay-hours included

```
Destination egress:  30 hrs × 4 destinations × $0.0275/dest-hr   = $3.30
Relay (10 hrs, fair-use, 30-day retention):
    vendor cost 10 × $0.36/hr  = $3.60
    our egress leg 10 × $0.0275/hr = $0.28                       = $3.88
VM fixed-cost allocation                                          = $2.00
──────────────────────────────────────────────────────────────────────
Total worst-case cost to serve one Pro customer                   ≈ $9.18

Gross margin = (39.00 − 9.18) / 39.00 ≈ 76.5%
```

### 3.2 Enterprise — $129/month, 100 hours, 6 destinations, 40 relay-hours included

```
Destination egress:  100 hrs × 6 destinations × $0.0275/dest-hr  = $16.50
Relay (40 hrs, fair-use, 30-day retention):
    vendor cost 40 × $0.36/hr  = $14.40
    our egress leg 40 × $0.0275/hr = $1.10                       = $15.50
VM fixed-cost allocation (heavier profile)                        = $3.00
──────────────────────────────────────────────────────────────────────
Total worst-case cost to serve one Enterprise customer            ≈ $35.00

Gross margin = (129.00 − 35.00) / 129.00 ≈ 72.9%
```

### 3.3 Why these margins are the right target

Rule of thumb for SaaS is 70–80%+ gross margin; a video-relay product is
structurally more infra-heavy than a pure software SaaS, so **[RECOMMENDATION]**
treating 65–75% as "healthy" for this category (rather than insisting on
80%+ on day one) is realistic — and both tiers clear that even under the
*worst-case ceiling*, not the expected case. The realistic/blended case is
much better than this: a customer who averages, say, half their included
hours across half their destination slots (a far more typical usage
pattern than maxing every dimension simultaneously every billing period)
costs roughly a quarter of the worst-case figure — pushing blended margin
on Pro toward ~93% and Enterprise toward ~91%. The worst-case numbers
above are the floor, not the forecast — which is exactly what you want a
pricing ceiling to be: something that stays profitable even when a
customer legitimately uses every dollar of what they paid for.

Free tier's worst case (2 hours, 1 destination, no relay) is
2 × 1 × $0.0275 = $0.055 plus its share of VM fixed cost — i.e.,
economically a rounding error, fine to run at $0 as a funnel.

---

## 4. Overage handling

**[RECOMMENDATION]**

- **Never hard-cut a stream that's already live.** Killing someone's
  broadcast mid-stream over a metering threshold is a support-ticket and
  trust disaster, and the marginal cost of letting one stream run past
  its cap is a few cents (see §1.3/§3) — not worth the damage.
- **Soft warning at 80% of included hours** (in-app + email), so the
  customer sees it coming.
- **Meter and bill overage after the fact** on paid tiers, at the
  per-hour rates in §2 — all comfortably above the ~$0.03–0.20/stream-hour
  marginal cost computed above, so overage itself carries very high
  margin and, more importantly, is priced to make upgrading to the next
  tier the obviously better deal for anyone who overages regularly
  (that's the intended behavior: overage pricing as a nudge toward the
  right tier, not a revenue line to optimize on its own).
- **Block starting new streams** once usage exceeds included hours + a
  small grace buffer (e.g., 20%), until the customer upgrades or the
  billing period rolls over — this caps exposure without touching a live
  broadcast.
- **Free tier gets a hard stop, not metered overage** — there's no
  payment method on file at $0, so "pay for overage" isn't available
  there; it's an upgrade prompt instead.
- Since payment processing is explicitly out of scope, this is a metering
  and gating recommendation, not a billing integration: `includedHoursPerMonth`
  and `streamHourUsageCurrentPeriod` already on `Account` are exactly the
  two counters needed to implement the checks above; the actual
  overage *invoice* gets settled through whatever manual/external process
  handles billing (the existing `razorpayCustomerId` column suggests
  Razorpay is the eventual target, but wiring that up is out of scope
  here).

---

## 5. Competitive positioning

**[ASSUMPTION — unverified in this session, no internet access]** — reasoning
from general knowledge of StreamYard's public pricing ballparks, not a
live check of streamyard.com/pricing: StreamYard's tiers have historically
run roughly in the neighborhood of a free tier with hour/branding limits,
a Basic tier around $20/month, a Professional tier around $39/month, and
a Business tier in the $70–90+/month range, with incremental
destination/guest limits gating each step up. Treat these as rough,
possibly stale ballparks to verify against the live pricing page before
this document is used to set final numbers.

Given that caveat, StreamBird's proposed tiers land in roughly the same
*price band* as StreamYard's middle tiers (Starter $19 undercutting their
Basic-equivalent, Pro $39 matching their Professional-equivalent), but
with a materially different cost structure behind the price:

- StreamYard (and similar StreamYard-style tools) are presumably built on
  managed cloud infrastructure where transcoding/relay is a metered
  vendor bill that scales with usage — their pricing has to absorb that
  vendor markup at every tier.
- StreamBird's core delivery path is self-hosted (MediaMTX + ffmpeg on a
  VM we already pay a flat rate for), so the marginal cost of one more
  destination or one more stream-hour is bandwidth, not a vendor invoice.
  The only place a metered third-party bill can appear at all is the
  *optional* Cloudflare/Mux relay, and §2 deliberately keeps that
  unbundled/fair-use-capped rather than built into the base price.

The practical upshot: StreamBird can either **match StreamYard-ish price
points while carrying meaningfully fatter margins** (as shown in §3), or
**undercut on price at the Starter/Pro tiers** to win on cost while still
clearing a healthy margin — both are viable; this document picks the
former (match-price-band, bank the margin) for now since margin safety
matters more pre-scale than maximizing top-line growth, and the price
points can be revisited once there's real usage data instead of the
worst-case assumptions in §1.2.
