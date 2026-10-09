---
name: streambird-docs-maintenance
description: Keep StreamBird's agent knowledge base (CLAUDE.md, .claude/docs, .claude/skills) accurate when code changes. Use at the end of every change before opening the PR, and when asked to refresh the docs.
---

# Keeping `.claude/` true

Wrong docs are worse than none: agents act on them. Treat docs as part of the change.

## Which doc follows which change
| You changed… | Update |
|---|---|
| a route, module, entity, guard, flow | `docs/backend.md` (module table / flow / auth) |
| a migration | `docs/backend.md` + "next number" in `CLAUDE.md` and `skills/streambird-add-migration` |
| env var / config / CI / deploy process | `docs/operations.md` (+ `.env.example`) |
| plan limits, prices, Razorpay behaviour | `docs/billing-and-plans.md`, `docs/overview.md` glossary ladder, **and** tell the user the landing/docs repo needs the same change |
| studio logic, layouts, themes, slides | `docs/studio.md` |
| pages, components, CSS conventions, loaders | `docs/frontend.md` |
| test harness, selectors, commands | `docs/testing.md` + `skills/streambird-test` |
| a decision or a trap you discovered | one line in `docs/decisions-and-gotchas.md` |
| product capability added/removed | "Product state" in `docs/overview.md` |
| a new workflow you had to figure out | a new skill (below) |

## Procedure
1. `git diff origin/main --stat` → map files to the table above; open those docs; fix stale sentences, add the new fact. Verify any path/name you write exists (`grep`/`ls`).
2. Search the docs for the old name/behaviour (`grep -rn "oldName" .claude CLAUDE.md`).
3. Keep `CLAUDE.md` short (it loads every session): rules and pointers only; detail goes in `docs/`.
4. No secrets or tokens; identifiers (uuids, project ids) are fine.
5. If a file nears ~300 lines, split it and update `docs/README.md` and the `CLAUDE.md` table.
6. Mention in the PR body: "docs updated: <files>" (or why none needed).

## Writing a new skill
Create `.claude/skills/<streambird-name>/SKILL.md` with frontmatter `name` (= folder) and a `description` that says *what it does and when to use it* (this is what triggers it). Body: numbered steps, exact commands and paths, a verification section, pitfalls. Under ~120 lines; put scripts next to it and call them by path. Add it to `CLAUDE.md` and `docs/README.md`.
