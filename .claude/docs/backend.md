# Backend (`src/`)

NestJS 10 + TypeORM on Postgres. Global prefix `/api` (only `/health` is outside it). Wiring: `src/main.ts` → `src/app.setup.ts` (`configureApp`: cookie-parser, legacy-host redirect, global `ValidationPipe({whitelist, transform, forbidNonWhitelisted})`, `AllExceptionsFilter`). The app is created with `rawBody: true` (Razorpay webhook HMAC needs the raw body). `AppModule` also serves the SPA from `dist-web/` (`ServeStaticModule`, SPA fallback). e2e tests boot the same `configureApp`.

## Modules (all routes under `/api`)
| Dir | Responsibility · key classes · tables · routes |
|---|---|
| `accounts` | tenant root. `AccountsService`: API-key issue/lookup (sha256 only), suspend, lazy 30-day usage rollover, `assertCanStartStream`, `assertDestinationCount`, `activatePlan`, `grantDayPass`, `assignReviewPlan`, `recordStreamUsage`. `accounts`. `POST /accounts` (one-time `sb_…` key), `GET /accounts/me` |
| `users` | `UsersService` (`findOrCreateForEmail`, `createCompanyAdmin`, `inviteUser`, `approve/rejectUser`, suspend), `review-accounts.ts`. `users` |
| `auth` | `AuthService`, `GoogleOAuthService`, `FacebookLoginService`, `password.util.ts` (scrypt). `login_codes`, `user_sessions`. `POST auth/request-code|verify-code|signup-company|superadmin-login|superadmin-verify|logout`, `GET auth/google[/callback]|facebook[/callback]|me` |
| `companies` | entity only (`companies`) |
| `team` | company-admin team mgmt: `GET team`, `POST team/invite`, `DELETE team/:userId` |
| `platform-connections` | OAuth connect + token storage (`platform_connections.credentials_ciphertext`). `GET youtube/connect|callback`, `facebook/connect|callback|pages`, `POST facebook/select`, `POST twitch/manual`, `GET /`, `DELETE :id` (revokes at the provider unless another connection shares the token) |
| `providers` | `StreamProvider` impls: `YouTubeProvider`, `FacebookProvider`, `TwitchProvider`, injected as the `STREAM_PROVIDERS` array. LinkedIn is in the `Platform` enum but has no provider |
| `streams` | `StreamsService` (create/start/end/retry/status), `StreamSchedulingService`, `GlitchRecoveryService`, `SessionLimitService`, `thumbnail.util.ts`. `live_streams`, `live_stream_destinations`, `stream_thumbnails`. `POST streams` (5/min/account), `POST streams/schedule` (10/min), `GET streams[?view=upcoming]`, `GET :id`, `GET :id/status`, `POST :id/end|start`, `POST :id/destinations/:destId/retry`, `GET|PATCH|DELETE :id/schedule`, `POST :id/schedule/cancel|guests`, `DELETE|POST …/guests/:inviteId[/resend]`, `PUT|GET|DELETE :id/schedule/thumbnail` |
| `studio` | `StudioSessionsService`, `StudioSignalingGateway` (Socket.IO `/studio`), `TurnCredentialsService`. `studio_sessions`, `studio_guest_invites`, `studio_participants`, `studio_host_tokens`. Public: `GET studio-sessions/turn-credentials`, `GET invites/:token`, `POST invites/:token/check-password` (throttled 10/min/IP). Account: `POST :id/host-token`, `POST|DELETE :id/invites`, `GET :id/participants`, `PATCH :id/layout` |
| `relay` | `MediaMtxService` (**the real delivery path**: paths, ffmpeg `runOnReady`, slate), optional `RelayProvider`s (`CloudflareRelayService`, `MuxRelayService`, token `RELAY_PROVIDER`), `fake-relay-provider.ts` for tests |
| `plans` | `PlansService` (`effectiveLimits`, pure `computeLimits`, `syncAccountHoursMirror`). `plans`. `GET plans/public|me` |
| `billing` | `BillingService`, `RazorpayClient`, `SuperadminBillingController`. `payments`, `subscriptions`, `app_settings`. See `billing-and-plans.md` |
| `superadmin` | everything `@Roles(SUPERADMIN)`: approvals, users, accounts, plans, analytics, audit log, force-end; `SuperadminSeedService` seeds the admin on boot |
| `audit-log` | `AuditLogService` → `superadmin_audit_log` |
| `email` | `EMAIL_SERVICE` token: `ResendEmailService` when `RESEND_API_KEY` is set, else `FakeEmailService` (logs codes). `stream-invite.template.ts` builds invitation emails + `.ics` |
| `encryption` | `EncryptionService` AES-256-GCM (`nonce(12)‖ciphertext‖tag(16)`), key must be 32 bytes or boot fails |
| `common` | guards (`AccountGuard`, `SessionGuard`, `RolesGuard`, `ApiKeyGuard` legacy, `StreamCreateThrottlerGuard`), decorators (`@CurrentAccount`, `@CurrentUser`, `@Roles`), enums (`Role`, `Platform`, `PlanTier`, `StreamStatus`, `DestinationStatus`), `AllExceptionsFilter`, `legacy-hosts.ts`, global throttler 100/min |
| `config` | `configuration.ts` (all env), `database.module.ts` (explicit entity list), `migrate.ts` |

