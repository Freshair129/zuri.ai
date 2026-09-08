---
id: ZAI:GENESISRAG17-CONTRACT
title: GenesisRAG17 isolated execution wire contract
version: "1.3.0b"
status: active
created_at: "2026-09-07T23:00:00+07:00,RWANG"
last_update: "2026-09-08T04:00:00+07:00,RWANG"
attributes:
  domain: knowledge
  scope: isolated seventeen-stage acceptance implementation
relations:
  - type: relates_to
    target: ZAI:ADR-070
---

# Approved GenesisRAG17 implementation contract

Version 1.3.0b records the user-approved code-audit remediation; wire `genesisrag17.v1` is unchanged.
Read [the stage spec](../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) and
[execution/extension map](../KNOWLEDGE-INGESTION-17-STAGE-FLOW.md) before adding fields
or changing a stage. All nine tools are defined here: the seven entries below plus
`graph_receipt` and `stage_failure` in their dedicated sections. Those amendments
are required parts of the current contract, not optional future operations.

User approval: explicit implementation request in this task, 2026-09-07. C-3 / HIGH. Synthetic input and isolated databases only. No deployment, LLM extraction, new UI, multiple concurrent input sources or production quality claim. This execution contract implements FR-109 / FR-110 and preserves FR-071 attempt semantics. The [RCA](../../.brain/rca/2026-09-07-genesisrag-17-stage-incomplete.md) records the original incomplete-pipeline investigation.

## Authority and immutable lineage

Tier 1 owns versioned RawExternalRecord -> ParsedArtifact -> Chunk persistence and source resolution. New versions append rows. Tier 2 MSP authenticates, authorizes and relays; it owns no stage, content store or pipeline cursor. GKS is passive canonical resolution/fact/ontology/temporal/graph-decision and final quality authority. Tier 4 pulls through MSP, owns physical graph/vector/index writes and physical publication. No Tier 1 direct GKS or Tier 4 client. Every source mention occurrence retains a separate sourceMentionId and semanticType, independent of the resolution key.

## Wire v1 (frozen before implementation)

All new pipeline messages use camelCase and `schemaVersion: "genesisrag17.v1"`. Legacy promotion/evidence APIs remain readable and unchanged. JSON SHA256 uses recursively sorted object keys, arrays in original order, UTF-8, no whitespace. Hash helpers must reject non-JSON numbers. Text hashes are SHA256 of exact UTF-8 content. Times are ISO UTC. Pipeline scope is the six-field shape `{portfolioId,tenantId,businessId,workspaceId,agentId,visibility}`; all fields are explicit strings (unused workspace/agent empty), visibility private for acceptance. Equality is exact across all six fields. At the legacy GKS resolver boundary, preserve workspaceId, set projectId to empty and map visibility to sharing; agentId is never a projectId. Never derive identity/authorization from caller `actor`.

Every request has `{schemaVersion,scope,...}` plus `credential` at the MSP boundary. Runtime `MSP_PIPELINE_PRINCIPALS` is a JSON array of `{credential,principalId,role,scope}`, roles `source` or `worker`; deny unknown credentials/scope/role before provider invocation. MSP removes the caller credential/actor and adds `relayCredential` configured by `MSP_GKS_PIPELINE_CREDENTIAL`; GKS checks against `GKS_PIPELINE_RELAY_CREDENTIAL`. The worker query server has a separate runtime token configured as `MSP_PIPELINE_WORKER_TOKEN` / `GENESIS_WORKER_QUERY_TOKEN`. No defaults to privileged identities; tests use explicit isolated credentials. Caller roles allow: source submit/evidence/query; worker claim/graph_receipt/write_receipt/stage_failure/gate/publication_receipt/query. Authenticated identity may be journaled; payloads/credentials may not.

Stage identity is `{runId,pipelineStageId,executionStepId,attemptId}`. `runId` is the zuri executionRunId exposed by its API, not a database row ID. A batch carries `stages`, an array of these identities for stages 9–17, and `stageNumber` on each. Stage IDs come from the existing catalog, not generated strings. Every run/step/attempt must be internally consistent. A new real execution receives a new attempt using FR-071; delivery retry retains the identical batch/idempotency key.

### MSP/GKS tool pairs

