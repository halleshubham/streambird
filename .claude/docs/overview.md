# StreamBird overview

**What it is:** a browser-based live-streaming studio and simulcast service ("StreamYard-style"). A host goes live once from a browser tab to YouTube, Facebook and Twitch at the same time, with remote guests, layouts, branding, slides and a ticker. Live at **https://streambird.app**; user docs at https://shackyapps.in/docs/streambird/ (a separate repo). Open source, AGPL-3.0, built by ShackyApps; billing in INR via Razorpay.

## Stack
- **Backend**: NestJS 10, TypeORM 0.3 (`synchronize:false`), PostgreSQL 16, Socket.IO (signaling), Node 22. Hand-written SQL migrations.
- **Frontend**: React 19 SPA in `web-app/` (Vite, TypeScript, no UI framework), built to `dist-web/` and served by the same Nest process (one origin, cookies not tokens).
- **Media**: MediaMTX (self-hosted, `deploy/mediamtx/`) receives the host's WHIP stream; an `ffmpeg` process (started by MediaMTX `runOnReady`, video copied, audio → AAC) pushes RTMP(S) to each destination. Optional Cloudflare/Mux "relay providers" exist behind an interface but MediaMTX is the real path.
- **External services**: Google (login + YouTube Data API v3), Facebook Graph (login + Live), Twitch (manual key + status), Razorpay (payments), Resend (email), Cloudflare TURN (WebRTC relay credentials).
- **Hosting**: one VPS; Coolify (`admin.shackyapps.in`) deploys the container image from GHCR; GitHub Actions builds it. See `operations.md`.

## How a stream works (one paragraph)
`POST /api/streams` checks plan limits, creates a broadcast on each chosen platform (`StreamProvider.createBroadcast` → ingest URL + key), registers a MediaMTX path whose `runOnReady` ffmpeg forwards to all those RTMP(S) ingests, and returns a WHIP URL. The host opens the studio (`/streams/:id/studio`), guests join with invite links (`/join/:token`) over a WebRTC mesh to the host's browser, the host's browser composites everything on a canvas and publishes it to the WHIP URL, and MediaMTX → ffmpeg fans it out. If the host's browser drops, a "technical difficulties" slate keeps every destination alive for up to 5 minutes. Details: `studio.md` (browser side) and `backend.md` (server side).

## Repo map
```
src/                 NestJS backend (one folder per module; *.spec.ts beside the code)
migrations/          numbered hand-written SQL (0001…0016), applied on every container start
web-app/             React SPA (routes, components, api client, studio/); public/ has slates + logo
test/e2e/            e2e on real Postgres (harness.ts is the toolbox)
test/ui/             Playwright tests + fixture server
deploy/mediamtx/     docker-compose for the media server
scripts/load-test/   relay capacity load test (needs a second machine)
.github/workflows/   ci.yml (all tests) + docker-publish.yml (build image from green main)
.claude/             THIS agent knowledge base: docs/ (context) and skills/ (workflows) — see CLAUDE.md
README.md            human-oriented feature notes (long; partly stale, see below)
PRICING.md           founder pricing analysis (internal; the live ladder is in the plans table + migration 0015)
```
`README.md` has good feature write-ups (scheduled streams, plans, payments, domain move, recovery) but its "Status" intro is outdated (it describes an early Cloudflare-based scaffold). Trust the code and these docs for architecture.

## Domain glossary
- **Account**: tenant; owns connections, streams, plan, usage. A **User** logs in and belongs to an account; roles `superadmin`, `company_admin`, `user`; new users wait for **approval** (admin) except invited team members and review accounts.
- **Platform connection**: a stored, encrypted credential for YouTube/Facebook (OAuth) or Twitch (manual ingest key).
- **Live stream** (`live_streams`): one broadcast job. Statuses `scheduled → live → ended|failed`. **Destinations** (`live_stream_destinations`): one row per platform target, with its own status/watch URL.
- **Scheduled stream**: planned ahead (nothing created/billed until Start); has emailed guest invites + `.ics`.
- **Studio session**: the room for a stream; **host token** (host's socket auth) and **guest invites** (token, optional password, optional email).
- **Orientation**: `landscape` (default) or `portrait` (9:16), fixed at creation.
- **Slate / glitch recovery**: pre-encoded looped MP4 pushed to destinations when the host's publisher disappears.
- **Plan**: row in `plans` (hours, destinations, guests, max quality, session cap, prices). **Day pass**: temporary raise of limits. Ladder today: Free / Starter ₹999 / Pro ₹1,999 / Business (key `enterprise`) ₹4,999 / Day Pass ₹199. Custom/enterprise enquiries go to support@shackyapps.in.
- **Review account**: an email listed in `REVIEW_ACCOUNT_EMAILS` (auto-approved, Pro, no emailed code). Currently **unset** in production; Google's OAuth review is approved.

## Product state (keep current)
Live and working: email-code / Google / Facebook sign-in, company accounts and team invites, YouTube/Facebook/Twitch destinations, instant and scheduled streams (YouTube pre-creation + thumbnail), guest invites (shared link or per-email, optional password checked before joining), browser studio with 13 layouts, 11 canvas themes + wallpaper + slides + ticker + logo, vertical streams, glitch recovery, plans/limits, Razorpay payments + autopay, superadmin console (users, accounts, plans, billing, analytics, audit log). Not built: LinkedIn, refunds, GST invoices, plan-change proration, server-side compositing fallback, server-side enforcement of max quality.
