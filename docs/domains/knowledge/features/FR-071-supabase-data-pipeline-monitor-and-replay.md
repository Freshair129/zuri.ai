---
domain: knowledge
feature: FR-071
module: knowledge
source: v2-native
version: 0.10.0b
status: candidate
---

# FR-071 — Supabase data pipeline monitor and replay

## Intent

Zuri must monitor the governed SmartGift knowledge pipeline from the approved
DuckDB/source artifact into Supabase/Postgres, identify the exact stage and
record that failed, attach stable tags, and replay a full run, failed stage or
failed record without mutating the original run.

This is a data-ingestion monitor, not a generic task board. The destination is
the private Supabase `zuri_core.business_knowledge` store. The source artifact
and its provenance remain authoritative for what was approved; Supabase is the
operational destination for the published knowledge projection.

The first implementation slice also adds the document front door used by the
SmartGift `ProductIngestAgent` and `CustomerIngestAgent`. It accepts the strict
`smartgift.document-intake.v1` contract and persists a server-owned raw staging
record. This slice deliberately stops before domain validation, human review or
canonical Product/Customer promotion.

## Pipeline boundary

```text
DuckDB / approved source
  → export artifact
  → artifact/schema validation
  → reconciliation (row count + SHA-256)
  → Tenant/Business/scope resolution
  → staging load
  → transactional Supabase upsert
  → post-apply isolation/count verification
  → publish or explicit rollback
```

The existing `zuri_core.bootstrap_audit_event` remains the compatibility audit
record for the completed import. FR-071 adds stage/record observability around
it; it does not replace the source artifact, the existing batch ID or the
Tenant/Business isolation boundary.

### Document intake front door

```text
PDF / DOCX / picture / Excel
  → local ProductIngestAgent or CustomerIngestAgent
  → smartgift.document-intake.v1
  → POST /api/ingest/documents
  → server-resolved IntegrationConnection
  → RawExternalRecord (Supabase application staging)
  → domain validation / review
  → canonical Product or Customer (later slice)
```

`RawExternalRecord` is the existing server-owned raw-ingestion table in the
Supabase application schema. The route requires an installation operator, takes
no Tenant/Business IDs from the document payload, and resolves those IDs from an
`ACTIVE` `PRIMARY` connection whose provider is
`SMARTGIFT_DOCUMENT_INTAKE` and purpose is `DATA_DOCUMENT_INGESTION`. Exact
replays return `UNCHANGED`; the raw payload remains private and the monitor
response returns hashes, IDs, counts and status only. `POST` remains an
installation-operator action; `GET` may resolve by `businessId` for a viewer
that can see that Business, and returns an explicit `configured: false` state
when the active primary receiver has not been provisioned.

## Full pipeline tracking slice

The local application adds a server-owned tracking ledger around the
document-intake substrate and the DuckDB/source-artifact → Supabase pipeline:

```text
PipelineRun
  ├─ PipelineStep (one row per stage attempt)
  ├─ PipelineRecordEvent (one redacted record outcome per attempt)
  ├─ PipelineReconciliation (counts, hashes, isolation/probe evidence)
  └─ PipelineGateDecision (approval/hold evidence for the run)
```

The event receiver validates the complete identity envelope, exact idempotency
keys, status transitions, failure requirements and Tenant/Business scope before
writing the ledger and an `AuditEvent`. Heartbeats update freshness only; they do
not count as progress or success. A stale run/step is exposed as `UNKNOWN` with
an explicit `staleAt`/last heartbeat rather than inferred completion.

