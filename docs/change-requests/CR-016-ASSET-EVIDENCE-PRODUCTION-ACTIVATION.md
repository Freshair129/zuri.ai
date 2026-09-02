---
version: "0.4.0b"
created_at: "2026-09-02T12:19:45+07:00,RWANG"
last_update: "2026-09-03T05:10:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "change-request"
  scope: "Production PostgreSQL migration, private evidence storage, Vercel deployment and real-provider canary for FR-137..140"
---

# CR-016 — Asset Evidence Production Activation

## Outcome requested

Activate the already-implemented FR-137..140 Asset evidence beta on one explicit
production Supabase project and one explicit Vercel project without expanding the
functional boundary beyond `READY_FOR_REGISTRATION`.

## Dependency

This change depends on CR-015 and ADR-056. It addresses the operational gates
recorded in the CR-015 W4 report and the RCA at
`.brain/rca/2026-09-02-asset-production-activation-readiness-gap.md`.

## Complexity and risk

- Execution level: C-3, architecture-driven implementation.
- Risk: HIGH — production schema, server credentials, payment evidence and an
  external AI provider are in scope.

## Scope

1. Identify and record the exact Vercel team/project and Supabase project before
   any write.
2. Add reviewed PostgreSQL/Supabase migrations for the Asset foundation and
   evidence-execution tables, indexes and relations already declared in
   `prisma/schema.postgres.prisma`.
3. Add a private Supabase Storage bucket for Asset evidence with no public URL,
   no upsert, a 20 MiB object limit and the MIME boundary accepted by FR-137.
4. Declare and verify these server variables without committing their values:
   `SUPABASE_URL`, one server-only Supabase service-role variable,
   `ZURI_ASSET_EVIDENCE_BUCKET`, `OPENAI_API_KEY` and optional
   `ZURI_ASSET_EVIDENCE_MODEL`.
5. Build and deploy the merged `main` artifact to a protected Vercel deployment.
6. Run a synthetic, non-PII image/PDF canary through upload, extraction, human
   review and deterministic validation up to `READY_FOR_REGISTRATION`.
7. Promote only after database inventory, storage isolation, provider output,
   audit evidence and runtime logs pass.

## Non-goals

- creating `RegisteredAsset` records or Asset IDs;
- mutating PR, PO, GRN or Procurement records;
- Finance capitalization, depreciation-book approval, journals or tax posting;
- live two-way Google Sheets synchronization;
- LINE signature verification or LINE attachment-byte retrieval;
- copying production secret values into files, commands, logs or evidence.

## Required documentation and implementation changes

### Documentation

- accept ADR-057 as the production deployment and migration boundary;
- update CR-015/W4 delivery state to link this separate activation slice without
  rewriting the local-beta historical claim;
- add an operator runbook containing identity checks, backup/inventory, apply,
  verify, canary, promote and rollback steps;
- record a production activation report with only redacted identifiers.

### Tests before implementation

1. RED: Asset production migrations are missing from `supabase/migrations`.
2. RED: SQLite-only types are rejected from the Supabase migration lane.
3. RED: required Asset provider variable names are missing from `.env.example`.
4. RED: storage migration/config must prove a private bucket and bounded size.
5. RED: deployment/canary receipt must reject secret values and document bytes.
6. GREEN: run focused migration/env/canary tests, full `npm run verify`, then
   GitHub PR and post-merge governance workflows.

## Production execution gates

| Gate | Required evidence | Refusal condition |
|---|---|---|
| Target identity | exact Vercel team/project and Supabase project ref | missing, ambiguous or wrong Git repository |
| Database baseline | backup/inventory and remote migration ledger | destructive diff, drift or unknown owner role |
| Migration | additive transaction plus ledger receipts | drop/rename/data rewrite or partial failure |
| Storage | private bucket, 20 MiB limit, accepted MIME list | public bucket or browser-visible service key |
| Secrets | required names present in Production scope | missing, preview-only or `NEXT_PUBLIC_` secret |
| Deployment | protected artifact built from merged `main` SHA | build mismatch or failed health probe |
| Canary | upload/extract/review/validate with synthetic evidence | auto-approval, secret/byte logging or unexpected state |
| Promotion | all preceding gates pass | any `NOT_RUN`, `WARN` or unresolved production error |

## Rollback

1. Repoint the production alias to the last known-good Vercel deployment.
2. Remove/disable Asset provider variables if provider traffic must stop.
3. Preserve additive database tables and migration receipts; do not down-migrate
   by dropping evidence or audit data.
4. Quarantine canary objects by opaque reference and remove them only through the
   storage port after the receipt is retained.

## Acceptance criteria

1. Production target identities are explicit and match `Freshair129/zuri.ai`.
2. Both Asset migration versions are recorded in the remote ledger and all
   expected tables/indexes exist.
3. The evidence bucket is private and upload/get/remove work only through the
   server credential boundary.
4. A real OpenAI Responses request returns a strict `CANDIDATE` with
   `store: false`; it cannot set review or approval state.
5. A reviewed synthetic intake reaches `READY_FOR_REGISTRATION` idempotently and
   no `RegisteredAsset`, Procurement mutation or Finance posting is created.
6. Production runtime error scan is clean for the canary window.
7. The activation report records deployment SHA, migration receipts, canary IDs,
   timings and rollback target without secrets or document content.

## Approval record

The owner approved this CR together with ADR-057 on 2026-09-02. Implementation,
verification and production activation may proceed under the gates in this document.

## Repository implementation state

The repository-side activation artifacts are implemented and locally GREEN:

- two additive PostgreSQL/Supabase Asset migrations, including forced RLS and the
  private 20 MiB evidence bucket;
- explicit server environment names in `.env.example`;
- an identity-to-rollback operator runbook and executable redacted-receipt validator;
- 13 focused Asset files / 69 tests, PostgreSQL Prisma validation, full build,
  documentation governance and Playwright verification.

The full verification run passed 2,954 unit/integration tests, generated 45 static
pages, reported 0 documentation criticals/warnings and passed 96 E2E tests. Remote
target identity, backup/inventory, migration apply, protected deployment, real-provider
canary and promotion remain `NOT_RUN`; no production system was mutated and this CR is
not yet production-complete.

**Update 2026-09-03.** On the owner's instruction the two Asset migrations were applied
to production and recorded in `supabase_migrations.schema_migrations`, and the private
`asset-evidence` bucket now exists with the approved size limit and MIME allowlist (see the
runbook §2, §4 and §5 notes for the verified values and the apply path — direct SQL over
`DIRECT_URL`, not `db push`, because the CLI is not logged in). Target identity and
inventory are therefore DONE and migration apply and storage verification are DONE; the
environment gate, protected deployment, real-provider canary and promotion remain
`NOT_RUN`, so this CR is still not production-complete and `READY_FOR_REGISTRATION` has
not been reached.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | draft | Proposed production activation gates for the verified local beta | working-tree | RWANG |
| 0.2.0b | 2026-09-02 | beta | Owner approved the production activation gates for implementation | working-tree | RWANG |
| 0.3.0b | 2026-09-02 | beta | Implemented and fully verified repository activation artifacts; remote production gates remain NOT_RUN | working-tree | RWANG |
| 0.4.0b | 2026-09-03 | beta | Production migrations applied and bucket provisioned on owner instruction; deployment, canary and promotion gates remain NOT_RUN | working-tree | Claude Code |
