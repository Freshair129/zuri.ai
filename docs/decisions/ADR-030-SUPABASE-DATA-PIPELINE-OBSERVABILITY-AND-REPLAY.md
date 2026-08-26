# ADR-030 — Supabase data pipeline observability and replay

**Status:** Accepted for local tracking slice — production apply remains gated
**Date:** 2026-08-17
**Decided by:** Boss (requested data pipeline monitor and replay contract)
**Relates to:** [ADR-018](ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md), [ADR-029](ADR-029-STABLE-IDENTITY-BINDINGS-FOR-EXECUTION-PLANS.md), [FR-047](../domains/knowledge/features/FR-047-line-business-knowledge-pilot.md), [FR-051](../domains/agent/features/FR-051-production-supabase-tenant-isolation.md), [FR-071](../domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md), SDD-042

## Context

The SmartGift knowledge import already records a destination batch,
`migration_id`, artifact SHA-256, row count and `correlation_id` in
`zuri_core.bootstrap_audit_event`. That proves the result of an approved import
but cannot answer, for a failed or replayed run:

- which pipeline stage failed;
- which attempt failed and whether it is retryable;
- which source record caused the failure;
- which tags and audit event belong to the exact stage; or
- whether a replay used the same approved artifact and destination scope.

The pipeline is the governed path from DuckDB/source artifact into the private
Supabase/Postgres business-knowledge destination. It is not a client-side REST
write path and it must not weaken the production Tenant/Business isolation
boundary.

## Decision

### D1 — One monitored pipeline boundary

The v1 monitor covers only:

```text
approved source → export/reconcile → scope resolve → staging
  → Supabase transaction → post-apply verification → publish/rollback
```

The stable definition ID is:

```text
dataPipelineDefinitionId = DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1
executionContractId      = EXC-DATA-MIGRATION-V1
```

`migration_id` remains a compatibility projection. It is not allowed to become
the identity of a run.

### D2 — Every stage has definition and occurrence IDs

The monitor separates catalog identity from runtime identity:

```text
dataPipelineDefinitionId
  → executionRunId
    → pipelineStageId + executionStepId
      → attemptId
        → pipelineRecordId
            ├→ docId / picId
            ├→ factId → destinationRecordId (`knowledge_id` projection)
            └→ auditEventId
```

Business/destination IDs (`bootstrapBatchId`, `destinationRecordId`, Tenant and
Business IDs) are carried as context, not substituted for trace IDs. The
existing B2B Sales `pipelineId` alias is never reused for the data pipeline.

There is one run UUID across boundaries: API/events use `executionRunId`, SQL
stores it as `execution_run_id`, and the UI labels it `Run ID`. A bare
`run_id` or a second `dataPipelineRunId` is not a separate identity.

Source and governed-fact IDs are data identity, not execution identity. API/events
use `docId`, `picId` and `factId`; SQL uses `doc_id`, `pic_id` and `fact_id`.
`docId`/`picId` may be null independently, with source arrays for multi-source
facts. `factId` is stable for the same governed fact, while `knowledge_id` remains
the existing 1:1 destination compatibility projection.

Every stage and record event carries the complete supporting identity envelope
from ADR-029: `node_id`, `edge_id`, `artifact_id`, `contract_id`, `meeting_id`,
`call_id`, `followup_id`, `req_id`, `verify_id`, `gate_id`, `integration_id`,
`graph_id`, `workflow_contract_id`, `workflow_id`, `runbook_id`,
`promotion_id`, `skill_id` and `tool_id`. API events use their camelCase
projections (`nodeIds`, `edgeIds`, `artifactIds`, `contractIds`, `meetingIds`,
`callIds`, `followupIds`, `reqIds`, `verifyIds`, `gateIds`, `integrationId`,
`graphId`, `workflowContractId`, `workflowId`, `runbookIds`, `promotionIds`,
`skillIds`, `toolIds`). Non-applicable values are explicit `null`/`[]`; an
omitted key is a schema violation. `contract_id` is CRM Contact context, not a
shortened `execution_contract_id` or `workflow_contract_id`. `integration_id`
is canonical; legacy `int_id` normalizes to it and is not Intent.
`req_id` resolves to a declared requirement/feature key, not a transport
request ID. `runbook_id` identifies the concrete procedure, and `promotion_id`
identifies the governed promotion occurrence. These references are resolved by
their owners and do not widen pipeline scope.

