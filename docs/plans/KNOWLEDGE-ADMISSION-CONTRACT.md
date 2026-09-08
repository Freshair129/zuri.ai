---
id: ZAI:KNOWLEDGE-ADMISSION-CONTRACT
title: Knowledge admission phases 0–4 integration contract
version: "1.0.1b"
status: beta
created_at: "2026-09-08T16:40:00+07:00,RWANG,base dfdbaf11"
last_update: "2026-09-08T19:37:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:ADR-072
  - type: relates_to
    target: ZAI:FR-172
---

# Knowledge admission contract — phases 0–4

Isolated acceptance: Business owner Files browser admission and session HTTP/MCP reached the real native pipeline; four document runs each have 17 successful evidence rows, four native snapshots and five corpus generations. Project-scoped and bearer/API-grant paths have unit/Prisma authorization evidence, not native browser proof. Browser query controls and production activation are not claimed. See the [phase report](../../.brain/reports/2026-09-08-knowledge-admission-phase0-4.md) for versions, test counts and limits.

Owner-approved implementation contract under ADR-072. Text/Markdown and managed readable text files only; existing document-staging, OCR, connectors and org-wide sharing remain separate later phases.

## Request and service boundary

Admission is a strict object `{businessId, projectId?, idempotencyKey, source}`. `source` is TEXT `{kind:"TEXT", sourceKey, version, title, content}` or FILE `{kind:"FILE", fileAssetId, sourceKey?, version?, title?}`. No caller scope/policy/actor/credential fields. Limits: UTF-8 text at most 1 MiB; identifiers/keys at most 200 characters; nonempty content; supported file types plain text/Markdown with fatal UTF-8 decode. File bytes are frozen at admission, not re-read into a queued old version. FILE defaults sourceKey to fileAssetId and version to content hash; correction with the same source/version but changed bytes conflicts.

`admitKnowledge(input, {db, viewer, env, now})` validates authorization and source access, resolves server runtime binding, and commits corpus/source/job atomically. It does not wait for native execution to return HTTP accepted. Services live in the knowledge domain. HTTP/MCP authenticate through existing request viewer; explicit configured grants are required before an existing API key can access knowledge. No key receives new implicit powers.

`readKnowledgeIngestion(id, options)` and `listKnowledgeIngestions({businessId,projectId,limit}, options)` return no raw text or runtime secrets. Public id is the admission job id; executionRunId remains a separately named nullable field. Corpus/source status and receipt-backed publication identity are explicit.

`queryKnowledgeCorpus({businessId,projectId,query,topK}, options)` returns `{corpusId, corpusGeneration, manifestHash, ranking:"rrf-k60", results}`. Each result has source/ingestion/snapshot/generation identity, rank-fusion score, snapshot-local score, text and citationId. Query pins a manifest and validates every returned hit against its exact snapshot and lineage; empty active corpus is a truthful empty result. A missing required snapshot fails the request rather than silently omitting a document. Use reciprocal-rank fusion k=60 over per-snapshot ranks with deterministic source/chunk tie breaks, not a sort of incomparable native BM25/hybrid scores. The corpus is a Tier 1 snapshot read set; cross-document graph traversal and an aggregate native gate are not claimed.

`resolveKnowledgeCitation(citationId, options)` resolves source/version/chunk/text/offset and verifies current corpus/source/file/project access even for historical generations. Citation ids encode references only; unsigned reference tampering is detected by manifest membership and authoritative records, never trusted as authorization.

`withdrawKnowledgeSource(sourceId, {expectedVersion}, options)` checks write access, compare-and-set source version, revokes membership and atomically publishes a new manifest excluding the source. No physical historical-store deletion. Withdrawal controls only corpus membership, so current corpus write authority may remove a source even after its FileAsset is deleted; it neither reads nor modifies that file. Authorized corpus status/history retains safe admission metadata for this cleanup, but never cross-corpus source metadata. Late job receipts must not revive a revoked source.

## Repository models

All four models have UUID primary keys; mutable rows have createdAt/updatedAt/version and deletedAt where applicable. No canonical fact payload is stored here.

| Model | Required fields beyond id |
|---|---|
| KnowledgeCorpus | corpusKey unique; portfolioId, tenantId, businessId; nullable projectId; workspaceId; scopeJson, policyJson; status; generation default 0; version default 1; createdAt, updatedAt, deletedAt |
| KnowledgeSource | corpusId; sourceKey; kind; title; nullable fileAssetId; desiredRevision default 0; nullable activeIngestionId; version default 1; revokedAt; createdAt, updatedAt, deletedAt; unique(corpusId, sourceKey) |
| KnowledgeIngestion | corpusId, sourceId; revision; sourceVersion; contentHash; content; sourceMetaJson; idempotencyKey unique (server namespaced); requestHash; submittedById; status; executionRunId nullable unique; rawArtifactId, parsedArtifactId, snapshotId, snapshotGeneration, receiptHash nullable; claimToken, leaseExpiresAt nullable; attempts default 0; failureCode nullable; version default 1; createdAt, updatedAt; unique(sourceId, sourceVersion) |
| KnowledgeCorpusGeneration | corpusId, number; manifestJson, manifestHash; createdAt; unique(corpusId, number) |

