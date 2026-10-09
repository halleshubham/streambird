# `.claude/docs` — agent knowledge base for StreamBird

Written for AI coding agents (and humans in a hurry). **Start at `/CLAUDE.md`**, which tells you which of these to open. Files are small, factual, and name exact paths so you can jump straight to code. Prefer these over the long human `README.md` (whose "Status" section is stale).

| Open this | when you need |
|---|---|
| [`overview.md`](overview.md) | what the product is, stack, repo map, glossary, current product state |
| [`backend.md`](backend.md) | modules/routes/tables, go-live and scheduling flows, auth model, backend conventions, adding a platform |
| [`studio.md`](studio.md) | the browser studio: compositor, signaling, layouts/themes, slides, recovery |
| [`frontend.md`](frontend.md) | routes, components, API layer, CSS rules and pitfalls, loading-feedback system |
| [`billing-and-plans.md`](billing-and-plans.md) | plan limits and where they are enforced, Razorpay one-time/autopay/webhook |
| [`testing.md`](testing.md) | the four test layers, local setup, harness API, selector contract, pre-PR checklist |
| [`operations.md`](operations.md) | env vars, CI/CD, deploying via Coolify, secrets rules, sandbox limits |
| [`decisions-and-gotchas.md`](decisions-and-gotchas.md) | why things are the way they are; traps; known gaps |

Skills (step-by-step workflows) are in [`../skills/`](../skills/): `streambird-dev-workflow`, `streambird-test`, `streambird-deploy`, `streambird-add-migration`, `streambird-backend-feature`, `streambird-ui-change`, `streambird-studio-layout`, `streambird-add-platform`, `streambird-docs-maintenance`.

## Keeping this accurate (rules)
1. Docs describe **what is true now**. If your change makes a sentence false, fix it in the same PR (skill `streambird-docs-maintenance` lists which doc follows which kind of change).
2. Facts a reader can verify in code (routes, env var names, file paths) must be exact; prefer "see `path`" over copying code.
3. No secrets, tokens or passwords here, ever. Identifiers (app uuids, project ids) are fine.
4. Keep each file focused; if one passes ~300 lines, split it and update this index and `CLAUDE.md`.
5. Record non-obvious decisions and traps in `decisions-and-gotchas.md` as one line each.
