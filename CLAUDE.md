# CLAUDE.md — StreamBird

StreamBird is a browser live-streaming studio and simulcast service (live at https://streambird.app): a host goes live once to YouTube/Facebook/Twitch with remote guests, layouts and branding. **NestJS + TypeORM + Postgres backend (`src/`), React SPA (`web-app/`), MediaMTX + ffmpeg media path.** AGPL-3.0, solo founder (ShackyApps), INR billing via Razorpay.

## Read before you change anything
Agent knowledge lives in **`.claude/`** (not in this file). Open only what you need:

| Task touches… | Read |
|---|---|
| anything, first time | `.claude/docs/overview.md` (stack, repo map, glossary) |
| API, DB, auth, streams, scheduling, providers | `.claude/docs/backend.md` |
| the studio, canvas, layouts/themes, slides, guests | `.claude/docs/studio.md` |
| pages, components, CSS, loading states | `.claude/docs/frontend.md` |
| plans, limits, payments | `.claude/docs/billing-and-plans.md` |
| running or writing tests | `.claude/docs/testing.md` |
| env vars, CI, deploy, secrets | `.claude/docs/operations.md` |
| "why is it like this?", traps | `.claude/docs/decisions-and-gotchas.md` |

Index of all docs: `.claude/docs/README.md`.

## Skills (workflows) — `.claude/skills/<name>/SKILL.md`
`streambird-dev-workflow` (every change, start here) · `streambird-test` · `streambird-deploy` · `streambird-add-migration` · `streambird-backend-feature` · `streambird-ui-change` · `streambird-studio-layout` · `streambird-add-platform` · `streambird-docs-maintenance`. Invoke the matching one with the Skill tool before you start that kind of work.

## Commands
```bash
npm ci && npm ci --prefix web-app          # install
npm run typecheck                          # backend + tests + web app
npm test                                   # unit (Jest)
export E2E_DATABASE_URL="$(.claude/skills/streambird-test/local-postgres.sh start)"   # throwaway Postgres
(cd web-app && npx tsc -b && npx vite build)   # REQUIRED before UI tests (they serve dist-web/)
npm run test:e2e                           # real Postgres + real app + mock Razorpay
npm run test:ui                            # Playwright (set PW_CHROMIUM=/opt/pw-browsers/chromium in the cloud sandbox)
npm run start:dev                          # backend with watch (needs .env: DATABASE_URL, ENCRYPTION_KEY_BASE64)
npm run migrate                            # apply migrations/*.sql
```
CI (`.github/workflows/ci.yml`) runs exactly typecheck → unit → build → e2e → UI on every PR, and again on `main` before the image is published.

## Rules that always apply
1. **Test before you claim done.** Add/adjust tests at the right layer (unit / e2e / UI) for every behaviour change, run the full set (`testing.md` pre-PR checklist), and say which tests you added. For UI changes also look at screenshots (desktop 1366×800 + phone 390×800).
2. **Never commit or print secrets**, including password-like literals in tests (GitGuardian fails the PR; generate with `crypto.randomBytes`). User-pasted tokens/passwords are used for the asked task only, passed inline as env vars, never written to files; remind the user to rotate them.
3. **The user decides when to merge and deploy.** Open a PR for each change; merge (squash) and deploy only when told. Deploy only after the image build for the merge commit succeeded (`streambird-deploy`).
4. **Migrations are hand-written SQL** in `migrations/` (next number after 0016), backward compatible, with an existing-data case in `test/e2e/migrations.e2e-spec.ts`. They run on every container start.
5. **Env vars are read only in `src/config/configuration.ts`** (+ update `.env.example` and `operations.md`).
6. **Keep the YouTube scope `youtube.force-ssl`** and do not call new YouTube APIs without checking `backend.md` — Google's verification is approved for exactly that set.
7. **Do not break test contracts**: ids/test ids/accessible names listed in `testing.md` ("Selector contract"). Shortened UI labels keep their full `aria-label`.
8. **Vanilla canvas theme and landscape behaviour must stay unchanged** unless asked; vertical (9:16) is per-stream and immutable after creation.
9. Single backend process is assumed (some state is in memory). Do not introduce multi-instance assumptions.
10. Update `.claude/` docs/skills in the same PR when your change makes them wrong (`streambird-docs-maintenance`).

## Working with this user
- Terse, practical requests; they review in the browser on the live site. They often say "merge and deploy once CI is green" — that means: wait for CI, squash-merge, wait for the image, deploy with the token they provide, verify live, report.
- Report outcomes plainly with what was verified and what was not. Surface decisions that are theirs (pricing, scopes, auth bypasses) instead of choosing silently.
- Ask for a fresh Coolify token on a 401; do not retry old ones.

## Layout cheat sheet
`src/<module>/` backend (spec beside code) · `migrations/` SQL · `web-app/src/{routes,components,api,studio,lib}` SPA · `test/e2e` (harness.ts) · `test/ui` (fixture-server.ts) · `deploy/mediamtx` · `.claude/{docs,skills}` agent KB · `README.md` human feature notes (Status intro is stale) · `PRICING.md` pricing analysis.
