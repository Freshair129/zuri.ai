# Production PostgreSQL migration reconciliation runbook

**Decision:** [ADR-104](../decisions/ADR-104-PRODUCTION-MIGRATION-LINEAGE-RECONCILIATION.md)

**Target:** Supabase project `qcnmhyglarzcpudjorzc` (verify again; never trust a copied value)

**Connection:** direct Postgres URL only; never print it

**Deployment:** Docker Compose under [ADR-058](../decisions/ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md)

This runbook applies the production database lane independently from the
application image lane. The original reconciliation has eleven steps (six
catalog-verified historical records and five SQL applies). Its 2026-09-23
receipt below remains a dated record of that execution. The Pipeline Builder
operation adds one separately gated SQL apply, but runs only when all eleven
prior ledger entries and catalog effects already match. This migration-specific
operator never records or applies a missing historical step.

## 1. Safety gates

Run from the accepted release checkout, not from a dirty primary checkout.
Confirm all of the following before any write:

- the current Git SHA is the reviewed release commit;
- `DIRECT_URL` resolves to the expected Supabase project direct endpoint and
  the connection is `postgres` on the `public` schema;
- the read-only preflight passes and its endpoint, schema, ledger and
  `Dependency` baseline are verified;
- a target-bound logical snapshot and its `Dependency` NDJSON sidecar are saved
  outside the repository with independently verified SHA-256 values;
- preflight and snapshot share the same endpoint, catalog, row and ledger
  baseline hashes;
- the migration plan contains only the allowlisted versions in ADR-104;
- the live Docker Compose project is not being replaced by this database step.

The preflight and snapshot scripts require `DIRECT_URL`, verify the direct
project endpoint and TLS certificate/hostname, and are read-only. Use a
protected external directory that does not already contain the output names:

```powershell
Push-Location apps/server
try {
$preflight = 'D:\operator-evidence\pm-pipeline-preflight.json'
$snapshot = 'D:\operator-evidence\pm-pipeline-snapshot.json'
node scripts/readonly-supabase-preflight.mjs $preflight
node scripts/readonly-supabase-logical-backup.mjs $snapshot
$preflightHash = (Get-FileHash -Algorithm SHA256 $preflight).Hash.ToLowerInvariant()
$snapshotHash = (Get-FileHash -Algorithm SHA256 $snapshot).Hash.ToLowerInvariant()
Get-FileHash -Algorithm SHA256 "$snapshot.dependency.ndjson"
} finally {
  Pop-Location
}
```

Both scripts ignore `DATABASE_URL`. The snapshot contains the migration ledger
and a row-level `public."Dependency"` backup in the adjacent NDJSON sidecar.
The sidecar preserves the complete row, including `contractJson` values when
present. Its full-row hash binds the recovery artifact; a separate
migration-invariant hash excludes only `contractJson` for before/after row
comparisons. Do not move one file without the other. The tool never prints connection
secrets. Keep receipts and the row backup in the approved external evidence
directory; they contain production data.

Do not use `prisma db push`, SQLite Prisma migrations or an unqualified
`supabase db push` while the ledger gap is unresolved.

## 2. Review the planned set

The controlled operator tool has two modes. Without `--apply` it performs a
rolled-back dry run and prints only redacted status. It requires the exact
preflight and snapshot file hashes verified above. `--apply` is the explicit
write gate and requires the expected project reference:

```powershell
Push-Location apps/server
try {
node scripts/production-migration-reconcile.mjs --project-ref qcnmhyglarzcpudjorzc --preflight $preflight --preflight-sha256 $preflightHash --snapshot $snapshot --snapshot-sha256 $snapshotHash
node scripts/production-migration-reconcile.mjs --apply --project-ref qcnmhyglarzcpudjorzc --preflight $preflight --preflight-sha256 $preflightHash --snapshot $snapshot --snapshot-sha256 $snapshotHash
} finally {
  Pop-Location
}
```

The tool first requires the six historical records and five prior SQL applies
to have exact ledger names and matching catalog effects. It stops on any
missing or partial prior state; this runner never records or applies those
earlier migrations. It then executes only
`20261024010000_dependency_handoff.sql`, whose bytes are hashed at runtime. The
operator independently verifies the endpoint and paired artifacts, then
acquires write-blocking `SHARE` locks on `Dependency` and the migration ledger
before capturing the current complete baseline inside a repeatable-read
transaction. Lock acquisition has a five-second timeout; each SQL statement has
a 120-second timeout. These locks remain held through the full pre/post
`Dependency` row scans. The accepted change window must allow up to five minutes
for the operator transaction; if fresh table size or active lock/transaction
pressure does not support completion within that window, stop before `--apply`
and request a separately reviewed operational plan. If the tool has not
returned within five minutes, interrupt it, then run fresh read-only checks to
determine whether the atomic transaction committed or rolled back before taking
any further action. It requires
`current_user = postgres` and `current_schema() = public`.

