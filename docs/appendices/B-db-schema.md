# Appendix B — Database Schema Summary

| Field | Value |
|-------|-------|
| **Version** | 1.9.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-20 |

Source of truth: `prisma/schema.prisma` (SQLite; Postgres-ready ตาม DB-MIGRATION-NOTES.md)
Conventions: UUID PK · unique human `code` · `createdAt/updatedAt` · `version` บน aggregate
roots · `deletedAt` soft delete · enums เป็น string (Zod validate) · JSON เก็บเป็น string

ทุก model ต้องอยู่ใน `SNAPSHOT_MODELS` (เรียงพ่อก่อนลูก) หรืออยู่ใน
`SNAPSHOT_EXCLUDED_MODELS` พร้อมเหตุผลว่าทำไมกู้คืนไม่ได้ — ทั้งคู่อยู่ใน
`src/modules/project-manager/application/backup-service.js` และ preflight
(`snapshot-coverage`) ตรวจจาก `prisma/schema.prisma` โดยตรง model ที่ไม่อยู่ในลิสต์ไหนเลย
คือ CRITICAL เพราะ restore จะไม่ export ไม่ลบ และไม่คืนตารางนั้น

## Models

| Model | Key fields | หมายเหตุ |
|---|---|---|
| Portfolio | code, name | รากของเครือ (BR-001) |
| Tenant | portfolioId, status | ขอบเขต isolation + การแชร์ข้อมูล |
| LegalEntity / LegalEntityIdentifier | portfolioId; (country,type,value) unique | external identifier ไม่ใช่ PK (BR-002) |
| Business | tenantId, legalEntityId? | ธุรกิจปฏิบัติการ |
| Branch | tenantId, businessId | tenantId ต้องตรงกับ business (tested) |
| Person / Membership | tenant, business?, branch?, role, domainKeysJson | local identity; MEMBER domain allow-list, OWNER/DEV role grant (FR-038) |
| RoleBinding | personId, tenantId, businessId, roleKey, scopeType, status, assignedBy, revokedAt | generic Business-scoped RBAC binding; `PRODUCT_OWNER` is the current Product role (FR-076) |
| Workspace | scopeType (PORTFOLIO/TENANT/BUSINESS) + denormalized ancestor ids | ต้องมี scope ชัดเจน |
| Project | businessId?, workspaceId, type, status, priority?, picPersonId?, startAt/targetAt | direct Business owner; schema Workspace is Development Space; null owner only for explicit shared work; soft delete. `priority` (FR-087) and `picPersonId` (FR-088) are both nullable at rest — every row predates them, and unset is a state the Dashboard renders honestly rather than defaulting |
| PlanImportReceipt | idempotencyKey, payloadHash, executionRunId, executionStepId?, attemptId?, correlationId, projectId | server-owned PlanEnvelope commit receipt; stable trace/idempotency boundary; never accepts client-generated execution IDs |
| PersonCredential | personId unique, passwordHash | FR-090 — production auth credential. Declared here because the table is live on Supabase with a real row; the service that uses it is still on `codex/postgres-primary-runtime`. Undeclared, `migrate diff` proposes DROP |
| PasswordResetToken | personId, token unique, expiresAt, usedAt? | FR-090 — same origin as PersonCredential; currently empty |
| Workstream | projectId, executionMode, laneId?, progressStrategy, progressWeight, progressCache, viewConfigJson | หัวใจของ 7 โหมด · `laneId` (FR-090) is live on every row on Supabase |
| WorkContainer | workstreamId, parentId (hierarchy), subtype, metadataJson | SPRINT/MIGRATION_STAGE/… |
| WorkItem | workstreamId, containerId?, subtype, weight, numericValue, probability, metricDataJson, metadataJson | atomic ทุกโหมด |
| Milestone | projectId, workstreamId?, weight, targetAt, completedAt | |
| Gate | projectId, workstreamId?, required, evidenceJson, status | cap progress (BR-006) |
| Dependency | (sourceType,sourceId,targetType,targetId,dependencyType) unique | cycle-checked ที่ service |
| Repository / ProjectRepository | provider, externalRepoId?, fullName; (projectId,repoId,role) unique | local metadata, m2m |
| Team | code unique, businessId, deletedAt? | FR-089 — organisational grouping, Business-scoped (ADR-037 D2). Grants nothing: the identity module never reads it (BR-018) |
| TeamMembership | (teamId,personId) unique | Person ↔ Team, deliberately separate from `Membership` — that one is the authority record, and merging the two is what let an unauthenticated POST mint owner authority on 2026-08-17. No `role` column, on purpose |
| ProjectTeam | (projectId,teamId) unique | m2m: a Project is worked by several Teams and a Team works several Projects (ADR-037 D3) |
| IntegrationProvider / IntegrationConnection / IntegrationCredential | code unique; (tenantId,providerId,externalAccountId) unique; connectionId unique | provider + Business-scoped connection registry, opaque secret ref (FR-079/FR-080) |
| IngestionRun | connectionId, lane, resourceType, status, counts | one acquisition pass; inherits the connection's scope (FR-081) |
| RawExternalRecord | idempotencyKey unique; (connectionId,entityType,externalId) | verbatim source payload as replayable evidence (FR-081) |
| SyncCursor | (connectionId,resourceType) unique | incremental watermark per resource (FR-081) |
| ExternalEntityRef | (connectionId,entityType,externalId) unique | external → internal mapping; external id is never a PK (BR-002) |
| DeadLetterRecord | connectionId, failureStage, failureOwner, status | preserved failure with a named owner (FR-081) |
| MarketObservation | tenantId, businessId?, rawRecordId, connectionId, provider, externalId, lineageKey unique | Market-owned translated observation; scalar raw/connection refs preserve Integration authority, and unresolved candidates remain valid (FR-092 / ADR-038) |
| ProjectFile | projectId, workItemId?, name, mime, size, url/blobRef, version, uploadedBy | metadata/reference only; optional WorkItem must belong to Project (FR-037) |
| BusinessRoadmap | businessId, code, title, status, startAt/targetAt | Business-level direction container (FR-041) |
| BusinessRoadmapHorizon | roadmapId, key, label, position, targetAt | ordered short/medium/long horizon; service allows 2 or 3 |
| BusinessGoal | businessId, roadmapId?, horizonId?, code, title, status, progress | Business goal displayed in Strategy Overview |
| ProjectGoal | projectId, goalId | optional many-to-many link; Project remains a Development resource |
| AuditEvent | entityType, entityId, action, payloadJson, actorType | append-only (SEC-003) |
| PipelineRun | executionRunId unique, dataPipelineDefinitionId, executionContractId, tenantId, businessId?, status, hashes, counts, replay lineage, heartbeat | server-owned full-pipeline run envelope; distinct from IngestionRun and PlanImportReceipt (FR-071) |
| PipelineStep | executionStepId unique, runId, pipelineStageId, sequence, attemptId unique, status, hashes, failure evidence, heartbeat | one stage occurrence/attempt; retries create new executionStepId/attemptId (FR-071) |
| PipelineEventReceipt | runId, idempotencyKey unique, eventType, eventHash, resultJson, auditEventId | exact event idempotency and immutable receipt; no raw event payload (FR-071) |
| PipelineRecordEvent | runId, stepId?, attemptId, pipelineRecordId, source key/hash, docId?, picId?, factId?, destinationRecordId?, status, failure evidence | redacted record outcome/provenance ledger; no OCR/document/image payload (FR-071) |
| PipelineReconciliation | runId, stepId?, expected/actual/delta counts, source/artifact/staging/destination hashes, RLS/isolation result | reconciliation evidence linked to a run/stage (FR-071) |
| PipelineGateDecision | runId, gateId?, status, required, decision/evidence references, auditEventId | approval/hold evidence for execution; existing Project Manager Gate remains its owner (FR-071) |
| SotDecision | tenantId, businessId?, decisionType, subjectRef, phaseId?, payloadJson+payloadSha256, decisionVersion, status, decidedByPersonId, reason, auditEventId | the SoT pipeline's generic human-decision queue: submitted by the data plane, decided in the browser, pulled back by cursor; rows immutable once decided (FR-100, ADR-046) |
| CustomerImportBatch | contractId, missionId, versionId, tenantId, businessId, snapshotSha256, counts, status, approvedByPersonId | private batch receipt and rollback boundary for FR-078; no raw PII |
| CustomerImportProvenance | batchId, sourceSystem/table/key, sourceRow, sourceSha256, snapshotSha256, idempotencyKey, resolutionStatus, disposition, optional target ids, optional reviewCaseId/evidence flags | private source identity/idempotency ledger for FR-078; no raw PII |
| CustomerImportReviewCase | batchId, tenantId, businessId, reasonCode, groupFingerprint, status, itemCount, redacted evidence, version | deterministic duplicate-group queue identity for FR-078; no raw PII |
| CustomerImportReviewDecision | reviewCaseId, provenanceId, decisionVersion, action, targetCustomerId?, decidedByPersonId, decidedAt | append-only human decision ledger; no update/delete path |

