# Testing

Everything below runs in CI on every PR and again on `main` before an image is published, so a green local run of the same commands is the bar for opening a PR. Skill: `streambird-test` (has the Postgres helper script).

## The four layers

| Layer | Command | Needs | Lives in | Use it for |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` | nothing | backend + tests (`tsconfig.json`), web app (`web-app/tsconfig.app.json`) | always |
| Unit | `npm test` | nothing | `src/**/*.spec.ts` next to the code | one service in isolation, fakes for repos/HTTP |
| End-to-end | `npm run test:e2e` | **Postgres** (`E2E_DATABASE_URL`), ffmpeg for `slate` | `test/e2e/*.e2e-spec.ts` | HTTP behaviour on the real app: guards, DTOs, DB writes, migrations, payments |
| Browser | `npm run test:ui` | **Postgres**, **built SPA**, Chromium | `test/ui/*.spec.ts` | what a person sees: layout, copy, flows, canvas pixels |

Without `E2E_DATABASE_URL` the e2e specs are skipped (`describeE2E`), so `npm test` is green on a bare checkout. The UI suite fails to boot without it.

## Local setup (copy-paste)

```bash
npm ci && npm ci --prefix web-app
export E2E_DATABASE_URL="$(.claude/skills/streambird-test/local-postgres.sh start)"   # throwaway Postgres on :5544
export PW_CHROMIUM=/opt/pw-browsers/chromium      # only if Playwright's own browser is not installed (cloud sandbox)
npm run typecheck && npm test
(cd web-app && npx tsc -b && npx vite build)        # REQUIRED before test:ui — it serves dist-web/
npm run test:e2e
npm run test:ui                                      # one test: npx playwright test -c test/ui/playwright.config.ts -g "part of title"
```

Single e2e file: `npx jest --config test/e2e/jest-e2e.config.js --runInBand test/e2e/<name>`.

Gotchas that have each cost time:
- **Stale `dist-web/`** → UI tests assert on old markup and fail confusingly. Rebuild the web app after every web change (`vite build` is ~1 s).
- **Stale Postgres `postmaster.pid`** after a container restart → `ECONNREFUSED :5544`. The helper script handles it; by hand, delete the pid file when its process is gone.
- The cloud sandbox runs Postgres as the `postgres` user (root cannot); the helper does this.
- `playwright.config.ts` already passes fake-camera flags and grants camera/mic; do not add `test.use({ launchOptions })` inside a `describe` (Playwright forbids it).
- Playwright `workers: 1`; e2e `--runInBand`. Tests share one app instance and one IP, so **rate limits are shared** (see below).

## Unit tests (`src/**/*.spec.ts`)

- `Test.createTestingModule` with `getRepositoryToken(Entity)` → an in-memory repo. There is a small `inMemoryRepo()` helper copied into several specs (`auth.service.spec.ts`, `studio-sessions.service.spec.ts`, ...): copy the nearest one, do not invent a new style.
- Read environment at call time in code under test (`process.env`) and set/restore it in the test (`review-accounts.ts` is the pattern).
- Test the rule, not the framework: refusals as much as successes (wrong password, missing owner, expired).

## E2E tests (`test/e2e/`)

`harness.ts` is the toolbox:
- `bootApp({ razorpay?, mediamtx?, port? })` migrates the DB, boots the **real** `AppModule` through `configureApp` (same pipeline as `main.ts`) and returns `{ baseUrl, db, mailbox, razorpay, signIn, close }`. **`bootApp` overwrites many env vars** (`Object.assign(process.env, …)`): set test-specific env (e.g. `REVIEW_ACCOUNT_EMAILS`) *after* it, if the code reads env at call time, or before it if read at boot.
- `h.signIn({ superadmin? })` → `{ client, email, accountId }`: a user created through the real code flow, then approved via SQL. `Client` is a cookie-keeping `fetch` wrapper: `get/post/patch/put/delete(path, body)` → `{ status, body }` (paths are relative to `/api`).
- `h.mailbox.codes.get(email)` is the "emailed" login code; `receipts`, `notices` capture other mail. Review accounts and nothing else skip the code.
- `MockRazorpay` (`mock-razorpay.ts`) records every call and signs webhooks like Razorpay.
- `ids('prefix')(n)` makes unique ids so a re-run on the same DB never collides.
- `h.mailbox.decisions` captures the approve/reject emails to users; `h.mailbox.digests` captures the superadmin approval digests; the harness sets `APPROVAL_DIGEST_INTERVAL_HOURS=0` so the timers are off and a test calls `app.get(ApprovalDigestService).run({ now, intervalHours })`.
- `describeE2E(name, fn)` wraps `describe` so the file skips without a DB.

Rules of thumb:
- **Throttled endpoints**: `ThrottlerGuard` limits are per IP and the whole file shares one IP. Put a test that exhausts a limit **last** in its file and keep earlier calls under the limit.
- A new **migration** needs an "existing data" case in `migrations.e2e-spec.ts` (insert old-shape rows, run, assert).
- A payment/plan rule belongs in `payments|autopay|plans.e2e-spec.ts` using the mock.
- `slate.e2e-spec.ts` runs real ffmpeg RTMP; it is the only e2e that needs ffmpeg.

## Browser tests (`test/ui/`)

- `fixture-server.ts` (Playwright `webServer`) boots the real app on `:4310` with the built SPA, plus a control server on `:4311`: `GET /code?email=` (the emailed code) and `POST /approve?email=[&superadmin=1]`.
- `smoke.spec.ts` helpers: `signIn(context)` (cookies land in the browser context), `newStream(...)` (creates a manual Twitch destination then a stream through the API), `addSolidSlides`, `addWallpaper`, `pixel(page,x,y)` (reads the studio `<canvas>` — assert on drawn pixels, not just DOM).
- `compose.spec.ts` is pure geometry (`computeLayout`) with no browser page.
- Prefer **API setup + UI assertion**: create data over `context.request`, then visit the page.
- **Generate passwords/secrets in tests** (`crypto.randomBytes(6).toString('hex')`). Literal passwords in test files trip GitGuardian ("Generic Password"), which fails the PR check and cannot be cleared without rewriting the commit.

### Selector contract (renaming these breaks tests — update both)
Ids: `#layoutSelect`, `#themeSelect`, `#slidesInput`, `#wallpaperInput`, `#email`, `#code`, `#displayName`, `#invitePassword`. Test ids: `slide-counter`, `wallpaper-fit`, `youtube-permission-note`. Classes used by tests: `.studio-resolution-select option` (the **quality** menu only — do not reuse that class for other selects; layout/style use `.tb-select`), `canvas.studio-canvas`, `.busy-overlay-bird`, `.slide-controls`, `.slide-thumb(--active)`, `.meeting-grid`, `.chip-link`, `.go-live-cta`, `.hero-word`, `.hero-studio`, `.hs-dest` (home hero), `.pending-bird`, `.pending-ring--1`, heading "Your studio is being set up!" and the "Setup progress" list (approval page).
Accessible names: icon buttons keep their **full** `aria-label` even when the visible text is short ("Start my camera"/"Camera on", "Create guest invite", "End stream", "Previous slide"), so tests and screen readers are unaffected by label trimming.

## Visual verification (do it for any UI change)
Tests prove behaviour, not looks. Drop a temporary `test/ui/zz-shots.spec.ts` that signs in, opens the page and `page.screenshot({ path })` to the scratchpad at desktop (1366x800) and phone (390x800) widths, **read the PNGs**, then delete the spec before committing. See skill `streambird-ui-change`.

## What to run before a PR
`npm run typecheck && npm test`, rebuild web app, `npm run test:e2e`, `npm run test:ui`. For a change you only touched in one layer you may run a subset while iterating, but run all four once before pushing. State in the PR which tests were added.