## Go live now: `StreamsService.create`
1. `AccountsService.assertCanStartStream` (hours + grace) then `assertDestinationCount`.
2. Load the account's `PlatformConnection`s (422 if any is not theirs).
3. Save `LiveStream` (SCHEDULED), `StudioSessionsService.createForStream`.
4. `provision()`: `Promise.allSettled` of `provider.createBroadcast` per destination (failure → a FAILED destination row; none succeeded → stream FAILED + 422). Optional `RelayProvider.createLiveInput` (extra forward only). `MediaMtxService.registerForward(streamId, ingestUrls)` → `POST /v3/config/paths/add/<id>` with `{source:'publisher', runOnReady: <ffmpeg>, runOnReadyRestart:true}`; returns `whipUrl = MEDIAMTX_WHIP_BASE_URL/<id>/whip` or null (best-effort, never throws). Destinations READY→LIVE, stream LIVE, `startedAt` set.
5. The browser then mints a host token, connects the socket and publishes WHIP. The ffmpeg command (`buildRunOnReady`) pulls RTSP over loopback TCP with `-c:v copy -c:a aac` (WHIP audio is Opus; FLV cannot carry it) teed to every RTMP(S) URL. Only `rtmp(s)://` is accepted and every argument is shell-quoted (`shQuote`).

**Scheduled**: `StreamSchedulingService.schedule` stores a SCHEDULED stream (`isScheduledEvent`), PENDING destination placeholders, a studio session, a general link and emailed invites; `createOnPlatforms` pre-creates broadcasts (YouTube only, `canPrescheduleBroadcast`). Nothing is billed. **There is no cron/auto-start**: the host presses Start → `POST /streams/:id/start` → `StreamsService.start` re-checks limits, reuses pre-created broadcasts (`collectReusableBroadcasts`, unless complete/revoked/stopped/VOD), recreates destinations, `provision(…, reuse)`, `applyThumbnailToFreshBroadcasts`; on total failure it restores the snapshot and returns to SCHEDULED. `cancel()` emails guests and deletes platform broadcasts; `delete()` is silent.

**End** (`StreamsService.end`): `provider.endBroadcast` per live destination → `relay.deleteLiveInput` → `mediaMtx.removeForward` (stops the slate first) → revoke host tokens + invites → ENDED → `recordStreamUsage(hours)` (best-effort).

**Glitch recovery** (`GlitchRecoveryService`): polls `MediaMtxService.listPaths()` every 2 s; only UUID-named paths whose publisher was once ready. After 10 s with no publisher → `startSlate(streamId, dests, orientation)` on path `<id>-slate` (ffmpeg looping `glitch-slate[-portrait].mp4`); publisher back → `stopSlate` within ~2 s; after 5 min → `StreamsService.end`. State is in memory; `reconcile()` rebuilds it from MediaMTX after a restart. The studio gateway's 60 s host-disconnect auto-end skips streams being watched here. **Session limit**: `SessionLimitService` every 60 s ends LIVE streams over `maxSessionHours`.