The monitor read model is available through:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pipelines/runs` | list scope-filtered runs and current evidence |
| POST | `/api/pipelines/runs` | create one idempotent queued run envelope |
| GET | `/api/pipelines/runs/{executionRunId}` | show run, stage timeline, record failures, reconciliation and gate evidence |
| POST | `/api/pipelines/runs/{executionRunId}/events` | accept a validated stage/record/heartbeat/reconciliation or gate event |
| POST | `/api/pipelines/runs/{executionRunId}/replay` | create an authorized queued replay with immutable lineage; it does not execute the apply worker |

Replay requests create new run/step/attempt/audit identities only after the
source run, artifact/contract identity and Business scope are revalidated. The
local tracking slice records replay intent and lineage; execution by the Codex
worker and production Supabase apply remain separate gates.

## Approved local slice — Codex-mediated worker bridge

The approved local slice connects the local SmartGift agents to the
existing server-owned ledger without giving the agents Supabase or browser
credentials:

```text
ProductIngestAgent / CustomerIngestAgent
  → redacted append-only evidence outbox
  → Codex worker
  → authenticated `data_pipeline.*` MCP adapter
  → existing tracking/document-staging services
  → Data Migration monitor
```

The MCP adapter is an application-service adapter, not a second persistence
path. It must resolve the internal Tenant/Business/connection on the server,
keep restricted document payloads separate from redacted pipeline events and
start in `EVIDENCE_ONLY` mode. Canonical Supabase apply, Product/Customer
promotion, publish and rollback remain disabled until the external RLS,
isolation and non-production replay gates pass. The approved architecture is
specified in [ADR-039](../../../decisions/ADR-040-CODEX-MEDIATED-SMARTGIFT-PIPELINE-BRIDGE.md).

## Identity contract

`pipelineId` is deliberately not used here because B2B Sales already uses
`pipelineId` as the typed ID of a sales `WorkContainer`. The data pipeline has
its own unambiguous definition ID:

| Identity | Canonical field | Purpose |
|---|---|---|
| Pipeline definition | `dataPipelineDefinitionId` | `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1`; stable definition of this pipeline |
| Execution contract | `executionContractId` | `EXC-DATA-MIGRATION-V1`; selects the seven-mode data-migration contract |
| Pipeline run | `executionRunId` | One full execution of the data pipeline; generated by the server |
| Stage definition | `pipelineStageId` | Stable catalog ID for one pipeline stage |
| Stage occurrence | `executionStepId` | One concrete stage execution within a run |
| Attempt | `attemptId` | One try of a stage or record; retries receive new IDs |
| Batch | `bootstrapBatchId` | Existing destination batch identity; compatibility alias for the import batch |
| Source record | `pipelineRecordId` + `sourceRecordKey` | One source-record execution unit and its deterministic source key |
| Source document | `docId` / `doc_id` | Stable identity of the source document; not its filename, path or content hash |
| Source picture | `picId` / `pic_id` | Stable identity of the source picture/image asset; nullable when the source has no picture |
| Governed fact | `factId` / `fact_id` | Stable identity of the normalized, approved fact produced by the pipeline |
| Destination record | `destinationRecordId` / `knowledge_id` | Existing Supabase storage projection of `factId`; not a second semantic fact identity |
| Request trace | `correlationId`, `idempotencyKey` | Connects caller/transport and prevents duplicate run creation |
| Audit | `auditEventId` | Immutable audit event for the run, stage or mutation |
| Replay lineage | `replayOfExecutionRunId`, `replayOfExecutionStepId`, `replayOfPipelineRecordId`, `replayOfDocId`, `replayOfPicId`, `replayOfFactId` | Links a replay to the immutable source occurrence and provenance identity |

Every stage and record event also carries one normalized supporting-reference
envelope when applicable:

| Storage ID | Event field | Rule |
|---|---|---|
| `node_id`, `edge_id`, `graph_id` | `nodeId[]`, `edgeId[]`, `graphId` | Knowledge/GKS context only; not the generated document graph and not a substitute for pipeline IDs |
| `artifact_id` | `artifactId[]` | Approved source/evidence artifact identities; hash/path remain evidence metadata |
| `contract_id` | `contractId[]` | CRM Contact context; not `executionContractId` or `workflowContractId` |
| `meeting_id` | `meetingId[]` | CRM meeting context; not a Project Milestone or Gate |
| `call_id` | `callId[]` | CRM call/interaction context; not a pipeline run ID |
| `followup_id` | `followupId[]` | CRM follow-up action context; not a Project Manager WorkItem identity |
| `req_id` | `reqId[]` | Declared requirement/feature reference; not a transport request ID |
| `verify_id` | `verifyId[]` | Verification result/decision occurrences for the stage or record |
| `gate_id` | `gateId[]` | Authorized Project Manager Gate references; existing `Gate.id` only |
| `integration_id` | `integrationId` | Integration adapter/bridge context; legacy `int_id` normalizes to this field |
| `workflow_contract_id` | `workflowContractId` | Multi-agent workflow contract governing roles, handoffs, inputs, outputs, tools, failure handling and approval |
| `workflow_id` | `workflowId` | Approved workflow definition governed by `workflowContractId`; concrete procedure is `runbookId` |
| `runbook_id` | `runbookId[]` | Concrete approved runbook/procedure selected by the workflow |
| `promotion_id` | `promotionId[]` | Governed candidate-to-canonical promotion occurrence; distinct from fact and execution IDs |
| `skill_id`, `tool_id` | `skillId[]`, `toolId[]` | Allow-listed Agent capability context; neither grants authority |

The envelope is present on every event. `null`/`[]` means not applicable or not
available; an omitted key is a schema violation. Unknown, unauthorized or
owner-unavailable references fail closed for writes and are explicit on reads.

`migration_id` in the existing `bootstrap_audit_event` is retained as a
compatibility projection of `dataPipelineDefinitionId`; it is not the run ID.
`artifact_sha256`, `source_sha256`, `source_ref` and source row/reference keys
remain the evidence needed to prove which input was processed.

### Provenance identity contract

The pipeline keeps execution identity separate from source and knowledge identity:

```text
pipelineRecordId
  ├─ docId / sourceDocIds[]
  ├─ picId / sourcePicIds[]
  └─ factId
       └─ destinationRecordId = compatibility projection of knowledge_id
