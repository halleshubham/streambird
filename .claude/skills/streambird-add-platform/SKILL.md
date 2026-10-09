---
name: streambird-add-platform
description: Add a new streaming destination platform (e.g. LinkedIn Live) to StreamBird end to end: enum, StreamProvider, OAuth connect flow, config, UI badge, tests. Use when a new platform is requested.
---

# Adding a platform

Context: `.claude/docs/backend.md` ("Add a platform"), existing providers in `src/providers/{youtube,facebook,twitch}`, connect flows in `src/platform-connections/`. `StreamsService` never branches on platform — it only calls the provider through `resolveProvider`.

## Steps
1. **Enum**: add to `Platform` (`src/common/enums/platform.enum.ts`; `linkedin` is already declared but unimplemented). Check migrations for `CHECK` constraints or enums listing platforms (`grep -rn "platform" migrations/`) → new migration if needed (skill `streambird-add-migration`).
2. **Provider**: `src/providers/<name>/<name>.provider.ts` implementing `StreamProvider` (`src/providers/stream-provider.interface.ts`): `createBroadcast(conn, meta: BroadcastMeta)` → `BroadcastResult { ingestUrl, streamKey, platformBroadcastId, watchUrl|null }`, `endBroadcast(conn, platformBroadcastId)`, and optional hooks: `canPrescheduleBroadcast`, `updateBroadcast`, `deleteBroadcast`, `setBroadcastThumbnail` + `thumbnailAppliesWhenLive`, and the status/viewer-count read with its minimum interval (see the interface file for exact names). Ingest must be an `rtmp://` or `rtmps://` URL (the relay only accepts those and shell-quotes them).
3. **Register**: `ProvidersModule` providers list **and** the `STREAM_PROVIDERS` factory (including its inject array).
4. **Connect flow**: routes in `PlatformConnectionsController` (`GET <name>/connect`, `GET <name>/callback`) + service logic; store credentials with `EncryptionService` in `platform_connections.credentials_ciphertext`; disconnect (`DELETE :id`) must revoke at the provider when possible.
5. **Config**: client id/secret/redirect in `src/config/configuration.ts`, `.env.example`, `operations.md` (and the user must register the redirect URI with the platform — tell them exactly which URL).
6. **Scheduling**: `PLATFORM_LABELS` in `src/streams/stream-scheduling.service.ts`; decide pre-schedule behaviour (only if the API really supports scheduled broadcasts).
7. **UI**: `PlatformBadge`/`PlatformLogo` components, Connections page card (disclosure text for scopes if the platform needs app review), docs link, CreateStream destination list.
8. **Privacy/terms**: scopes requested must be disclosed on `/privacy` and the Connections page.
9. **Tests**: unit for the provider (mock `HttpService`), e2e for connect callback state handling and a stream with the new destination (fake provider via the existing test patterns), UI test for the Connections card.
10. **Review/approval**: platforms with sensitive scopes need their own app review — ask the user to start it early; do not widen scopes silently.
