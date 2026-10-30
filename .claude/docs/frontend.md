# Frontend (`web-app/`)

Paths below are relative to `web-app/` unless they start with another top-level folder.

React 19 + react-router 7 + Vite + TypeScript, no UI framework, icons from `lucide-react`. One global stylesheet. Built into `dist-web/` and served by the Nest app, so the SPA and API share one origin.

## Map
| Where | What |
|---|---|
| `src/main.tsx` | mounts `BrowserRouter` → `AuthProvider` → `<App/>` + `<BusyOverlay/>` |
| `src/App.tsx` | **all routes** (below) |
| `src/routes/` | one file per page; `routes/admin/*` superadmin pages; `routes/studio/{HostStudioPage,GuestJoinPage}.tsx` |
| `src/components/` | shells/guards (`AppShell`, `AdminShell`, `ProtectedRoute`, `SuperadminRoute`, `HomeRoute`), loaders (`BirdLoader`, `BirdBusy`, `BusyOverlay`), `SlideControls`, `ScheduledStreamPanel`, `UsageMeter`, platform badges/logos, `ThumbnailPicker` (create form, both modes), `LiveThumbnailPanel` (stream page while live), `GuestEmailsField`, `DocsLink` |
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

## Waiting-for-approval page (`routes/PendingApprovalPage.tsx`)
Rendered by `ProtectedRoute` for any non-superadmin without `approvedAt`: "Your studio is being set up!" with a CSS-animated bird/rings scene, a four-step progress list, a line saying we will email them when the studio is ready (approval and rejection both send an email, see `backend.md`), a support mailto (prefilled with the user's email), **Check again** (shows `BirdBusy`, then says what it found) and a 30 s poll of `/auth/me` so the page becomes the dashboard by itself. Motion is off under `prefers-reduced-motion`. Tests: `smoke.spec.ts` "waiting for approval" (uses `page.clock` to fast-forward the poll). The superadmin side of approvals: Admin dashboard + the 12-hourly email (`backend.md`).

## Loading feedback (three tools — pick by situation)
| Tool | Use | Notes |
|---|---|---|
| `BirdLoader loading [compact] [label]` | a page/panel waiting on its first data | big centred bird (compact = fills the content area); stays mounted and plays a fly-out when `loading` flips false — pass the boolean, don't unmount it |
| `BirdBusy` | inside a button or status line while a user-triggered action runs | small flapping logo; keep the button label, set `disabled`; **while mounted it registers with `lib/busy.ts`** |
| `BusyOverlay` (mounted once in `main.tsx`) | automatic | shows a large centred bird + "Working on it…" whenever the busy count > 0 for 250 ms; `pointer-events: none`, so the studio stays usable |

Rules: every async button gets `{busy && <BirdBusy />}`. **The big overlay bird is for actions the user is waiting on, never for information**: in the host studio only statuses with `busy: true` (Starting publish…, Ending stream…, restoring) use it; every other status ending in `…` (a guest joining, reconnecting) gets `overlay={false}`, and each such status must be replaced when it resolves (a guest joining → "X is connected.", with a 15 s fallback). `BusyOverlay` also gives up after 45 s as a safety net. A studio status that ends in `…` is "in progress" (`isInProgress(text)`) and shows the bird; end final messages **without** `…`. For an open-ended wait the user is not blocked on (a guest alone in the room) use `<BirdBusy overlay={false} />`, otherwise the overlay would cover the page forever.

## Superadmin UI kit (`/admin/*`)
Every admin page is `PageHeader` + `Section`/`DataTable` from `web-app/src/components/admin/adminKit.tsx` (also: `Badge` with tones neutral/success/warning/danger/info, `Empty`, `ShowMore`, `When` (compact local time, full time as tooltip), label maps `ROLE_LABEL`/`RESOLUTION_LABEL`, `humanize`, `planLabel`, `statusTone`). Do not hand-roll `<table className="data-table">`, ad-hoc `badge-*` spans or raw enum strings (`qhd`, `company_admin`, `approve_user`) in admin pages. Styles are the "Superadmin" block at the end of `index.css`.
- **Nav** (`AdminShell`): Approvals (with a red count of waiting signups; refreshed on navigation, every minute and when `PENDING_CHANGED_EVENT` from `lib/adminEvents.ts` fires), Companies, Plans, Billing, Analytics, Audit log. On phones it is a single scrolling row.
- **There is no Users page**: Companies search also matches the email of any user on an account (`matchedUserEmail` says which), and per-user Suspend/Reactivate lives in the Users table on the company page. `/admin/users` redirects to Companies. (`GET /superadmin/users?email=` still exists on the server.)
- **Long lists never silently truncate**: Companies is searched (account name, company name, user email) and paged on the server (`GET /superadmin/accounts?q=&limit=&offset=` returns `total`), Audit log pages with "Load older entries", Billing tables show 20 with "Show more", the live-streams list is complete but scrolls inside a capped box (`DataTable tall`).
- **Phones**: secondary columns carry `hide-sm` (hidden ≤640px; put the essentials under the primary cell with `show-sm`), and row action buttons stack, so Approve/Reject/Suspend are always on screen. `test/ui/smoke.spec.ts` ("admin console") asserts this at 390px.
- Destructive actions confirm (`window.confirm`): reject signup, suspend user, suspend account, force end. Row actions use `btn-sm` (+ `danger-button`); page-level actions sit in `PageHeader actions`.

- **Admin sign-in** (`AdminLoginPage`): same identity as the admin header (logo + ADMIN badge, amber top rule), two labelled steps ("Sign in" then "Check your email"), errors as `role=alert`. Tests: `admin login page` block in smoke.spec.

## Cookie consent (optional, off by default)
Google Analytics is **not in `index.html`**; `lib/consent.ts` injects it. The server decides the mode with `COOKIE_CONSENT_BANNER` (default `false`, served by `GET /api/config/public`, fetched by `initConsent()` in `main.tsx`):
- **off (default):** no banner, no "Cookie settings" link, analytics loads for every visitor, and `/privacy` says so.
- **on:** `components/CookieBanner.tsx` (mounted in `App.tsx`, hidden on `/join/*` and `*/studio`) shows Accept/Reject with equal weight; analytics loads only after Accept (choice in localStorage `streambird:consent:v1`); `CookieSettingsLink` in the landing, login and app footers reopens the banner; `/privacy` describes the opt-in. Use this for EU/UK visitors (GDPR/ePrivacy need opt-in).
If the setting can't be fetched, nothing loads. Never add another tracking/marketing script outside this module, and keep `/privacy#cookies` accurate. Playwright's `use.storageState` pre-answers the banner (Reject) for every test; the `cookie consent` tests stub `/api/config/public` to pick a mode.

## Brand page
`/brand` (`routes/BrandPage.tsx`, nav link "Brand"): the asset library and brand kits. Library: a drag-and-drop zone (`label.brand-drop` around the real `input#assetFile`, aria-label "Image (PNG, JPG, WebP or GIF (logos only), up to 4 MB)"; a GIF is accepted for the Logo type only, the server refuses it for other types), the chosen file shown with a preview, Upload disabled until a file is chosen, a usage meter that turns amber at 80%, an empty-state hint. Kits: one compact card per kit (`KitSummary`: live `KitPreview`, "Account default" badge, channels using it, Edit button `aria-label="Edit <name>"`); only one form is open at a time (`KitEditor`, `aria-label="Brand kit <name>"` / "New brand kit", opened by the "New brand kit" button); the form has a live preview, "Save kit" is disabled until something changed, "Close without saving". Every action confirms in a `role="status"` line (`.brand-notice`), errors in `role="alert"`. Free shows `data-testid="brand-free-notice"` and no forms. API in `api/assets.ts`; images are `<img src=/api/assets/:id/file>`. The lower-third panel shows an "On air" indicator (`.on-air`) and Enter in its text fields shows the banner.
