---
id: ZAI:PM-PIPELINE-PRODUCTION-MIGRATION-20261025
title: Project Manager Pipeline Builder production migration plan
doc_type: implementation-plan
status: approved
version: "0.2.0"
approved_at: "2026-10-25"
source_revision: "189fb41a677b5ebf4a0a92053c3ef6f93ca7e833"
relations:
  - type: references
    target: ZAI:FEAT-007
  - type: references
    target: ZAI:FR-084
  - type: references
    target: ZAI:ADR-035
  - type: references
    target: ZAI:ADR-104
  - type: references
    target: ZAI:ADR-018
  - type: references
    target: ZAI:ADR-058
---

# Project Manager Pipeline Builder production migration plan

> **Status: approved for operator-tool implementation and isolated
> qualification.** This approval grants no production connection, preflight,
> backup, dry run, migration apply, runtime activation or application
> deployment. Production work still requires a separately approved change
> window and exact apply authorization after review of fresh evidence.

## Goal and scope

Prepare a controlled production change for the single additive PostgreSQL
migration that introduces `public."Dependency"."contractJson"` for FR-084,
after reconciling it with the production lineage controls in ADR-104.

The production change under consideration is only
`20261024010000_dependency_handoff.sql`. It adds a nullable `TEXT` column with
no default, backfill, data rewrite, grant change, or RLS change. Existing rows
must retain `NULL` and the legacy undeclared-edge behavior. The Prisma SQLite
migration is provider-parity evidence, not an instruction to run SQLite or
`prisma db push` against production.

This plan excludes the other SQL files used in the isolated UAT, canonical
lifecycle adoption, production application-image replacement, runtime data
activation, and any broader PM/OKR/IAM migrations. Database apply and application
release remain separate gates under ADR-104 D4 and ADR-058.

## Verified source baseline

The review baseline is main merge commit
`189fb41a677b5ebf4a0a92053c3ef6f93ca7e833` (tree
`a4cde3fc6a5246865667804fda8896342284ab26`). PR #745 records isolated Pipeline
Builder UAT against synthetic data and an isolated PostgreSQL deployment. That
UAT is useful application and migration rehearsal evidence; it is not a current
production catalog, backup, ledger, or apply receipt.

The PostgreSQL migration is exactly:

| Field | Reviewed value |
|---|---|
| Version | `20261024010000` |
| Name | `dependency_handoff` |
| File | `apps/server/supabase/migrations/20261024010000_dependency_handoff.sql` |
| SHA-256 | `7ebd65cccbb049f92a8e0c246b7866888f65e39958b855ae43ffbb704e965d19` |
| Effect | `ALTER TABLE public."Dependency" ADD COLUMN "contractJson" TEXT;` |

Both Prisma schemas declare `Dependency.contractJson String?`; the SQLite
migration also adds a nullable column without rewriting existing rows.

At the source baseline, ADR-104 D2 said to record seven historical effects,
while the operator tool, test and runbook pinned eleven entries (six `record`,
five `apply`). The source evidence resolves the discrepancy: the first six
versions listed by ADR-104 are the catalog-present historical effects; six
`record` plus five prior `apply` is eleven. “Seven” was a count error. ADR-104
D2 now records six, and D5 admits this exact Pipeline Builder migration as a
separately gated twelfth step. ADR-104's 2026-09-23 receipt and ledger counts
remain dated evidence, not the current production state. No live production
ledger or catalog was read for this plan or its implementation.

Source review also found operator-tool gaps to resolve before using it for this
migration:

- The operator, read-only preflight, and logical-backup scripts accept
  `DATABASE_URL`. The preflight and backup outputs use a hard-coded production
  reference, but none of the scripts verifies that the actual connection
  endpoint belongs to that project. The reconciliation script checks artifact
  mode/reference fields but does not bind them to its actual endpoint. The
  current user is checked as `postgres`; `current_schema()` is reported but is
  not required to be `public`.
- The operator and read-only clients set `rejectUnauthorized: false` for
  Supabase URLs, so TLS does not authenticate the database certificate and
  hostname.