The Pipeline Builder step is migration
`20261024010000_dependency_handoff` with SHA-256
`7ebd65cccbb049f92a8e0c246b7866888f65e39958b855ae43ffbb704e965d19`. The
pending-migration precondition requires `public."Dependency"` to exist and
`contractJson` to be absent. The postcondition requires nullable `TEXT` with no
default and the exact ledger row. If both the exact ledger row and postcondition
already exist, the full-value snapshot permits the tool to return
`ALREADY_APPLIED` without writing. The tool also verifies that
`Dependency`'s migration-invariant rows, RLS, policies and grants remain
unchanged. If the column exists without its exact ledger row, stop and prepare
a separately reviewed record-only repair; never replay the `ALTER TABLE` or
write the external ledger manually.

Do not run `--apply` until the dry-run receipt is reviewed and separate explicit
production apply authorization is given for the exact commit and migration
hash. Approval of ADR-104 or this runbook alone is not the write authorization.

## 3. Post-apply verification

The tool's receipt is not sufficient by itself. Read the database again and
confirm all twelve allowlisted version/name pairs, including
`20261024010000` / `dependency_handoff`:

```sql
select version, name
from supabase_migrations.schema_migrations
where version in (
  '20260907233000','20260912120000','20260912130000',
  '20260912140000','20260912150000','20260912160000',
  '20260912170000','20260922120000','20260922130000',
  '20260923010000','20260923020000','20261024010000'
)
order by version;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'Dependency'
  and column_name = 'contractJson';
```

The protected sidecar is complete row evidence and can be used in an isolated
restore rehearsal. Do not replay it into production as an automatic rollback:
the additive migration changes no row values, and the transaction rolls back
on any pre-commit failure. If a post-commit issue appears, preserve the receipt
and snapshot, stop, and prepare a separately reviewed recovery decision.

Require exactly one row for every version/name pair. Require
`contractJson` to be `text`, nullable, and have no default. Compare the
pre-apply and post-apply `Dependency` row count and row hash after excluding the
new nullable column; verify RLS, policies, grants and unrelated ledger rows are
unchanged. For each of `MfaFactor`, `PasskeyCredential`,
`ProjectExecutionRun` and `ProjectExecutionStep`, verify `relrowsecurity =
true`, `relforcerowsecurity = true`, one `zuri_app_runtime_all` policy and zero
`service_role` table grants. Verify that `BusinessKeyResult`,
`BusinessKeyResultCheckIn` and `ProjectApprovalRequest` have the same runtime
policy/grant shape.

Record the apply receipt, preflight receipt, snapshot and sidecar SHA-256,
commit SHA and post-apply query output in the operator evidence directory. Do
not put database URLs, tokens, cookies, production row data or credential
material in tracked files or receipts.

## 4. Recorded apply receipt — 2026-09-23

PR #533 merged at `119f98639fa7efa03d0157fe0b7c6eccf044026c` before the write.
The operator apply completed with `APPLIED` for all 11 allowlisted steps against
Supabase `qcnmhyglarzcpudjorzc` (PostgreSQL 17, `public`). The redacted
pre-migration snapshot SHA-256 was
`39619a2064b9ba7f5beb8222201747fae622cc85dbb27aca8026cf37a3de2d9f`.

Post-apply verification found 107 total ledger rows and all 11 expected
version/name pairs, seven target tables, forced RLS, one policy and eight
runtime grants on each target table, zero `service_role`/Data API grants, and
zero rows in the new target tables. `BusinessGoal.perspective` and `isWig` were
present. The live Docker health endpoint returned `status=ok`, `db=ok` and
`dbLatencyMs=103`. The Docker image was not replaced by this database step.
This receipt predates the Pipeline Builder extension and is not current
production catalog or apply evidence for it.

## 5. Release boundary

Only after the database receipt is accepted may the release lane build a Docker
image. The image must come from a reconciled commit and must preserve the
production-only changes currently represented by the live image, or replacement
must be separately approved. Health `200` proves process/database reachability;
it does not prove PM execution, OKR, approval or handoff behavior without
route-level checks.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-23 | beta | Initial owner-approved production migration reconciliation runbook | uncommitted | RWANG |
| 0.2.0b | 2026-09-23 | applied | Production reconciliation applied and verified after PR #533; Docker image release remains separate | 119f9863 | RWANG |
| 0.3.0 | 2026-10-25 | accepted | Correct six-record lineage count and add the separately gated Pipeline Builder migration with target-bound evidence requirements | uncommitted | Codex |
