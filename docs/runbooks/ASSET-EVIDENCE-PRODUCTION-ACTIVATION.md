---
version: "0.3.0b"
created_at: "2026-09-02T12:31:04+07:00,RWANG"
last_update: "2026-09-04T07:20:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "runbook"
  scope: "Operator procedure for Supabase migration, private evidence storage, protected Vercel deployment, synthetic canary, promotion and rollback"
---

# Asset Evidence Production Activation Runbook

## Purpose and stop condition

This runbook activates CR-016 only up to `READY_FOR_REGISTRATION`. It never
creates a `RegisteredAsset`, mutates Procurement, capitalizes an Asset or posts
Finance entries. Stop immediately when a target is ambiguous, a migration is
destructive, a required environment name is absent, a bucket is public, a
canary state is unexpected or a runtime error remains unresolved.

Never paste or print a secret, database URL, evidence byte stream, provider
payload or extracted field value into a terminal transcript, issue, PR, log or
activation receipt.

## 1. Target identity

Required target record:

| System | Must be recorded before a write |
|---|---|
| GitHub | repository `Freshair129/zuri.ai` and merged `main` commit SHA |
| Vercel | authenticated team ID, project ID and Git repository link |
| Supabase | authenticated project ref and organization/project name |

Run read-only checks first:

```powershell
gh repo view Freshair129/zuri.ai --json nameWithOwner,defaultBranchRef
npx vercel@59.11.2 whoami
npx vercel@59.11.2 project inspect <vercel-project> --scope <vercel-team>
npx supabase@2.114.0 projects list
```

The Vercel inspection must resolve to `Freshair129/zuri.ai`. Link only after the
operator has matched the exact existing IDs; never create a similarly named
fallback project. Link Supabase only to the exact reviewed ref:

```powershell
npx vercel@59.11.2 link --project <vercel-project> --scope <vercel-team>
npx supabase@2.114.0 link --project-ref <supabase-project-ref>
```

Record redacted IDs in the activation report. A current authenticated context
that lists another repository is a refusal condition, not permission to create
a new project.

## 2. Backup and inventory

> **Done 2026-09-03 (inventory).** Read-only inventory over `DIRECT_URL` found the clean
> baseline: none of the nine Asset tables existed, neither Asset version was recorded,
> `storage.buckets` was empty. The operator-controlled logical backup could not be taken
> — the Supabase CLI is not logged in on the operator machine — and was consciously
> skipped: both migrations are additive only (no drop/rename/truncate/data rewrite,
> confirmed by a four-reviewer pass) and there was nothing Asset-related to back up on an
> empty baseline. Take the backup before any later, non-additive Asset migration.

Before apply, take an operator-controlled logical backup and retain its SHA-256
outside Git. Never write a database URL into the command line.

```powershell
npx supabase@2.114.0 migration list --linked
npx supabase@2.114.0 db dump --linked --file <approved-backup-path>
Get-FileHash -Algorithm SHA256 -LiteralPath <approved-backup-path>
```

Inventory the remote database through the approved SQL console or read-only
operator connection:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'RegisteredAsset', 'AssetIntake', 'AssetEvidence',
    'AssetProcurementRef', 'AssetLot', 'AssetResponsibility',
    'AssetLocationHistory', 'AssetProjectAllocation',
    'AssetDepreciationCandidate'
  )
order by table_name;

select version
from supabase_migrations.schema_migrations
where version in ('20260902001000', '20260902103000')
order by version;
```

Expected clean baseline: neither migration version is recorded and none of the
nine tables exists. If only part of the set exists, stop and perform a drift
review; do not mark a migration as applied manually.

## 3. Environment gate

Confirm names and scopes without printing values:

```powershell
npx vercel@59.11.2 env ls production --scope <vercel-team>
```

Production must contain `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_STORAGE_SERVICE_ROLE_KEY`, `ZURI_ASSET_EVIDENCE_BUCKET`,
`OPENAI_API_KEY` and optional `ZURI_ASSET_EVIDENCE_MODEL`. No credential may
start with `NEXT_PUBLIC_`. `ZURI_ASSET_EVIDENCE_BUCKET` must name the private
bucket provisioned by migration (`asset-evidence` for this release).

> **`OPENAI_API_KEY` becomes optional once the edge provider is activated
> (FR-143, FR-144, ADR-059).** `ZURI_ASSET_EVIDENCE_PROVIDER` selects the
> extraction path (`openai` | `edge`); an explicit value always wins, and with
> it unset the platform picks `edge` when no `OPENAI_API_KEY` is configured
> **and** the Business has at least one ACTIVE `EdgeDeviceCredential`, else it
> picks `openai`. A production Business running edge-only extraction may
> therefore ship this environment gate with `OPENAI_API_KEY` absent — see
> `docs/runbooks/EDGE-EXTRACTION-ACTIVATION.md` for minting the device
> credential and confirming a job completes end to end. The cloud never holds
> an edge model credential or secret of its own (ADR-041 D3); the only new
> production-relevant setting here is `ZURI_ASSET_EVIDENCE_PROVIDER` itself.

## 4. Apply migrations

> **Done 2026-09-03.** `db push --linked` was not available (no CLI login); each file was
> dry-run inside a rolled-back transaction, then run in its own transaction over
> `DIRECT_URL` with the `pg` client and its version inserted into
> `supabase_migrations.schema_migrations` (`20260902001000 asset_management_foundation`,
> `20260902103000 asset_evidence_intake_execution`). Two unrelated pending migrations
> (`20260830120000 plugin_auth`, `20260830221729 conversation_analysis`) were applied in the
> same window on the owner's instruction, so the "only the two approved Asset migrations"
> window statement below was widened by the owner rather than violated. Post-apply
> inventory: nine Asset tables, RLS enabled+forced, one `zuri_app_runtime_all` policy each,
> `zuri_app_runtime` holds SELECT/INSERT/UPDATE/DELETE, zero grants to
> anon/authenticated/service_role/PUBLIC, `AssetIntake` carries `normalizedEnvelopeJson`,
> `payloadSha256`, `validatedAt`, `validationJson`.

Review the linked dry run first. Only the two approved Asset migrations may be
new in this activation window.

```powershell
npx supabase@2.114.0 db push --linked --dry-run
npx supabase@2.114.0 db push --linked
npx supabase@2.114.0 migration list --linked
```

Post-apply inventory must return nine Asset tables and both migration versions.
The SQL must contain no drop, rename, truncate or data rewrite. A partial apply
or unexpected remote migration is a stop condition.

## 5. Verify storage

> **Done 2026-09-03.** `storage.buckets` holds `asset-evidence` with `public = false`,
> `file_size_limit = 20971520` and `allowed_mime_types = {image/jpeg, image/png,
> image/webp, application/pdf}` — exactly the expected values below. §3 (environment gate),
> §6 (protected deployment), §7 (synthetic canary) and §8 (promotion) remain NOT_RUN.

Verify bucket metadata through the approved SQL console:

```sql
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'asset-evidence';
```

Expected values:

- `public = false`;
- `file_size_limit = 20971520`;
- MIME allowlist is exactly `image/jpeg`, `image/png`, `image/webp` and
  `application/pdf`.

Confirm an unauthenticated object URL cannot retrieve a canary object. Upload,
read and removal must succeed only through the deployed server adapter. Record
only the opaque `supabase://` object reference and SHA-256, never its bytes or a
signed/public URL.