- The current logical-backup script snapshots selected `zuri_core` tables and
  the migration ledger, but not `public."Dependency"`. It does not provide a
  row-level rollback artifact for the table being changed.
- The reconciliation tool verifies migration-file hashes and column presence,
  but does not validate the column's exact type/nullability/default or a
  pre-apply absence condition for this change.

These are static source findings only; they say nothing about today's live
production configuration or schema.

## Plan of work

### 0. Approve the exact non-production scope

- Owner approval received 2026-10-25 for operator-tool implementation and
  isolated qualification.
- ADR-104 D2 now records the six catalog-present historical effects; D5 names
  this migration's version, name, file path, hash and separate apply gates.
- This decision does not grant production access, dry-run or apply authority.
- Keep the production database change and image release as separate decisions.

**Exit:** passed for the bounded non-production work. The production apply gate
remains closed until fresh evidence and separate explicit authorization.

### 1. Reconcile source and compatibility

- Start from the then-current reviewed main commit and re-confirm the SQL file
  hash, the matching Prisma migration, generated PostgreSQL schema, and all
  consumers of `contractJson`.
- Confirm the SQL remains a single additive `ALTER TABLE` with no data rewrite,
  default, grant, RLS, or policy changes. Any changed SQL or hash returns to
  decision review.
- Confirm the deployed application image/source lineage before planning the
  database operation. Do not replace the production image as part of this plan.

### 2. Extend the controlled operator lane

The owning decision, runbook, and operator tooling were updated in this reviewed
change:

- Add the exact migration entry and SHA-256 to
  `apps/server/scripts/production-migration-reconcile.mjs`. Keep historical
  entries as catalog/ledger prerequisites, but make the production CLI execute
  only the Pipeline Builder migration; stop if any prior name or catalog effect
  is missing or mismatched.
- Update `apps/server/scripts/readonly-supabase-preflight.mjs` and
  `apps/server/scripts/readonly-supabase-logical-backup.mjs` to require
  `DIRECT_URL`, verify the live endpoint against the approved project reference
  without printing connection secrets, and write target-bound artifacts with a
  shared baseline identity/hash. Require TLS certificate and hostname
  verification with the approved CA; do not disable certificate validation.
- Make the reconciliation tool require `DIRECT_URL`, independently verify the
  live endpoint against the accepted project, require `current_user = postgres`
  and `current_schema() = public`, and reject preflight/snapshot artifacts that
  do not match the same verified target and baseline.
- Require TLS certificate and hostname verification in the reconciliation
  connection too; fail closed when the approved CA or identity cannot be
  verified.
- Add preconditions that `public."Dependency"` exists and
  `contractJson` is absent. Add postconditions that it is `text`, nullable, and
  has no default, and that the migration ledger records the exact version/name.
  Verify RLS, policies and grants are unchanged from the approved preflight.
- Extend the protected logical snapshot to cover the affected
  `public."Dependency"` rows (or an approved equivalent table-level backup),
  the target schema shape, and the migration ledger. Keep the artifact outside
  the repository and verify its content hash before use. The sidecar must
  preserve every `Dependency` column, including `contractJson` when present;
  keep a separate migration-invariant row hash that excludes only this column
  for before/after comparisons.
- If the column exists without the exact ledger row, stop and prepare a
  separate record-only reconciliation with exact catalog evidence. Do not
  replay the `ALTER TABLE` or write the external ledger manually. If the ledger
  row exists, require the exact name and postconditions before returning
  `ALREADY_APPLIED`.
- Extend `apps/server/tests/unit/production-migration-reconciliation.test.js`
  to pin the new manifest entry, hash, mode counts, target guards, artifact
  binding, catalog checks, atomic ledger behavior, rollback on dry run, and all
  mismatch/partial-state refusals, including a mismatched TLS certificate or
  hostname. Add tests for any modified preflight or backup behavior.
- Update `docs/runbooks/production-migration-reconciliation.md` with the new
  approved scope, exact target checks, artifact custody, command sequence,
  post-apply queries and stop conditions. Do not add credentials or production
  row data to tracked files.

