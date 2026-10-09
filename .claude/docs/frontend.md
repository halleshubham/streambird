# Frontend (`web-app/`)

Paths below are relative to `web-app/` unless they start with another top-level folder.

React 19 + react-router 7 + Vite + TypeScript, no UI framework, icons from `lucide-react`. One global stylesheet. Built into `dist-web/` and served by the Nest app, so the SPA and API share one origin.

## Map
| Where | What |
|---|---|
| `src/main.tsx` | mounts `BrowserRouter` → `AuthProvider` → `<App/>` + `<BusyOverlay/>` |
| `src/App.tsx` | **all routes** (below) |
| `src/routes/` | one file per page; `routes/admin/*` superadmin pages; `routes/studio/{HostStudioPage,GuestJoinPage}.tsx` |
| `src/components/` | shells/guards (`AppShell`, `AdminShell`, `ProtectedRoute`, `SuperadminRoute`, `HomeRoute`), loaders (`BirdLoader`, `BirdBusy`, `BusyOverlay`), `SlideControls`, `ScheduledStreamPanel`, `UsageMeter`, platform badges/logos, `ThumbnailPicker`, `GuestEmailsField`, `DocsLink` |
| `src/api/` | `client.ts` (`api.get/post/patch/delete`, `ApiError(message,status)`), one module per domain (`auth`, `streams`, `studio`, `connections`, `billing`, `plans`, `team`, `accounts`, `superadmin`) |
| `src/context/` | `AuthContext/AuthProvider`: `useAuth()` → `{status: loading|authenticated|anonymous, user, accountId, login, refresh}` |
| `src/studio/` | host/guest studio logic (see `studio.md`) |
| `src/lib/` | `busy.ts` (busy counter), `schedule.ts`, `deleteUpcoming.ts` |
| `src/types/api.ts` | shared API types — add new response shapes here |
| `src/docs.ts` | links to the user docs site (`shackyapps.in/docs/streambird/`) |
| `public/` | `logo.png` (also the loader bird), icons, `glitch-slate*.mp4/png` (fallback slates; see `studio.md`) |

### Routes (`App.tsx`)
- Public: `/` (`HomeRoute`: anonymous → `LandingPage`, signed in → `/dashboard`), `/login`, `/signup-company`, `/privacy`, `/terms`, `/join/:token` (guest, no account), `/admin/login`, `*` → `NotFoundPage`.
- Signed in (`ProtectedRoute`; unapproved non-superadmin → `PendingApprovalPage`): `/dashboard`, `/connections`, `/billing`, `/streams/new`, `/streams/upcoming`, `/streams/:id`, `/team` inside `AppShell`; **`/streams/:id/studio` is deliberately outside `AppShell`** (no nav bar).
- Superadmin (`SuperadminRoute` → `AdminShell`): `/admin`, `/analytics`, `/users`, `/accounts`, `/accounts/:id`, `/plans`, `/billing`, `/audit-log`. Add admin pages as siblings there.
- Real API routes always live under `/api` (the SPA fallback serves `index.html` for every other GET). Dev: Vite proxies `/api` and `/socket.io` to `localhost:3000`.

## Conventions
- **Data**: call `src/api/*`; errors are `ApiError` → show `e instanceof ApiError ? e.message : 'fallback'` in `<p className="error">`. A 204 resolves `undefined`.
- **Page states**: loading → `BirdLoader`; error → `.error`; empty → a short paragraph, ideally with a `chip-link` action.
- **Icon-only or shortened buttons keep a full `aria-label`** (tests and screen readers use it): see the selector contract in `testing.md`.
- TS is strict: `verbatimModuleSyntax` (use `import type`), `erasableSyntaxOnly` (no enums/parameter properties), `noUnusedLocals/Parameters` — unused imports **fail the build** (`tsc -b`). Lint is `oxlint` (`npm run lint --prefix web-app`; `react/rules-of-hooks` is an error, a few existing warnings are known).
- Do not add a UI/CSS framework. Do not introduce state libraries; hooks + context is the pattern.

## Styling (`src/index.css`, ~2400 lines, single file)
- Theme = CSS variables on `:root` (`--text --text-h --bg --card-bg --border --accent --accent-hover --error --warning`). Dark mode is **only** `@media (prefers-color-scheme: dark)` overriding those variables — always use variables, never raw colours, for anything that must work in both.
- Class names are plain kebab-case with BEM-ish `--modifier`. Shared blocks: `.panel`, `.icon-btn(--small|--accent|--danger)`, `.chip-link(--sm|--lg)`, `.segmented`, `.checkbox-row`, `.field-hint`, `.docs-hint`, `.error`, `.success`.
- The newest additions live in the "UI polish" block near the end of the file (chips, segmented control, busy overlay, studio top bar, slide controls). Add new feature CSS next to the related existing rules, or append a clearly commented block.
- **Pitfalls**
  1. A bare `input, textarea, select { width:100%; padding; margin-bottom }` rule applies to *every* control. Checkboxes/radios are re-reset; any other inline control (file, number, small select) needs explicit `width/margin/padding`. This is what once misaligned the "Require a password" checkbox.
  2. `.landing-section--alt > * { max-width:1100px; margin-left/right:auto }` beats single-class margin rules. Use `margin: X auto Y` on children there, or they sit off-centre (this broke the currency switch).
  3. Global `button` styling is the accent-filled look; a "plain" button must override background/border/colour **and** their `:hover:not(:disabled)` state.
  4. A `<label>` is `display:block; font-weight:600` globally — a label used as a button needs its own class (`label.slide-add-btn`).
  5. Sticky/fixed elements: the studio top bar is sticky only above 720 px wide; it is three rows tall on phones.
- Verify layout changes with screenshots at ~1366×800 and 390×800 (skill `streambird-ui-change`).

## Home page hero (`routes/LandingPage.tsx`, `components/HeroShowcase.tsx`)
Pure-CSS motion, no JS timers: a pulsing "live" pill, an H1 whose platform name cycles YouTube → Facebook → Twitch (`.hero-word`, three words in one grid cell, 9 s loop, delays 0/3/6 s; a visually-hidden sentence gives screen readers the plain headline), drifting glow blobs, and `HeroShowcase`, a decorative (`aria-hidden`) miniature of the studio (slide, two speaking tiles, ticker, three destinations going live). Every animation is switched off under `prefers-reduced-motion` (the list at the end of the hero CSS block — **add any new animated hero class there**). To change the cycle, edit `HERO_WORDS` and the keyframe timing together.

## Loading feedback (three tools — pick by situation)
| Tool | Use | Notes |
|---|---|---|
| `BirdLoader loading [compact] [label]` | a page/panel waiting on its first data | big centred bird (compact = fills the content area); stays mounted and plays a fly-out when `loading` flips false — pass the boolean, don't unmount it |
| `BirdBusy` | inside a button or status line while a user-triggered action runs | small flapping logo; keep the button label, set `disabled`; **while mounted it registers with `lib/busy.ts`** |
| `BusyOverlay` (mounted once in `main.tsx`) | automatic | shows a large centred bird + "Working on it…" whenever the busy count > 0 for 250 ms; `pointer-events: none`, so the studio stays usable |

Rules: every async button gets `{busy && <BirdBusy />}`. A studio status that ends in `…` is "in progress" (`isInProgress(text)`) and shows the bird; end final messages **without** `…`. For an open-ended wait the user is not blocked on (a guest alone in the room) use `<BirdBusy overlay={false} />`, otherwise the overlay would cover the page forever.
