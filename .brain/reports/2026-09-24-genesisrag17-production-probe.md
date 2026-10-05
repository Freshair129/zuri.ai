---
version: "1.0.0b"
status: beta
created_at: "2026-09-24T09:00:00+07:00,Claude Fable 5.1"
last_update: "2026-09-24T09:00:00+07:00,Claude Fable 5.1"
attributes:
  domain: knowledge
  doc_type: production-observation
  scope: "read-only production probe for the 2026-09-24 GenesisRAG17 review"
---

# GenesisRAG17 production probe — 2026-09-24

Recorded for the Lane A4 round-3 acceptance review of
[`docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md`](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md)
§9.2, which states production facts that needed a committed, checkable record
rather than an unbacked assertion in the plan document itself.

## What was probed and how

The probe was read-only throughout: no `docker compose` mutation, no schema
change, no migration, and no customer content was read. It ran in two steps:

1. **Container and configuration inspection.** `docker ps`, `docker inspect`
   and `docker exec printf` of flag values against the running containers on
   the production host, to record which images are deployed, which compose
   files and profiles are in effect, and which environment flags are set —
   flag **names**, never secret values.
2. **Database counts.** A Node script using `require('pg')` was run inside
   the `zuri-ai-web-1` container against that container's own
   `DATABASE_URL`. It used `information_schema` to discover the relevant
   tables and then ran `GROUP BY status` / count-only aggregate queries —
   row counts and status breakdowns only, never row content, never a
   customer-identifying value.

No production write was made by this probe.

## Facts

### Containers and images

| Container | State | Image |
|---|---|---|
| `zuri-ai-web-1` | Up (healthy) | `zuri-ai-web-ki17:release-fad8ec62-ki17-overlay` |
| `zuri-ai-genesis-worker-1` | Up (healthy) | `zuri-ai-genesis-worker:release-fad8ec62-msp-68e6169-genesis-5156f41` |
| `zuri-ai-line-worker-1` | Up | — |
| `zuri-ai-ngrok-1` | Up | — |

### Web container configuration

| Item | Value |
|---|---|
| `ZURI_KNOWLEDGE_ENABLED` | `1` |
| `ZURI_KNOWLEDGE_STORAGE_ENABLED` | `1` |
| `ZURI_LINE_SERVER_ENABLED` | `true` |
| `ZURI_KNOWLEDGE_BINDINGS` | set (value not recorded) |
| `MSP_PIPELINE_PRINCIPALS` | set (value not recorded) |
| MSP transport command | set (value not recorded) |
| `com.docker.compose.project.config_files` label | `docker-compose.yml`, `docker-compose.line-server.yml`, `docker-compose.cold-archive.yml`, `docker-compose.ki17-web.yml` (all under `apps/server`) |
| `apps/server/.env` `COMPOSE_FILE` | the same four files |
| `apps/server/.env` `COMPOSE_PROFILES` | `line-server` |
| Knowledge/MSP/GKS/worker variable names | in `apps/server/.env.knowledge` (names only were inspected, no values) |

### Knowledge pipeline row counts

| Table | Counts |
|---|---|
| `KnowledgeCorpus` | 1 (`ACTIVE`, generation 22, `businessId 834fa869-...`, `projectId` null) |
| `KnowledgeCorpusGeneration` | 22 (latest 22, created `2026-09-21T11:55:43Z`) |
| `KnowledgeIngestion` | `PUBLISHED` 22 · `FAILED` 33 (16 `KNOWLEDGE_INGESTION_REJECTED`, last 2026-09-18; 17 `KNOWLEDGE_PIPELINE_FAILED`, last 2026-09-21) · `SUPERSEDED` 1 (`KNOWLEDGE_RUNTIME_RETRY`) |
| `KnowledgeSource` | 55 (54 `FILE`, 1 `TEXT`, 0 revoked) |
| `KnowledgeRawArtifact` | 56 (54 `application/json` `FILE`, 2 `text/plain` `MANUAL`) |
| `KnowledgeParsedArtifact` | 40 (38 `genesisrag17-parser-2`, 2 `genesisrag17-parser-1`) |
| `KnowledgeChunk` | 117 (chars min 70 / p50 352 / max 1346; `tokenCount` max 80) |
| `GenesisRag17SourceMention` | 148 |
| `GenesisRag17Batch` | `ACKNOWLEDGED` 39 · `PENDING` 1 |
| `GenesisRag17IngestionIntent` | `SUCCEEDED` 39 · `FAILED` 16 · `RUNNING` 1 |
| `GenesisRag17PublicationReceipt` | 22 (all `publishedAt` 2026-09-21) |
| `KnowledgeArtifactStorage` | `READY` 56 |
| `PipelineRun` (`DPL-KNOWLEDGE-INGEST-V1`) | `SUCCEEDED` 22 · `FAILED` 33 · `RUNNING` 1 |

