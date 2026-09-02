---
version: "0.3.0b"
created_at: "2026-09-02T12:19:45+07:00,RWANG"
last_update: "2026-09-02T12:39:30+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "root-cause-analysis"
  scope: "Production activation cannot safely start because the deployment target, production credentials and PostgreSQL migration artifact are not available in the current operator context"
---

# RCA — Asset production activation readiness gap

## Symptom

The owner authorized production activation after PR #202 merged. Read-only
preflight could not identify an existing `zuri-ai` Vercel project, a linked
Supabase project, production PostgreSQL credentials, or the Asset migrations in
the production Supabase migration lane. No production mutation was attempted.

## Evidence

1. Vercel CLI 59.11.2 reported `Logged out`; the authenticated Codex Vercel
   connector listed one team and only one project, `resume`, linked to
   `Freshair129/resume`. It did not list a `zuri-ai` project.
2. `gh api repos/Freshair129/zuri.ai/deployments` returned an empty array. The
   repository has no Vercel deployment workflow or GitHub Actions deployment
   secrets/variables/environments; only `.github/workflows/governance.yml` is
   tracked.
3. Supabase CLI 2.114.0 reported that no access token was available. No
   `supabase/.temp/project-ref` exists.
4. The only local `DATABASE_URL` under the `zuri-ai` checkout resolves to a
   SQLite `file:` URL. It is not a remote PostgreSQL or Supabase connection.
5. The complete workspace-scoped `.env*` enumeration found no
   `OPENAI_API_KEY`, `SUPABASE_URL`, Supabase service-role variable,
   `ZURI_ASSET_EVIDENCE_BUCKET`, Vercel token, or Supabase access token for this
   repository. Values were never printed.
6. `prisma/migrations/20260902001000_asset_management_foundation/migration.sql`
   and `prisma/migrations/20260902103000_asset_evidence_intake_execution/migration.sql`
   exist, but there are no corresponding 20260902 Asset files under
   `supabase/migrations/`.
7. The Prisma Asset foundation migration contains SQLite-oriented types such as
   `DATETIME` and `REAL`; it is not the reviewed PostgreSQL/Supabase artifact
   used by the repository's production migration lane.
8. `tests/unit/asset-management-schema-contract.test.js` proves that both Prisma
   schema files contain the models and that a Prisma migration is additive. It
   does not require a Supabase migration, PostgreSQL execution, migration-ledger
   receipt, storage bucket policy, or production environment contract.
9. `.env.example` does not declare the environment variables consumed by the
   configured Supabase storage and OpenAI extraction adapters.

## Root Cause

CR-015 was intentionally authorized and delivered as a local beta ending at
`READY_FOR_REGISTRATION`. Production provider activation was explicitly left as
an operational gate. The implementation added provider adapters and PostgreSQL
schema-model parity, but the delivery gate did not require the operational
artifacts that turn those contracts into a production deployment:

- a reviewed Supabase/PostgreSQL migration in the repository's production lane;
- a test that executes or parses that production migration contract;
- a complete server-side environment-variable template;
- an identified Vercel project/team and Supabase project;
- a redacted, consented real-provider canary procedure.

The immediate blocking condition is therefore not a bad key. It is the absence
of an authenticated and unambiguous production target plus the absence of a
deployable Asset migration artifact for that target.

## Why the issue escaped detection

1. The approved Definition of Done was local-beta completion, not production
   activation. The report truthfully recorded provider and migration gates as
   `NOT_RUN`.
2. The phrase "SQLite/Postgres schema parity and migration" combined two
   different proofs: model parity in both Prisma schema files and an additive
   local Prisma migration. It did not prove a Supabase production migration.
3. Tests exercised adapters with injected fake credentials and mocked provider
   responses. They correctly proved secret non-disclosure but could not prove
   deployed secret presence or scope.
4. No gate compared configured adapter variable names with `.env.example`.
5. No gate required a Vercel/Supabase project identity before declaring a slice
   ready for a later production activation.

## Proposed prevention

1. Add CR-016 and ADR-057 to make production activation a separate reviewed
   change, preserving CR-015's local-beta truth.
2. Add PostgreSQL/Supabase Asset migrations generated against the actual remote
   baseline, review them for additive-only behavior, and require ledger receipts.
3. Add tests that require every production Asset model/mutation to have a
   Supabase migration and reject SQLite-only types in that lane.
4. Add the required server-only variables to `.env.example` with empty values and
   a test that adapter variables remain declared without exposing values.
5. Require explicit Vercel team/project and Supabase project identity before any
   production command. Never auto-create a similarly named project when the
   authenticated account does not contain the expected target.
6. Use a two-phase deployment: additive migration and inventory verification,
   then protected deployment/canary and promotion.
7. Use a synthetic, non-PII receipt/payment proof for the first real-provider
   canary; log only IDs, hashes, states, status codes and timings.

## Current containment

- No database, storage, Vercel project, secret or production alias was mutated.
- The merged application remains at the verified local-beta boundary.
- At investigation time, production activation was blocked until CR-016/ADR-057
  approval and authentication of the intended Vercel/Supabase targets.

## Remediation status

CR-016 and ADR-057 were approved. The missing repository-side Supabase migrations,
environment contract, runbook, receipt validator and regression tests are implemented
and locally verified. The remaining blocker is narrower: the intended Vercel and
Supabase targets are still not authenticated or unambiguously visible to this operator
context. Therefore remote inventory/apply/deploy/canary/promotion remain gated and no
production mutation has occurred.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | draft | Recorded the verified production-readiness gap and proposed prevention | working-tree | RWANG |
| 0.2.0b | 2026-09-02 | beta | Owner approved the containment and remediation direction | working-tree | RWANG |
| 0.3.0b | 2026-09-02 | beta | Recorded local remediation completion and narrowed the blocker to authenticated production targets | working-tree | RWANG |
