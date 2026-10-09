# The studio (host + guests + compositor)

The product's core: a **browser-side video mixer**. Guests send camera/mic to the host over WebRTC; the host's browser composites everyone onto a `<canvas>`, mixes audio with Web Audio, and publishes one WebRTC (WHIP) stream to the relay, which forwards it to every destination. No media passes through the NestJS app.

```
guest browsers ── WebRTC mesh ──► host browser (canvas + Web Audio mix)
        ▲  signaling only (Socket.IO /studio)        │ WHIP (SDP over HTTPS, then WebRTC media)
        └──────── StudioSignalingGateway ◄───────────┘          ▼
                                                      MediaMTX path  ──ffmpeg (video copy, audio→AAC)──► RTMP(S) to each destination
```
Server side of this lives in `src/studio/` (signaling, invites, host tokens, TURN credentials) and `src/relay/mediamtx.service.ts` (paths, ffmpeg runOnReady, slate). See `backend.md`.

## Files
| File | Role |
|---|---|
| `web-app/src/studio/compose.ts` | **pure** layout/theme/branding/wallpaper geometry and data (no DOM/React) — unit-tested by `test/ui/compose.spec.ts` |
| `web-app/src/studio/themePaint.ts` | canvas painting helpers: theme background/pattern, wallpaper, slide/wallpaper loaders |
| `web-app/src/studio/useHostStudio.ts` | the host hook (~1960 lines): camera, signaling, peers, draw loop, audio mix, WHIP, slides, scenes, persistence, recovery |
| `web-app/src/studio/useGuestStudio.ts` | guest hook: invite check, password check, signaling, mesh peers |
| `web-app/src/routes/studio/HostStudioPage.tsx` | host UI: top bar, canvas, panels |
| `web-app/src/routes/studio/GuestJoinPage.tsx` | guest join form + in-call grid |
| `web-app/src/components/SlideControls.tsx` | slide controller under the picture |

## Host lifecycle (`useHostStudio`)
1. Load the stream, `mintHostToken`, fetch TURN credentials; open `io('/studio', { auth: { role:'host', sessionId, hostToken, displayName:'Host' } })`; start the draw loop.
2. `startCamera()` (portrait streams ask for `aspectRatio 9/16`), optional `startScreenShare()` (stored as participant `SCREEN_SHARE_ID`).
3. Signaling handshake: server emits `peer-joined`; host sends `signal {type:'request-offer'}`; guest replies with an `offer`; host answers (`handleGuestOffer`). Guests also connect to **each other** (full mesh). `kicked` removes a guest. Layout changes persist via `PATCH /studio-sessions/:id/layout`.
4. **Draw loop** (`frame`): `paintBackground` (theme) → `paintWallpaper` (if set) → `drawFramed` | `drawSpotlight` | `drawGrid` (or `drawBrandSlide` when nobody is on camera and the layout has no slide area) → `drawLogo` → `drawNewsline` (ticker) → crossfade snapshot (`beginTransition`). Timing comes from a **Web Worker tick** (33 ms) so a backgrounded tab does not freeze the broadcast; rAF/setInterval is the fallback.
5. **Audio**: `ensureAudioMix()` builds an `AudioContext` + `MediaStreamDestination` with a constant-zero source (keeps Opus flowing so the relay never sees a video-only stream). Only on-stage participants are mixed; the host's own mic is not fed back. Each guest also receives a **mix-minus** (everyone except themselves).
6. `goLive()`: capture `canvas.captureStream(30)` + the mix track, sendonly `RTCPeerConnection` with **H264 first**, POST the SDP to `stream.whipUrl` (non-trickle: waits, capped, for ICE gathering), remember the `Location` resource, set the `wentLive` flag. `endStream()` clears it.
7. Orientation comes from `stream.orientation` (immutable): portrait = 720×1280 (HD) / 1080×1920, layouts stack, text scales with `min(w/1280, h/720)`.

