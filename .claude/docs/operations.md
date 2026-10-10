# Operations: environments, CI/CD, deploy, secrets

## Topology
- **App**: one container (Nest API + SPA + Socket.IO) from `ghcr.io/halleshubham/streambird:latest`, deployed by **Coolify** at `https://admin.shackyapps.in` (app uuid `gb8rghmifpq7hb5y6gkkcf6e`) behind Traefik at **https://streambird.app**. Health: `GET /health`.
- **Media**: MediaMTX (compose in `deploy/mediamtx/`, UDP 8189 for WebRTC, API 9997, WHIP 8889) on the same VPS; config file with the API password lives on the host (not in git).
- **Database**: PostgreSQL 16, reached through `DATABASE_URL` (migrations run at container start).
- **Landing/docs**: separate repo `halleshubham/shackyapps-landing` (shackyapps.in, Coolify app uuid `qywy4fxyjk1yowjsfnoowbb9`) — marketing page and the user docs under `/docs/streambird/`. Update its pricing/feature text when plans or features change.
- Single backend process assumption (in-memory state, see `backend.md`).

## CI/CD
- `.github/workflows/ci.yml` (PRs, `workflow_call`, manual): Postgres 16 service, ffmpeg, then typecheck → unit → build → e2e → Playwright UI. `GitGuardian` also runs on PRs.
- `docker-publish.yml` (push to `main`, manual): runs `ci.yml` first, then builds and pushes `latest` + short-sha to GHCR. **An image exists only for a green `main` commit.** Typical timing: CI ≈ 3–4 min, image ≈ 4–5 min.
- **Release = merge to `main` → wait for the image → deploy in Coolify.** Merging does not deploy by itself.
- Re-run a stuck CI via the Actions UI or `workflow_dispatch` (a hung `apt-get install ffmpeg` step has happened once).

## Deploying (skill `streambird-deploy`)
1. `.claude/skills/streambird-deploy/wait-for-build.sh <merge sha>` → exits 0 when the image is published.
2. `COOLIFY_API_TOKEN=… .claude/skills/streambird-deploy/deploy.sh [streambird|landing]` → `POST /api/v1/deploy?uuid=…&force=true`, polls the deployment, prints `health 200` and the app status (`running:healthy`).
3. Verify: `curl https://streambird.app/health`; for UI/API changes check the shipped bundle or hit the new endpoint (e.g. an unknown-token request returning 404 proves a new route exists).
- The Coolify token is **user-provided per session** (invalid → HTTP 401 → ask for a new one; never guess or reuse an old one). Pass it only as an inline env var; never write it to a file, commit or PR. The user usually pastes secrets in chat — advise rotating them afterwards.
- Env var changes: Coolify API `GET/PATCH/DELETE /api/v1/applications/<uuid>/envs` (each var may appear twice: normal and preview — delete both) then redeploy (env is read at boot).
- **Migrations run automatically at container start**; a failing migration fails the deploy. Rolling back code does not roll back schema, so write backward-compatible migrations (add columns nullable/with defaults; drop later).
- Deploy only when the user asks. Merge only when the user says so (squash merge).

## Environment variables (read only in `src/config/configuration.ts` unless marked)
Required: `DATABASE_URL`, `ENCRYPTION_KEY_BASE64` (base64 of 32 bytes: `openssl rand -base64 32`). Effectively required in production: `PUBLIC_BASE_URL` (exact site origin; CSRF check, links), `RESEND_API_KEY` (else login codes are only logged), `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD` (seed; skipped if either missing).

| Group | Variables |
|---|---|
| Core | `PORT` (3000), `NODE_ENV`, `PUBLIC_BASE_URL`, `LEGACY_HOSTS` (old hostnames to redirect/accept) |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Admin/review | `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `APPROVAL_DIGEST_INTERVAL_HOURS` (12; 0 = no "waiting for approval" emails to `SUPERADMIN_EMAIL`), `REVIEW_ACCOUNT_EMAILS` (read in `users/review-accounts.ts`), `REVIEW_ACCOUNT_PLAN` (pro) |
| Google/YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (= `PUBLIC_BASE_URL/api/auth/google/callback`), `GOOGLE_YOUTUBE_REDIRECT_URI` (= `…/api/platform-connections/youtube/callback`), `GOOGLE_YOUTUBE_SCOPE` (default `youtube.force-ssl`) |
| Facebook | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI` (page connect callback), `FACEBOOK_LOGIN_REDIRECT_URI`, `FACEBOOK_LOGIN_CONFIG_ID`, `FACEBOOK_CONNECT_CONFIG_ID` |
| Twitch | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (status/viewer read; ingest key is pasted manually) |
| MediaMTX | `MEDIAMTX_API_URL`, `MEDIAMTX_API_USER`, `MEDIAMTX_API_PASSWORD`, `MEDIAMTX_WHIP_BASE_URL`, `GLITCH_SLATE_URL`, `GLITCH_SLATE_PORTRAIT_URL` (default `PUBLIC_BASE_URL/glitch-slate[-portrait].mp4`) |
| Optional relay | `RELAY_PROVIDER` (`cloudflare`\|`mux`), `CLOUDFLARE_ACCOUNT_ID/API_TOKEN/CUSTOMER_CODE`, `MUX_TOKEN_ID/SECRET` |
| TURN | `CLOUDFLARE_TURN_TOKEN_ID`, `CLOUDFLARE_TURN_API_TOKEN` (empty → STUN only) |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_GRACE_DAYS` (3), `RAZORPAY_API_BASE` (test override) |

`.env.example` is incomplete (`FACEBOOK_REDIRECT_URI`, `GLITCH_SLATE_PORTRAIT_URL`, TURN and `RAZORPAY_API_BASE` are missing; LinkedIn vars are listed but unused). Adding a variable = `configuration.ts` + `.env.example` + this table.

## Secrets rules
- Never commit secrets, tokens or passwords — including test passwords as literals (GitGuardian flags them; generate in tests). Never print them back in chat/PRs/logs. User-pasted credentials are used only for the task they were given for.
- OAuth app secrets, Razorpay keys, Coolify token, Resend key live in Coolify env / the user's head, never in git.

## External dashboards the user controls (you cannot change these)
Google Cloud project `1083454847771` (OAuth consent screen, **Data access scopes** must stay `openid email profile youtube.force-ssl` — Google verified this exact set), Meta app (Facebook login + Live), Razorpay (webhook registered at `/api/billing/webhook`), Resend (sender domain), Cloudflare (TURN), GitHub repo settings, Coolify.

## Sandbox limits worth knowing (cloud Claude sessions)
- `git push --delete <branch>` is refused by the git proxy (HTTP 403) and the GitHub tools have no delete-branch action → ask the user to delete merged branches in the GitHub UI.
- Force-push / `--amend` after pushing may be denied; fix a bad pushed commit by a new commit or a fresh branch + PR.
- Outbound HTTPS goes through a proxy (CA bundle in `/root/.ccr/`); do not disable TLS verification. Headless Google sign-in from the sandbox is silently refused — do not try to automate Google logins (record demos locally).