### D3 — Stage and record ledger is append-only

Each run, stage occurrence, attempt and record outcome is immutable. A failure
contains a structured code, safe error reference, retryability, input/output
hashes and audit linkage. Tags use `tagId` against the exact run/stage/record
target; tags are filters, not the failure source of truth. The ledger also retains
the `docId`/`picId` provenance and `factId` governed-fact link for each
record-scoped outcome without copying source contents or image bytes.

The monitor must preserve explicit `SKIPPED`/`NOT_STARTED` downstream state so
the first failed `executionStepId` is observable and reproducible.

### D4 — Replay is a new lineage, never an overwrite

Full, failed-stage and failed-record replay each create new
`executionRunId`/`executionStepId`/`attemptId`/`auditEventId` values and link to
the source using `replayOf...` fields. Replay revalidates:

1. approved artifact SHA-256 and contract version;
2. Tenant/Business destination and authorization;
3. RLS/isolation expectations and conflict state; and
4. idempotent destination keys before the Supabase transaction.

A provenance-filtered replay may start from `docId`, `picId` or `factId`, but the
server must resolve that identity to authorized `pipelineRecordId` values before
execution. When the approved source still represents the same semantic fact,
replay preserves `docId`, `picId` and `factId`; it creates new trace lineage rather
than a duplicate fact identity. The lineage fields are `replayOfDocId`,
`replayOfPicId` and `replayOfFactId`, alongside the existing
`replayOfExecutionRunId`, `replayOfExecutionStepId` and
`replayOfPipelineRecordId` fields.

Rollback is itself a run with its own IDs. Replay cannot delete source data or
unrelated destination rows.

### D5 — Supabase security remains server-owned

The monitor UI reads a server-filtered contract. The browser never receives a
service-role key, database URL, unrestricted SQL capability or another
Tenant's pipeline metadata. The monitor ledger belongs in the private
`zuri_core` boundary with forced RLS and a least-privilege read path after the
implementation is approved. The Data API exposure decision is separate from
RLS and must be reviewed explicitly if any monitor view is exposed there.

### D6 — Existing import audit remains compatible

`zuri_core.bootstrap_audit_event` remains readable and continues to prove the
completed batch-level import. The new ledger links to it using `auditEventId`,
`bootstrapBatchId`, `correlationId` and artifact hash. Applied migrations are
not rewritten; the implementation adds a new migration through the approved
Supabase workflow.

## Rejected alternatives

| Alternative | Rejection reason |
|---|---|
| Use `pipelineId` for every pipeline | It already means a B2B Sales WorkContainer ID |
| Put all status in `bootstrap_audit_event.details` | Cannot efficiently query stage/record failures or replay lineage |
| Tag failures with labels only | Labels are not stable identity and cannot prove the failed attempt |
| Omit non-applicable identity keys | A changing event shape prevents deterministic replay validation and makes agent outputs incomparable |
| Retry using the same run/step IDs | Overwrites history and makes the result non-auditable |
| Use `knowledge_id` as the only fact identity | Couples governed-fact provenance to one destination table and loses the source `doc_id`/`pic_id` links |
| Browser writes directly to Supabase | Exposes credentials and bypasses server-owned scope/replay controls |
| Use service-role reads for the monitor | Violates least privilege and hides RLS defects |
| Treat Supabase as source of truth | DuckDB/approved artifact provenance remains the approved source for this import |

## Implementation boundary

The accepted local slice adds the server-owned tracking ledger, validated event
receiver, scope-filtered read model and queued replay-lineage request described
by FR-071. It does not execute the Codex worker or a production Supabase apply.
The Supabase migration must be created through the CLI, and advisor/security
review, deterministic fixture tests, a failed-stage replay test and a
post-apply isolation proof remain required before any production import is
re-enabled.