## Persistence and recovery
- `localStorage` per stream: `streambird:studio:<streamId>:v1` (layout, resolution, branding, theme, scenes, logo data URL, `wentLive`) and a **separate** `…:wallpaper:v1` key (a full quota must not drop the rest; saves are best-effort). **Slides are memory-only.**
- Host drops (tab closed/crash): the backend starts the "technical difficulties" slate after ~10 s (`GlitchRecoveryService`), keeps platform broadcasts up, and ends the stream after 5 min. Reopening the same studio URL with `wentLive` set triggers `resumeLive()` (camera best-effort, audio resume — `audioBlocked` shows a one-click "Enable audio" — then `goLive()` again). The server replays connected guests to the returning host; guests keep their links.
- `beforeunload` is guarded while live.

## Layouts, themes, branding (all in `compose.ts`)
- `LAYOUTS` (`as const satisfies LayoutDef[]`): `{ id, name, group, maxPeople, hasSlide, description }`. Classic (`grid`, `spotlight`, edge to edge) and framed ones (podcast-*, pod-slide-*, anchor-slide-*, panel-slide-*). `LAYOUT_BY_ID`, `isFramedLayout`, `computeLayout(id,w,h)` (landscape) and `computePortraitLayout` (h>w), `orderPeople` (pinning; `HOST_ID='local'`).
- `THEMES: CanvasTheme[]` (`vanilla` = the original plain black look and the default — **never change it**), patterns `none|lines-h|lines-v|grid|dots|diagonal|ruled|pinstripe` painted in `themePaint.ts`.
- Branding: `BRANDING_RANGES` (logo size, name label size, ticker size), wallpaper: `WALLPAPER_RANGES`, `WALLPAPER_MAX_SIDE=1920`, `coverCrop`, `describeWallpaperFit`.
- **Add a layout**: entry in `LAYOUTS` → a case in **both** `computeLayout` and `computePortraitLayout` → check `drawFramed` → extend the `LayoutGroup` union if it is a new group → `compose.spec.ts` iterates every layout/theme and checks geometry invariants (must pass). `#layoutSelect` is generated from `LAYOUTS`. Skill: `streambird-studio-layout`.
- **Add a theme**: append to `THEMES` (a new pattern needs a `PatternKind` + a case in `paintPattern`; new group → `ThemeGroup`). `#themeSelect` is generated.
- Keep `compose.ts` free of DOM/React so it stays testable.

## Slides
`MAX_SLIDES = 40` images only (PNG/JPG/WebP; users export decks/PDFs as images). `addSlides` decodes each (max side 1920), caps to the room left, and keeps a cached 160 px JPEG thumbnail (`slideThumb`) for the controller. `gotoSlide/nextSlide/prevSlide/clearSlides`; ←/→/PageUp/PageDown flip slides (ignored while typing in a field). A screen share replaces the slide area while on. Slides show only in layouts with `hasSlide`.

## Guest side
`useGuestStudio(token)`: `resolveInvite` → (password required?) → `checkInvitePassword` (a wrong password is refused **on the form**, before camera/room; the socket handshake still re-checks) → `io('/studio', { auth:{ role:'guest', token, displayName, password } })` → mesh. Guests never touch the compositor. Status text ending in `…` shows the bird (`overlay={false}` while waiting for others).

## Signaling events (`/studio` namespace)
Server→client: `joined {sessionId, participantId, role}`, `peer-joined {socketId, displayName}`, `peer-left {socketId, role}`, `signal {from,type,payload}`, `error {message}`. Client→server: `signal {to, type: offer|answer|ice-candidate|request-offer|kicked, payload}`, `rtc-state` (diagnostics only).

## Studio page layout (host)
Sticky **top bar** (`.studio-topbar`): Camera, Share, Layout toggle (icon), Invite + lock (password popover with an explicit Save), quality / layout / canvas-style selects, Go live, End. Then the picture (height-capped to the screen so controls stay visible), the layout note, `SlideControls`, destinations, participants, wallpaper, logo/ticker, scenes. Quality select is the only `.studio-resolution-select` (tests rely on it).
