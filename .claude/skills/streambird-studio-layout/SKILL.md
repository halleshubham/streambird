---
name: streambird-studio-layout
description: Add or change a studio canvas layout, canvas theme/style, branding control, wallpaper or slide behaviour in StreamBird's host studio (compose.ts, themePaint.ts, useHostStudio.ts). Use for anything drawn on the broadcast canvas.
---

# Studio canvas work

Context: `.claude/docs/studio.md`. The broadcast is whatever the host's `<canvas>` draws; guests and viewers see exactly that.

## Add a layout
1. `web-app/src/studio/compose.ts`: add an entry to `LAYOUTS` (`id, name, group, maxPeople, hasSlide, description`). New group → extend the `LayoutGroup` union.
2. Add its case to **both** `computeLayout(id, w, h)` (landscape) and `computePortraitLayout` (9:16: layouts **stack** vertically). Return a `LayoutGeometry` — `{ slide: Rect | null, people: Rect[] }` (rects are `{x,y,w,h}` via the `r()` helper) — consistent with neighbours; people are ordered by `orderPeople` (pinned first, host first).
3. Check `drawFramed` in `useHostStudio.ts` draws it (slide area via `drawSlideArea` when `hasSlide`; empty-slot behaviour).
4. `#layoutSelect` is generated from `LAYOUTS` — nothing else to wire. If the default/ids used by tests change, update `test/ui`.
5. Tests: `test/ui/compose.spec.ts` iterates all layouts (people rects inside the frame, no overlaps, slide present iff `hasSlide`, portrait stacks) — it must pass; add a case for anything special. For slide layouts add a pixel assertion in `smoke.spec.ts` (see the slide layout test using `computeLayout` + `pixel()`).

## Add a theme (canvas style)
Append to `THEMES` in `compose.ts` (`id, name, group, bg:[c1,c2], pattern, patternColor, accent, accent2, fg, border, radius, tickerBg, tickerFg, cardBg`). New pattern → `PatternKind` + a case in `paintPattern` (`themePaint.ts`, scale with `unit = min(w/1280, h/720)` so portrait/HD/FHD look alike). **`vanilla` must remain the original plain black look and the default.** Keep styles subtle (news/healthcare/technology/education/legal tone). Backgrounds are cached per `theme:WxH` — if you change painting, the cache key already covers size.

## Branding / wallpaper / slides
Ranges live in `BRANDING_RANGES`, `WALLPAPER_RANGES`; wallpaper cover-crop uses `coverCrop` around a focus point and `describeWallpaperFit` for the exact-size hint; persisted separately from other settings (quota). Slides are in memory (`MAX_SLIDES = 40`, thumbnails cached). New persisted setting → add to the `streambird:studio:<streamId>:v1` shape with a safe default for old saved values.

## Verify
`npm run typecheck`, rebuild web app, `npx playwright test -c test/ui/playwright.config.ts` (compose + smoke). Also look at the canvas: a screenshot of the studio in landscape and a portrait stream (create with `orientation:'portrait'`), with and without a camera/slides. Keep `compose.ts` free of DOM/React.
