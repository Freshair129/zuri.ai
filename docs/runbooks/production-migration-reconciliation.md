# Production PostgreSQL migration reconciliation runbook

**Decision:** [ADR-104](../decisions/ADR-104-PRODUCTION-MIGRATION-LINEAGE-RECONCILIATION.md)

**Target:** Supabase project `qcnmhyglarzcpudjorzc` (verify again; never trust a copied value)

**Connection:** direct Postgres URL only; never print it

**Deployment:** Docker Compose under [ADR-058](../decisions/ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md)

This runbook applies the production database lane independently from the
application image lane. It is intended for the owner-approved reconciliation
where the live ledger is behind the repository tree and some historical effects
already exist.

## 1. Safety gates

Run from the accepted release checkout, not from a dirty primary checkout.
Confirm all of the following before any write:

- the current Git SHA is the reviewed release commit;
- `DIRECT_URL` resolves to the expected Supabase project and the connection is
  `postgres` on the `public` schema;
- the read-only preflight passes;
- a redacted logical snapshot is saved outside the repository with its SHA-256;
- the migration plan contains only the allowlisted versions in ADR-104;
- the live Docker Compose project is not being replaced by this database step.

The preflight and snapshot scripts are read-only:

```powershell
node --env-file=.env scripts/readonly-supabase-preflight.mjs <receipt.json>
node --env-file=.env scripts/readonly-supabase-logical-backup.mjs <snapshot.json>
```

Do not use `prisma db push`, SQLite Prisma migrations or an unqualified
`supabase db push` while the ledger gap is unresolved.

## 2. Review the planned set

The controlled operator tool has two modes. Without `--apply` it performs a
rolled-back dry run and prints only redacted status. `--apply` is the explicit
write gate and requires the expected project reference:

```powershell
node scripts/production-migration-reconcile.mjs --project-ref qcnmhyglarzcpudjorzc --preflight <receipt.json> --snapshot <snapshot.json>
node scripts/production-migration-reconcile.mjs --apply --project-ref qcnmhyglarzcpudjorzc --preflight <receipt.json> --snapshot <snapshot.json>
```

The tool records old migrations only after their catalog preconditions pass. It
executes the missing `PasskeyCredential`, PM trace, Business Key Result,
approval-gateway and hardening SQL in the declared order. Each SQL file is
hashed at runtime and the plan refuses an unexpected target or a missing file.

## 3. Post-apply verification

The tool's receipt is not sufficient by itself. Read the database again and
confirm:

```sql
select version, name
from supabase_migrations.schema_migrations
where version in (
  '20260907233000','20260912120000','20260912130000',
  '20260912140000','20260912150000','20260912160000',
  '20260912170000','20260922120000','20260922130000',
  '20260923010000','20260923020000'
)
order by version;
```

For each of `MfaFactor`, `PasskeyCredential`, `ProjectExecutionRun` and
`ProjectExecutionStep`, verify `relrowsecurity = true`,
`relforcerowsecurity = true`, one `zuri_app_runtime_all` policy and zero
`service_role` table grants. Verify that `BusinessKeyResult`,
`BusinessKeyResultCheckIn` and `ProjectApprovalRequest` have the same runtime
policy/grant shape.

Record the apply receipt, preflight receipt, snapshot SHA-256, commit SHA and
post-apply query output in the operator evidence directory. Do not put database
URLs, tokens, cookies, audio, transcripts or credential material in the receipt.

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

## 5. Release boundary

Only after the database receipt is accepted may the release lane build a Docker
image. The image must come from a reconciled commit and must preserve the
production-only changes currently represented by the live image, or replacement
must be separately approved. Health `200` proves process/database reachability;
it does not prove PM execution, OKR or approval behavior without route-level
checks.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-23 | beta | Initial owner-approved production migration reconciliation runbook | uncommitted | RWANG |
| 0.2.0b | 2026-09-23 | applied | Production reconciliation applied and verified after PR #533; Docker image release remains separate | 119f9863 | RWANG |
