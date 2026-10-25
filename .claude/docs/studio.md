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
7. Orientation comes from `stream.orientation` (immutable): portrait = 720×1280 (HD) / 1080×1920 / 1440×2560 (2K), layouts stack, text scales with `min(w/1280, h/720)`.

## Persistence and recovery
- `localStorage` per stream: `streambird:studio:<streamId>:v1` (layout, resolution, branding, theme, scenes, logo data URL, `wentLive`) and a **separate** `…:wallpaper:v1` key (a full quota must not drop the rest; saves are best-effort). **Slides are memory-only.**
- Host drops (tab closed/crash): the backend starts the "technical difficulties" slate after ~10 s (`GlitchRecoveryService`), keeps platform broadcasts up, and ends the stream after 5 min. Reopening the same studio URL with `wentLive` set triggers `resumeLive()` (camera best-effort, audio resume — `audioBlocked` shows a one-click "Enable audio" — then `goLive()` again). The server replays connected guests to the returning host; guests keep their links.
- `beforeunload` is guarded while live.

## Layouts, themes, branding (all in `compose.ts`)
- `LAYOUTS` (`as const satisfies LayoutDef[]`): `{ id, name, group, maxPeople, hasSlide, description }`. Classic (`grid`, `spotlight`, edge to edge) and framed ones (podcast-*, pod-slide-*, anchor-slide-*, panel-slide-*). `LAYOUT_BY_ID`, `isFramedLayout`, `computeLayout(id,w,h,count?)` (landscape) and `computePortraitLayout` (h>w), `orderPeople` (pinning; `HOST_ID='local'`).
- `THEMES: CanvasTheme[]` (`vanilla` = the original plain black look and the default — **never change it**), patterns `none|lines-h|lines-v|grid|dots|diagonal|ruled|pinstripe` painted in `themePaint.ts`.
- Branding: `BRANDING_RANGES` (logo size, name label size, ticker size); `Branding.logoPosition` `'left'|'right'` (top corner, 16 px margin; saved in the persisted branding and in scenes; a missing value means left, so older saved streams are unchanged), wallpaper: `WALLPAPER_RANGES`, `WALLPAPER_MAX_SIDE=1920`, `coverCrop`, `describeWallpaperFit`.
- **Scalable "4 to 8" panels** (`panel-gallery/featured/stage`, `panel-slide-side/strip/centre`): defs carry `minPeople`; `computeLayout` takes the on-stage count (`drawFramed` passes `people.length`) and returns exactly that many tiles (clamped 1..8), so tiles re-flow as guests join/leave. `panel-featured` puts the pinned person (else host) in the big tile. `compose.spec.ts` checks n=1..8 at every size.
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

## Local recording (Pro)
`web-app/src/studio/recorder.ts` records the **composited stream** (`canvas.captureStream(30)` + the mixed audio destination) with `MediaRecorder` on the host's own computer; nothing is uploaded. MP4 when the browser can, else WebM. With the File System Access API (`showSaveFilePicker`, must run inside the click) chunks are written to the picked file every 2 s; otherwise they stay in memory and download on Stop. Gated by `plans.can_record` (migration 0018: Pro + Business) via `GET /plans/me` `canRecord` — **UI-level gate only**, since the bytes never touch the server. Quality select is locked while recording; End stream and leaving the page stop it; `beforeunload` warns while it runs. Buttons: `Record to this computer`, `Record to this computer (Pro plan)` (locked, goes to /billing), `Stop recording`. Cloud recording/storage is a separate, later feature.

