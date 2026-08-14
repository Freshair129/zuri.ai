---
version: "0.2.0b"
created_at: "2026-08-14T08:34:39+07:00,ATHER"
last_update: "2026-08-14T08:36:30+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "developer-experience"
  doc_type: "root-cause-analysis"
  scope: "run.bat local database bootstrap"
---

# RCA — run.bat local database bootstrap

## Symptom

Running `run.bat` from a clean worktree exits before the Next.js server starts. Port 3100 has no
listener and `http://localhost:3100/` cannot be reached.

## Evidence

- the initial port check found no listener on 3100 and the HTTP request could not connect;
- `run.bat` reached `npm run db:push`, then Prisma exited with `P1012`;
- Prisma identified `prisma/schema.prisma:10` and reported that `DATABASE_URL` was missing;
- `.env.example` documents `DATABASE_URL="file:./dev.db"`, but a clean worktree intentionally has
  no ignored `.env`; and
- launching the unchanged script with process-local `DATABASE_URL=file:./dev.db` produced a seeded
  server that listened on 3100 and returned HTTP 200.

## Root Cause

`run.bat` promises a double-click local startup but relies on an untracked `.env` for the mandatory
Prisma datasource. It sets the demo-auth and Prisma logging environment itself, yet does not provide
the documented local SQLite default when `DATABASE_URL` is absent.

## Why the issue escaped detection

Vitest and Playwright explicitly inject isolated database URLs, while established developer
worktrees already contain ignored local environment state. No test asserted the clean-checkout
contract of `run.bat` itself.

## Proposed prevention

1. Set `DATABASE_URL=file:./dev.db` only when the caller has not already defined it.
2. Keep any caller-supplied URL authoritative so the script does not redirect an intentional target.
3. Add a focused static startup-contract test proving the fallback appears before schema push.
4. Run the batch file without a database environment and verify port 3100 plus HTTP 200.

## Acceptance and exit gates

- focused regression test passes;
- an absent `DATABASE_URL` selects only the documented local SQLite file;
- a caller-supplied `DATABASE_URL` is not overwritten;
- `run.bat` completes schema push/seed and serves HTTP 200 on port 3100; and
- diff check passes with no credential added.

## Implementation result

`run.bat` now assigns the documented `file:./dev.db` only through `if not defined
DATABASE_URL`. The focused regression test passes. A clean-environment replay completed Prisma
schema push and seed, started Next.js on port 3100, and returned HTTP 200. The inherited environment
contract is preserved because CMD skips the assignment whenever the caller already defines the
variable.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Evidence-backed clean-worktree startup root cause and bounded prevention | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Conditional fallback implemented; clean-environment run.bat replay serves HTTP 200 | working-tree | ATHER |