MSP names below relay to the same suffix with `gks_` replacing `msp_`. Provider methods may use suffix names. Requests and results below include schemaVersion and exact scope unless stated.

1. `msp_pipeline_submit`: `{batch}` -> `{batchId,decisionId,status}`. Batch is `{schemaVersion,batchId,idempotencyKey,scope,runId,stages,source,policy,chunks,mentions}`. `source` is `{sourceId,rawArtifactId,parsedArtifactId,documentId,version,contentHash,content}`. `chunks[]` is `{chunkId,parsedArtifactId,ordinal,text,contentHash,startOffset,endOffset}`; offsets must identify exact source substrings. `mentions[]` is `{sourceMentionId,resolutionKey,semanticType,name,chunkId,startOffset,endOffset}`; offsets are chunk-local and must match the name. `policy` is `{allowEmbedding:true,allowPublication:true}` (false explicitly denies). `batchId` and idempotencyKey remain stable across lost replies. GKS validates source and chunk hashes/positions before canonical processing. `decisionId` may initially be null if processing pending.
2. `msp_pipeline_claim`: `{limit:1}` -> `{decisions:[decision]}`. No destructive dequeue. Return pending decisions until final publication acknowledged; worker receipt idempotency prevents duplicated writes. Decision is `{schemaVersion,decisionId,decisionHash,batchId,scope,runId,stages,source,chunks,entities,facts,held,derived,policy,ontologyVersion:"ontology_v1",pipelineVersion:"genesisrag17.v1"}`. decisionHash is canonical hash of the decision excluding decisionHash. Every fact/derived row has stable id and source references `{sourceId,rawArtifactId,parsedArtifactId,chunkId,sourceMentionIds}`. Facts include subjectId,predicate,objectId OR value,confidence,temporal. Entities have id,name,semanticType,mentions. Payload belongs in GKS/worker; zuri ledger stores counts only.
3. `msp_pipeline_write_receipt`: `{receipt}` -> `{accepted:true,receiptHash}`. Receipt is `{schemaVersion,scope,runId,decisionId,decisionHash,stages,snapshotId,generation,model,transaction,readback,laneManifest,metrics,benchmark}`. `model` = `{id:"intfloat/multilingual-e5-small",revision:"614241f622f53c4eeff9890bdc4f31cfecc418b3",dimensions:384,metric:"cosine",artifactHashes:{path:sha256}}`. `transaction` = `{id,frontier,checkpoint}` (actual native values represented as JSON-safe strings). `readback` = `{ok,nodeCount,edgeCount,vectorCount,citationCount}` from actual reads. laneManifest has vector,lexical,graph,sqlite,bitemporal,provenance each `{status:"ready"|"not_applicable"|"unsupported",reason,objects}`. Unsupported required capability fails gate. `metrics` maps stage numbers 13,15,16 to all six counters. `benchmark` = `{fixtureVersion,queryCount,recallAt5,mrr,citationCorrectness,crossTenantLeaks}` derived from real queries on frozen fixtures. Runtime identity supplied by authenticated MSP is reporter authority.
4. `msp_pipeline_gate`: `{decisionId,decisionHash}` -> `{verdict}`. Verdict = `{schemaVersion,scope,runId,decisionId,decisionHash,snapshotId,generation,receiptHash,verdict:"PASS"|"WARN"|"FAIL",allowPublication,dimensions}`. Each dimension data,graph,knowledge,security,retrieval has `{result:"PASS"|"WARN"|"FAIL",critical:boolean,reasons:[]}`. GKS evaluates immutable source/facts/policy and matching physical receipt; missing receipt cannot pass. Recall@5 >= .80, MRR >= .65, citation correctness == 1, cross tenant leaks == 0. No inferred success or synthesized zero metrics.
5. `msp_pipeline_publication_receipt`: `{receipt}` -> `{accepted:true}`. Receipt is `{schemaVersion,scope,runId,decisionId,decisionHash,snapshotId,generation,receiptHash,publishedAt,pointerHash,modelRevision,transactionFrontier,readback:{ok:true}}`. GKS checks against exact allowed verdict/write receipt before storing, then emits Stage17 terminal evidence. Duplicate identical receipt succeeds; different content for same identity conflicts.
6. `msp_pipeline_evidence`: `{runId,afterCursor:0,limit:100}` -> `{rows,nextCursor}`. Rows are `{cursor,schemaVersion,scope,runId,pipelineStageId,executionStepId,attemptId,stageNumber,outcome:"SUCCEEDED"|"FAILED",startedAt,finishedAt,metrics,details}`. Metrics exact keys `records_in,records_out,records_quarantined,error_count,retry_count,duration_ms`, all nonnegative finite numbers. One terminal per stage/attempt; successful stage13 only after graph receipt, successful stage17 only after publication receipt; failed terminals follow the failure rules below. Stage17 details carry verdict and publicationReceipt; other details counts/digests only. Cursor advances only after durable ledger writes; invalid row stops page consumption. Old legacy evidence never closes a new attempt.
7. `msp_pipeline_query` relays to Tier4's loopback POST `/query` (not GKS): `{schemaVersion,scope,query,topK:5,snapshotId?}` -> `{schemaVersion,scope,snapshotId,generation,results:[{id,score,text,citation:{sourceId,rawArtifactId,parsedArtifactId,chunkId,contentHash}}]}`. MSP authenticates source/worker, rejects response scope mismatch. Worker requires bearer runtime token and exact scope. Missing snapshotId selects published pointer exactly once for the entire query; named historical snapshot must match scope. No visible candidate generations. Worker port/address explicit runtime `MSP_PIPELINE_WORKER_URL`; only loopback permitted in this test implementation.

