---
name: streambird-backend-feature
description: Recipe for adding or changing a StreamBird backend endpoint or service (controller, DTO, service, guards, throttling, config, tests). Use for any NestJS API work.
---

# Backend feature recipe

Context: `.claude/docs/backend.md` (modules, auth model, conventions). Look at the nearest existing module first and copy its shape.

## Checklist
1. **Where**: pick the module that owns the data (`accounts`, `streams`, `studio`, `billing`, …). New module only if truly new; register it in `src/app.module.ts`.
2. **DTO** in `<module>/dto/*.dto.ts` with `class-validator` decorators on **every** accepted field (the global pipe is `whitelist + forbidNonWhitelisted`; undecorated fields are rejected). Bounds: `@MaxLength` on strings, `@IsUUID`/`ParseUUIDPipe` on ids.
3. **Controller**: thin; `@UseGuards(AccountGuard)` on every resource controller (then `RolesGuard` + `@Roles(...)` *after* it for admin/company routes). Public routes need a reason; if they check a secret or send email, add `@UseGuards(ThrottlerGuard) @Throttle(...)` (per-account create limit uses `StreamCreateThrottlerGuard`; see `streams.controller.ts`, `studio-sessions.controller.ts`). 204 for "no body" (`@HttpCode(HttpStatus.NO_CONTENT)`).
4. **Service**: all logic and DB access here (`@InjectRepository`). Throw Nest `HttpException` subclasses with a user-safe message. Ownership: always scope queries by `accountId` from `@CurrentAccount()`; return 404 (not 403) for someone else's id.
5. **Limits**: new action that consumes a plan resource must call the enforcement point (`billing-and-plans.md` table), not re-implement it.
6. **Config**: new setting → `src/config/configuration.ts` (camelCase key) + `.env.example` + `.claude/docs/operations.md`. Read via `ConfigService`, never `process.env` in services.
7. **External calls**: `HttpService` + `firstValueFrom`; best-effort calls must catch, `logger.warn`, and not fail the user action unless the docs say so. Secrets at rest go through `EncryptionService`; tokens/codes are stored only as sha256.
8. **Email**: add a method to the `EmailService` interface and **both** implementations (`ResendEmailService`, `FakeEmailService`) and the e2e `Mailbox` if tests need to read it.
9. **Schema change?** → skill `streambird-add-migration`.
10. **Frontend**: add the call in `web-app/src/api/<domain>.ts` and types in `web-app/src/types/api.ts`.

## Tests (required)
- Unit: the rule in the service (`*.spec.ts`, in-memory repo pattern), including refusals.
- E2E (`test/e2e`): the endpoint through `bootApp()`: success, wrong owner (404), unauthenticated (401), unapproved (403), validation (400), throttle (429 — last in the file).
- Run `npm run typecheck && npm test && npm run test:e2e`.

## Security reminders
Never log secrets/tokens; never return credential fields (select explicit fields); CSRF protection relies on `AccountGuard` + `Origin` — do not bypass it with a custom guard; payments: compare amounts with the DB, never the client.
