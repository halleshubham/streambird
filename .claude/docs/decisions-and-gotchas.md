# Decisions, history and traps

Short "why" records. When code looks odd, check here before "fixing" it. Add a line when you make a non-obvious call.

## Product / platform decisions
- **YouTube scope = `youtube.force-ssl` only** (PR #28). `youtube.readonly` cannot create broadcasts; `youtube.upload` does not cover `liveBroadcasts`/`liveStreams`; `youtube` (broader) was removed to satisfy Google's "narrowest scope" review. Google's OAuth verification is **approved** for this set. Adding any scope, or calling an API outside the documented list, risks the approval. The privacy policy and Connections page quote the permission wording — keep them in sync (tests pin it).
- **No video upload through the API.** The picture goes RTMP → the ingest address returned by `liveStreams.insert`.
- **Facebook broadcasts are not pre-created** for scheduled streams (Graph API rejects "Scheduled Live" — `(#100) Scheduled Live has been deprecated`); only YouTube pre-creates (`canPrescheduleBroadcast`).
- **Compositing in the host's browser** (canvas + Web Audio), not on the server: server cost stays near zero; a paid server-side compositor (`compositing_mode='server_egress'`) exists only in the schema.
- **Guests are a WebRTC mesh to the host** (no SFU). Fine for a handful of guests; the signaling gateway is the seam for an SFU later. TURN credentials come from Cloudflare.
- **ffmpeg does the RTMP push** (MediaMTX `runOnReady`) because MediaMTX's own RTMP forward rejects WHIP's Opus audio; video is copied, audio becomes AAC. Pinned image `bluenviron/mediamtx:…-ffmpeg`.
- **Orientation is immutable** after creation (the canvas, slate and destinations are all sized at create time). The portrait slate is a separate MP4.
- **Vanilla theme must stay exactly the original look** (user requirement); new styles are additive and subtle.
- **Pricing**: ladder Free / Starter ₹999 / Pro ₹1,999 / Business ₹4,999 / Day Pass ₹199, comparable to StreamYard but inside self-hosted cost limits (`PRICING.md`). Billing is Razorpay (autopay default).
- **Review accounts**: built so Google's reviewers could sign in without an admin or an email code; deliberately a *bypass for listed emails only*. In production `REVIEW_ACCOUNT_EMAILS` is unset now. Never set it for real users.

## Engineering decisions
- Migrations are hand-written SQL, run at every container start; `synchronize:false`; entities listed explicitly.
- Cookie sessions + CSRF origin check, not bearer tokens, for the SPA; API keys (`x-api-key`) remain for scripts.
- One global `index.css`, no CSS framework; dark mode via `prefers-color-scheme` only.
- Studio timing uses a **Web Worker tick** so broadcasts do not freeze in background tabs.
- Guest password is verified **before** the guest enters the room (new public throttled endpoint) *and* again at socket handshake; the host's password only applies to invites created after pressing **Save**.
- Squash merges; one change per PR; the user decides when to merge and deploy.

## Traps (each one has bitten)
| Trap | What to do |
|---|---|
| Stale `dist-web/` before UI tests | rebuild web app first |
| Literal passwords in tests → GitGuardian "Generic Password" fails the PR | generate with `crypto.randomBytes` |
| Shortened button labels break Playwright selectors | keep the full `aria-label` |
| New select reusing `.studio-resolution-select` breaks the quality-menu tests | use `.tb-select` |
| `input { width:100% }` global rule | override per control type |
| `.landing-section--alt > *` margin override | use `margin: X auto Y` |
| `BirdBusy` mounted forever shows the full-screen bird forever | `overlay={false}` for open-ended waits |
| `bootApp()` resets env vars | set env after it for call-time reads |
| Throttle limits are per IP, shared across a test file | put exhausting tests last |
| New entity but no `database.module.ts` entry | add to the explicit list |
| DTO field without a decorator is rejected (whitelist + forbidNonWhitelisted) | decorate every accepted field |
| `@Roles` before `AccountGuard` | guard order matters |
| Env var read outside `configuration.ts` | keep config in one place |
| In-memory state (glitch, OAuth selections) | single process only |
| Google refuses headless/automated sign-in silently | record OAuth demos by hand |
| `git push --delete` / force push in the sandbox | not possible; use UI / new branch |
| Coolify token expired (401) | ask the user for a fresh one |
| An outside call with no timeout (platform API, relay, MediaMTX) inside something that must finish (ending a stream) | wrap it in `withTimeout` and make it best-effort; log what failed |
| Docs/skills claim something the code no longer does | update `.claude/` in the same PR |

## Known gaps / ideas not built
LinkedIn provider; refunds, GST invoices, proration; server-side max-quality enforcement; TURN self-hosting; separate docs page for the new studio layouts/styles/vertical; CI ffmpeg-install timeout/retry; remove stale README "Status" section; complete `.env.example`.
