---
version: "0.1.0b"
created_at: "2026-08-18T20:28:52+07:00,ATHER"
last_update: "2026-08-18T20:28:52+07:00,ATHER"
status: "candidate"
attributes:
  domain: "agent-governance"
  doc_type: "root-cause-analysis"
  scope: "PR-064 generated-view CI check"
---

# RCA - Generated views included a stale ignored Prisma client

## Complexity and risk

- **Complexity:** C-1 - generated-artifact cleanup and deterministic regeneration
- **Risk:** LOW - no tracked production code, schema, secret or application data changes

## Symptom

PR #64 passed tests, production build and the governance chain, but failed the
final `Generated views are committed and current` check.

## Evidence

- GitHub Actions regenerated the graph at `nodes 922 · edges 2813` and reported
  removal of `code:src/generated/prisma-postgres/edge.js` and
  `code:src/generated/prisma-postgres/index.js`.
- The committed generated views still contained references to those two files;
  the CI diff was `FEATURE-MAP.md` 18 lines, `TRACE.md` 18 lines and
  `appendices/D-traceability.md` 34 lines.
- The local checkout contained `src/generated/prisma-postgres/`, which is
  ignored by `.gitignore` and is not tracked by Git.
- `scripts/generate-prisma-clients.mjs` emits the Postgres client to
  `node_modules/@zuri/prisma-postgres`, not to `src/generated/prisma-postgres`.
- No source file references the stale `src/generated` path.

## Root Cause

An old ignored Prisma client directory remained in the local checkout. The
doc-graph scanner walks the filesystem rather than Git's tracked file list, so
local `npm run govern` indexed stale ignored files that a clean CI checkout did
not contain. The committed generated views therefore described a different
filesystem from the one used by CI.

## Why the issue escaped detection

The local verification environment retained generated artifacts from an older
client-output layout. The generated directory was ignored, so `git status` did
not reveal it, and the local governance run was not performed from a clean
generated-artifact state before the commit.

## Fix and prevention

1. Remove the stale ignored `src/generated/prisma-postgres` directory; it is
   reproducible from the current dependency installation if needed.
2. Regenerate the governed views from the clean checkout state and commit the
   result.
3. Keep the current Prisma output under `node_modules/@zuri/prisma-postgres`;
   do not add the ignored client to source control.
4. Treat ignored generated directories as part of the governance input and
   clean them before publishing generated views.

## Acceptance criteria

- Local `npm run govern` produces no diff in the four CI-checked generated views.
- PR #64's `Generated views are committed and current` check passes.
- Tests and production build remain unchanged and pass.
- No source production code, schema, secret or Supabase data is changed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Recorded stale ignored Prisma client drift in generated-view CI verification | working-tree | ATHER |
