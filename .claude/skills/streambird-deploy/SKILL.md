---
name: streambird-deploy
description: Deploy StreamBird (or the shackyapps-landing site) through Coolify after a merge, waiting for the container image build first, then verify production. Use only when the user asks to deploy.
---

# Deploying

Only when the user asks. Merge first (user says "merge"), then:

1. **Wait for the image** of the merge commit (the image is only built from a green `main`):
   ```bash
   .claude/skills/streambird-deploy/wait-for-build.sh <merge-commit-sha>   # exit 0 = published, 1 = build failed
   ```
   If the user says "check again": re-run it; do not assume a stale answer. Never deploy the old image to "save time".
2. **Deploy** with the token the user gave you (this session's `COOLIFY_API_TOKEN` env is often expired — a 401 means ask for a fresh token, don't retry):
   ```bash
   COOLIFY_API_TOKEN='<token from the user>' .claude/skills/streambird-deploy/deploy.sh streambird   # or: landing
   ```
   It triggers `POST /api/v1/deploy?uuid=…&force=true`, polls until `finished`, then prints `health 200` and `app status: running:healthy`. Token goes only in the inline env var — never into a file, commit, PR or message.
3. **Verify the change is live**, not just that the deploy finished:
   - API change: call the new endpoint (an unknown-token request returning 404 instead of 404-route-not-found proves the route exists; check status codes).
   - UI change: fetch `https://streambird.app/`, extract the `/assets/index-*.js|css` names and grep for a new class/string (`curl -s …/assets/index-XXXX.js | grep -c "new-class"`).
   - Config change: check the env var through the Coolify API (`GET /api/v1/applications/<uuid>/envs`).
   - Never sign in as a real or review user to "test"; do not run destructive calls in production.
4. **Report**: deployment id, health, what you verified, and a reminder to rotate any token/secrets pasted in chat.

## Env var changes (no code)
Coolify API: `GET/PATCH/DELETE https://admin.shackyapps.in/api/v1/applications/<uuid>/envs[/<env uuid>]` (`PATCH` body `{"key":…,"value":…}`; a var can exist twice — normal and preview, delete both). Then run the deploy script (env is read at boot).

## Rollback
Redeploy a previous image tag from Coolify's UI (the user does this) or revert the merge via a new PR. Remember migrations are forward-only: schema stays migrated.

Ids: streambird app uuid `gb8rghmifpq7hb5y6gkkcf6e` (https://streambird.app), landing app uuid `qywy4fxyjk1yowjsfnoowbb9` (https://shackyapps.in). More: `.claude/docs/operations.md`.