Job statuses: QUEUED, RUNNING, PUBLISHED, FAILED, SUPERSEDED, WITHDRAWN. Source states derive from revokedAt/deletedAt and activeIngestionId. An unsuccessful correction leaves the earlier published source queryable unless explicitly revoked.

## Manifest and concurrency

Manifest JSON `{schemaVersion:"knowledge-corpus.v1", corpusId, generation, entries}`; entries are sorted by sourceId and contain `{sourceId, ingestionId, sourceVersion, revision, executionRunId, snapshotId, generation, scope, receiptHash, rawArtifactId, parsedArtifactId, contentHash, fileAssetId, title}`. `generation` inside an entry is the native generation string; outer generation is a corpus integer. One entry per source. Hash uses canonical JSON SHA-256.

The publication transaction checks latest desiredRevision, non-revoked source, verified job receipt and source identity, merges the new entry into the previous manifest, inserts the immutable generation, sets activeIngestionId, advances corpus generation/version via CAS and marks the job PUBLISHED. Retry a CAS conflict from the latest manifest; never last-write-wins a stale whole manifest. Already published job completion is idempotent. Withdrawal uses the same manifest transaction/CAS discipline. Delayed completion becomes SUPERSEDED/WITHDRAWN without replacing newer evidence.

The pinned native query response carries `snapshotId` and `generation` both on the envelope and on each result. The strict zuri parser accepts these declared result fields and requires exact equality with the envelope before corpus validation; extra fields and mixed-generation results are rejected. Document content hashes and chunk citation hashes remain distinct.

Runtime leases are application ownership only; they do not mint new pipeline attempt IDs. Expired leases resume the same immutable ingestion request/FR-071 identities; transport retry is not a replay. Worker completion and corpus publication have separate evidence and crash boundaries.

## Runtime and authority

Root integration owns runtime binding selection, repository adapter, scoped execution capability, existing pipeline writer changes, migrations and governance. The capability is held in a module-private WeakMap and cannot be serialized into an HTTP request; validators restrict it to the exact GenesisRAG scope and knowledge definition/run. Ordinary viewer, fake isOperator body field or source role credential alone cannot bypass these checks.

The opt-in source loop starts at server runtime boot and resumes durable jobs; UI requests may wake it but are not required after restart. Runtime configuration must explicitly enable this profile and provide matching source principal, transport and policy. Disabled/unconfigured admission fails truthfully; tests use isolated configuration and native stores. Database publication pointer changes occur only after receipt verification.

### Configuration and canonical input adapter

The Node server starts the queue only when `ZURI_KNOWLEDGE_ENABLED=1`. `ZURI_KNOWLEDGE_BINDINGS` is a JSON array of `{scope, policy:{allowEmbedding:true,allowPublication:true}}`, with exactly one binding in this process profile. It must match that Business's current Tenant/Portfolio, an exact source entry in `MSP_PIPELINE_PRINCIPALS`, and the configured `ZURI_MSP_COMMAND` transport. Multiple entries fail closed in this phase because MSP currently has one worker query endpoint. The same pipeline code can run in separately configured isolated deployments; one native process does not serve several stores. Each deployment still supplies a matching Tier 4 scope/store and query endpoint.

`ZURI_KNOWLEDGE_API_GRANTS` is a JSON array of `{serviceAccountId,tenantId,businessId,actions:["read","write"]}`. An authenticated API key additionally requires an exact grant; existing tenant API authority is not automatically widened.

The runtime creates/reuses a Business-scoped `KNOWLEDGE_ADMISSION` IntegrationProvider/Connection without external credentials. Its MANUAL/FILE adapter invokes the existing canonical RawExternalRecord ingestion at Stage 1. The admission-to-executionRunId attachment and raw intent commit in the same transaction, so a lost reply cannot strand a run outside the admission job. Temporary transport errors retain RUNNING with a safe retry code; only confirmed terminal evidence publishes a corpus entry.

Backups now carry `knowledgeAdmissionRecovery` version `knowledge-admission-recovery.v1` requiring all four admission tables. An incomplete declared manifest fails preview before restore; historical backups without the manifest remain readable with a recovery-unavailable warning. Tier 4 native snapshots remain separately persisted artifacts; a Tier 1 backup alone does not recreate them.

## Ownership and integration

Root: shared schema/repository, runtime queue/boot and narrow existing executor/ledger capability seams, canonical documents/registries, backup and combined checks.

Admission worker: admission/status service, new HTTP routes, MCP tools and existing Files UI, with tests; no independent schema/govern changes.

Corpus worker: authorization helper, manifest publication/withdrawal, query/citation services and tests; no independent schema/govern changes.

Native worker: explicit-snapshot correctness review/fixes and actual native multi-document HTTP/browser acceptance harness; no unrelated engine or production changes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.1b | 2026-09-08 | beta | Record isolated Business surface/native acceptance and distinguish Project/API-grant test evidence | 03256b74 + integration | RWANG |
| 1.0.0b | 2026-09-08 | beta | Frozen source, corpus, job, manifest and service boundaries for approved phases 0–4 | base dfdbaf11 | RWANG |