```

The API and event contract uses `docId`, `picId` and `factId`; the Supabase/Postgres
storage contract uses `doc_id`, `pic_id` and `fact_id`. `docId` and `picId` are
nullable independently because a source may be structured data, document-only or
picture-only. When a fact has more than one source, `sourceDocIds[]` and
`sourcePicIds[]` are the canonical provenance set and the singular fields are the
primary-source projections. A publishable fact must still have an approved source
reference (`docId`, `picId` or the existing structured `sourceRecordKey`/`sourceRef`).

`factId` identifies the governed fact, not one attempt to process it. A replay of
the same approved source and same semantic fact keeps `docId`/`picId`/`factId` and
creates new execution trace IDs. A materially different governed fact receives a
new `factId`; the source hash remains the evidence for that change. No separate
`knowledgeId` is introduced: the existing `knowledge_id` is the destination
compatibility projection and must remain linked 1:1 to the published `factId`.

### Run ID naming across boundaries

There is one canonical run identity, not separate `run_id`, `dataPipelineRunId`
and `executionRunId` values:

| Boundary | Name | Rule |
|---|---|---|
| API, event payload, TypeScript | `executionRunId` | canonical contract field |
| Supabase/Postgres column | `execution_run_id` | snake_case storage projection of the same UUID |
| UI | `Run ID` | display label for `executionRunId` |
| Logs/metrics | `execution_run_id` | structured attribute carrying the same UUID |

The existing `bootstrap_audit_event.id` remains `auditEventId`,
`correlation_id` remains request/transport correlation, and
`bootstrap_batch_id` remains destination batch grouping. None of these is an
alias for the run ID.

## Canonical pipeline stages

Every stage has a stable `pipelineStageId` and every occurrence also has a
unique `executionStepId`:

| Sequence | `pipelineStageId` | Stage | Required evidence |
|---:|---|---|---|
| 10 | `DPS-SOURCE-SNAPSHOT` | Open the approved source snapshot | source reference, source SHA-256, source as-of |
| 20 | `DPS-EXPORT-ARTIFACT` | Produce the immutable JSONL/export artifact | artifact path/reference, artifact SHA-256, row count |
| 30 | `DPS-SCHEMA-VALIDATE` | Validate record shape and allowed fields | contract version, rejected-field count, validation result |
| 40 | `DPS-RECONCILE` | Reconcile rows, keys and hashes | expected/actual rows, duplicate count, reconciliation hash |
| 50 | `DPS-SCOPE-RESOLVE` | Resolve Portfolio/Tenant/Business destination | tenant ID, business ID, scope authorization result |
| 60 | `DPS-STAGING-LOAD` | Load the transaction-local staging set | staged rows, rejected rows, staging hash |
| 70 | `DPS-SUPABASE-APPLY` | Apply the guarded transactional upsert | inserted/updated rows, destination batch ID |
| 80 | `DPS-POST-APPLY-VERIFY` | Verify counts, hashes, isolation and destination rows | observed rows, cross-Tenant result, advisor/probe result |
| 90 | `DPS-PUBLISH` | Mark the approved projection available | publish decision, active row count, owner decision |
| 99 | `DPS-ROLLBACK` | Revert a failed or owner-rejected run | rollback run/step IDs, affected batch, verification result |

The stage sequence is ordering metadata only. A stage is identified by
`pipelineStageId + executionStepId`, never by its label or sequence number.

## Stage and record event contract

Every stage event must carry:

```json
{
  "dataPipelineDefinitionId": "DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1",
  "executionContractId": "EXC-DATA-MIGRATION-V1",
  "executionRunId": "server-uuid",
  "pipelineStageId": "DPS-RECONCILE",
  "executionStepId": "server-uuid",
  "attemptId": "server-uuid",
  "sequence": 40,
  "status": "FAILED",
  "bootstrapBatchId": "server-uuid",
  "docId": null,
  "picId": null,
  "factId": null,
  "sourceDocIds": [],
  "sourcePicIds": [],
  "correlationId": "request-uuid",
  "inputHash": "sha256",
  "outputHash": null,
  "tagIds": ["tag-uuid"],
  "identityRefs": {
    "nodeIds": [],
    "edgeIds": [],
    "artifactIds": ["artifact-uuid"],
    "contractIds": [],
    "meetingIds": [],
    "callIds": [],
    "followupIds": [],
    "reqIds": [],
    "verifyIds": [],
    "gateIds": [],
    "integrationId": null,
    "graphId": null,
    "workflowContractId": null,
    "workflowId": null,
    "runbookIds": [],
    "promotionIds": [],
    "skillIds": [],
    "toolIds": []
  },
  "failureCode": "SOURCE_ROW_DUPLICATE",
  "errorRef": "redacted-error-reference",
  "retryable": false,
  "auditEventId": "server-uuid",
  "replayOfExecutionStepId": null
}
```

Record-level events additionally carry `pipelineRecordId`, `sourceRecordKey`,
`sourceRowNumber` when available, `sourceSha256`, `docId`, `picId`, `factId`,
`sourceDocIds[]`, `sourcePicIds[]`, `destinationRecordId` when known, record
status and record-level error information. They must not copy raw PII, image
bytes, document contents or secrets into the monitor payload; source references
and hashes are the evidence links.

## Status and failure contract

Run status:

```text
QUEUED → RUNNING → SUCCEEDED
                 ↘ FAILED
                 ↘ PARTIAL
                 ↘ ROLLED_BACK
                 ↘ CANCELLED