**Exit:** record focused tests, isolated database rehearsal, `npm run govern`,
and independent review of the exact patch in the implementation evidence below.
No production connection is needed for this phase.

### 3. Qualify the exact migration in isolated PostgreSQL

- Use a harness-created Docker container with a per-run owner token, Postgres 17,
  loopback-only port binding, `--rm` and tmpfs data. Verify its container id,
  label, database identity, port and storage before any destructive SQL; never
  accept an arbitrary local `PM_MIGRATION_TEST_DATABASE_URL`. Use the exact
  reviewed production operator code, migration bytes, and synthetic baseline.
  Prove absent-column apply, exact
  ledger recording, and a rolled-back dry run that leaves table rows, catalog,
  security state, and ledger unchanged.
- Prove fail-closed behavior for wrong endpoint/reference, wrong user/schema,
  untrusted/mismatched TLS certificate or hostname, hash mismatch, wrong ledger
  name, missing table, pre-existing column, wrong column shape,
  invalid/mismatched snapshot, and interrupted transaction.
- Re-run authenticated application behavior with the actual non-owner runtime
  role against PostgreSQL. Confirm legacy-null edges remain undeclared and
  existing protected-write/authorization behavior is unchanged. The existing
  PR #745 evidence can be cited for its tested scope but does not replace proof
  against the final reviewed migration/operator patch.
- Generate the row-hashed NDJSON sidecar outside the repository, verify its
  hash/count from the snapshot metadata, and restore the isolated target from
  that sidecar. Compare the affected table's row hashes/counts, schema, ledger,
  RLS, policies and grants. Structural rollback is a separate reviewed
  migration; it is not an automatic `DROP COLUMN` action.

### 4. Prepare the separately authorized production window

Only after the reviewed code change is merged and its required hosted checks pass:

- Obtain explicit production operator authorization and a scheduled change
  window for the exact main commit and migration hash. This plan alone does not
  authorize the operation.
- Use the approved secret source for `DIRECT_URL`; never put its value in shell
  history, tracked files, logs, or receipts.
- Run fresh read-only preflight and a protected logical snapshot that includes
  `public."Dependency"`. Verify the endpoint/project, `postgres` user,
  `public` schema, current migration ledger, table/column state, and table
  security. Capture table size and active lock/transaction pressure for change
  timing; the snapshot reports relation-lock counts, active transaction count,
  oldest transaction age and lock waiters. Keep the operator's five-second lock
  acquisition timeout, 120-second statement timeout and five-minute supervised
  transaction window. Stop before `--apply` if fresh size/activity evidence
  cannot support completion inside the window. If the command is interrupted,
  take fresh read-only evidence to determine commit versus rollback before
  acting again. Compare the current baseline to the accepted source and stop on
  drift.
- Run the controlled tool without `--apply`. For a pending migration, accept
  only a `DRY_RUN_ROLLED_BACK` result for the exact project, commit, file hash
  and snapshot. Independently confirm the migration row and new column remain
  absent and that the affected table/security baseline is unchanged. If the
  exact ledger row and postconditions already exist, accept only
  `ALREADY_APPLIED`, verify the paired full-row snapshot and make no write.
- Allow a supervised five-minute transaction window. The read-only evidence
  reports relation size, relation locks, active transaction count, oldest
  transaction age and lock waiters. If the evidence does not support completing
  both full-table scans inside that window, stop before `--apply`; the tool has
  a five-second lock acquisition timeout and a 120-second per-statement limit.
  If an operator interrupts a long run, use fresh read-only evidence to decide
  whether it committed or rolled back before any retry.
- For a pending migration, require a second, explicit apply authorization after
  reviewing the dry-run receipt. Apply only the single approved migration in
  the controlled operator transaction. Do not run `supabase db push`,
  `prisma db push`, SQLite migrations, startup hooks, or manual ledger SQL.

### 5. Verify and close the database change

- Confirm ledger version `20261024010000` has name `dependency_handoff` exactly
  once.
