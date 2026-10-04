# StreamBird

Open-source multi-platform live-streaming service: go live once, simulcast to
YouTube Live, Facebook Live, Twitch, and (gated) LinkedIn Live. Standalone —
no dependency on any other product's database, auth, or billing.

Full architecture, cost model, and build order live in the implementation
plan this repo was scaffolded from; the summary here is just enough to run
what exists today.

## Status

Early scaffold. Working so far:

- `POST /accounts` — issues an API key (shown once).
- `GET /platform-connections`, `DELETE /platform-connections/:id`.
- `POST /streams` — creates a `LiveStream`, fans out `createBroadcast()` to
  each requested destination's `StreamProvider` in parallel, and — as long
  as at least one destination succeeds — creates a Cloudflare Stream Live
  input and registers each successful destination as an output on it.
  Partial failures are first-class: a stream can go live to 3 of 4
  requested destinations, with the 4th surfaced as `status: 'failed'` and
  retryable via `POST /streams/:id/destinations/:destinationId/retry`.
- `GET /streams/:id`, `GET /streams/:id/status`, `POST /streams/:id/end`.
- `TwitchProvider` (static ingest URL/key, pasted manually — no OAuth),
  `YouTubeProvider` (full OAuth connect flow against the YouTube Data API
  v3: `liveBroadcasts.insert` + `liveStreams.insert` + `.bind`, with
  `enableAutoStart`/`enableAutoStop` so YouTube flips the broadcast
  live/complete itself the moment it sees — or stops seeing — the RTMP
  stream), and `FacebookProvider` (OAuth connect flow against the Graph
  API's Live Video endpoints — `POST /{page-id}/live_videos`, with a
  Page-picker step for accounts managing more than one Page) are all
  implemented. Both YouTube's `youtube` scope and Facebook's
  `pages_manage_posts`/`publish_video` scopes are "sensitive"/gated on
  their respective platforms — each connect flow works today against the
  app's own registered test users, but needs that platform's app-review
  process to clear before the general public can use it. LinkedIn is
  still pending its own OAuth/app-review process.