```

Stage and record status use:

```text
NOT_STARTED → RUNNING → SUCCEEDED
                      ↘ FAILED
                      ↘ SKIPPED
                      ↘ REPLAYING
```

`FAILED` requires `failureCode`, `errorRef`, `retryable`, `executionStepId`,
`attemptId` and `auditEventId`. Downstream stages/records are explicitly
`SKIPPED` or `NOT_STARTED`; they may not disappear from the monitor. The first
failed step in sequence is the run's primary failure point.

## Replay contract

The monitor supports three replay scopes:

| Replay scope | Source reference | New records created |
|---|---|---|
| Full run | `replayOfExecutionRunId` | new run, all stage steps and attempts |
| Failed stage | `replayOfExecutionRunId` + `replayOfExecutionStepId` | new run/step/attempt from the selected stage after prerequisite checks |
| Failed records | `replayOfExecutionRunId` + `replayOfPipelineRecordId[]` | new run/record attempts for an allow-listed record set |
| Provenance-filtered records | `replayOfDocId[]`, `replayOfPicId[]` or `replayOfFactId[]` | resolve to an allow-listed `pipelineRecordId[]` first, then create new record attempts |

Replay rules:

1. The source artifact SHA-256 and contract version must still resolve to an
   approved input; a replay cannot silently use a different artifact.
2. The server creates new `executionRunId`, `executionStepId`, `attemptId` and
   `auditEventId` values. The original trace is append-only and immutable.
3. Tenant/Business scope, destination authorization, RLS expectations and
   conflict checks run again before Supabase mutation.
4. The apply stage uses a transaction-local staging set and idempotent keys;
   replay must not duplicate `(tenant_id, business_id, product_code)` rows.
5. A replay may produce `SUCCEEDED`, `PARTIAL` or `FAILED` independently of the
   source run. The monitor retains both outcomes and their lineage.
6. For the same approved semantic fact, replay preserves `docId`, `picId`,
   source arrays and `factId`; it never creates a second fact identity merely
   because the execution attempt is new.
7. Rollback is an explicit operation with its own run/step/audit IDs; deleting
   the source artifact or unrelated destination rows is never a replay action.

## Human monitor contract

The pipeline meaning and approved knowledge payload remain owned by the
Knowledge domain. The operator read surface is proposed as
`Platform > Data Pipeline Monitor` because it is a system/audit capability,
not a new Business domain and not a replacement for the Knowledge read API.
The route is implemented locally for the approved `EVIDENCE_ONLY` monitor
slice. Production exposure and any Supabase apply capability remain gated by
the external verification requirements below.

The Data Pipeline Monitor must show:

- pipeline definition, contract version, destination Supabase scope and current
  run status;
- source/artifact SHA-256, row counts, expected/actual deltas and batch ID;
- stage timeline with stage ID, execution step ID, status, duration, counts,
  tags and failure point;
- failed record list by `pipelineRecordId`, `docId`, `picId` or `factId`/source key
  with safe error reason, destination row ID and retryability;
- provenance drill-down from a governed `factId` to its source document/picture
  IDs and the destination `knowledge_id` projection;
- replay actions limited to an authorized operator and available replay scope;
- source run, replay run and rollback lineage; and
- explicit unavailable/unknown state when monitoring evidence is missing.

The UI receives a server-filtered read model. It never receives a Supabase
`service_role` key, raw database URL, source secrets or unrestricted SQL access.
The monitor endpoint must apply the same Tenant/Business scope guard as the
pipeline mutation and must not expose another Tenant's failure metadata.

## Acceptance criteria

- **AC-071.1** The SmartGift DuckDB/source-artifact → Supabase pipeline has one
  stable `dataPipelineDefinitionId` and the existing `migration_id` remains a
  compatibility projection.
- **AC-071.2** Every run, stage occurrence, attempt, record event and audit
  mutation has the required IDs and links to the applicable source/destination
  identity.
- **AC-071.3** The monitor can identify the first failed stage and record by
  `pipelineStageId`, `executionStepId`, `attemptId`, `pipelineRecordId` and
  structured `failureCode`; labels alone are insufficient.
- **AC-071.4** Stage-level and record-level tags use `tagId`; tags never replace
  failure, hash, audit or replay fields.
- **AC-071.5** Full, failed-stage and failed-record replay create new immutable
  IDs and preserve source-run/source-step/source-record lineage.
- **AC-071.6** Replay validates the approved artifact hash, contract version,
  destination scope, authorization, RLS boundary and idempotent destination key
  before applying to Supabase.
- **AC-071.7** The monitor reports expected/actual counts, source/artifact
  hashes, batch ID, destination IDs, row status and post-apply verification.
- **AC-071.8** The monitor is server-mediated, scope-filtered and never exposes
  a service key, raw database URL, unrestricted SQL or unredacted sensitive
  source payload.
- **AC-071.9** Existing `zuri_core.bootstrap_audit_event` records remain
  readable and linked to the new run/step ledger; no applied migration history
  is rewritten.
- **AC-071.10** Every record-scoped event exposes `docId`/`doc_id`,
  `picId`/`pic_id` and `factId`/`fact_id` with the nullability and multi-source
  rules defined in the provenance contract; stage aggregates may carry null
  singular values and must retain record links.
- **AC-071.11** `factId` is the stable governed-fact identity and
  `knowledge_id` is its 1:1 destination compatibility projection; retries and
  same-fact replays do not create a second fact identity.
- **AC-071.12** The monitor can filter and drill down by `docId`, `picId`,
  `factId` and `pipelineRecordId` without exposing document contents, image
  bytes, raw PII or secrets.
- **AC-071.13** A provenance-filtered replay resolves `docId`, `picId` or
  `factId` to authorized source records before creating new run/step/attempt
  IDs, and preserves the source/fact identity lineage.
- **AC-071.14** Source identity, content evidence and execution identity remain
  distinct: IDs are not inferred from filename/path, a blob URL or a hash alone.
- **AC-071.15** Every stage and record event carries the same complete
  `identityRefs` envelope for `node_id`, `edge_id`, `artifact_id`, `contract_id`,
  `meeting_id`, `call_id`, `followup_id`, `req_id`, `verify_id`, `gate_id`,
  `integration_id`, `graph_id`, `workflow_contract_id`, `workflow_id`,
  `runbook_id`, `promotion_id`, `skill_id` and `tool_id`; non-applicable values
  are explicit `null`/`[]`, never silently omitted.
- **AC-071.16** A replay copies the resolved supporting references into the new
  lineage after revalidation, while creating new run/step/attempt/audit IDs; it
  never derives an ID from a label, hash or source path.
- **AC-071.17** The SmartGift document intake route validates
  `smartgift.document-intake.v1`, enforces the Product/Customer field allowlists
  and evidence locations, resolves Tenant/Business from the server-owned
  connection, stores only a raw staging record, and never writes a canonical
  Product or Customer row.
- **AC-071.18** An exact document-contract replay is idempotent and returns the
  existing raw-record identity; the redacted monitor response never returns
  extracted field values, raw OCR text or a service key.
- **AC-071.19** The redacted monitor resolves an active primary document-intake
  connection by a visible Business without requiring the browser to know a
  connection ID; absent provisioning is returned as `configured: false`, not
  as fake progress or a successful empty import.
- **AC-071.20** The SmartGift bootstrap migration creates the provider and one
  active primary staging connection without an IntegrationCredential, enforces
  one active primary receiver per Business, records a provisioning audit event,
  and fails closed when the approved Business/connection identity is missing.
- **AC-071.21** The local application persists a server-owned `PipelineRun`,
  `PipelineStep`, `PipelineRecordEvent`, `PipelineReconciliation` and
  `PipelineGateDecision` ledger without reusing `PlanImportReceipt` or treating
  `IngestionRun` as the full pipeline run.
- **AC-071.22** Pipeline events validate the complete identity envelope, exact
  idempotency key, allowed transition and required failure fields; duplicate
  event delivery returns the existing immutable receipt and raw PII, document
  contents, image bytes and secrets are rejected.
- **AC-071.23** The monitor exposes heartbeat freshness and reports stale or
  missing evidence as explicit `UNKNOWN`; elapsed time and task percentages do
  not manufacture progress or success.
- **AC-071.24** A scope-filtered read model exposes the first failure, stage and
  record evidence, reconciliation deltas, destination IDs, gate decisions and
  replay lineage without exposing raw source payloads or another Business.
- **AC-071.25** An authorized replay request creates a new queued run with new
  execution/attempt/audit IDs and immutable source lineage; it does not overwrite
  the original run and does not claim that the Supabase apply worker executed.
- **AC-071.26** The Data Migration view reads the full-pipeline monitor when a
  run exists and shows explicit unavailable/configuration/unknown states when
  evidence is absent; legacy WorkItem metrics remain a separate display only.
- **AC-071.27** The tracking migration enables forced RLS and revokes Data API
  access for public/browser roles; browser code never receives a service-role
  key, database URL or unrestricted SQL capability.
- **AC-071.28** The local SmartGift agents emit only append-only, redacted
  lifecycle evidence; they never receive a Supabase `service_role`, browser
  credential or caller-selected Tenant/Business destination.
- **AC-071.29** Codex can use a separate `data_pipeline.*` MCP namespace to
  create a run, stage a restricted document contract, record evidence, read the
  monitor and request replay through the existing application services; the
  adapter creates no second persistence path.
- **AC-071.30** The server resolves internal Tenant/Business/connection scope
  from the authenticated worker context and rejects destination overrides from
  the local outbox or document contract.
- **AC-071.31** Pipeline events and monitor/audit outputs contain no raw PII,
  OCR text, image bytes, secrets, database URLs or unrestricted source payload;
  restricted document staging remains a separate server-owned boundary.
- **AC-071.32** The bridge starts in `EVIDENCE_ONLY` mode and has a proof that
  local extraction plus event delivery cannot perform canonical Supabase apply,
  Product/Customer promotion, publish or rollback.
- **AC-071.33** Worker retry, duplicate delivery, stale heartbeat, failed-stage
  evidence and queued replay are covered by deterministic MCP/service tests.

## Non-goals

- Streaming/CDC ingestion or a generic ETL marketplace.
- Replacing DuckDB provenance, GKS authority, MSP, GenesisBlockDB or the
  existing Supabase tenant-isolation design.
- Letting a Human select an arbitrary Tenant/Business destination.
- Direct browser-to-Supabase writes or service-role credentials in the UI.
- Replaying a different artifact under the identity of the source run.

## Implementation boundary

The document-intake receiver remains implemented over the existing raw-ingestion
substrate: `RawExternalRecord`, `IngestionRun` and `AuditEvent`. The full
pipeline ledger adds server-owned tracking tables and a local event/read/replay
request API; it does not replace the existing bootstrap audit or
`PlanImportReceipt`. The bootstrap and tracking migrations add no browser
credential or Data API grant; application tables remain server-owned and
RLS-enabled. Local tests, migration inspection and the monitor UI are
implementation evidence only until the migrations are applied to a
non-production Supabase target, remote RLS/privilege checks pass, and a
non-production event/replay/apply probe is verified. Codex worker execution,
Supabase transactional apply, post-apply isolation proof, canonical
Product/Customer promotion and publish/rollback remain explicit gates. Any
Future schema change must use the Supabase workflow: create a migration through
the CLI, run advisors and isolation probes, then verify a non-production import
before a production write. ADR-039 is approved for local `EVIDENCE_ONLY`
execution; it must not be promoted to canonical apply or production-enabled
write behavior before those external gates pass.

## Related documents

- [FR-047 — LINE business-knowledge pilot](FR-047-line-business-knowledge-pilot.md)
- [FR-051 — Production Supabase tenant isolation](../../agent/features/FR-051-production-supabase-tenant-isolation.md)
- [ADR-030 — Supabase data pipeline observability and replay](../../../decisions/ADR-030-SUPABASE-DATA-PIPELINE-OBSERVABILITY-AND-REPLAY.md)
- [ADR-040 — Codex-mediated SmartGift pipeline evidence bridge](../../../decisions/ADR-040-CODEX-MEDIATED-SMARTGIFT-PIPELINE-BRIDGE.md)
- [ZV2-CR-004 — Supabase production tenant bootstrap](../../../changes/ZV2-CR-004-SUPABASE-PRODUCTION-TENANT-BOOTSTRAP.md)