- Confirm `public."Dependency"."contractJson"` is `text`, nullable, with no
  default; compare the affected table against the pre-apply snapshot to prove no
  existing row was rewritten. Confirm RLS, policies, grants, and unrelated
  schema/ledger state match the approved baseline.
- Save redacted preflight, protected snapshot hash, dry-run/apply receipts,
  commit and migration hashes, post-apply query results, operator identity,
  timestamps, and any deviations in the approved external evidence directory.
  Never commit credentials or production row data.
- Record database migration status separately from image release. Any app-image
  replacement requires its own source reconciliation, release review and
  authorization under ADR-104 D4 and ADR-058.
- A pre-commit failure rolls back atomically. The sidecar supports isolated
  recovery qualification but is not an automatic production restore command;
  after any post-commit concern, preserve evidence and obtain a separately
  reviewed recovery decision.

## Stop conditions

Stop before mutation if the reviewed SQL hash changes; target identity or
connection is uncertain; `DIRECT_URL`, user, schema, artifact target or snapshot
does not match; TLS certificate or hostname verification fails; the migration
is not in the accepted allowlist; the ledger or column is partially present;
`Dependency` catalog/security differs from the accepted baseline;
backup/recovery is unverified; the dry run mutates anything; or a required
review/check is missing. Preserve the evidence and prepare a new reconciliation
decision instead of improvising a repair.

## Implementation and qualification record — 2026-10-25

- ADR-104 D2 now records six historical effects, and D5 pins the new migration
  version, name, file, hash and separate apply gate.
- The operator now requires the project-specific direct endpoint and
  `DIRECT_URL`; it builds a TLS config that cannot be downgraded by URL options,
  with certificate-chain and hostname verification enabled.
- The production CLI executes only `20261024010000_dependency_handoff.sql`;
  all eleven earlier records and SQL applies are mandatory exact-name/catalog
  prerequisites. It locks `Dependency` and the migration ledger before
  capturing the baseline, so committed writers appear in the comparison and
  subsequent writers wait until the transaction ends.
- Preflight and snapshot artifacts carry one matching target/baseline identity.
  Their file hashes are supplied out of band to the operator. The snapshot
  includes every `Dependency` field in a full-row NDJSON sidecar, while a
  separate hash excludes only `contractJson` for migration-invariant row
  comparisons. The operator streams and verifies the complete sidecar before
  using it, including after the column is already present.
- Isolated PostgreSQL 17 qualification uses a harness-owned auto-removed
  loopback-only tmpfs database and synthetic rows. Four integration tests passed
  for missing-history refusal, lock timing against a concurrent writer, dry-run
  rollback, exact nullable column and ledger postconditions, partial-state
  refusal, failed-postcondition rollback, unchanged rows/RLS/policy/grants,
  full-value sidecar capture with `contractJson` present, and restoration from
  the verified NDJSON sidecar.
- TLS handshake tests rejected an untrusted certificate and a trusted
  certificate for the wrong hostname; a trusted matching-host control passed.
- `npm --prefix apps/server run test:postgres -- tests/postgres/pipeline-handoff-races.test.js`
  passed all 13 tests with a disposable embedded PostgreSQL cluster, including
  the actual `zuri_web_login` runtime role, legacy NULL behavior and recovery.
- Focused operator unit tests passed 13/13; the isolated PostgreSQL operator
  integration suite passed 4/4; the actual-runtime-role Pipeline Builder suite
  passed 13/13. Server build passed, including Next lint and type validation.
  `npm run govern` passed with zero criticals and zero warnings.
- Independent review of the exact patch: ready to merge as a non-production
  plan/tooling patch, with no material blockers. The reviewer did not rerun
  checks or access production; the command results above are the local receipts.

## Acceptance record for this planning task

- Plan status: approved for tooling implementation and isolated qualification.
- Production authority: no production connection, preflight, snapshot, dry run,
  apply, runtime activation or deployment was performed or authorized by this
  plan approval.
- Production access, preflight, snapshot, dry run, apply and deployment: not
  performed.
- Next gate: complete independent review on the exact patch. A future
  production window still requires fresh evidence, exact-head review, a change
  window and separate explicit apply authorization.