## Auth and access
- **Session cookie** `sb_session`: httpOnly, `sameSite=lax`, `secure` when `NODE_ENV=production`, 30 days; random 32-byte token stored as sha256 in `user_sessions`.
- **`AccountGuard`** (`common/guards/account.guard.ts`) is on every resource controller. Order: (1) `x-api-key` → account by hash (CSRF skipped, no `request.user`); else (2) cookie session; (3) **approval gate** — any non-superadmin without `approvedAt` gets 403 (kept in the guard so new routes can't forget it); (4) account/user suspension; (5) **CSRF/origin check** on non-GET: `Origin` must be `PUBLIC_BASE_URL` or a `LEGACY_HOSTS` origin. `SessionGuard` (cookie only, no approval check) is only for `/auth/me` and `/auth/logout` so pending users can see their status.
- **`RolesGuard` + `@Roles()`** must come **after** `AccountGuard`; API-key callers have no user so they always fail `@Roles` routes.
- **Email code**: 6 digits, sha256-hashed, 10 min TTL, 5 attempts; `request-code` always answers 202 (never reveals whether an email exists). **Google/Facebook login**: random `state` in a short-lived cookie; provider email treated as verified; both go through `findOrCreateForEmail`.
- **Superadmin**: magic-code, Google and Facebook paths **refuse** a superadmin (`rejectSuperadmin`). Login = `superadmin-login` (password → emails an OTP, sent by `sendCode` which is never skipped) then `superadmin-verify` (password + OTP). `SuperadminSeedService` creates/reconciles the user from env at every boot and never promotes an existing non-superadmin; it silently skips if either env var is missing.
- **Review accounts** (`users/review-accounts.ts`, reads `process.env` at call time): listed emails are auto-approved on first sign-in, moved to `REVIEW_ACCOUNT_PLAN` (default `pro`, no expiry, only while on free), **skip the emailed code** (typing the address signs in), never apply to a superadmin. List throwaway accounts only.
- **Studio tokens**: host token (`studio_host_tokens`, minted by an authenticated account, revoked on end) and guest invite token (optional password); neither uses the cookie. The `/studio` gateway has `cors:'*'`; authentication is the handshake `auth` payload (`{role:'host', sessionId, hostToken}` / `{role:'guest', token, password?}`). A guest invite password is also verifiable up front via `POST …/invites/:token/check-password`.
- **Facebook/Google OAuth state and Facebook page selections are kept in memory** → this assumes **one backend process**. Do not scale out without moving them (also glitch state, host-end timers).

## Conventions
- **Config**: `ConfigService.get('camelKey')` from `src/config/configuration.ts` — env vars are read **only** there (exceptions: `review-accounts.ts`, `main.ts` `PORT`, `migrate.ts` `DATABASE_URL`). A new setting = add to `configuration.ts` + `.env.example` + `operations.md`.
- **Migrations**: hand-written, numbered SQL in `migrations/` (next is `0017_…`). `src/config/migrate.ts` applies unapplied files in filename order, each in a transaction, tracked in `schema_migrations`; the Dockerfile CMD runs `npm run migrate:prod && node dist/main.js` so **every deploy migrates**. `synchronize` is false. A new entity needs: the migration **and** an entry in `database.module.ts`'s explicit entity list **and** `TypeOrmModule.forFeature`. Naming strategy is snake_case. Migrations must be idempotent-safe on existing data (test: `test/e2e/migrations.e2e-spec.ts`). Skill: `streambird-add-migration`.
- **DTOs**: class-validator/transformer; the global pipe **rejects unknown fields**, so every accepted field needs a decorator. UUID params use `ParseUUIDPipe`.
- **Errors**: throw Nest `HttpException` subclasses; `AllExceptionsFilter` returns `{statusCode, message, timestamp}`; non-HTTP errors become a logged generic 500.
- **HTTP out**: `@nestjs/axios` `HttpService` + `firstValueFrom` (exception: `TurnCredentialsService` uses `fetch`). **Secrets at rest**: `EncryptionService` for connection credentials; API keys, session tokens and OTPs only as sha256.
- **Logging**: `new Logger(Class.name)`; `warn` for best-effort failures.
- **Guards**: `AccountGuard` on every new resource controller. Public endpoints that check a secret must be `@Throttle`d (`ThrottlerGuard`).
- **Add a platform** (skill `streambird-add-platform`): `Platform` enum → implement `StreamProvider` (`createBroadcast`, `endBroadcast`, optional pre-schedule/thumbnail/status/viewer-count hooks) → register in `ProvidersModule` (providers list **and** the `STREAM_PROVIDERS` factory inject list) → connect flow in `PlatformConnectionsController/Service` → env block in `configuration.ts` → check DB CHECK constraints in migrations and `PLATFORM_LABELS` in `stream-scheduling.service.ts`. `StreamsService` must never branch on platform.

## YouTube specifics
Scope: `youtube.force-ssl` only (override `GOOGLE_YOUTUBE_SCOPE`); Google approved this exact scope — **do not widen it** (re-verification). Calls used: `liveBroadcasts` insert/bind/update/transition/delete/list, `liveStreams.insert`, `thumbnails.set` (needs a verified channel), `videos.list` (concurrent viewers), `channels.list?mine=true` (id + title only). No `videos.insert`: video travels over RTMP. The Connections page and `/privacy` disclose this wording; tests pin it (`youtube-scope.e2e-spec.ts`, UI smoke).

## Gotchas
- `MediaMtxService.registerForward` is best-effort: `whipUrl` can be null and the stream still goes LIVE — a MediaMTX outage degrades silently.
- `StreamsService.start()` rollback deletes and recreates destination placeholders; re-reading the stream without its relation is deliberate (avoids a NOT NULL violation).
- Payments: never trust client/webhook amounts (compare with the DB); keep `fulfill`'s claim-then-apply order; the webhook needs `rawBody`.
- The Cloudflare TURN API token never reaches a client (`TurnCredentialsService` mints short-lived credentials).
- `/auth/*` has no explicit throttle (the OTP has its own 5-attempt cap). Explicit `@Throttle`s: stream create/schedule/guest-email routes in `streams.controller.ts` and the two public studio routes.
- `AccountGuard`'s CSRF check relies on the browser sending `Origin`; `PUBLIC_BASE_URL` must equal the site origin exactly.
