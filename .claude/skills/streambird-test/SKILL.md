---
name: streambird-test
description: Set up and run StreamBird's test layers (typecheck, Jest unit, Jest e2e on real Postgres, Playwright UI), choose where a new test belongs, and debug common failures. Use when adding/running tests or when CI fails.
---

# Testing StreamBird

Full reference: `.claude/docs/testing.md` (layers, harness API, selector contract). This skill is the procedure.

## Run everything (the pre-PR bar)
```bash
npm ci && npm ci --prefix web-app                                    # once
export E2E_DATABASE_URL="$(.claude/skills/streambird-test/local-postgres.sh start)"
export PW_CHROMIUM=/opt/pw-browsers/chromium                         # cloud sandbox only
npm run typecheck && npm test
(cd web-app && npx tsc -b && npx vite build)                         # UI tests serve dist-web/
npm run test:e2e
npm run test:ui
```
Subset while iterating: `npx jest src/studio` · `npx jest --config test/e2e/jest-e2e.config.js --runInBand test/e2e/<file>` · `npx playwright test -c test/ui/playwright.config.ts -g "<title>"`. Stop Postgres with `local-postgres.sh stop`.

## Where does my test go?
| Change | Test |
|---|---|
| pure rule / service logic | unit `src/<module>/<x>.spec.ts` (copy the nearest `inMemoryRepo` pattern) |
| endpoint, guard, DTO, DB write, migration, throttle, payment | e2e `test/e2e/*.e2e-spec.ts` via `bootApp()` + `Client` (`harness.ts`) |
| layout/geometry in `compose.ts` | `test/ui/compose.spec.ts` (no browser page needed) |
| what the user sees / clicks / canvas pixels | UI `test/ui/smoke.spec.ts` (API setup + UI assertion) |
| new migration | extend `test/e2e/migrations.e2e-spec.ts` with an existing-data case |

## Writing rules
- Assert refusals as well as successes. Prefer API setup (`context.request`) then assert in the page.
- Generate passwords/secrets at run time (`crypto.randomBytes(6).toString('hex')`) — literals fail GitGuardian.
- Rate limits are per IP and shared across a file: put limit-exhausting tests last.
- Do not rename ids/test ids/accessible names in the selector contract without updating tests. Keep full `aria-label`s on shortened buttons.
- No `test.use({launchOptions})` inside a `describe` (config already has fake camera/mic).
- Do not use `sleep` to wait for state in Playwright; use `expect(...).toBeVisible()/toHaveText()/poll`. A short `waitForTimeout` is acceptable only for canvas redraws.

## Failure triage
| Symptom | Likely cause / fix |
|---|---|
| UI test asserts old text/markup | stale `dist-web/` → rebuild web app |
| `ECONNREFUSED :5544` | Postgres not running or stale `postmaster.pid` → `local-postgres.sh start` |
| e2e all skipped | `E2E_DATABASE_URL` not exported in this shell |
| `slate` e2e fails | ffmpeg missing |
| `unused variable` TS6133 in web-app | unused import breaks `tsc -b`; remove it |
| 429 in a test | shared throttle; reorder/lower calls |
| GitGuardian "Generic Password" | literal password in a test; generate it |
| works locally, fails in CI only | CI uses a clean DB and Node 22; check ordering/leftover data and time-based assertions |

## Visual verification (UI changes)
Create `test/ui/zz-shots.spec.ts` temporarily: sign in through the API, open the page, `page.screenshot({ path: '<scratchpad>/x.png' })` at 1366×800 and 390×800, read the PNGs, **delete the spec before committing**.
