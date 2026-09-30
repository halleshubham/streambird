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

Not yet built: the studio/guest layer (client-side compositing, guest
invites), platform OAuth connect/callback flows, and the paid server-side
"Guaranteed Quality" compositing fallback.

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
orchestration (including the partial-failure fan-out) is tested against a
`FakeCloudflareRelay` and fake providers. What genuinely can't be tested
without live credentials: an actual Cloudflare billing/output-count check,
and a real end-to-end OBS/browser → Cloudflare → platform smoke test.

## License

AGPL-3.0. See `LICENSE`.
