---
version: "0.1.0b"
status: beta
created_at: "2026-09-11T01:56:45+07:00,RWANG"
last_update: "2026-09-11T01:56:45+07:00,RWANG"
---

# Billing persistence parity found during implementation review

Complexity: C-2. Risk: HIGH because this approved Billing/POS slice adds
persisted fiscal-document evidence and database migrations. This RCA records
local implementation defects discovered before integration, not a production
incident.

## Symptom

The first Billing implementation accepted a monetary input that PostgreSQL
cannot persist. Its handwritten PostgreSQL migration also differed from the
Prisma/SQLite contract, and its RLS policies did not give the application roles
the table privileges needed to use the new tables.

## Evidence

- A read-only `zPosCheckout.safeParse` probe accepted `21,474,836.48` baht:
  `2,147,483,648` satang, above PostgreSQL `INTEGER`'s maximum
  `2,147,483,647`. JavaScript safe-integer validation alone was insufficient.
- Against a baseline generated from integration's PostgreSQL Prisma schema,
  the initial SQL snapshot `05d3a64f729cd63c42b985360efc46e9e9f3fa6bb82074e10e4a20e795aeb06d`
  used restrictive BillingProfile parent FKs while both Prisma schemas and the
  SQLite migration specified cascading profile deletion. It also added database
  defaults for `updatedAt` that Prisma did not specify, and PostgreSQL truncated
  two index names differently from Prisma's generated names.
- After those parity corrections, SQL snapshot
  `ebf46f0cbac406483b1c1500aae3f32d706a0b4b80f963e42089faed6c252416`
  applied successfully, but `has_table_privilege` returned false for SELECT,
  INSERT, UPDATE and DELETE for both `zuri_app_runtime` and `zuri_web_login` on
  all three new tables. Actual `SET ROLE` reads failed with permission denied.
- The isolated logs, copied SQL snapshots, source hashes, synthetic fixtures
  and result manifest are retained in the task artifact directory's
  `billing-pg-qa/` and `billing-sqlite-qa/` folders. The artifact root is
  `C:/Users/pc/.codex/visualizations/2026/09/10/01a08aba-fa9c-7a51-9e67-415f939bd9ac`.

## Root cause

The amount guard checked the JavaScript representation instead of the narrowest
supported persisted integer range. SQLite's integer storage accepted values
outside PostgreSQL's 32-bit range.

The handwritten Supabase migration was not initially compared with Prisma's
additive PostgreSQL diff. Row-level policies were then treated as sufficient
authorization, although PostgreSQL checks table privileges as well as RLS.
The missing explicit runtime grants therefore remained observable even with
correct policies.

## Why detection initially missed these defects

The application test harness creates SQLite databases from Prisma, which does
not exercise the separate Supabase SQL or its role permissions. Successful
schema application as a privileged database owner also does not prove that a
runtime login can query the resulting tables. Neither check compares the
database-specific index identifiers and defaults.

## Prevention and verified repair

Billing/POS now applies shared persisted Int32 guards to amounts, intermediate
totals and sequence exhaustion. The PostgreSQL SQL uses the canonical FK actions,
Prisma's index names, matching timestamp defaults, and explicit SELECT/INSERT/
UPDATE/DELETE grants for the two runtime roles. Public/Data API role revocations
remain in the migration.

Final PostgreSQL snapshot
`512becf9e45c3957d289255bc696f5a7755ab8a02163e6051abda0fa6a0d44d4`
passed actual migration execution, exact catalog checks, runtime privilege and
`SET ROLE` checks, idempotent replay, and synthetic FK deletion checks on
PostgreSQL 17.11. Profile/sequence rows cascade with their Business; issued
documents block deletion of their order, branch, Business and Tenant.

SQLite migration snapshot
`5ddca8cccf2592408600e30533b263a7f1874553b72faabf87769c9abf06348e`
also applied to a generated baseline and rejected the four issued-document
parent deletions with zero foreign-key violations. These fixtures prove SQL
constraints only; application issuance, recovery and browser acceptance use
their own tests. The migrations add no SQL CHECK constraints: the new enum and
numeric input checks belong to the application and recovery validators.

The disposable PostgreSQL container was removed by its verified exact ID after
testing; SQLite ran in memory. Root must compare the integrated migration hashes
before reusing this evidence. No production migration or runtime activation was
performed by this QA.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-11 | beta | Record reproduced numeric, SQL parity and runtime-grant defects and isolated repair evidence | working-tree | RWANG |

Version diff: new RCA at 0.1.0b; no additional feature scope.