## Product Owner RBAC role (FR-076 / ADR-033)

`RoleBinding { personId→Person, tenantId→Tenant, businessId→Business, roleKey,
scopeType, status, assignedBy?, version, createdAt, updatedAt, revokedAt? }`
is the generic responsibility relation. The current supported scope is
`BUSINESS`; `roleKey=PRODUCT_OWNER` expands through the identity role registry
to Product permissions. `status` is `ACTIVE`, `SUSPENDED` or `REVOKED`.
`tenantId` and `businessId` are both persisted for scoped queries, while the
service rejects a mismatch against `Business.tenantId`. The relation is
many-to-many and does not change `Membership.role`, platform authority or
import authority. Changes append an `AuditEvent` without secrets or customer
content.

FR-078 adds `roleKey=CUSTOMER_DATA_REVIEWER` as a separate Business-scoped
capability. It grants review read/decision permissions only; Product Owner,
platform and ownership labels do not imply customer-data review authority.

## Planned (FR-019)

`ExternalRef { entityType, entityId, system, value, labelAs }` unique(system,value)
— generalization ของ LegalEntityIdentifier/externalRepoId สำหรับ enterprise mapping

`ExternalIdentity { tenantId, personId→Person, provider, providerSubject, verifiedAt, linkedAt, revokedAt }`
unique(tenantId, provider, providerSubject) — FR-021: channel/auth identity (LINE user)
→ Person principal, tenant-scoped; personId is a real FK (V2 unified identity into Person,
ADR-003 §D10, so no polymorphic principal). Distinct from ExternalRef (data mapping).