- **Studio (guest-join + client-side compositing)** — `POST /streams` now
  also creates a `StudioSession`. `POST /studio-sessions/:id/invites`
  issues a single-use, short-TTL guest join link; `web-app/src/studio/`
  (React, part of the main SPA — `/streams/:id/studio` for the host,
  `/join/:token` for guests) implements the actual WebRTC flow: guests
  publish their camera/mic to the host's browser over a **direct P2P mesh**
  (no SFU vendor yet — that was an open decision in the plan; mesh is the
  right MVP default since it costs nothing server-side and is a clean,
  swappable seam for a real SFU later, at up to a handful of guests). Each
  guest also gets a personal mix-minus audio feed (everyone else, never
  their own voice) plus every other participant's video, on a separate
  connection the host recreates whenever the room's roster changes. The
  host composites every participant onto a `<canvas>` (grid or spotlight
  layout, toggleable), mixes all audio tracks via the Web Audio API, and publishes the
  composited result to Cloudflare via **WHIP** — the exact flow (build
  offer, wait for ICE gathering, POST `application/sdp`, parse the answer)
  follows VDO.Ninja's proven implementation, referenced rather than
  copied (its code is AGPL and not otherwise reused; ShackyApps has
  separately decided this repo itself is open source, so that obligation
  isn't a concern here regardless). The signaling layer
  (`StudioSignalingGateway`, Socket.IO) only relays SDP/ICE JSON —
  no media ever touches the server, keeping the default path's server
  cost near zero, per the plan's architecture decision.
  **Not yet verified**: the `whipUrl` field name returned by Cloudflare
  (`result.webRTC.url`) is inferred from their documented WHIP support,
  not confirmed against a real API response — flagged in
  `cloudflare-relay.service.ts` pending the empirical spike.

Not yet built: a LinkedIn OAuth connect/callback flow and `StreamProvider`
adapter, and the paid server-side "Guaranteed Quality" compositing
fallback (`compositing_mode='server_egress'` exists in the schema but has
no implementation yet).

## Running locally

```bash
cp .env.example .env   # fill in DATABASE_URL, ENCRYPTION_KEY_BASE64, CLOUDFLARE_*
npm install
npm run migrate         # applies migrations/*.sql
npm run start:dev
```

`ENCRYPTION_KEY_BASE64` must decode to exactly 32 bytes: `openssl rand -base64 32`.

## Host drop recovery ("technical difficulties")

If the host closes the tab, crashes or loses connection **without pressing End stream**, the stream isn't ended immediately:

1. After ~10s with no publisher, the backend starts pushing a "technical difficulties" slate (`web-app/public/glitch-slate.mp4`, a pre-encoded 10s H.264 loop that is copied rather than re-encoded, + silence; regenerate it from `glitch-slate.png` with the ffmpeg command in `web-app/public/README-slate.txt`) to every destination, via a `<streamId>-slate` MediaMTX path (`GlitchRecoveryService`). Platform broadcasts stay up.
2. The host reopens the **same studio link**; if that browser had already taken the stream live, it restores layout/branding/scenes from `localStorage`, restarts the camera and re-publishes. Guests keep their **same invite links** - the server replays connected guests to the returning host so video reconnects.
3. When the publisher is back the slate stops within ~2s. If the host hasn't returned after **5 minutes**, the stream is ended (and billed) as before.

The slate image is fetched by MediaMTX's ffmpeg over HTTP(S) from `PUBLIC_BASE_URL` (override with `GLITCH_SLATE_URL`).

## Scheduled streams and guest invites

A stream can be planned ahead of time ("Schedule for later" on the create page): date/time (stored as an instant, rendered in the host's timezone), expected duration, description, a note for guests, destinations, and guests by email.

- Scheduling creates **nothing on any platform and bills nothing**. The stream stays `SCHEDULED` (with `is_scheduled_event`) until the host presses **Start stream** (`POST /streams/:id/start`), which creates the broadcasts and goes `LIVE` exactly like "Go live now". If every destination fails, it goes back to `SCHEDULED` so the host can retry.
- Each invited email gets a **personal join link** and an HTML email with an `.ics` calendar attachment (`src/email/stream-invite.template.ts`; sent via Resend in production, logged by the fake email service elsewhere). Updating the time/title/details emails guests again; cancelling emails a cancellation and revokes every link.
- **Copy invitation** copies the same plaintext (generated server-side from the same template) with the general join link. A join password, if set, is never emailed or copied.
- **Create on platforms now (optional):** for platforms that can hold a scheduled broadcast (currently only YouTube; `StreamProvider.canPrescheduleBroadcast`), the broadcast can be created at scheduling time with the scheduled start, so it appears on YouTube and its watch link goes into the invites and the copied invitation (not for `private` streams). At start the pre-created broadcast is **reused** (after checking it is still alive; otherwise a fresh one is created), edits to title/time/description/visibility are pushed to it, and cancelling, deleting, dropping a destination or switching the option off **removes it from YouTube**. Twitch and Facebook are always created at start. Facebook is deliberately not pre-created: its Graph API now rejects scheduled live videos (`(#100) Invalid broadcast status, Scheduled Live has been deprecated`), confirmed live against a Page after trying both documented `event_params` formats.
- **Thumbnail (optional):** one JPG/PNG (<= 2 MB, >= 640px wide, 1280x720 recommended; validated from the file's bytes, stored in `stream_thumbnails`). It is pushed to an existing YouTube broadcast when uploaded, to one created later, and to a fresh YouTube broadcast at start, via `thumbnails.set` on the broadcast id (needs a verified channel; `liveBroadcasts` itself has no writable thumbnail). YouTube doesn't let an app clear a thumbnail it set. Facebook and Twitch don't take a thumbnail from here. Endpoints: `PUT|GET|DELETE /streams/:id/schedule/thumbnail`.
- Guests can open their link before the host starts - they wait in the studio and are connected when the host comes online.

API: `POST /streams/schedule`, `GET|PATCH /streams/:id/schedule`, `POST /streams/:id/schedule/guests`, `DELETE .../guests/:inviteId`, `POST .../guests/:inviteId/resend`, `POST /streams/:id/schedule/cancel`, `GET /streams?view=upcoming`. Migration: `0010_scheduled_streams.sql` (applied automatically on container start).

## Moving to a new domain

1. Point DNS at the server and add the new domain to the app in Coolify (keep the old one).
2. Register the new OAuth redirect URIs *before* switching: Google (`/api/auth/google/callback`, `/api/platform-connections/youtube/callback`) and Meta (`/api/platform-connections/facebook/callback`, plus App Domains / privacy / terms URLs). Verify the new domain in Resend if the sender changes.
3. Set `LEGACY_HOSTS=<old host>` and switch `PUBLIC_BASE_URL`, `GOOGLE_REDIRECT_URI`, `GOOGLE_YOUTUBE_REDIRECT_URI`, `FACEBOOK_REDIRECT_URI` and `EMAIL_FROM`, then redeploy.

While the old host is listed in `LEGACY_HOSTS`: page visits on it 301-redirect to the new domain (same path and query, so old `/join/<token>` invite links, bookmarks and calendar entries keep working), and browser writes from it still pass the CSRF origin check in `AccountGuard`. `/api`, `/health` and `/socket.io` are never redirected (API-key clients, OAuth callbacks still registered on the old host, Coolify's health check). Sessions are per hostname, so users log in again on the new domain; connected YouTube/Facebook accounts are unaffected. Remove the old host from `LEGACY_HOSTS` (and its redirect URIs) once nothing uses it. MediaMTX's own hostnames (`MEDIAMTX_*`) are independent of this.

## Testing

```bash
npm test
```

Every `StreamProvider` and the `CloudflareRelayService` are tested against
mocked HTTP calls — no live credentials needed. `StreamsService`'s
orchestration (including the partial-failure fan-out) and
`StudioSessionsService` (invite issuance/expiry/single-use consumption)
are tested against fakes, no real Postgres or Cloudflare required.

Manually verified against a real local Postgres and a running server in
this session: migrations apply cleanly, the app boots with no DI wiring
errors, and the full account → platform-connection → stream-create →
studio-session → invite-issuance → public-token-resolution chain works
end-to-end. It only fails at the genuinely external dependency — a real
Cloudflare API call, which 404s with no live account configured. What
still needs real credentials: the Cloudflare billing/`whipUrl` empirical
spike, and a real browser-to-browser WHIP→Cloudflare→platform smoke test.

## License

AGPL-3.0. See `LICENSE`.