MSP forwards `authenticatedPrincipal: {principalId,role,scope}` from its runtime grant, replacing any caller value. GKS verifies the relay credential and the required role as well as exact scope. The shared scope key uses JSON array serialization of the ordered six values, never an unescaped delimiter join. Source/chunk/mention offsets are UTF-16 code-unit indices as used by JavaScript String.slice; hashes always cover UTF-8 bytes. `laneManifest[lane].objects` is a nonnegative integer count, not an array. Facts and held rows use `id` and `sourceReferences` (one reference object); derived summaries use `id` and `sourceReferences` (array of actual reference objects). A held record need not have canonical endpoints and is never written as a verified assertion. Receipt metric maps contain only keys 13, 15 and 16.

The frozen integration corpus is `apps/server/tests/fixtures/genesisrag17-corpus-v1.json`: eight markdown sections, repeated mentions, five natural-language queries with predeclared relevant texts, and a version-two correction. Tier4 evaluates actual results against those gold texts; it must not generate expected answers from its own ranking output. The current worker-local SQLite FTS5 derived index supplies lexical retrieval because the pinned native API has no standalone text index; its manifest reason is `worker_sqlite_fts5`.

## Fixed processing baseline

Readback counters describe the physical projection, separately from canonical decided counts. Before enrichment: nodes = 2 source/raw-and-parsed nodes + chunks + entities + facts + held rows; edges = 1 parsed-source link + chunk links + mention links + 2 per verified fact + 1 per held row. Enrichment adds one node and entity link per derived summary plus links to its distinct source chunks. Citation count is the number of persisted chunks with verified source references. SQLite manifest objects count physical nodes, graph manifest objects count physical edges. GKS computes these expectations from the immutable decision and separate enrichment result before comparing worker evidence.

Required vector, lexical, graph, SQLite and provenance capabilities must be ready. Temporal applicability is explicit; absent native temporal-index API support is reported as unsupported with its precise limitation rather than calling JSON property storage a verified native index. The isolated fixture gate may accept that documented optional capability while testing persisted temporal metadata and scoped retrieval. This is not evidence of a production temporal index.

Stage10 rule_v1 recognizes explicit natural-language `Person works for Organization` (.90) and `Person purchased Product` (.90), structured equivalents (.85), inferred/co-occurrence <=.70 HELD. Write floor .80; raw predicate retained until stage11. Stage11 aliases (case/space normalized): works for, employed by, works_for -> WORKS_FOR; purchased, bought, purchased_from -> PURCHASED. WORKS_FOR endpoints Person->Organization, PURCHASED Person|Organization->Product. Unknown predicates and invalid endpoints HELD with reason. Extend neither vocabulary nor meanings silently. Stage12 uses accepted temporal ADR baseline, pinned standalone MSP implementation/parity fixtures; unmapped, open-ended and explicit not_applicable distinct. Stage14 enrich_v1 counts distinct documents/chunks/verified facts per entity, separate derived records with source references.

