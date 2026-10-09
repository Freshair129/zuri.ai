---
status: active
superseded_by: null
---

# RCA — document-links CLI fixture omitted standalone File model source

## Symptom

PR #635 at `a6187ef2` failed hosted `tests (1/4)` in
`tests/unit/doc-links-cli.test.js`: the fixture's first `doc-graph.mjs` run
exited 1 with `Missing or outside-workspace model_source:
services/file-management/migrations/0001_file_management.sql`. The other
executed shards, governance check and build passed on that head.

## Evidence

- The test copies `scripts`, `contracts`, `docs`, Server Prisma and a small
  Server config file into a temporary workspace, then runs the graph. It does
  not copy the standalone File SQL migration.
- Copying `docs` includes `docs/domains/file-management/CHARTER.md`, whose
  `model_source` names that migration. The approved source reader refuses a
  declared source that is absent from the workspace.
- Hosted run `37401327493`, job `112069058097`, failed at
  `doc-links-cli.test.js:42`; the reader reported the missing SQL path at
  `domain-model-source.mjs:25`. This is distinct from the local
  `governance-canonical-source.test.js` timing failure, whose isolated rerun
  passed without code changes.

## Root Cause

The CLI fixture copied the Server Prisma source but did not copy every
model source declared by the charters it copied. Adding the File charter
exposed that incomplete fixture under the correct fail-closed source rule.

## Why the issue escaped detection

The fixture was written when all copied charters could use Server Prisma.
The standalone source reader's focused tests covered valid and missing SQL
paths, but no composed test exercised the older CLI fixture with the new File
charter. The local focused suite did not include `doc-links-cli.test.js`.

## Proposed prevention

Copy the one declared File SQL migration into the temporary CLI workspace
before running the graph. Keep missing-source negative coverage in
`domain-model-source.test.js`, and exercise the CLI fixture in the focused
governance test set when a new charter adds a model source.
