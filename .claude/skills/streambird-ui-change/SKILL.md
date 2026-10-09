---
name: streambird-ui-change
description: Recipe for changing StreamBird's React UI (pages, components, CSS, loading/busy states, host/guest studio chrome) while keeping Playwright selectors and styles safe, then verifying with screenshots. Use for any web-app change.
---

# UI change recipe

Context: `.claude/docs/frontend.md` (map, CSS rules, loading system) and `studio.md` for studio pages.

## Before editing
- Find the existing component/CSS block for the area (`grep -n "class-name" web-app/src/index.css`). Reuse `.panel`, `.icon-btn`, `.chip-link`, `.segmented`, `.checkbox-row` before adding styles.
- Check the **selector contract** in `.claude/docs/testing.md` — ids, test ids, class names and accessible names tests rely on.

## Rules
1. **Loading/busy**: every async button → `{busy && <BirdBusy />}` + `disabled`; first-load of a page/panel → `BirdLoader`; do not build ad-hoc spinners. Open-ended waits → `<BirdBusy overlay={false} />`. In-progress status text ends with `…`, final text does not.
2. **Icon-only/short buttons** keep a full `aria-label` (and `title`). Use `lucide-react` icons with `size` 14–18 and give icon+text buttons a gap (`.icon-btn` has one).
3. **Actions that look like links** (Manage, Schedule…, See pricing) use `.chip-link` (`--sm`/`--lg`), not bare `<Link>`.
4. **Forms**: remember the global `input {width:100%; padding; margin-bottom}`; checkboxes use `.checkbox-row`. Inline controls need explicit width/margin/padding.
5. **Colours** via CSS variables only (dark mode is variable-driven). Never hard-code colours that must work in both themes.
6. **Responsive**: check 390 px wide; labels collapse (`.tb-label`), bars wrap, popovers must not overflow (see `.studio-popover` mobile rule).
7. TS strictness: `import type`, no enums, **no unused imports/vars** (`tsc -b` fails the build).
8. Error handling: `ApiError` → message in `<p className="error">`; never swallow errors silently on user actions.

## Verify (all three)
1. `npm run typecheck`, rebuild: `(cd web-app && npx tsc -b && npx vite build)`.
2. Tests: update/add Playwright tests (`test/ui/smoke.spec.ts` "UI polish" block is the pattern: API setup, then assert in the page; assert computed styles/boxes for layout bugs).
3. **Screenshots**: temporary `test/ui/zz-shots.spec.ts` (sign in via API with the `CONTROL` helper endpoints, create data over `context.request`, `page.setViewportSize`, `page.screenshot`) at 1366×800 and 390×800 → read the PNGs → delete the spec. Template:
   ```ts
   import { test } from '@playwright/test';
   import * as crypto from 'crypto';
   const CONTROL = `http://127.0.0.1:${process.env.UI_CONTROL_PORT ?? 4311}`, APP = `http://127.0.0.1:${process.env.UI_APP_PORT ?? 4310}`;
   const H = { Origin: APP, 'Content-Type': 'application/json' };
   test('shots', async ({ page, context }) => {
     const email = `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`, api = context.request;
     await api.post(`${APP}/api/auth/request-code`, { data: { email }, headers: H });
     const { code } = await (await api.get(`${CONTROL}/code?email=${email}`)).json();
     await api.post(`${APP}/api/auth/verify-code`, { data: { email, code }, headers: H });
     await api.post(`${CONTROL}/approve?email=${email}`);
     await page.goto('/dashboard'); await page.screenshot({ path: process.env.SHOT_DIR + '/dash.png' });
   });
   ```
   Run with `E2E_DATABASE_URL=… PW_CHROMIUM=… SHOT_DIR=<scratchpad> npx playwright test -c test/ui/playwright.config.ts zz-shots`.

## Docs
New component/pattern or a new pitfall → `.claude/docs/frontend.md` (or `studio.md`); new test contract → `testing.md`.