## Ordered physical write and enrichment amendment (1.1.0b)

The initial draft's combined Stage13/15/16 receipt could not establish Stage13 before Stage14/15. To execute the agreed order, the worker first commits graph-only nodes/edges/source/chunks, without embeddings or derived summaries, then calls `msp_pipeline_graph_receipt` (worker role, relayed to `gks_pipeline_graph_receipt`). Request: `{schemaVersion,scope,credential,receipt:{schemaVersion,scope,runId,decisionId,decisionHash,stages,transaction:{id,frontier,checkpoint},readback:{ok,nodeCount,edgeCount},metrics,startedAt,finishedAt}}`. Metrics contains all six counters for Stage13, and times are the actual worker operation interval. GKS compares physical counts and identity against the immutable decision, stores one idempotent receipt, completes Stage13, executes enrich_v1, and completes Stage14.

Response is `{schemaVersion,scope,accepted:true,graphReceiptHash,derived,derivedHash}`. The initial immutable decision has `derived: []`; actual enrichment is a separately stored immutable result whose hash is `derivedHash`. Its references must point to actual written graph/source/chunks. Worker retains it separately and does not alter the original decision hash. It next computes embeddings (Stage15), commits derived rows/vectors into the same candidate generation, flushes/checkpoints/reads back indexes (Stage16), and sends the final write receipt. That receipt additionally requires `graphReceiptHash`, `derivedHash`, and `executionTimes: {13:{startedAt,finishedAt},15:{startedAt,finishedAt},16:{startedAt,finishedAt}}`. GKS matches both preceding receipts and emits only Stage15/16 at this step; Stage13 has already terminated. Stage17 remains gated by final quality then physical publication receipt.

This uses two native candidate transactions, preserving atomic *publication* of the completed generation. A candidate is never query-visible before its final pointer switch. Each transition and receipt has a durable retry identity; replaying the graph receipt must not duplicate canonical enrichment or Stage13/14 evidence.

## Publication, recovery and acceptance

Worker failures use `msp_pipeline_stage_failure` -> `gks_pipeline_stage_failure`, authenticated with the worker runtime grant. The request carries `{schemaVersion,scope,runId,decisionId,decisionHash,stage,startedAt,finishedAt,metrics,error:{code,message}}`; `stage` is the exact materialized identity and metrics contain six measured values. GKS stores one FAILED terminal for the actual failing stage/attempt, never success for unexecuted downstream stages. Denied embedding policy fails Stage15 and prevents publication. A failed Stage17 gate terminates FAILED without a publication receipt; successful Stage17 always requires it. Transport and reply loss retain the original durable outbox request for retry.

The worker grant includes graph_receipt and stage_failure as well as claim/write_receipt/gate/publication_receipt/query. Stage failure is restricted to worker-owned stages 13, 15 and 16. GKS may return quality PASS while policy denies publication; in that case its Stage17 terminal is FAILED. Tier1 retains both original fields and projects the combined legacy gate to QUARANTINE, never inventing a published snapshot for that quality result.

Tier4 pin e15e35b0093394e0a8880af7f4e6f63cf81223b7. Embedded NAPI owner writes candidate generation, flushes indexes, checkpoints, performs readback and benchmark, receives GKS gate through MSP, then atomically replaces publication pointer. Durable outbox retransmits receipt after crash/reply loss. Old snapshot files remain. One query binds one generation. No production data path inferred from env. Independent workers expose start/stop and resume durable state; no OS scheduled tasks.

Acceptance begins at raw Tier1 entrypoint, with multiple chunks and repeated mentions. It exercises all17 and all6 metrics, receipt-required finish, restart lineage/citations, duplicates/reply loss/crash/replay/late attempts, cursor rejection/resume, wrong scope/tenant/policy, missing provenance/index/security, checkpoint/pointer crash, correction retaining old citations. Native embeddings and native store are mandatory in integration; no skips counted as proof. Record exact commits/schema/model/artifact hashes and test commands in final report. Root alone runs zuri govern and edits shared registries. Each repo owns its migrations. Contract changes require coordinated update before dependent implementations.