## CRM slice (FR-023, ADR-007 P2)

`Customer { code, tenantId, businessId?, personId→Person, displayName, lifecycleStage, +soft-delete/version }`
unique(tenantId, personId) — a CRM record per principal per tenant (shared across the
tenant's businesses).
`Conversation { tenantId, businessId?, customerId→Customer, channel, externalThreadId, status }`
  — `@@unique([tenantId, channel, externalThreadId])`
`Message { conversationId→Conversation, direction, body, externalMessageId?, createdAt }`
  — `@@unique([conversationId, externalMessageId])`

Both external ids were globally unique until 2026-08-19, which made a provider id an
effective primary key across every tenant (BR-002) and let one tenant's thread or
message id resolve another tenant's rows. They are now scoped: the conversation by
tenant and channel, the message by the conversation that owns it — a Message has no
tenant column of its own, and adding one would duplicate truth that could drift from
its Conversation.
The LINE gateway `ingestLineMessage` resolves through FR-021 then upserts customer →
conversation → message in one transaction; idempotent on externalMessageId.

The FR-078 historical backfill uses a separate private `zuri_core` target boundary
(`person`, `customer`, `customer_import_batch`, `customer_import_provenance`,
`customer_import_review_case`, `customer_import_review_decision`) so
the Supabase migration can enforce forced RLS and deny Data API roles before any
Customer row is approved. The contract's initial publish allowlist is
`display_name` only; source keys and hashes remain in the private provenance
ledger.

## Identity P3 gate (FR-022, ADR-007 P3)

`IdentityLinkToken { tenantId, personId→Person, provider, token@unique, expiresAt, consumedAt?, createdAt }`
— a single-use, expiring nonce for **account linking**: bind a LINE subject to an
EXISTING Person instead of minting a fresh one. Redemption re-points (merges) a
subject that was auto-minted to a throwaway principal, carrying its Customer along so
the principal never forks. No new columns on identity — the **staff/customer split**
is structural (Membership ⇒ STAFF, Customer ⇒ CUSTOMER, both ⇒ STAFF). **PDPA erase**
revokes the ExternalIdentity (a revoked binding refuses to resolve), invalidates
outstanding tokens, and redacts the CRM record. `resolveLinePrincipal` is the single
seam that resolves + classifies in one call.

## Managed local files (FR-045 — implemented additively)

`LocalWorkspaceMount { id, tenantId, businessId, deviceKey, rootPath, status,
lastScanAt, createdAt, updatedAt }` maps one device-local absolute root. `rootPath`
is not exported as portable identity and must be remapped during restore.

`FileAsset { id, code, tenantId, businessId, projectId?, workItemId?, storageKind,
relativePath?, externalUrl?, blobRef?, name, mime, size, sha256?, status, version,
createdAt, updatedAt, deletedAt? }` is the authoritative metadata record.

`FileLink { id, fileId, entityType, entityId, relationType, createdAt, updatedAt }`
is a typed secondary relation validated at the service boundary. Initial entity
types are limited to approved FR-045 targets; arbitrary polymorphic input is denied.

These models are additive. `ProjectFile` remains for compatibility and is not
removed by ZV2-CR-001. SQLite is canonical for MVP; the generated Postgres schema
preserves metadata semantics while device root paths remain local configuration.

## Raw external ingestion (FR-081)

Five additive tables sit beneath the connection registry and hold what arrived
through a connection, before anything translates it into business truth.

`IngestionRun { tenantId, businessId?, connectionId, lane, resourceType, runType,
status, startedAt, finishedAt?, fetched/created/updated/unchanged/failedCount,
errorCode?, errorMessage? }` is one acquisition pass. It inherits tenant and
Business from the connection rather than from the caller.

`RawExternalRecord { ..., provider, lane, entityType, externalId, sourceType,
sourceUri?, schemaVersion, payloadJson, payloadHash, idempotencyKey@unique,
receivedAt, processingStatus, processingError?, processedAt? }` is the verbatim
payload. `idempotencyKey = sha256(tenantId, connectionId, entityType, externalId,
payloadHash)` over a canonically serialized payload, so a re-delivered event is
recognised instead of duplicated.

`SyncCursor { (connectionId,resourceType) unique, strategy, cursorValue?,
watermarkAt?, lastSuccessAt? }` is the incremental watermark per resource.

`ExternalEntityRef { (connectionId,entityType,externalId) unique,
internalEntityType?, internalEntityId?, externalCode?, documentNumber?,
payloadHash?, firstSeenAt, lastSeenAt, lastSyncedAt? }` maps an external
identifier to an internal one. The external id lives here and never becomes a
primary key (BR-002).

`DeadLetterRecord { ..., ingestionRunId?, rawRecordId?, failureStage,
failureOwner, errorCode, errorMessage, retryCount, status, nextRetryAt?,
resolvedAt? }` preserves a failure with the stage and the owner responsible for
it, rather than retrying it silently.

All five are covered by the backup snapshot, ordered so they restore after the
connection they hang off and delete before the Tenant/Business they reference.

## Integration runtime connections (FR-079 / ADR-031)

`IntegrationProvider { code, name, status, capabilitiesJson }` is provider
metadata. `IntegrationConnection { tenantId, businessId?, providerId, name,
authorizationType, externalAccountId?, purpose, role, status, metadataJson,
version }` is the Business-scoped connection registry; Phase 1 selection requires
`purpose=PHASE1_LINE_LLM`, `status=ACTIVE`, and `role=PRIMARY` under the
server-resolved binding scope. `IntegrationCredential { connectionId@unique,
secretRef, status, expiresAt?, accessTokenExpiresAt?, refreshTokenExpiresAt?,
rotatedAt?, version }` stores only an opaque
external secret-manager reference; raw credential material is never persisted in
Prisma or returned to the browser.

The generic Postgres artifact carries the additive connection tables and
`prisma/postgres/0002_phase1_line_primary_connection.sql` adds the active-primary
unique index. Production Supabase uses the private-schema migration
`supabase/migrations/20260818040000_phase1_line_runtime_connections.sql`, which
adds forced RLS and read-only `zuri_line_smartgift_ro` grants. The follow-up
`supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql`
adds a private `SECURITY DEFINER` resolver for `supabase-vault:<uuid>` refs;
`zuri_line_runtime` receives function execute only and no direct Vault view read.
