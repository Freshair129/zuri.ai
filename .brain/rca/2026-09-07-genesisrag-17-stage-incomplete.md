---
version: "0.1.0b"
created_at: "2026-09-07T21:24:00+07:00,RWANG"
last_update: "2026-09-07T21:24:00+07:00,RWANG"
status: "draft"
attributes:
  domain: "knowledge-ingestion"
  doc_type: "root-cause-analysis"
  scope: "Why the canonical seventeen-stage pipeline cannot complete; source and running deployment inspection"
---

# RCA: GenesisRAG seventeen-stage pipeline is not integrated through publication

## Scope and risk

C-2 diagnostic investigation. Inspection and this report are LOW risk; implementing the remaining cross-tier execution and publication would be C-3 / HIGH. No application code, deployment configuration, migrations, runtime records or external repository files were changed.

Examined zuri-ai at `b17e7258` and the local Genesis-Knowledge-System checkout at `7b6e310`. Live observations were taken on 2026-09-07 around 21:17–21:22 ICT from `zuri-ai-web-1`, the container serving localhost:3000. These observations do not establish the state of another deployment or another database.

## Symptom

The user asked why GenesisRAG's seventeen-stage pipeline is not finished. Two meanings must be distinguished: implementation completeness and a particular executing job. The current source proves incomplete integration. This deployment's ledger contains no runs, so a particular stuck job cannot be diagnosed from it.

## Evidence

### Running deployment, directly verified

- Container is healthy, image `zuri-ai-web:local`, working directory `/app`, no mounts.
- Its built Next.js app-paths manifest includes all five knowledge routes: job read, stages, gate, finish and evidence/pull. The receiver is present in the running build.
- Only configuration-presence booleans were inspected: `ZURI_MSP_COMMAND`, `ZURI_MSP_ARGS` and `ZURI_MSP_CWD` are all unset. No credential values were printed.
- Read-only PostgreSQL transaction using the container's configured application connection: grouping **all** `PipelineRun` rows by definition/status returned zero rows; canonical knowledge steps and gates also returned zero rows.
- `public."KnowledgeEvidenceCursor"` exists, but its row count is zero and maximum `lastPulledAt` is null. Thus the older ADR-068 statement that its migration was not yet applied is not an accurate description of this database today; missing table is not the observed blocker.
- An initial step-count query used an incorrect foreign-key name, returned PostgreSQL `42703`, and was corrected against the enumerated Prisma schema (`PipelineStep.runId`). All final aggregate queries succeeded.

### Source and parent/peer contracts

1. `docs/decisions/ADR-068-KNOWLEDGE-EVIDENCE-PULL-THROUGH-MSP.md` D4 explicitly excludes the forward Stage 8 → MSP `msp_knowledge_promote` handoff and scheduling. Its integration test plays the missing forward caller. Source enumeration/search confirms that `apps/server/src` has no caller of `msp_knowledge_promote`; the evidence importer is invoked by the operator-triggered route.
2. `apps/server/src/app/api/pipelines/knowledge/evidence/pull/route.js` constructs the transport from runtime configuration and throws 503 when it is absent. This is a code-derived outcome for an authenticated invocation, not a claim that an authenticated HTTP request was performed.
3. ADR-067 added the external reporter and `finishKnowledgeIngestionRun`; ADR-068 added GKS export → MSP relay → zuri-ai pull. These close the historical receiver gap but deliberately do not supply every execution stage.
4. GKS's actual `docs/ADR-GKS-FACT-EXTRACT.md` is version `0.1.5b`, status `proposed`, `approval_owner: null`. Its decision-status section says implementation follows owner acceptance. Stage 12's `docs/ADR-GKS-TEMPORAL-MAP.md` is `0.1.4b` with the same proposed status. The boundary document's older version pointers must not override these files.
5. GKS's tracked `apps/`, `packages/` and `docs/` were enumerated. Its core consists of `index.mjs` and `resolve.mjs`; its tool registry exposes promotion/resolution, search/entity/relation/artifact/review operations and stage-evidence export, not a complete Stage 10–17 runner. The gap-closure plan explicitly sequences Stages 11, 14 and 17 after Stage 10 exists. An existing generic relation operation is not evidence of the specified Stage 10/11 pipeline.
6. GKS's `docs/reports/2026-08-31-gbdb-adapter-decision-brief.md` remains a draft describing the Stage 13 write / 15 / 16 adapter gap. Its statements about other repositories are historical: GenesisBlockDB implementation/runtime was not independently inspected in this investigation. Tier-4 completion remains unverified, not proven absent.
7. `apps/server/src/modules/knowledge/ingestion-job.js`, `knowledgeRunOutcome`, requires every executed Stage 2–17 to succeed plus an approved publishable gate. Stage 1 is out of band, evidenced by the ingested artifact; its NOT_STARTED step is not itself a reason to reject completion. The Tier-1 executor intentionally leaves its run open after its own work.

## Stage assessment

This is an implementation/evidence assessment, not a runtime completion percentage. There are no production run rows in the inspected database.