## Background removal (green screen + "Any background", Pro)
Per participant (host and each guest), done in the **host's** compositor, never on the server; gated by `plans.can_chroma_key` (migration 0019: Pro + Business, `/plans/me` `canChromaKey`, a UI-level gate: the pixels never reach the server). `ChromaSettings {enabled, mode: 'color'|'person', keyColor, similarity, smoothness, spill}` (sliders 0–100) in `web-app/src/studio/chromaKey.ts`. Two methods share one pipeline and one WebGL canvas per keyed person (`ChromaKeyer`, premultiplied alpha):
- **`mode: 'color'` (green screen)**: CbCr-distance key; `chromaAlpha()` is the reference the tests pin, the fragment shader must agree.
- **`mode: 'person'` (any background)**: MediaPipe Selfie Segmenter (`personSegmenter.ts`, `@mediapipe/tasks-vision`, model `public/models/selfie_segmenter.tflite` 250 KB committed, WASM runtime copied from node_modules into `dist-web/mediapipe/` by the `mediapipeRuntime` vite plugin; library `import()`ed only on first use; GPU delegate then CPU). The video is shrunk to 256 px for the model; the 0–1 "person" mask is smoothed over time (`smoothMask`) and uploaded as a texture; `renderPerson` turns it into alpha (`personAlpha`: threshold from "Cut-out strength", edge width from "Edge softness"). Masks are refreshed by `updateMasks()` at the start of each frame (about 15/s, adaptive); **each mask call blocks the draw loop, so if masks average over 150 ms (after 5) every cut-out is switched off with a message** (`SEG_TOO_SLOW_MS`). A failed model load switches cut-outs back to green screen/off with a message. The camera shows until the first mask exists. Test seam: `window.__SB_TEST_SEGMENTER__` (`{init?, mask()}`) replaces the model in browser tests.
`useHostStudio.drawCell` is the single place a person's tile is drawn: if `isKeyed(p)` it draws (framed layouts) no card unless the person has their own picture, then the picture "cover"-cropped, then the keyed video; classic grid/spotlight draw the picture over the cell and the keyed video in the contain-fit area. Without a picture the wallpaper / canvas style shows through. Settings live on `Participant.chroma/chromaBg/keyer/mask` (guests: memory only; host: settings incl. mode in the `…:v1` persisted state, picture under `…:chromabg:v1`). Actions `setChroma`, `setChromaPreview` (panel open ⇒ keep masks coming), `getChromaMask`, `setChromaBackground`. UI: `components/ChromaPanel.tsx` under the person's row (button "Background for <name>", `aria-expanded`; locked + "· Pro" and /billing on other plans): method switch (Green screen | Any background), live raw-camera preview (click to pick the screen colour, green-screen mode) next to a live "how it will look" preview, presets, sliders, Reset, picture behind; `data-cutout-state` on the group. If WebGL is unavailable `setChroma` refuses with a message. **Not done on purpose**: guest-side segmentation (each guest cut out on their own computer, to spread the load) — everything runs on the host's machine. Tests: `test/ui/chroma.spec.ts` (maths, smoothing) and the "background removal (Pro)" block in `smoke.spec.ts` (real shader on the fake green camera; a fake segmenter with a known mask for pixel checks incl. a guest; load failure; too-slow guard; persistence; the real model starting).

## Lower-third banner (Pro/Business)
`web-app/src/studio/lowerThird.ts` (pure drawing + settings: title, subtitle, style `bar|accent|glass`, `autoHideSec`) and `components/LowerThirdPanel.tsx`. Drawn by `drawLowerThirdBanner` in `useHostStudio.ts` right after the ticker (so it sits above the ticker bar; in vertical it keeps 12% clear of the bottom edge). Slides in/out over `LOWER_THIRD_MS` via a per-frame progress value. Gated by `plans.can_lower_third` (`/plans/me` `canLowerThird`, migration 0021); not drawn on plans without it. Settings and saved texts (`lowerThirdPresets`, max 12) are per stream in localStorage (`lowerThird`, `lowerThirdPresets`), not in scenes; shown/hidden state is never persisted. Not to be confused with the per-person name label (`nameFontSize`), which the code comments also call a lower third. UI tests: `lower third banner (Pro)` in `smoke.spec.ts` (accent stripe pixel #7c3aed).

## Go-live notice
Right after the host presses Go live (`goLive()` in `useHostStudio.ts`), `goLiveNotice` is true for `GO_LIVE_NOTICE_MS` (10 s) and `HostStudioPage` shows a `role="status"` banner (`data-testid="golive-notice"`): "You're live. <YouTube, Facebook and Twitch> can take about 5–10 seconds to start showing your stream. Keep this tab open." (names from the stream's destinations, `goLiveNames`), with a shrinking progress bar and a dismiss button (`aria-label="Dismiss this notice"`). It is not shown for quiet re-publishes (`goLive({ announce: false })`, used when `resumeLive` restores a studio after a reload) and is cleared when the stream ends. UI tests fake the WHIP answer (`page.route('**/*whip*')` + a no-op `setRemoteDescription`) to go "live" without MediaMTX.
