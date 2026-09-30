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
- `TwitchProvider` is the only `StreamProvider` adapter implemented so far
  (no OAuth-review wait, no broadcast-object complexity — see the plan's
  build order for why it's first). YouTube, Facebook, and LinkedIn adapters
  land once their respective OAuth/app-review processes clear.
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

Not yet built: platform OAuth connect/callback flows, YouTube/Facebook/
LinkedIn `StreamProvider` adapters, and the paid server-side "Guaranteed
Quality" compositing fallback (`compositing_mode='server_egress'` exists
in the schema but has no implementation yet).

## Running locally

```bash
cp .env.example .env   # fill in DATABASE_URL, ENCRYPTION_KEY_BASE64, CLOUDFLARE_*
npm install
npm run migrate         # applies migrations/*.sql
npm run start:dev
```

`ENCRYPTION_KEY_BASE64` must decode to exactly 32 bytes: `openssl rand -base64 32`.

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
