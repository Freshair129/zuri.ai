---
version: "0.1.0b"
created_at: "2026-09-17T02:38:52+07:00,Codex"
last_update: "2026-09-17T02:38:52+07:00,Codex"
status: "beta"
superseded_by: null
attributes:
  domain: "platform"
  doc_type: "root-cause-analysis"
  scope: "Integration restore tests failed after a deliberately corrupted ArchiveManifest row leaked into the shared SQLite test database"
---

# RCA — backup restore test state leaked through a deliberately corrupted archive manifest

## Symptom

After merging the release-safety changes from `origin/main`, the full server
integration suite failed seven restore assertions across six files. The legal
hold tests and the isolated restore tests still passed.

## Evidence

- The integration run reported `199` files with `7` failed tests.
- A gated diagnostic on the first failing restore returned:
  `Archive manifest <id> is not self-consistent`.
- `tests/integration/crm-archive-legal-hold.test.js` deliberately changes an
  `ArchiveManifest.fileSha256` value without changing its `manifestHash` to
  prove expiry fails closed.
- That test removed only its temporary archive directory. It did not restore
  the database row before the next integration file exported the installation
  snapshot.
- The new snapshot validator in `backup-service.js` correctly rejects that
  inconsistent row. The six affected files pass when run in an isolated test
  database.

## Root Cause

The shared integration database outlived a test that intentionally created an
invalid persisted state. The test's teardown covered filesystem state but not
the mutated `ArchiveManifest` fields. Once snapshot import began validating
manifest self-consistency, every later full-installation snapshot inherited the
invalid row and was refused before its destructive transaction.

## Why the issue escaped detection

Before the validator was merged, the stale invalid row did not participate in
snapshot preflight, so the missing database cleanup was invisible. The affected
tests were also commonly run individually, where global setup creates a fresh
database and the leaked row cannot affect another file.

## Prevention

Restore every deliberately mutated database row in a `finally` block, just as
temporary filesystem state is removed. Tests that intentionally exercise broken
chains must leave the shared database valid for subsequent files. The validator
remains fail-closed; weakening it would hide real archive corruption.