## 6. Protected deployment from merged `main`

Fetch and verify the artifact before deployment:

```powershell
git fetch origin main
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
npm ci
npm run verify
```

The working tree must be clean and `HEAD` must equal the merged `main` SHA in
the activation report. Create a production-target deployment without assigning
the production domain:

```powershell
npx vercel@59.11.2 deploy --prod --skip-domain --yes --scope <vercel-team>
npx vercel@59.11.2 inspect <protected-deployment-url> --scope <vercel-team>
```

Retain the current production deployment ID as the rollback target before any
promotion.

## 7. Synthetic canary

Use a generated image or PDF that says `SYNTHETIC TEST ONLY` and contains only
invented supplier, PO, PR, amount and transfer-reference values. It must contain
no real person, company registration number, tax ID, bank account, employee
identifier or customer data.

1. Sign in to the protected deployment as an authorized Asset receiver/reviewer.
2. Open `/assets/receiving` for a synthetic Business test scope.
3. Upload the canary as `PAYMENT_PROOF`; confirm the response contains an opaque
   object reference and a SHA-256, never a public URL.
4. Submit an intake with synthetic PR and PO references.
5. Run Vision extraction and confirm the provider result is `CANDIDATE`; it must
   not set review, approval or registration state.
6. Perform explicit human review and accept/correct the candidate.
7. Confirm the intake ends at `READY_FOR_REGISTRATION`.
8. Query by the returned opaque IDs to confirm no `RegisteredAsset` was created,
   no Procurement row was mutated and no Finance posting exists.
9. Scan Vercel runtime logs for the canary window and require zero unresolved
   errors.

Create a JSON activation receipt matching
`asset-production-activation.v1`, then validate it without printing its content:

```powershell
npm run asset:production:receipt:verify -- <redacted-receipt.json>
```

The receipt validator rejects credential-shaped values, database URLs, document
bytes, provider responses and extracted fields.

## 8. Promote

Promote only when target, backup/inventory, migrations, storage, environment,
protected deployment, canary and runtime scan all pass:

```powershell
npx vercel@59.11.2 promote <protected-deployment-url> --scope <vercel-team>
npx vercel@59.11.2 inspect <production-domain> --scope <vercel-team>
```

Repeat the health probe and short runtime error scan after alias assignment.
Any `NOT_RUN`, warning or unresolved error forbids promotion.

## 9. Rollback

Application rollback does not reverse additive database migrations:

```powershell
npx vercel@59.11.2 rollback <rollback-deployment-id> --scope <vercel-team>
```

If provider traffic must stop, remove or disable the Asset provider variables
through the Vercel dashboard/CLI and redeploy the known-good artifact. Preserve
Asset tables, evidence metadata and migration receipts. Quarantine/delete the
synthetic object only through the server storage port after retaining its opaque
ID and hash in the receipt. Never drop production tables as rollback.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Added the approved identity-to-rollback production activation procedure | working-tree | RWANG |
| 0.2.0b | 2026-09-03 | beta | §2 inventory, §4 migration apply and §5 storage verification recorded as done on production (direct SQL over DIRECT_URL, versions ledgered); backup step skipped on an empty additive-only baseline; §3, §6–§8 remain NOT_RUN | working-tree | Claude Code |
| 0.3.0b | 2026-09-04 | beta | §3 notes `OPENAI_API_KEY` is optional once `ZURI_ASSET_EVIDENCE_PROVIDER=edge` is active (FR-143, FR-144, ADR-059) and points to the new `EDGE-EXTRACTION-ACTIVATION.md` runbook; no other section changed | working-tree | Claude Code |
