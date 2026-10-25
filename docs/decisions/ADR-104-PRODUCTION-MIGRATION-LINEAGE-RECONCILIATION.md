---
id: ZAI:ADR-104
title: Production PostgreSQL migration lineage reconciliation and controlled apply
version: "0.2.0"
status: accepted
created_at: "2026-09-23T00:00:00+07:00,RWANG"
last_update: "2026-10-25T00:00:00+07:00,Codex"
author: RWANG
superseded_by: null
attributes:
  domain: platform-control
  doc_type: architecture-decision
  scope: Production Supabase migration lineage, additive PM/OKR/IAM apply and Docker release separation
relations:
  - type: relates_to
    target: ZAI:ADR-057
  - type: relates_to
    target: ZAI:ADR-058
  - type: relates_to
    target: ZAI:ADR-102
  - type: relates_to
    target: ZAI:ADR-103
---

# ADR-104 — Production PostgreSQL migration lineage reconciliation and controlled apply

**Status:** Accepted on 2026-09-23 and amended on 2026-10-25. The database
operator lane may proceed only through the gates in this decision.
Application-image replacement stays separate until the release source is
reconciled with the image currently serving production.

**Risk:** HIGH. This decision crosses the production migration ledger, security
posture and the Docker release boundary.

## Context

The production Supabase database and the repository migration tree do not have a
one-to-one ledger at the current target. A read-only preflight on 2026-09-23
identified 105 committed Supabase migration files versus 96 production ledger
rows. Ten versions are absent from the ledger:

- `20260907233000_execution_trace`
- `20260912120000_access_grant_lifecycle`
- `20260912130000_org_employment_legal_entity`
- `20260912140000_access_invite_sod_operator`
- `20260912150000_audit_scope_and_evidence`
- `20260912160000_p2_mfa_session_assurance`
- `20260912170000_p2_webauthn_passkeys`
- `20260922120000_pm_execution_trace_replay`
- `20260922130000_business_key_results`
- `20260923010000_pm_approval_gateway_admission`

Catalog evidence shows the effects of the first six older slices are present,
while `PasskeyCredential` is absent. The PM trace tables, OKR tables and
approval table are also absent. The production runtime is a Docker Compose
deployment using an image built from a dirty primary checkout, so replacing it
with a clean `origin/main` image before source reconciliation could regress
changes that are currently live.

## Decision

### D1 — Reconcile by evidence; never replay destructive historical SQL

The operator must compare each missing version with the live catalog before
acting. A migration whose exact tables, columns, constraints, indexes and
security effects are already present is recorded as applied by the controlled
operator tool; its historical SQL is not replayed. A missing effect is applied
from its reviewed `supabase/migrations/*.sql` file, then recorded by the same
operator transaction.

The reconciliation tool refuses a version/name mismatch, an unexpected target,
an absent precondition or an unreviewed migration path. It is the only place
allowed to repair the external ledger; migration SQL files never insert into
`supabase_migrations.schema_migrations`.

### D2 — Apply only the reviewed additive set

The approved production set is:

1. record the six historical effects already verified by catalog evidence;
2. apply and record `20260912170000_p2_webauthn_passkeys.sql` because
   `PasskeyCredential` is absent;
3. apply and record the PM execution-trace migration;
4. apply and record the Business Key Result migration;
5. apply and record the PM approval-gateway migration;
6. apply and record the RLS/grant hardening migration added by this decision.

The hardening migration forces RLS, installs the single runtime policy and grants
runtime DML only for `MfaFactor`, `PasskeyCredential`, `ProjectExecutionRun`
and `ProjectExecutionStep`. It also revokes access from `PUBLIC`, `anon`,
`authenticated` and `service_role`. The PM trace migration is intentionally
followed by this repair because its original file enabled RLS without creating a
policy or runtime grant.

**Ruling (2026-10-25):** the historical record count is six. The first six
versions listed in Context are the catalog-present effects; the executable
manifest and its contract test each contain six `record` and five prior
`apply` steps, and the 2026-09-23 receipt describes eleven total steps. “Seven”
was a count error. This ruling leaves those eleven steps unchanged.

