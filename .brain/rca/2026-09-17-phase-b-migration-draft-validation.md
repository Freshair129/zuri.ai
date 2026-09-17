---
title: Phase B draft migration validation findings
version: "0.1.0b"
status: under review
created_at: "2026-09-17T04:35:00+07:00,RWANG,bd99651f"
last_update: "2026-09-17T04:35:00+07:00,RWANG"
attributes:
  domain: project-manager
  scope: FR-252 local W1 migration authoring
---

# Phase B draft migration validation

## Symptom

The first root-owned isolated PostgreSQL application refused the draft Phase B
migration with SQLSTATE 42601. No production database was contacted; the new
tables were in one transaction and the isolated attempt rolled back.

## Evidence

The tested SQL SHA-256 was
`9a403fae203bcfff4792e20702a82ae7c911c6c73aa4f959c0a5e5475a39a2b0`.
PostgreSQL reported an unterminated dollar-quoted string beginning at
`DO $phase_b_shape_guard$`. The block ended with `END $$;` instead of its
opening tag. The retained local record is `phase-b-pg-proof-draft-01.json` in
the thread's 20260917 QA directory.

Source inspection also found the shape guard placed `deletedAt` in text-column
arrays although DDL declares TIMESTAMP(3). The independent SQLite/Prisma review
found five shortened index names in SQL without matching Prisma `map:` values,
and SQLite `length(sourceManifest)` counting characters where the selected
contract bounds serialized UTF-8 bytes. Those source findings are distinct from
the actually executed parser failure; their corrective tests are still pending.

The independent follow-up also found SQLite UUID shape checks accepted additional
hyphens outside the four required positions, and integer-affinity columns lacked
storage-type checks for fractional values. PostgreSQL policy collision guards
initially matched text markers and used pg_policy command codes against the
pg_policies view; marker presence cannot prove predicate equivalence. Same-name
CHECK/FK/index presence likewise cannot establish an unchanged definition.

Root's first exact-catalog probe used temporary reference tables; PostgreSQL
refused with 42P16 because temporary-table foreign keys cannot reference permanent
parents (`phase-b-pg-proof-draft-02.json`). The corrected probe uses a newly
created transaction-owned schema, refuses a pre-existing schema name, and drops
only its own empty verification objects before commit. Actual-role proof then
passed 129 checks, including successful idempotent application.

Ten definition-collision cases then passed. The eleventh reproduced an existing
grant gap: granting only SELECT/INSERT does not remove pre-existing UPDATE/DELETE
privileges on immutable tables. The isolated rerun still reported both privileges
true (`phase-b-pg-collision-proof-red.json`). Explicitly revoke the six new tables'
direct runtime/web privileges before granting the selected bounded set; no
existing unrelated table or role is modified. Rerun the negative grant case and
the actual-role proof after this correction.

## Root cause

The new hand-authored collision guard changed its opening delimiter without
changing the closing delimiter. Its duplicated column-type list also classified
nullable deletion timestamps as text. Index-name defaults and text length were
not reconciled across Prisma, SQLite and PostgreSQL in the initial draft.

## Why the issue escaped detection

This was an in-progress worker draft before its first syntax/runtime migration
gate. Prisma schema validity alone cannot parse a separate PostgreSQL migration,
prove idempotent catalog reuse or establish a UTF-8 byte bound. Independent
review and root isolated execution caught the defects before a release gate.

## Proposed prevention

Fix only the mismatched delimiter, type list, mapped index names and byte check.
Execute the actual migration twice on the complete isolated baseline, reject
divergent catalog definitions, and exercise actual non-bypass-role scope cases.
Run SQLite constraint regressions including a multibyte sourceManifest and
verify Prisma index parity. Retain the failed receipt separately from the
corrected result. W1 cannot be accepted until these checks pass.

Use exact parsed catalog comparisons for columns, constraints, indexes and RLS
policies, rejecting unexpected extra policies. Verify changed definitions and
predicate weakening are rejected on rerun. SQLite negative cases also exercise
extra UUID hyphens and fractional integer values, without unrelated uniqueness
conflicts masking the intended refusal.
