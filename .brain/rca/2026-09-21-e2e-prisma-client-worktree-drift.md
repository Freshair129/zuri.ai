---
version: "0.1.0b"
created_at: "2026-09-21T08:02:50+07:00,LUNA"
last_update: "2026-09-21T08:02:50+07:00,LUNA"
status: "beta"
superseded_by: null
attributes:
  domain: "test-infrastructure"
  doc_type: "root-cause-analysis"
  scope: "tests/e2e/global-setup.js — Playwright Prisma client generation"
---

# RCA — E2E bootstrap used a Prisma client from another worktree

## Symptom

The local FR-184 stocktake and FR-186 billing browser specs failed in
`beforeAll`, before any browser assertion ran:

```text
PrismaClientKnownRequestError: The table `main.Person` does not exist
```

The same checkout's disposable E2E database had been seeded, so this was a
verification-harness failure rather than evidence about stocktake or billing
behavior.

## Evidence

- `tests/e2e/global-setup.js` ran `npx prisma db push --skip-generate`.
- The generated client at `apps/server/node_modules/.prisma/client/index.js`
  recorded a schema path in the sibling `task-zai-040-client-contract-local`
  worktree.
- The current checkout's `prisma/e2e-3100.db` was non-empty while that sibling
  worktree's `prisma/e2e-3100.db` was empty.
- `tests/global-setup.js` already documents and tests the same cross-worktree
  failure mode for Vitest, but the Playwright bootstrap bypassed that safeguard.

## Root Cause

The E2E bootstrap skipped Prisma client generation. Prisma embeds the schema
directory in the generated client, and the relative SQLite datasource therefore
resolved against whichever sibling checkout last generated the shared client.
The E2E setup pushed and seeded one database while the test process queried
another.

## Why the issue escaped detection

The existing Playwright unit test verified that setup and the web server used
the same target URL, but it explicitly asserted the stale `--skip-generate`
command. The warm-up browser test could pass while feature fixtures failed in
`beforeAll`, so no commerce or stocktake UI assertion reached the browser.

## Prevention

E2E bootstrap now uses `prisma db push` without `--skip-generate`, and the unit
contract asserts that a runnable browser setup does not skip client generation.
This remains disposable local/CI evidence only; it does not apply production
migrations or establish provider, owner, legal, or operational acceptance.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-21 | beta | Record and repair E2E cross-worktree Prisma client drift | pending | LUNA |