### `GenesisRag17StageEvidence` per stage (SUCCEEDED / FAILED)

| Stage | SUCCEEDED | FAILED | Notes |
|---|---|---|---|
| 1 | 56 | 0 | — |
| 2 | 40 | 16 | all `GENESISRAG17_STRUCTURED_RECORD_INVALID`, 2026-09-18 09:01–09:05Z |
| 3–8 | 40 | 0 | each |
| 9–14 | 39 | 0 | each |
| 15 | 38 | 0 | — |
| 16 | 38 | 1 | `BENCHMARK_NO_APPLICABLE_QUERIES`, 2026-09-21 06:18Z, run `774b95f7`, a `TEXT` source |
| 17 | 22 | 16 | all `FAIL` verdicts dated 2026-09-18 09:29–09:39Z, retrieval dimension `recallAt5` 0 or 0.11 and `mrr` 0 or 0.11, below thresholds; data/graph/knowledge/security `PASS`; `ontologyVersion` `ontology_v2` on all 38 verdict rows |

### Stuck run

| Field | Value |
|---|---|
| `PipelineRun` | `1db6810c-eb86-4e96-9f4c-e9c89c8ba0d3`, `RUNNING` since `2026-09-21T06:04:20Z` |
| `currentStageId` | `DPS-KI-ENTITY-EXTRACT` |
| `lastHeartbeatAt` | `06:04:50Z` |
| `GenesisRag17Batch` | `PENDING`, `decisionId` null, `responseJson` null since `06:04:53Z` |
| `GenesisRag17IngestionIntent` | `RUNNING`, `nextStageNumber` 9 |
| Superseded ingestion | its `KnowledgeIngestion` revision 1 is `SUPERSEDED` (`failureCode KNOWLEDGE_RUNTIME_RETRY`, updated `06:04:57Z`) because revision 2 of the same `TEXT` source (title prefix `BundleOffer.genesisrag17`) was admitted at `06:04:45Z` |
| Revision 2 outcome | its run `774b95f7` failed Stage 16 |

### LINE OA grounding

| Field | Value |
|---|---|
| `LineOaAccount.knowledgeGrounding` | `BUSINESS_KNOWLEDGE` for all 1 account |

The published corpus is not yet served to LINE.

### Commands used

- `docker ps` / `docker inspect` / `docker exec printf` of flag values (names only).
- A Node script using `require('pg')` with `information_schema` table discovery
  and `GROUP BY status` count aggregates.
- No production write was made.

## What this does and does not prove

This probe **proves**:

- the KI17/GenesisRAG17 stack (web, genesis-worker, line-worker, ngrok) is
  deployed and running with the images and compose overlays listed above;
- the pipeline has published 22 catalog-record generations into an `ACTIVE`
  `KnowledgeCorpus` (generation 22) for the SmartGift Business.

This probe does **not** prove:

- that the knowledge migrations behind these tables were recorded in a
  migration ledger;
- that an operator activation record exists for when and how this runtime was
  turned on (§10 of the deployment design, step 7);
- production answer quality (Stage 17 shows 16 `FAIL` verdicts against 22
  `PASS`, all dated 2026-09-18, and Stage 16 shows one benchmark failure on
  2026-09-21; this probe counts rows, it does not evaluate retrieval quality
  itself);
- that LINE serves the published corpus (the one `LineOaAccount` is grounded
  on `BUSINESS_KNOWLEDGE`, but the published corpus is not yet served to LINE).

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 1.0.0b | 2026-09-24 | beta | Initial read-only production probe record: container/image state, compose overlay and env-flag names, GenesisRAG17/knowledge pipeline row counts, per-stage evidence, the one stuck run, and LINE OA grounding. No write made. | Claude Fable 5.1 |
