---
version: "0.1.0b"
created_at: "2026-09-06T14:10:48+07:00,RWANG,7eb1e10d"
last_update: "2026-09-06T14:10:48+07:00,RWANG"
status: beta
attributes:
  domain: agent-governance
  complexity: C-1
  risk: LOW
---

# RCA: document-link test fixture reuses a real phase identity

## Symptom

PR #246's document graph passes governance, but `doc-links-cli.test.js` fails during
its first graph generation. The expected successful fixture setup instead returns
`Duplicate explicit ID or alias: ZAI:FR-148-P1`.

## Evidence

- Hosted run `34017983012`: 3,751 tests passed, one failed, 14 skipped; the failing
  assertion is `tests/unit/doc-links-cli.test.js:26`.
- Local focused reproduction on `7eb1e10d` fails with the same duplicate ID.
- The test copies the real docs tree and then creates `docs/LINK-PHASE.md` with
  `ZAI:FR-148-P1`. The copied tree now already declares that canonical phase.
- Both the fixture declaration and its legacy wikilink use that product identity.

## Root Cause

Synthetic test data borrowed an undeclared-at-the-time product ID. Once the approved
FR-148 phase documentation declared it, the combined fixture contained two owners.
The duplicate-ID guard is working correctly; changing the real phase ID would violate
the immutable identity contract in AGENTS.md and the approved phase map.

## Why the issue escaped detection

The earlier fixture passed before phase adoption. Standalone governance does not
create this synthetic test file, so only the CLI regression exposes the collision.

## Correction and prevention

Change only the fixture declaration and matching wikilink to
`ZAI:FIXTURE-DOC-LINK-PHASE`. Keep graph edge assertions, missing-target checks,
stale-backlink checks and production IDs unchanged. This corrects test data under
the existing metadata specification, without changing runtime code or parser rules.
Use fixture-specific identities in tests that copy live documentation.

Verification: run the focused CLI regression, governance and hosted regression checks.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Record confirmed fixture collision and surgical correction | base 7eb1e10d | RWANG |
