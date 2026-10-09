---
name: streambird-dev-workflow
description: End-to-end workflow for any change to the StreamBird repo (feature, fix, UI polish, docs): branch, implement, test, review, PR, CI, merge, deploy, verify. Use at the start of every task in this repo, before editing code.
---

# StreamBird change workflow

Follow in order. The user decides merge/deploy timing; everything before that is yours.

## 1. Orient (2 minutes)
- Read `CLAUDE.md` rules, then the one or two `.claude/docs/*.md` your change touches (table in `CLAUDE.md`). Grep for the existing pattern before inventing one.
- Start from fresh main: `git fetch origin main && git checkout -b claude/<short-topic> origin/main`. One topic per branch/PR. If the harness names a branch for the session, use that instead.

## 2. Implement
- Match surrounding code (naming, comment density, idioms). Smallest change that solves the request; no drive-by refactors.
- Backend feature → skill `streambird-backend-feature`; DB change → `streambird-add-migration`; UI → `streambird-ui-change`; studio layout/theme → `streambird-studio-layout`; new platform → `streambird-add-platform`.
- New env var → `src/config/configuration.ts` + `.env.example` + `.claude/docs/operations.md`.

## 3. Test (skill `streambird-test`)
- Add tests at every layer the change touches (rule of thumb: new rule → unit; new/changed endpoint, guard, DB write → e2e; visible behaviour → UI).
- Run: typecheck, unit, rebuild web app, e2e, UI. Fix failures at the cause; never skip/disable a test to go green.
- UI change → screenshots at 1366×800 and 390×800 and actually look at them.
- Tests must not contain password/secret-looking literals (generate them).

## 4. Self-review the diff
`git diff origin/main` and read it adversarially: unused imports (they break `tsc -b`), unvalidated DTO fields, missing guard/throttle on a public endpoint, secrets, broken selector contracts (`testing.md`), docs that are now wrong. Update `.claude/` (skill `streambird-docs-maintenance`).

## 5. Commit and PR
- Commit message: imperative subject, body explaining *why*. Add the attribution trailers the session's system reminder asks for.
- Push the branch with `git push -u origin <branch>` (retry network failures with backoff 2/4/8/16 s). **Never force-push, amend pushed commits, or push to main.**
- Open a PR (GitHub MCP tools; `gh` is not available). Body: what changed and why, behaviour notes, **which tests were added/updated and that the full suites pass**, anything not covered. Append the PR footer the session asks for.
- GitGuardian or CI red → read the failing job log (`get_job_logs` with `return_content`), fix with a new commit (or a fresh branch if the bad content is already in a pushed commit and history rewrite is denied), re-verify.

## 6. Merge (only when the user says "merge")
- Wait until both checks are green (`test` job + GitGuardian). Squash merge via the GitHub tool. If a merge conflicts, merge `origin/main` into the branch, resolve, re-run tests, push (no rebase).

## 7. Deploy (only when the user says "deploy")
Skill `streambird-deploy`: wait for the image build of the merge commit → deploy via Coolify with the token the user provides → verify live → report.

## 8. Report
Say what shipped, what was verified (and how), what was not, and what the user should look at. Mention secrets they pasted that should be rotated, and merged branches they can delete (the sandbox cannot delete remote branches).
