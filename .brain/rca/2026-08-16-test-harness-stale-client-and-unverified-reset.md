---
version: "0.1.0b"
created_at: "2026-08-16T08:15:00+07:00,CLAUDE"
last_update: "2026-08-16T08:15:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "test-infrastructure"
  doc_type: "root-cause-analysis"
  scope: "tests/global-setup.js — test database reset and Prisma client generation"
---

# RCA — the test harness could start from a stale client and an unverified database

Two failures seen in one session while working on unrelated changes. One has a
proven root cause and is fixed. The other was investigated, three hypotheses were
tested and refuted, and it is **not** claimed as fixed — only made diagnosable.

## Symptom A — 51 tests fail after a pull, naming no cause

Immediately after `git pull` brought 19 commits (including `prisma/schema.prisma`
changes), `npm test` failed 16 files / 51 tests with:

```
Unknown argument `tenantId_provider_providerSubject`. Available options are marked with ?.
  ❯ Module.resolveLineIdentity src/modules/identity/resolve-line-identity.js:40:20
```

`npx prisma generate` alone made the suite green. Nothing in the error names the
generated client, so the reader is pointed at application code that is correct.

### Root cause (proven)

`tests/global-setup.js` ran `npx prisma db push --skip-generate`. Verified
directly:

| command | result |
|---|---|
| `prisma db push` | `Running generate…` → `✔ Generated Prisma Client (v5.22.0) … in 339ms` |
| `prisma db push --skip-generate` | schema synced, **no generation** |

`db push` is the only step in the test path that regenerates the client, and the
flag disabled it. `postinstall` covers `npm install` only, so any schema change
arriving by pull — the normal case — left the client describing the old schema
while the database described the new one. The flag arrived unexamined in the
repo-flattening commit `a7843ab`.

### Why it escaped detection

The failure only appears in the window between a schema-changing pull and the
next `npm install`, and it disappears the moment anyone runs `prisma generate` for
any other reason. The saved cost was **339 ms** against an 80 s suite.

## Symptom B — nine suites fail mid-run on a database that was fine

One run failed with two contradictory errors in the same execution:

```
agent-multi-principal.test.js  → The table `main.Portfolio` does not exist
agent-runtime.test.js          → Unique constraint failed on the fields: (`code`)
```

Missing tables and populated tables in one run means the database changed *during*
the run, not that setup failed — `execSync` throws on a non-zero exit, so a failed
`db push` aborts setup loudly and cannot produce this.

### Hypotheses tested and refuted

| # | Hypothesis | Test | Result |
|---|---|---|---|
| 1 | A second concurrent `npm test` reset the shared database | Ran two suites, second started 25 s into the first | **Refuted** — the second dies at `rmSync` with `EPERM`; the first finished green (613 passed) |
| 2 | An external process deleted `prisma/test.db` mid-run | Attempted deletion from a separate process during a run | **Refuted** — `EPERM`; Windows holds the open SQLite file |
| 3 | A stale rollback journal corrupted a freshly pushed database | Abandoned a transaction to leave a hot `-journal`, removed only the `.db` as the harness does, recreated and read back | **Refuted** — SQLite discarded the orphaned journal; data read back correctly |

Not reproduced in roughly ten further suite runs. **No root cause established.**

## Fix

1. **Symptom A — root cause removed.** `--skip-generate` is gone; the client is
   regenerated on every test run, so it cannot disagree with the schema.
2. **Symptom B — made diagnosable, not "fixed".** After `db push`, the harness
   opens `prisma/test.db` and asserts the foundation tables (`Portfolio`,
   `Tenant`, `Business`) exist. If a push ever reports success without applying
   the schema, the run stops at setup with one message naming the missing tables
   instead of a dozen suites each reporting a missing table.
3. **Concurrent runs report themselves.** Hypothesis 1's `EPERM` is a real and
   reproducible failure mode with a useless message. It is now mapped to
   "another test run is holding it open … two suites cannot use it at once."
4. **The reset is now a reset.** `rmSync` covered only `test.db`, leaving
   `-journal` / `-wal` / `-shm`. Hypothesis 3 shows SQLite tolerates that today,
   so this is hygiene rather than a fix — but deleting part of a database's
   on-disk representation and calling it a fresh start is wrong on its face, and
   a stale `prisma/dev.db-journal` from 2026-08-14 sits in the tree as evidence
   that the project does leave them behind.

`node:sqlite` is loaded through `createRequire`: the Vite build inside vitest 2.x
predates that builtin, strips the `node:` prefix and then fails to resolve a bare
`sqlite`.

## Proposed prevention

1. Never pass `--skip-generate` in a path that is expected to produce a runnable
   client. If generation cost ever matters, gate it on a schema hash, do not
   remove it.
2. A harness that prepares state should assert that state before handing it to
   tests. Setup steps that "cannot fail" are exactly the ones that fail silently.
3. If Symptom B recurs, the new setup assertion decides it: an error at setup
   means the push is at fault, a clean setup followed by mid-run table loss means
   an external writer. Capture `prisma/test.db` at that moment before rerunning.
4. `prisma/test.db` is one fixed path shared by every run. It fails safe today,
   but a per-run database file would remove the collision entirely.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-16 | beta | Root-caused the stale Prisma client; documented three refuted hypotheses for the mid-run database loss and added setup verification | pending | CLAUDE |