| Stage | Name | Owner | Assessment |
|---:|---|---|---|
| 1 | Ingestion | zuri-ai/Edge | Contract/artifact path present; out-of-band relative to run step |
| 2 | Parsing | zuri-ai | Tier-1 implementation present |
| 3 | Provenance | zuri-ai | Tier-1 implementation present |
| 4 | Normalization | zuri-ai | Tier-1 implementation present |
| 5 | Classification/scope | zuri-ai | Tier-1 implementation present |
| 6 | Deduplication/versioning | zuri-ai | Tier-1 implementation present; not a claim all follow-on revision behaviors are complete |
| 7 | Chunking | zuri-ai | Tier-1 implementation present |
| 8 | Entity extraction | zuri-ai | Candidate production present; automatic forward handoff absent |
| 9 | Entity resolution | GKS | Implementation/export present; current zuri-ai runtime has no MSP transport configuration |
| 10 | Fact extraction | GKS | Proposed ADR, implementation gate not recorded as approved |
| 11 | Ontology mapping | GKS | Sequenced after Stage 10; no complete stage executor found in enumerated core/registry |
| 12 | Temporal mapping | GKS | Proposed ADR, implementation gate not recorded as approved |
| 13 | Graph construction | GKS + GenesisBlockDB | GKS decision/substrate write integration not demonstrated; external write half unverified |
| 14 | Enrichment | GKS | Sequenced after Stage 10/graph; no complete stage executor found in enumerated core/registry |
| 15 | Embedding | GenesisBlockDB | Seventeen-stage integration unverified; a separate catalog embedding service is not proof |
| 16 | Multi-lane indexing | GenesisBlockDB | Seventeen-stage integration unverified |
| 17 | Graph/retrieval quality gate | GKS + GenesisBlockDB | zuri-ai evidence receiver/finalizer present; complete five-dimension execution and atomic publication unverified |

## Root Cause

The product has a seventeen-stage catalog and independently delivered components, but lacks the complete execution chain between them. Specifically: Stage 8 does not dispatch to Stage 9; the deployed pull transport has no MSP command configured; pulling has no scheduler; GKS's Stage 10/12 remain proposed and dependent stage execution is unfinished; Tier-4 and full Stage-17 publication evidence have not been established. A ledger receiver and finalizer cannot manufacture those missing executions.

The finalization guard is behaving as designed: it refuses to label incomplete evidence as success. A historical missing-finalizer defect is documented by ADR-067, but presenting that as today's sole cause would ignore the receiver/finalizer already in the running image.

## Why the issue escaped detection

- Delivery was split into repository-local slices; the seventeen-stage definition was easy to confuse with a fully implemented orchestrator.
- The live-chain test explicitly substitutes the forward caller and proves Stage 9 reporting, not an unattended seventeen-stage production execution. It conditionally skips without sibling repository variables.
- No evidence in the inspected deployment's empty ledger/cursor establishes a production acceptance run. Unit tests cannot prove deployment wiring.
- Several narrative status references lag their own source: the GKS boundary file cites older Stage 10/12 ADR revisions, and ADR-068's historical migration note differs from the live database. Enumeration and runtime observation must take precedence.

## Proposed prevention and repair order

1. Define one acceptance run with a named scope and a stable run/correlation identity across tiers. Establish the intended deployment/database before discussing a stuck-run status.
2. Specify and approve the missing Stage 8 → MSP → Stage 9 dispatch, retry/idempotency behavior and run-id binding, then implement it.
3. Provision the MSP/GKS runtime and wire the existing transport in the deployment. Add an owned, scope-specific pull schedule and surface disabled/blocked/unattributed/held evidence. Do not infer that the already-existing cursor table needs a new migration.
4. Review the concrete GKS Stage 10/12 ADRs, reconcile ownership and implement dependent Stages 11/13/14 with reportable evidence in their owning repository.
5. Verify the GenesisBlockDB adapter and Stage 13-write/15/16 evidence independently; complete Stage 17's five dimensions and atomic publication before permitting a successful finish.
6. Require one source-to-published-snapshot acceptance trace through the actual orchestrator, failed-gate/no-publication proof, retry/cursor recovery proof, and production configuration evidence. Keep partial Stage 9 and unit-test results labeled by their actual scope.

This report proposes no code patch and requests no deployment mutation. The user's current request is diagnosis; implementation requires a separate reviewed scope under R5.

## Verification

`npm test -- tests/unit/knowledge-ingestion-job-state.test.js tests/unit/knowledge-published-snapshot-contract.test.js`, from `apps/server`: **37 tests passed**, two files, zero skipped, wrapper confirmed 37 executed. The repository harness used an isolated SQLite test database. This verifies lifecycle/gate contract behavior, not the missing production chain. No full build, full integration chain or production ingestion was executed.

`npm run govern` passed: strict preflight zero CRITICAL, zero WARNING; combined graph zero link findings, duplicate IDs or dangling edges. Regeneration refreshed four generated files (the two domain-state JSON timestamps and the server/combined graph drift statuses); their diffs do not change application logic. `git diff --check` passed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-07 | draft | Initial evidence-backed diagnosis, seventeen-stage assessment and repair order; no application changes | working-tree | RWANG |

Version diff: absent → 0.1.0b; one RCA report added and four generated governance artifacts refreshed. No commit was made.