## Audit remediation contract (1.3.0b)

The user approved repairing the findings in the
[code-flow audit](../../.brain/reports/GENESISRAG17-CODE-FLOW-AUDIT.md) on
2026-09-08. This amendment restores the existing isolated acceptance guarantees;
it does not add production ingestion, an LLM extractor, new predicates or native
engine/model revisions.

- **Source durability:** persist an ingestion intent with exact scope, source
  version, content and derivation configuration before Stage1, atomically with
  creation of its pipeline run. The source loop
  resumes interrupted local stages from that intent, without caller resubmission.
  Completed local evidence is reused only for its exact attempt; failed attempts
  still require FR-071 replay. Persist occurrence output before reporting Stage8
  success. Parser/chunker and recognizer identities must describe the configuration
  actually executed; unsupported custom execution must be rejected explicitly.
  Early local failure closes FAILED through the same central finish guard using
  current-attempt evidence, without waiting for or inventing downstream stages.
  New backup exports identify source-recovery coverage and require both intent
  and occurrence tables on restore. Older snapshots remain readable with an
  explicit compatibility warning that missing recovery state is not reconstructed.
- **Resolution and extraction:** retain all occurrences; a normalized name alone
  cannot merge incompatible semantic types. Resolve compatible typed identities
  or preserve an explicit conflict. Explicit extraction must preserve the subject
  across supported coordinated clauses and must never turn a negated relation
  into a positive verified fact. Unsupported ambiguity remains HELD. Rule scores,
  ontology aliases and the .80 write floor stay unchanged.
- **Temporal:** invalid intervals are HELD with a reason, never a builder
  exception. Unrecognized temporal claims are HELD as `temporal_unmapped`, distinct from an
  open-ended interval and a statement with no temporal claim (not_applicable in
  this text-only profile). Their source references retain the original claim;
  never emit an unmapped verified fact with null/null bounds that a downstream
  reader could mistake for not_applicable. Structured source
  temporal metadata is not silently accepted or discarded: unsupported input is
  rejected until a separately versioned mapping contract supports it.
- **Evidence:** local failure counts reflect the actual stage input/work rather
  than a universal one-record placeholder. Stage9 timing includes canonical
  lookup. Pending/null decision acknowledgements remain valid; source retries
  retain the same batch and idempotency key until an actual decision is available.
- **Physical recovery:** persist the complete native transaction intent,
  including expected frontier, before commit. An uncertain retry reuses the exact
  payload and identity. Save accepted graph receipt/derived state before removing
  its outbox. Checkpoint a newly declared vector collection before its first
  vector transaction so native replay retains model, dimension and metric.
  Cover crashes after graph/final native commits but before receipts,
  and after remote acceptance but before local acknowledgement. Lexical indexing
  belongs to Stage16; Stage13 writes graph/source/chunk projection only.
- **Publication:** this isolated profile publishes only PASS with
  allowPublication=true and a matching receipt. WARN remains a non-publishing
  terminal failure, consistently across all four repos. Atomic pointer replacement
  must keep the old pointer intact if replacement fails; never rename the old
  pointer away as a fallback. Keep historical snapshots accessible across retry.
- **Acceptance:** add real source-to-GKS regressions, native process crashes at
  the actual durability boundaries, source recovery before batch creation,
  measured-count assertions, and queries with two populated isolated tenants.
  Existing happy-path tests remain mandatory; no synthetic successful stage
  evidence or skipped native suite counts as completion.

## Changelog

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 1.3.0b | 2026-09-08 | active | User-approved audit repairs: semantic correctness, durable recovery, measured evidence and PASS-only atomic publication | RWANG |
| 1.2.1b | 2026-09-08 | active | Consolidate current nine-operation authority, graph receipt ordering and extension navigation; wire unchanged | RWANG |
| 1.0.0b | 2026-09-07 | active | User-approved isolated execution and wire freeze | RWANG |
| 1.1.0b | 2026-09-07 | active | Separate graph acknowledgement preserves actual 13 -> 14 -> 15 -> 16 execution order and operation timestamps | RWANG |
| 1.2.0b | 2026-09-07 | active | Authenticated stage failures terminate honestly; publication receipt required only for successful completion | RWANG |
