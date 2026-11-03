# Stream presets API

A preset is a named, saved "go live" setup of one account. The web dashboard shows them as one-tap cards; the Android app uses the same endpoints. Code: `src/presets/`, table `stream_presets` (migration 0029).

All routes are under `/api`, JSON, and authenticated exactly like the rest of the API: the `sb_session` cookie (non-GET requests need the `Origin` header of the site, see `AccountGuard`) or an `x-api-key` header. Another account's preset id always answers **404**. Presets are available on **every plan**.

## Preset object

```json
{
  "id": "uuid",
  "name": "Friday show",
  "config": {
    "orientation": "landscape",
    "destinationIds": ["<platform connection id>", "..."],
    "brandKitId": "<brand kit id>",
    "quality": "hd",
    "tickerEnabled": true,
    "tickerText": "Welcome to the show"
  },
  "lastUsedAt": "2026-11-03T10:00:00.000Z"
}
```

`lastUsedAt` is `null` until the preset is used. `config` holds only the keys the host chose; **every key is optional** and **unknown keys are rejected (400)**.

| `config` key | Type | Meaning if omitted |
|---|---|---|
| `orientation` | `"landscape"` \| `"portrait"` | landscape. Vertical (9:16) is fixed when the stream is created. |
| `destinationIds` | string[] (uuid, max 50) - ids from `GET /platform-connections` | every connected destination of the account |
| `brandKitId` | uuid \| `null` | omitted = the destination's / account default kit (what the studio does today); `null` = no kit (manual) |
| `quality` | `"sd"` \| `"hd"` \| `"fhd"` \| `"qhd"` (same values as the plan's `maxResolution` / `GET /plans/me`) | the studio's default (hd) |
| `tickerEnabled` | boolean | false |
| `tickerText` | string, max 200 | none |

Which of these are *stream* fields and which are *studio* settings: `orientation` and `destinationIds` become the stream (`POST /streams`). `quality`, `brandKitId`, `tickerEnabled`/`tickerText` are studio (client) settings in StreamBird: the server never stores them on the stream. `/use` and `/start` return them already checked against the plan (`effectiveConfig`) for the client to apply. Brand-kit ads are part of the kit; they follow the kit and the existing ad plan rules (Free plan cannot save ads), there is no separate ads field.

## Endpoints

### `GET /api/presets` -> 200 `Preset[]`
Ordered by `lastUsedAt` descending, never-used presets last (oldest created first among those).

### `POST /api/presets` -> 201 `Preset`
Body `{ "name": string (1-80, trimmed), "config": { ... } }` (`config` required, may be `{}`).
- 400 validation (unknown key, bad value, empty/long name, non-uuid id).
- 422 a `destinationIds` entry is not an active connection of this account, or `brandKitId` is not this account's kit.
- 409 the account already has **20** presets (`You can keep up to 20 presets...`).

### `PATCH /api/presets/:id` -> 200 `Preset`
Body `{ "name"?: string, "config"?: {...} }`. `config`, when sent, **replaces** the whole config (send the full object). Same 400/422 rules; 404 for an unknown or foreign id.

### `DELETE /api/presets/:id` -> 204
404 if unknown/foreign.

### `POST /api/presets/:id/use` -> 200
Sets `lastUsedAt = now` and returns the preset plus how it applies **today**:

```json
{ "id": "...", "name": "...", "config": { "...stored...": 1 }, "lastUsedAt": "...",
  "effectiveConfig": { "...": "config after the checks below" },
  "warnings": ["human readable reasons effectiveConfig differs"] }
```

Checks at use time (the plan or the account may have changed since the preset was saved; nothing is repaired in the stored preset):
- `destinationIds`: entries that are no longer connected are dropped (warning); no ids saved -> all active destinations.
- `quality` above the plan's `maxResolution` is lowered to it (warning).
- `brandKitId` is set to `null` (warning) when the kit was deleted or the plan has no brand storage (Free).

### `POST /api/presets/:id/start` -> 201
Optional body `{ "title"?: string (1-200) }`; the stream title defaults to the preset name. Creates the stream **through the same service method as `POST /api/streams`** (`StreamsService.create`): hours/grace check, destination count of the plan, provider broadcasts, MediaMTX forward, a studio session, status `live` - and the same throttle (5/min/account, 429). The response is **exactly the `POST /api/streams` response** (`StreamResponseDto`: `id, title, status, ingestUrl, streamKey, whipUrl, orientation, studioSessionId, destinations[], ...`) with one extra property:

```json
{ "id": "<stream id>", "title": "Friday show", "status": "live", "whipUrl": "...", "...": "...",
  "preset": { "id": "...", "name": "...", "config": {}, "lastUsedAt": "...", "effectiveConfig": {}, "warnings": [] } }
```

`preset.effectiveConfig` carries `quality`, `brandKitId`, `tickerEnabled`, `tickerText` for the client to apply to its studio before it publishes. `lastUsedAt` is stamped only after the stream was created (a refused start does not reorder the list).
- 422 no destination left to stream to (nothing connected / all saved ones removed).
- 403 plan limits (hours used up, more destinations than the plan allows) - same messages as `POST /api/streams`.
- 404 unknown/foreign preset.

Starting a stream does **not** publish media: like `POST /streams`, the client then opens the studio / mints a host token and publishes (web: `/streams/:id/studio`).

## Errors
Standard body `{ statusCode, message, timestamp }` (`AllExceptionsFilter`). `message` is a string, or for exceptions Nest builds itself (validation 400) Nest's own body `{ message: string | string[], error, statusCode }` - read `message` then `message.message` like the web client does.