### D3 — The operator path is explicit and reversible at the release boundary

The operator runs a read-only preflight and logical snapshot, then a rolled-back
dry run, and only then the explicit apply command against the direct Supabase
connection. The tool verifies the project reference, current user, migration
file hashes, expected ledger state and post-apply RLS/grant invariants. It does
not use SQLite Prisma migrations, `prisma db push`, or a Compose startup hook to
mutate the external database.

Database changes in this slice are additive or ledger-recording only. Rollback of
application behavior is a Docker image rollback; database structural rollback is
not automatic and requires a separately reviewed migration. A failed transaction
must leave the database and ledger unchanged for that migration.

### D4 — Database apply and application deploy remain separate gates

Applying the database does not authorize replacing the live web/worker image.
The release image must first be built from a reconciled commit that preserves
the current production-only changes or explicitly replaces them with owner
approval. The production deployment continues to use Docker Compose and the
existing ngrok overlay under ADR-058.

### D5 — Admit the Pipeline Builder handoff column as a separately gated step

The controlled operator applies only the exact additive migration
`20261024010000_dependency_handoff.sql` with SHA-256
`7ebd65cccbb049f92a8e0c246b7866888f65e39958b855ae43ffbb704e965d19`. It adds
nullable `TEXT` column `public."Dependency"."contractJson"` without a default,
backfill, row rewrite, grant change or RLS change. The operator must stop if the
column exists without its exact ledger row, and require exact column and ledger
postconditions if the row already exists. All eleven entries from the original
reconciliation must already have matching ledger names and catalog effects;
this migration-specific path never records or applies a missing prior entry. It
locks `Dependency` and the migration ledger before capturing the live baseline,
so committed writers are included in the comparison and later writers wait
until the operation ends. The logical-backup sidecar preserves every
`Dependency` column, including `contractJson` when present, and verifies the full
row hash. A separate migration-invariant row hash excludes only that new column
when comparing before and after, so the recovery evidence remains complete and
the `ALREADY_APPLIED` check remains usable.

This scope decision permits implementation and isolated qualification of the
operator lane. It does not authorize a production connection, preflight,
snapshot, dry run, apply or application release. Production apply still needs
fresh evidence, the exact reviewed main commit, a scheduled change window and
separate explicit apply authorization under this decision and its runbook.

## Alternatives and consequences

Running `supabase db push` against the entire backlog was rejected because the
ledger gap includes historical migrations with unguarded rename/drop operations
whose effects already exist. Re-running them could fail or mutate live data.

Inserting old ledger rows from a migration file was rejected because it makes a
schema migration impersonate the operator receipt and bypasses the evidence
gate. A dedicated operator tool keeps the external ledger repair explicit,
auditable and testable.

The consequence is a short-lived, intentional distinction between migration
files and the production receipt while the operator performs the reconciliation.
The distinction closes only after the post-apply ledger comparison and catalog
verification pass.

## Verification

- `npm run govern`, focused migration tests and the production operator-tool
  contract tests pass on the reconciled branch.
- Preflight and the redacted logical snapshot identify the same Supabase project
  and current schema before apply.
- The dry run rolls back with no new ledger rows or target tables.
- After the original reconciliation, all eleven allowlisted versions are
  present with matching names; the Passkey, PM trace, OKR and approval tables
  exist, and every newly secured table reports
  `rls=t`, `forced=t`, at least one policy and zero `service_role` table grants.
- The separately gated Pipeline Builder step requires the exact nullable
  `TEXT` column, one matching migration ledger row, unchanged Dependency rows,
  RLS, policies and grants, plus a verified rollback dry run before apply.
- Docker health and the PM/OKR/approval read paths are checked after the
  application release gate; database apply alone is not a deploy claim.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-23 | beta | Production migration lineage reconciliation and controlled additive apply decision | uncommitted | RWANG |
| 0.2.0 | 2026-10-25 | accepted | Correct the historical record count to six and admit the exact Pipeline Builder handoff migration behind separate production apply authorization | uncommitted | Codex |
