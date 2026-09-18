---
id: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
title: Project Manager Phase B Feature implementation plan
version: "0.5.0b"
status: beta
created_at: "2026-09-17T01:17:02+07:00,Luna Max,f061a113584aa15db68934dc8451f14b9a1011e1"
last_update: "2026-09-17T20:28:51+07:00,RWANG final integrator"
superseded_by: null
attributes:
  doc_type: implementation-plan
  domain: project-manager
  scope: "MA-I02 Phase B Project Feature authority, UX, persistence and contract"
  complexity: "C-3 / HIGH"
  evidence_level: "APPROVED DESIGN; LOCAL IMPLEMENTATION AND INDEPENDENT GATES PASS; HOSTED CI AND PRODUCTION PENDING"
  source_commit: "f061a113584aa15db68934dc8451f14b9a1011e1"
  canonical_id_status: "NO NEW FR, FEAT, ADR OR DOM IDS; ROOT OWNS REGISTRATION"
relations:
  - type: references
    target: ZAI:PM-PHASE-B-COMMIT-PROVENANCE
  - type: references
    target: ZAI:PM-PROJECT-DOMAIN-FEATURE-BASELINE
  - type: references
    target: ZAI:PM-TABLES-ERD
  - type: references
    target: ZAI:PM-CONTRACT-FOUNDATION
  - type: references
    target: ZAI:FR-250
  - type: references
    target: ZAI:FR-251
---

# Project Manager Phase B Feature implementation plan

**Current entry record:** The owner approved recovery/erasure decision26
v0.2.1b on 2026-09-17. Its separate clean-target recovery and reviewed
field-target erasure replace the earlier unspecified maintenance/erasure
boundary in section 8. W1, Identity P2 and W2 repository/recovery/erasure
passed independent and root local gates at 052821a7. W3-W5 implementation and
independent source reviews pass. The browser acceptance set is closed by
45 passing checks and the corrected privacy regression passing separately;
release gates are recorded below. [Contract27](27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md)
makes W5 manifest bytes, registry extraction and operator checkout binding
executable within this same approved six-record and 14-operation scope.
The owner previously approved v0.3.2b at e5ccfd7a; B2 registered
FR-252 and ADR-097 at 50b5e1dd with governance passing. ADR-097 is the approval
authority and closes the earlier B1/B2 gates. Version 0.3.3b aligned restore
prerequisites, owner-only snapshot listing and wire refusals with that approved
behavior. W1 published its exact per-table RLS/adapter policy and passed the
independent and root gates before isolated migration/adapter execution.
Identity P2 passed its separate local gate. The current composed runtime is
verified per wave; hosted CI and production deployment remain NOT_RUN.

**Approved design; implementation evidence is recorded per phase.** This
document composes the UX packet and backend packet into one Phase B design.
ADR-097 and approved decision26 record the implementation authority. No new
FR, FEAT, ADR or DOM identifier is allocated here. Root owns canonical
registration, document graph generation, governance, integration and release
gates.

The design below records the selected transport, records and worker boundaries.
Every route, DTO, table, security binding and worker slice follows the recorded
B1/B2 approvals and the independent local/runtime/release gates. The allocation rule is deliberately
precise: basis points split one
WorkItem's value across its Feature links; they are never summed across
unrelated WorkItems.

Current evidence: W3 list/detail browser proof passes 21 cases. The expanded
W4 PostgreSQL proof passes 19 cases, including Session and grant expiry during
authority-row lock waits, live revocation, CAS and atomic rollback. The latest
PM/CRM/Identity security composition passes 122 tests across 14 files. The
final Server suite passes 6376 tests with 32 skipped, including the final
authority/CRM/UI corrections; 2266 source, test, schema and configuration files
remained unchanged across that run. The final optimized Server build passes.
The separately approved CRM
hold/audit closure passes its independent PostgreSQL gate (14 cases) and final
SQLite hold suite (21 cases).

W5 owner forms implement the approved pickers, review summaries, uncertain-intent
retention, field focus and lifecycle/evidence presentation. The independent
Luna Max source review passes the frozen Forms/View/picker composition, and
focused UI tests pass 25/25. After correcting the actual Escape-focus defect,
the full Server suite and optimized build pass. The composed browser run has
45 passing checks and one failed privacy fixture; after a test-only locator
correction, that regression passes in a separate run without skips or flaky
outcomes. The original failed run remains recorded as FAIL. Final governance
is recorded in the integration report.
The first browser run's incorrect mocked DELETE receipt remains a recorded
fixture failure; strict product validation was retained. These conformance
repairs stay within section 7 and add no API or schema scope. Current evidence
and portable provider proofs are collected in the
[integration report](../../../.brain/reports/2026-09-17-project-feature-phase-b.md).
None of these local results claims hosted CI, production grants or deployment.

## 1. Boundary and product decision

Phase B adds a Project-scoped Feature authority. It does not turn the Phase A
Domain projection into a Feature registry, and it does not alter the existing
Workstream progress model.

| Concern | Authority in this plan | Boundary |
| --- | --- | --- |
| Execution Domain | FR-251 read-only projection of existing Workstream bindings, stable DOM keys, owners, contracts, blockers and deduplicated work evidence | No Domain create/update, no new DOM key, no grant, no Feature row inferred from a label or tag. |
| Project Feature | ProjectFeature plus its explicit relationship records | Owns Feature code, title, problem, outcome, lifecycle and traceability after B1/B2. |
| Domain contribution | FeatureContribution | Adds a supporting responsibility to a Feature; does not create or rename a Domain. |
| Work relationship | FeatureWorkLink | Explains which WorkItems contribute to a Feature and optional allocation. It does not mutate Workstream progress. |
| Requirement relationship | RequirementBinding plus GovernanceSnapshot | Pins a requirement subject and immutable revision evidence; the Feature UI cannot rewrite the canonical subject. |
| Project progress | Existing strategy and weighted roll-up services | Reused unchanged. Feature counts and allocations are not a progress percentage. |

The slice includes read/list/detail/create/edit and relationship binding flows,
scope/refusal, CSRF, idempotency, compare-and-set (CAS), audit, adapter,
backup/restore and privacy-erasure design. It excludes Workforce and
team/workload metrics, capacity, scheduling, provider/MCP/fleet operations,
global Product Readiness, a new Domain catalog, and implementation of the
planned Requirements, Architecture, API Explorer and Docs & Decisions views.
The workforce lane may proceed independently and must not depend on a Feature
fleet or binding implementation.

## 2. Evidence and reconciliation

The source tree was enumerated at commit
f061a113584aa15db68934dc8451f14b9a1011e1. Inputs are linked here for review:

* [baseline 23](23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md), especially §§4.2 and 5–8;
* [ERD and table dictionary 18](18-DATABASE-TABLES-AND-ERD.md);
* [contract foundation 21](21-CONTRACT-FOUNDATION.md);
* [FR-250 navigation](../../domains/project-manager/features/FR-250-hierarchical-project-navigation.md);
* [FR-251 Domain view](../../domains/project-manager/features/FR-251-project-execution-domains.md);
* the superseded operator QA artifact `phase-b-ux-test-plan.md`, external to
  the repository, SHA-256
  `90D05E9EC3533B76A3350D50218BFAFA570977B4D05884A0ED3132C176A368EA`; and
* the superseded operator QA artifact `phase-b-backend-plan.md`, external to
  the repository, SHA-256
  `1905E77EE6C13D3B4B202BF0BDF9012AE0F650AF6ECC056B61937691934BB7FF`;
* the candidate machine-readable OpenAPI overlay at
  contracts/phase-b/openapi.candidate.json; and
* the backend worker's candidate data-model overlay at
  contracts/phase-b/data-model.candidate.json (backend-owned; codegenReady
  remains false).

The earlier UX packet is retained as a source-audit artifact, but its open
transport, lifecycle, allocation, CSRF and restore questions are superseded by
this composed plan and the phase-b OpenAPI overlay. Workers must use this plan
and overlay as the single candidate input; no implementation may follow both
packets as competing contracts. Baseline 23 remains the historical Phase A
minimum and points forward to this document for the Phase B route, DTO and
record extension.

The machine-readable overlay is a standalone OpenAPI 3.0.3 candidate for the
Phase B routes and schemas. It is documentation input only. OpenAPI validation,
local reference resolution and DTO schema fixtures passed during W0. W1/W2
later supplied isolated migration and persistence evidence. W3 implements the
four selected GET operations with runtime Swagger and scoped read tests; W4/W5
mutation and provenance parity passes local API/provider checks. Code generation is
not claimed. The data-model overlay remains backend-owned and is not duplicated
in this plan.

The following reconciliation is incorporated into this plan:

1. The API, storage and parent ERD use sourceNamespace. The former namespace
   spelling is not retained as a second alias.
2. FeatureView.snapshotId is nullable and pairs with snapshotState. An absent
   provenance source is UNAVAILABLE, never a fabricated UUID or zero.
3. FeatureWorkLink allocation is validated by WorkItem across all active
   Feature links in the Project. A complete split totals 10000 for each one
   WorkItem, not for all WorkItems linked to one Feature. allocationState is
   derived per WorkItem after every read, delete and restore; a delete never
   redistributes shares, and an over-capacity restore is an atomic
   ALLOCATION_RESTORE_CONFLICT.
4. Relationship sets use complete-set replacement commands with one aggregate
   CAS boundary. A failed set leaves the previous set unchanged.
5. The wire response is a direct DTO and the error is the candidate
   code/message/requestId/retryable shape; there is no legacy error wrapper.
6. Generic API CSRF is an Identity-owned contract binding. The
   plugin-consent token is not silently reused for Feature mutations.
7. The selected model has six logical records: four product records
   (ProjectFeature, FeatureContribution, FeatureWorkLink and
   RequirementBinding), immutable GovernanceSnapshot evidence, and technical
   ProjectFeatureMutationReceipt support. The receipt is not a fifth product
   relationship and is required before mutation code.
8. The Feature list separates visibility from lifecycle. The default ACTIVE
   visibility discovers DRAFT, ACTIVE and RETIRED rows, while DELETED is an
   owner-only minimal tombstone view with a signed cursor bound to scope and
   filters.
9. The parent candidate OpenAPI references this overlay for the selected Phase B
   routes and schemas. Both documents have passed structural validation. No
   worker may implement the superseded flat Feature transport in parallel.

The original backend packet was captured at SHA-256
8C343604F75EDCD4AD0A53B34C5FBA9EC457D28BCC3B76DDDDFDA6266CFF2FB8
(source packet last written 2026-09-17T01:22:11+07:00). That digest is historical
provenance; the superseded QA packet digest in the input list includes its later
supersession notice. At the original W0 checkpoint, independent frozen-packet
re-review was incomplete after the verifier reached its usage limit; B1/B2 were
then pending. That historical checkpoint is superseded by the approvals and
per-wave evidence in the current entry record. This plan and its selected
API/data overlays remain the approved implementation inputs.

## 3. Navigation, scope and route contract

The shell remains:

Domain bar → Projects & Work → one selected logical module → module-local
tabs/views → content or action.

The six module rows remain Project Management, Work Management, Delivery
Design, Resource Coordination, Delivery Governance and Agent Delivery. Only
the selected module's local tabs render. Business Delivery Design and the
other planned module surfaces disclose named content without fabricated hrefs.

### 3.1 Existing navigation retained

| Module | Business entry | Project entry | Required behavior |
| --- | --- | --- | --- |
| Project Management | /projects | /projects/{projectId} and /inventory | Project Overview and Inventory retain their current semantics. |
| Work Management | /work | Existing seven Work views under /projects/{projectId}/execution/{mode} and their current route surfaces | Structure Plan remains the default; the seven canonical views and progress strategy remain unchanged. |
| Delivery Design | Planned Business entry with no href | /projects/{projectId}/domain-view | Execution Domains remains the FR-251 read-only surface. Features is activated only after B1 owner approval and B2 registration. |
| Resource Coordination | /files | /projects/{projectId}/team, /files and /repositories | Team, Files and Repositories retain separate meanings. Resources is a planned named capability here, not Team. |
| Delivery Governance | Planned Business entry with no href | Planned Risks, Reviews, Test & Release Evidence and Activity | Disclosure only; no fake route. |
| Agent Delivery | Planned Business entry with no href | Planned Command Center, Agents, Fleets and Workflows | Disclosure only; no fake route. |

The existing eight Business destinations, nine Project section meanings,
fourteen Project route templates and seven Work views remain FR-250
regressions. Requirements belongs to Delivery Design, Risks to Delivery
Governance and Resources to Resource Coordination. There is one PM-owned
Import action at /projects/{projectId}/import, visible from each authorized
live Project module, with the current-page cue and return to
/projects/{projectId}. It is not a Feature tab and is not duplicated.

### 3.2 Feature route and context

The approved candidate Project route is:

    /projects/{projectId}/feature-view

The Delivery Design local tab labelled Features is the only entry. The
Business Delivery Design disclosure remains non-navigable. Feature detail uses
the same route with the concrete query
/projects/{projectId}/feature-view?featureId=UUID and an accessible drawer. The
API detail path does not create a second UI route. Opening and closing the
drawer updates browser history, Project back navigation remains available, and
every load re-runs the scope guard.

Project authorization reuses the existing seam: BusinessShellGuard resolves
the viewer from /api/viewer before AppShell mounts, ScopeContext.projects is
the full authorized Project inventory, and the selected Project is joined to
that inventory. A null direct business owner remains subject to the existing
guard decision; a foreign direct business owner is refused. Scope is never
derived from URL, body, local storage or a new global selector. Every Feature
read and write reruns the Project decision. An explicit All Projects action
clears Project context.

## 4. Proposed persisted authority and ERD

These six logical records were approved through B1 and registered through B2.
No physical table or migration is part of this document.

~~~mermaid
erDiagram
  Project ||--o{ ProjectFeature : owns
  ProjectFeature ||--o{ FeatureContribution : has
  ProjectFeature ||--o{ FeatureWorkLink : links
  WorkItem ||--o{ FeatureWorkLink : receives
  ProjectFeature ||--o{ RequirementBinding : pins
  GovernanceSnapshot ||--o{ RequirementBinding : proves
  Repository ||--o{ GovernanceSnapshot : sources
  GovernanceSnapshot |o..o{ ProjectFeature : canonical_pin
  ProjectFeature |o..o{ ProjectFeatureMutationReceipt : PROJECT_FEATURE
  Project |o..o{ ProjectFeatureMutationReceipt : PROJECT_FEATURE_GRAPH
  GovernanceSnapshot |o..o{ ProjectFeatureMutationReceipt : GOVERNANCE_SNAPSHOT
  AuditEvent ||--o{ ProjectFeatureMutationReceipt : references
~~~

The three dotted receipt relationships are optional, typed logical references,
not three mandatory foreign keys. Exactly one resource branch applies to each
receipt according to `resourceType`; the owner validates its scope and identity.
No universal receipt-to-ProjectFeature foreign key exists. The optional canonical
pin is present only together with the Feature's canonical registry key.

### 4.1 Shared persistence rules

All new records carry server-derived trusted scope, server timestamps,
version >= 1 and nullable deletedAt where the record is mutable. Request JSON
cannot supply tenantId, businessId, actor, version or audit identity. New
records use internal UUIDs. Existing Project, Workstream, WorkContainer,
WorkItem, Repository, AuditEvent and Domain ID authorities are reused. The
aggregate is bounded at 200 non-deleted ProjectFeatures per Project, including
DRAFT, ACTIVE and RETIRED rows; create and restore enforce this limit while
holding the Project lock and return FEATURE_LIMIT_REACHED before any write.
WorkContainer has no deletedAt field and none is invented.

Existing parents do not all carry a physical composite tenant/business key.
The repository resolves the trusted parent scope through the existing PM
authorization chain. Any composite FK or trigger must be explicitly reviewed
per adapter; a logical scope claim is never presented as an existing FK.

### 4.2 Core records

| Record | Fields and invariants |
| --- | --- |
| GovernanceSnapshot | id UUID; tenantId; businessId; createdAt; repositoryId; projectRepositoryId; checkoutBindingId; commitSha; manifestHash as 64 lower-case hex; capturedAt; verifiedAt; verifierId; verifierVersion; proofId; typed verificationProof; validationStatus VALID; non-null sourceManifest. Immutable append-only. Unique businessId, repositoryId, commitSha and manifestHash. Only an in-scope VALID snapshot may prove a RequirementBinding; an invalid verification is refused and creates no snapshot. |
| ProjectFeature | id UUID; trusted tenantId/businessId; projectId; code; title; problem; outcome; exactly one primaryDomainId; lifecycle DRAFT, ACTIVE or RETIRED; createdAt; updatedAt; version; nullable deletedAt; nullable deleteBatchId; optional canonicalFeatureKey and governanceSnapshotId together or both absent. Unconditional unique projectId and code; a deleted code remains reserved and requires restoring the original row. |
| FeatureContribution | id UUID; trusted scope; featureId; domainId; responsibility; timestamps; version; nullable deletedAt; nullable deleteBatchId. Unconditional unique featureId and domainId; re-adding a removed key revives the same UUID and increments version. The primary Domain cannot also be a contribution. |
| FeatureWorkLink | id UUID; trusted scope; featureId; workItemId; nullable allocationBps in 0..10000; timestamps; version; nullable deletedAt; nullable deleteBatchId. Unconditional unique featureId and workItemId; re-adding a removed key revives the same UUID and increments version. WorkItem must be active and resolve through its Workstream to the URL Project and trusted Business. |
| RequirementBinding | id UUID; trusted scope; featureId; governanceSnapshotId; sourceNamespace; requirementKey; immutable revisionHash; acceptanceRef; timestamps; version; nullable deletedAt; nullable deleteBatchId. Unconditional unique featureId, governanceSnapshotId, sourceNamespace and requirementKey; re-adding a removed key revives the same UUID and increments version. Canonical requirement subject is read-only. |
| ProjectFeatureMutationReceipt | Technical support record: id/receiptId; trusted scope; projectId; nullable featureId; principalId; operation; httpMethod; idempotencyKey; normalized payloadHash; targetId and targetType (`PROJECT` for collection/graph/snapshot intent, `FEATURE` for an existing Feature); resourceId and resourceType (`PROJECT_FEATURE`, `PROJECT_FEATURE_GRAPH`, `GOVERNANCE_SNAPSHOT`); nullable version (null for graph/snapshot); etag; auditEventId; status; createdAt. Unique tenantId, businessId, principalId, operation, targetId and idempotencyKey. resourceId is typed by resourceType; there is no universal Feature foreign key. |

The candidate SourceManifest is a bounded object with schemaVersion and up to
1,000 entries. Each entry contains a repository-relative path (no leading
slash or parent traversal) and a lower-case 64-character SHA-256 hash.
commitSha accepts only a lower-case Git SHA of 40 or 64 characters. The
manifest is provenance evidence supplied as capture intent to the
owner-admitted verifier; it does not grant access or become Feature content.
The verifier is server-local Git code selected through an operator-registered
Repository-to-checkout binding. It requires an active ProjectRepository link
for the URL Project and the same Business as the Repository; it never fetches
an arbitrary URL, reads a caller-selected path or executes a caller script.
The persisted snapshot keeps the typed manifest and only a server-verified
VALID result is persisted. The bounded verifier port accepts the Project
intent and returns proofId, verifierId, verifierVersion, verifiedAt,
projectRepositoryId, checkoutBindingId, repositoryId, commitSha, manifestHash
and the typed manifest; a failed or unverifiable result is refused and leaves
no snapshot or receipt.

The optional canonicalFeatureKey is only a reference proven by the
GovernanceSnapshot; this plan does not allocate a new global Feature ID.
Known execution Domain keys reuse the existing FR-070 catalog. An imported
unknown DOM value remains UNMAPPED; no label or permission is guessed. TD
technical owner values remain separate metadata.

### 4.3 Work allocation semantics

FeatureWorkLink is a relationship between one Feature and one WorkItem.
allocationBps describes that WorkItem's share allocated to this Feature.

* In UNALLOCATED mode, each link may omit allocationBps. Present values for
  the same WorkItem across all active Feature links must total at most 10000;
  the remainder is shown as unallocated or overlapping explanation.
* In COMPLETE_SPLIT mode, every active link for each affected WorkItem must
  have a non-null allocationBps and the total for that one WorkItem must be
  exactly 10000. The transaction reads all active links for affected
  WorkItems, including links owned by other Features, before accepting the
  replacement.
* A partial or cross-Feature split never becomes complete merely because the
  links submitted for one Feature total 10000.
* `allocationState` is derived independently for each WorkItem from its active
  links: `UNALLOCATED` means no active link has a value; `PARTIAL` means at
  least one value exists but the complete-split rule is not met; and
  `COMPLETE_SPLIT` means every active link has a value and that WorkItem totals
  exactly 10000. It is never persisted as graph state.
* A Feature delete never redistributes shares. Remaining active links are
  re-evaluated as `PARTIAL` or `UNALLOCATED`. Restore evaluates the matching
  deleted links together with current active links; if any WorkItem would
  exceed 10000, the whole restore refuses atomically with
  `409 ALLOCATION_RESTORE_CONFLICT` and leaves all rows, receipt and audit
  state unchanged.
* Every Feature mutation first locks the existing Project row. A single-Feature
  replacement then locks and validates all links for each affected WorkItem.
  If shares must change across multiple Features in one command, the graph
  replacement route and graph ETag are required; unspecified Features remain
  unchanged but their links for the affected WorkItems are still read and
  validated under the same Project lock.
* The graph ETag is the lower-case SHA-256 of the UTF-8 bytes of this exact
  canonical JSON array (fixed object key order, no whitespace):
  `[{"id":"<uuid>","version":<int>,"deletedAt":"<ISO-8601 instant>"|null},...]`.
  Rows are sorted lexicographically by `(id,version,deletedAt)`; every
  ProjectFeature row is included, including tombstones. The resulting value is
  `"PROJECT_FEATURE_GRAPH/<projectId>/<sha256>"`; no graph-state table exists.
  The existing aggregate GET supplies that graph token in its ETag header to
  Business owners, using all rows in the same scoped read transaction. Shared
  readers receive no graph token. The detail GET supplies the returned
  Feature's strong ETag; these headers add no public DTO fields.
  The graph command's `affectedWorkItemIds` must equal the unique union of
  active links currently owned by its named Feature sets and submitted links:
  every submitted link's WorkItem is included, every listed affected WorkItem
  has a submitted set, and missing or extra IDs refuse before the transaction.
* Project uniqueWorkCount is the distinct active WorkItem UUID set across the
  Project, including unbound WorkItems where the existing view includes them.
  A Feature count is distinct links for that Feature. Shared Work appears in
  each relationship view but counts once in the Project total.
* Feature links never mutate Workstream progress strategy, progressWeight,
  progress evidence or weighted Project roll-up.

## 5. Approved API and DTO contract

The following is the selected transport accepted through B1 owner review and B2
registration. These routes are implemented and verified locally; production
activation remains a separate gate. Each relationship set is explicit and
transactional.

### 5.1 Routes

| Method and path | Request/effect | Response |
| --- | --- | --- |
| GET /api/projects/{projectId}/feature-view | Scope-first aggregate of active, non-deleted ProjectFeatures and active relationship rows | Direct FeatureView DTO. |
| GET /api/projects/{projectId}/features | Stable list ordered by code then id; visibility ACTIVE (default) includes DRAFT, ACTIVE and RETIRED rows while excluding soft-deleted rows; visibility DELETED requires Business-owner restore authority; optional lifecycle filter DRAFT, ACTIVE or RETIRED; limit 1..50 (default 50); signed opaque cursor. | FeatureRecordPage. |
| GET /api/projects/{projectId}/governance-snapshots | Business-owner-only immutable metadata list after full Project hierarchy/read authorization; invalid or foreign scope is redacted 404, an authorized non-owner is 403 CAPABILITY_DENIED before lookup. Limit 1..50, signed cursor, no source manifests. | GovernanceSnapshotPage of owner-safe metadata. |
| POST /api/projects/{projectId}/governance-snapshots | Owner-admitted verified append-only snapshot capture; never implicit in Feature create. Only a server-verified VALID result is persisted. | SnapshotCaptureResult { snapshot, receipt }; 201 new, 200 idempotent replay. |
| POST /api/projects/{projectId}/features | Creates one base ProjectFeature DRAFT; server derives scope and audit identity | 201 MutationReceipt plus strong ETag. |
| GET /api/projects/{projectId}/features/{featureId} | Project then Feature scope check, non-deleted record | FeatureRecord. |
| PATCH /api/projects/{projectId}/features/{featureId} | Replaces editable base fields/lifecycle at expected aggregate version | 200 MutationReceipt plus strong ETag. |
| PUT /api/projects/{projectId}/features/{featureId}/contributions | Complete desired active contribution set; omitted active rows soft-delete | 200 MutationReceipt plus fresh aggregate ETag. |
| PUT /api/projects/{projectId}/features/{featureId}/work-links | Complete desired active WorkItem link set; validate allocations across each affected WorkItem | 200 MutationReceipt plus fresh aggregate ETag. |
| PUT /api/projects/{projectId}/feature-work-links | Complete cross-Feature redistribution for at most 50 named Feature sets and affected WorkItems | 200 MutationReceipt plus graph ETag. |
| PUT /api/projects/{projectId}/features/{featureId}/requirement-bindings | Complete desired pinned requirement set; validate each snapshot and revision | 200 MutationReceipt plus fresh aggregate ETag. |
| DELETE /api/projects/{projectId}/features/{featureId} | Soft-deletes Feature and active child rows in one transaction | 200 MutationReceipt; audit retained. |
| POST /api/projects/{projectId}/features/{featureId}/restore | Restores original scope/Project rows and previous lifecycle if dependencies still resolve | 200 MutationReceipt; audit retained. |

Child PUT commands preserve IDs for unchanged rows, assign server UUIDs to
new rows, and soft-delete omitted active rows with a fresh child-set
deleteBatchId. A failed replacement leaves the entire previous set and parent
version unchanged. Re-adding a removed key revives its original child UUID and
increments its version; unconditional unique keys remain in force. Restore
cannot move a Feature across Project, Business or Tenant. B1/B2 approval and
registration are complete; these route names are the approved contract inputs.

### 5.2 Request DTOs

~~~json
{
  "FeatureCreateInput": {
    "code": "FEAT-LOCAL-001",
    "title": "string",
    "problem": "string",
    "outcome": "string",
    "primaryDomainId": "DOM-CRM",
    "canonicalFeatureKey": null,
    "governanceSnapshotId": null,
    "lifecycle": "DRAFT"
  },
  "FeaturePatchInput": {
    "title": "string",
    "problem": "string",
    "outcome": "string",
    "primaryDomainId": "DOM-CRM",
    "lifecycle": "DRAFT"
  },
  "ContributionsReplaceInput": {
    "contributions": [
      {"domainId": "DOM-COMMERCE", "responsibility": "string"}
    ]
  },
  "WorkLinksReplaceInput": {
    "allocationMode": "UNALLOCATED",
    "links": [
      {"workItemId": "uuid", "allocationBps": null}
    ]
  },
  "FeatureWorkGraphInput": {
    "allocationMode": "COMPLETE_SPLIT",
    "affectedWorkItemIds": ["uuid"],
    "featureSets": [
      {
        "featureId": "uuid",
        "links": [
          {"workItemId": "uuid", "allocationBps": 5000}
        ]
      }
    ]
  },
  "RequirementBindingsReplaceInput": {
    "bindings": [
      {
        "governanceSnapshotId": "uuid",
        "sourceNamespace": "ZAI",
        "requirementKey": "FR-070",
        "revisionHash": "64 lower-case hex characters",
        "acceptanceRef": "docs/..."
      }
    ]
  }
}
~~~

The client never submits trusted scope, actor, version, deletedAt, snapshot
capture data, audit fields or canonical requirement subject. Create and child
set writes may be separate commands because a DRAFT Feature can exist while
its traceability is completed; each command is atomic and failures do not
silently create partial child rows.

The [bound-commit implementation contract](27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md)
defines exact manifest bytes, operator configuration and canonical key/revision
proof through the existing verifier port. It adds no persisted proof fields.

The snapshot capture command accepts repositoryId, commitSha, manifestHash and
sourceManifest as intent only. Identity CSRF and scoped idempotency are
required, but If-Match is not required because capture is append-only. The
server-local verifier then resolves the operator-registered checkout binding,
the active same-Business Repository and the active ProjectRepository link for
the URL Project, and proves the typed manifest and commit. Only a verified
`VALID` result is persisted with its proof and the route returns
`SnapshotCaptureResult {snapshot, receipt}` (`201` new, `200` replay). An
invalid or unverifiable result is refused before insert; it never creates an
`INVALID` snapshot or receipt. Feature create never calls this authority.

### 5.3 Response DTOs

~~~json
{
  "FeatureView": {
    "schemaVersion": "1.0",
    "projectId": "uuid",
    "snapshotId": null,
    "snapshotState": "UNAVAILABLE",
    "observedAt": "server ISO timestamp",
    "uniqueWorkCount": 0,
    "features": [
      {
        "id": "uuid",
        "version": 1,
        "code": "FEAT-LOCAL-001",
        "title": "string",
        "problem": "string",
        "outcome": "string",
        "primaryDomain": {
          "domainId": "DOM-CRM",
          "label": "Customer",
          "mappingState": "MAPPED"
        },
        "contributions": [],
        "workLinks": [],
        "requirementBindings": [],
        "canonicalFeatureKey": null,
        "governanceSnapshotId": null,
        "lifecycle": "DRAFT",
        "uniqueWorkCount": 0,
        "evidence": [],
        "evidenceState": "UNAVAILABLE"
      }
    ]
  }
}
~~~

In Phase B the aggregate FeatureView always returns `snapshotId: null` and
`snapshotState: UNAVAILABLE`; there is no project-wide aggregate snapshot
publisher. Per-Feature and RequirementBinding snapshot references are the only
evidence authority and must retain their exact IDs and states.

FeatureRecord uses the same base fields plus:

* contribution id/version/domainId/label/mappingState/responsibility;
* work link id/version/workItemId, optional allocationBps, allocationState
  (UNALLOCATED, PARTIAL or COMPLETE_SPLIT), and only the minimal authorized
  WorkItem code/title projection; no WorkContainer deletion field is invented;
  and
* requirement binding id/version/governanceSnapshotId/sourceNamespace/
  requirementKey/revisionHash/acceptanceRef/bindingState, where bindingState
  is PINNED or UNAVAILABLE.

An absent snapshot is snapshotId null with snapshotState UNAVAILABLE. An empty
array means the authority was available and had no rows; unavailable evidence
is represented explicitly. There is no Feature-specific percentage. The
aggregate refuses with 413 FEATURE_VIEW_LIMIT_EXCEEDED rather than returning a
misleading partial result when it exceeds its 200-row bound. Create and
restore also refuse with `422 FEATURE_LIMIT_REACHED` when the Project already
has 200 non-deleted Features; no response path truncates that set.

### 5.4 Receipt, headers and error contract

Successful mutations return a durable MutationReceipt containing receiptId,
`targetId`, `targetType`, `operation`, `httpMethod`, `resourceId`,
`resourceType`, status, nullable version, `etag`, recordedAt, auditRef and
requestId. `targetType` is `PROJECT` or `FEATURE`: create, graph and snapshot
capture intent target the Project UUID; update, child-set replacement, delete
and restore target the Feature UUID. `resourceType` is `PROJECT_FEATURE`,
`PROJECT_FEATURE_GRAPH` or `GOVERNANCE_SNAPSHOT` and guards the polymorphic
resourceId; version is required for a Feature and strictly null for graph or
snapshot receipts. The durable key is
`(tenantId,businessId,principalId,operation,targetId,idempotencyKey)`, so a
Feature, graph and snapshot command cannot collide. There is no universal
Feature foreign key. The response has a strong ETag:

    "PROJECT_FEATURE/<featureId>/v<version>"

Cross-Feature redistribution uses:

    "PROJECT_FEATURE_GRAPH/<projectId>/<sha256>"

The graph digest is the exact canonical JSON SHA-256 described in §4.3,
including every ProjectFeature tombstone, and is rechecked inside the
Project-lock allocation transaction. The same WorkItem is the unit whose
active FeatureWorkLink allocations must total at most 10000 in UNALLOCATED
mode or exactly 10000 in COMPLETE_SPLIT mode. A graph receipt targets the
Project; a snapshot receipt targets the Project intent and returns the same
durable snapshot/receipt envelope on replay.

X-Request-ID equals the body requestId on success and refusal. A replay returns
the same receiptId, resource effect, version, auditRef and ETag with a fresh
request correlation ID; receipt `status` remains `COMMITTED` rather than
becoming a second replay state.

If-Match is required for PATCH, child PUT, DELETE and restore. Missing is 428
PRECONDITION_REQUIRED. A stale value is 412 VERSION_MISMATCH with only the
current version and current ETag. Idempotency-Key is required for every
mutation, is 8–128 characters, and is scoped to method/path, trusted
tenant/business, principal and target. The same scoped key and normalized
payload hash replays; a changed hash returns 409 IDEMPOTENCY_KEY_REUSED.

The receipt discriminator is fixed by route: `CREATE_FEATURE` is `POST` with
targetType `PROJECT` and resourceType `PROJECT_FEATURE`; `UPDATE_FEATURE` is
`PATCH` with targetType `FEATURE` and resourceType `PROJECT_FEATURE`; the
three child replacements are `PUT` with targetType `FEATURE` and the same
resourceType; `REPLACE_FEATURE_WORK_GRAPH` is `PUT` with targetType `PROJECT`
and resourceType `PROJECT_FEATURE_GRAPH`; `DELETE_FEATURE` is `DELETE` and
`RESTORE_FEATURE` is `POST`, both targeting a Feature and
`PROJECT_FEATURE`; and `CAPTURE_GOVERNANCE_SNAPSHOT` is `POST` targeting the
Project intent with resourceType `GOVERNANCE_SNAPSHOT`. The graph and snapshot
receipts use strictly null version; all Feature receipts use an integer
version. These mappings are enforced by the overlay's receipt `oneOf`, not
only by prose.

The refusal body is:

~~~json
{
  "code": "RESOURCE_NOT_FOUND",
  "message": "Resource not found.",
  "requestId": "uuid",
  "retryable": false
}
~~~

Required status families are:

Validation responses may include a bounded `fields` array of
`{path, code, message}` entries. Paths are request-field paths, messages are
redacted user-safe text, and the array is absent when there is no field-level
detail; it is never a map with server-only keys. This preserves the parent PM
error contract while keeping hierarchy and source details undisclosed.

| Status | Stable codes and disclosure |
| --- | --- |
| 400 | MALFORMED_REQUEST or INVALID_CURSOR; no database details. |
| 401 | AUTH_REQUIRED; no session or invalid/revoked/expired session. |
| 403 | CSRF_INVALID or CAPABILITY_DENIED; no internal scope detail. |
| 404 | RESOURCE_NOT_FOUND for missing, deleted, foreign, invalid-hierarchy or cross-scope target; same redacted message for each case. |
| 409 | IDEMPOTENCY_KEY_REUSED, DUPLICATE_FEATURE_CODE, DELETED_FEATURE_CODE_REQUIRES_RESTORE, ALLOCATION_RESTORE_CONFLICT or child-set uniqueness conflict. |
| 412 | VERSION_MISMATCH with currentVersion/currentEtag only. |
| 422 | DOMAIN_ID_UNRECOGNIZED, PRIMARY_DOMAIN_DUPLICATE, CROSS_PROJECT_WORK_LINK, INVALID_ALLOCATION, FEATURE_LIMIT_REACHED, SNAPSHOT_REQUIRED, SNAPSHOT_INVALID, REQUIREMENT_REVISION_MISMATCH or INVALID_LIFECYCLE. |
| 428 | PRECONDITION_REQUIRED when If-Match is absent on an existing target mutation. |
| 413 | FEATURE_VIEW_LIMIT_EXCEEDED when the unpaged aggregate exceeds 200 Features; no partial aggregate is returned. |
| 503 | SESSION_UNAVAILABLE or DATA_INTEGRITY_UNAVAILABLE; no raw database error. |

## 6. Authorization, transaction and CAS sequence

### 6.1 Read sequence

~~~mermaid
sequenceDiagram
  participant U as Browser
  participant R as PM route
  participant I as Identity viewer
  participant A as Project authorization
  participant M as Feature read model
  participant D as PM repositories
  U->>R: GET projectId/feature-view
  R->>I: resolveRequestViewer
  I-->>R: viewer or 401/503
  R->>A: assertProjectRoadmapReadable(projectId, viewer)
  A-->>R: trusted Project scope or redacted 404
  R->>M: compose FeatureView(projectId, trusted scope)
  M->>D: read ProjectFeature and active children
  D-->>M: scoped records and WorkItem joins
  M-->>R: direct DTO with dedup and evidence state
  R-->>U: 200 FeatureView or redacted refusal
~~~

Scope is resolved before Feature, child, WorkItem, snapshot or aggregate
reads. GET does not write an AuditEvent, progress cache, receipt or grant.
The read model uses the full authorized Project inventory and does not filter
out a null-owner Project merely because a narrower projection omitted it.

### 6.2 Mutation sequence

~~~mermaid
sequenceDiagram
  participant U as Browser
  participant R as PM route
  participant I as Identity and CSRF
  participant A as Project authorization
  participant T as PM transaction
  participant Q as Mutation receipt
  participant V as AuditEvent
  U->>R: mutation + If-Match + Idempotency-Key + X-CSRF-Token
  R->>I: resolve viewer, verify session-bound CSRF and Origin
  I-->>R: viewer or refusal
  R->>A: resolve full Project/Workspace/Business/Tenant scope
  A->>A: assertProjectWritable(projectId, viewer)
  A-->>R: trusted Project scope or redacted 404/403
  R->>T: begin transaction
  R->>T: acquire existing Project row lock
  R->>Q: lookup scoped key and normalized hash
  Q-->>R: replay receipt, conflict, or no prior effect
  R->>T: re-read target, children and sources
  T->>T: recheck hierarchy and lock Features/tombstones/affected links
  T->>T: CAS parent/graph ETag and validate same Project, snapshots and allocation
  T->>T: write rows, aggregate version, receipt and one AuditEvent
  T-->>R: committed receipt and ETag
  R-->>U: receipt, then browser re-reads fresh DTO
~~~

The exact operation is:

1. Generate a request UUID and resolve live zuri_session. Cookie labels do
   not provide authority.
2. For a mutation, Identity calls `assertApiWriteCsrfToken` for the token
   issued by `issueApiWriteCsrfToken`. The token has audience
   `zuri_api_write.v1`, uses HMAC-SHA256 with the existing
   `requireSessionSecret`, carries a digest of the `zuri_session` cookie plus
   `issuedAt`/`expiresAt`, and expires at the earlier of 15 minutes or live
   session expiry. Verification compares the digest constant-time, rejects
   future-issued, expired, revoked/rotated-session and plugin-consent tokens,
   and permits reuse only within that live-session TTL; Idempotency-Key still
   prevents duplicate effects. Every mutation also requires `Origin` exactly
   equal to the explicitly configured `PUBLIC_BASE_URL` origin. There is no
   Host or proxy-header fallback: missing/null/cross-origin Origin is
   `403 CSRF_INVALID`, while missing/invalid origin or secret configuration is
   `503 SESSION_UNAVAILABLE`. The authenticated CSRF GET is `no-store`, sends
   no CORS token, and the client keeps the response token in memory only. An
    absent Origin on this issuer GET is allowed only when `Sec-Fetch-Site: same-origin` or a
   same-origin Referer proves the request; otherwise the explicit Origin is
   required.
3. Resolve the URL Project and the complete Project -> Workspace -> Business ->
   Tenant hierarchy before any Feature, child, WorkItem, snapshot, aggregate
   or receipt lookup. Reads use the existing
   `assertProjectRoadmapReadable` seam. Writes use the existing
   `assertProjectWritable` Business mutation authority after the hierarchy
   check; shared visibility does not grant mutation. A body-supplied scope
   never repairs a mismatch. Missing/foreign/invalid hierarchy uses the same
   redacted 404; store/session failure uses the stable 503 family.
4. Normalize the command only after session, CSRF and scope checks. Look up
   the scoped receipt; same hash replays and changed hash refuses. The receipt
   key includes method/path operation, trusted scope, principal and explicit
   target.
5. In one transaction, re-read Project, Feature, all affected child rows,
   snapshots, WorkItems and Workstreams and repeat the complete hierarchy
   check. Lock the existing Project row first, then all ProjectFeature rows
   including tombstones and all FeatureWorkLink rows for every affected
   WorkItem, in deterministic order. Recheck active/deleted state, scope,
   same Project, primary/contribution uniqueness, snapshot validity, revision
   hash, lifecycle, the 200-feature limit and the WorkItem-grouped allocation
   rule. Compare the parent ETag. A graph command additionally checks its
   exact graph ETag, requires `affectedWorkItemIds` to equal the union of old
   active and submitted links for its named Feature sets, and validates every
   affected WorkItem's cross-Feature total, including links from unlisted
   Features. The single-Feature route uses the same Project lock, so an
   unlisted Feature cannot race it.
6. Write base or complete child set, increment the ProjectFeature aggregate
   version once, increment changed child versions, append one AuditEvent and
   record the receipt in the same transaction.
7. Return the receipt and ETag. The browser re-reads; it does not infer
   server state from a 2xx response body alone.

SQLite uses the existing repository transaction boundary and foreign keys,
with BEGIN IMMEDIATE where the adapter requires a write lock. PostgreSQL uses
a serializable transaction and bounded serialization/deadlock retry. A race
returns deterministic idempotent replay or 412; it never creates duplicate
child rows. A COMPLETE_SPLIT command is valid only when each affected
WorkItem's links across Features sum to 10000; cross-Feature redistribution
uses the graph command in one transaction. Delete leaves remaining links with
derived PARTIAL/UNALLOCATED state, and restore refuses atomically with
`ALLOCATION_RESTORE_CONFLICT` if any affected WorkItem would overflow.
Adapter tests must prove the single-Feature versus unlisted-Feature race and
the graph path under both adapters.

## 7. UX wireframe and state model

### 7.1 Project Feature list

The page layout is:

    Project breadcrumb / current Project / Import action
    Delivery Design local tabs: Execution Domains | Features
    Feature heading / observed timestamp / snapshot state
    Lifecycle filter (visibility and lifecycle are separate; free-text search
    is outside this selected candidate contract)
    Feature list or table
      code | title/outcome | lifecycle | primary Domain
      contributing Domains | requirements/evidence | unique Work
    Empty, unavailable, error or pagination state

The list shows only ProjectFeature authority and its explicit relationship
records. A row opens the selected detail presentation. Domain totals,
Workstream progress, Product readiness and missing evidence are not substituted
for Feature fields.

### 7.2 Detail, create and edit

Detail reading order is Project/code/title/lifecycle/version, then
problem/outcome/acceptance, primary and contributing Domain responsibilities,
WorkItem links and allocation explanation, requirement bindings and snapshot
evidence, audit/readiness status, and available actions. Planned
Requirements, Architecture, API Explorer and Docs & Decisions show a named
plain-language explanation without an application href.

Create starts with Project scope already resolved. The form collects code,
title, problem, outcome and primary Domain, then the approved relationship
sets. It never exposes tenant/business/project scope or authority inputs.
Validation precedes a review summary and one CSRF/idempotency-protected
mutation. A successful create returns a receipt, then the UI re-reads.

Edit sends the expected version and the approved partial base fields. A
duplicate code, invalid lifecycle, missing snapshot, stale version or binding
error leaves nonsecret local values visible and gives reload/current-version
choice. There is no silent last-write-wins. The candidate lifecycle is monotonic
DRAFT → ACTIVE → RETIRED; unchanged lifecycle is allowed during an edit.
RETIRED remains readable and allows authorized metadata/relationship edits,
soft delete and restore under the same CAS rules. It cannot transition back to
ACTIVE or DRAFT. Restore preserves the prior lifecycle, including RETIRED.
This complete policy is included in the B1 approval scope.

### 7.3 Relationship editors

* Domain picker accepts canonical authorized execution Domain IDs. One
  primary is required; supporting responsibilities are separate rows.
  Duplicate primary/supporting pairs and cross-scope IDs refuse. Unknown
  imported IDs display UNMAPPED and are not selectable for a new human binding
  until an import authority exists.
* Work picker accepts active same-Project WorkItems. Allocation entry explains
  that basis points split one WorkItem across Features. It shows the
  affected WorkItem's total and unallocated remainder after the server
  re-reads the complete Project set.
* Requirement picker records the GovernanceSnapshot, sourceNamespace, key,
  immutable revision hash and acceptance reference. The canonical subject is
  read-only. Missing or changed evidence blocks a readiness claim and shows
  UNAVAILABLE.

Each relationship editor submits the complete desired set under its own
aggregate ETag. Remove/replace is a reviewed mutation, not a hidden client
filter. A failed replacement leaves the previous set unchanged.

### 7.4 State matrix

| State | UI behavior | Contract/safety rule |
| --- | --- | --- |
| Loading | Skeleton for current Project context and list/detail; no old Project rows | Response identity must match the current projectId. |
| Ready | Render supplied fields, version, observedAt and evidence state | Scope precedes aggregate and child reads. |
| Empty | Explain no Features in this Project; offer Create when authorized | Empty differs from unavailable and is not evidence of readiness. |
| Filtered empty | Show active filter and clear-filter action | Unsupported server filters are not exposed. |
| UNKNOWN / UNMAPPED | Preserve stable Domain ID and explain catalog mapping is missing | Never guess a label or create a Domain. |
| UNAVAILABLE | Explain missing snapshot, evidence, contract or source; use null/unknown values | Never render zero, ready, approved or deployed from absence. |
| 401 / 403 / 404 | Re-authentication or generic refusal/not-found state | No Feature names, counts, IDs or stale payload leak. |
| 409 / 412 | Duplicate/idempotency/version conflict with reload or current-version choice | No silent overwrite or false receipt. |
| 422 | Field-level error summary and focused field | No partial mutation. |
| 410 / 429 / 503 / network | Retry/reload guidance; reconciliation for unknown mutation result | No blind write retry. |
| Project switch or wrong-project DTO | Clear old state; show new result or request-failed/incomplete | Wrong DTO never becomes perpetual Loading or exposes counters. |

## 8. Migration, restore, privacy and rollback

No schema or migration is authorized by this packet. After B2 registration, one data worker
must update both SQLite and Postgres adapters with additive records, indexes,
checks and reviewed scope constraints. Existing Project/Workstream fields are
not renamed or weakened. PostgreSQL must use explicit reviewed grants,
ENABLE/FORCE ROW LEVEL SECURITY and exact runtime predicates; no generic RLS
function is assumed. SQLite must use scoped repositories, foreign keys and
CAS transaction tests.

W1's first deliverable is an exact policy/adapter contract, before any Phase B
DDL or adapter activation. It must name the trusted transaction-local scope
inputs and setter after hierarchy/viewer authorization, missing-context denial,
Tenant/Business/Project/WorkItem joins, INSERT/UPDATE checks, allowed runtime
roles, forced RLS/revokes, append-only evidence privileges and executable
negative cross-scope/context-reset cases. The independent Luna Max verifier and
root must approve that artifact before W1 proceeds. Role-only USING (true) or
WITH CHECK (true) policies cannot satisfy it. This database gate does not block
Identity P2 once the corrected overall contract entry review passes.

Production write dependency: before any Phase B production write or migration,
the composed release must close the approved least-privilege runtime
credential/real-role isolation gate. A preflight catalog check or a bypass-RLS
runtime role is not proof of that gate. The carry-forward finding is recorded
in [the runtime-role RCA](../../../.brain/rca/2026-09-17-pm-release-runtime-role-carry-forward.md);
this plan proposes no remediation code or credential change.

The migration gate must prove:

* UUID and digest formats, lifecycle and allocation checks;
* unconditional uniqueness for ProjectFeature code, contribution pairs,
  WorkItem links and requirement bindings, including tombstones, plus the
  200 non-deleted-Feature Project capacity;
* same-Project WorkItem integrity through the PM service transaction and any
  reviewed composite constraint/trigger; and
* effective runtime-role reads/writes fail closed across Tenant and Business
  boundaries.

Backup and restore are additive family work, not a reason to weaken legacy
snapshots:

Approved [decision26](26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md) selects
offline recovery into a completely verified empty target. Ordinary web restore
refuses before every delete when Phase B rows are present, incoming or globally
unverifiable; its generic loops always skip the six tables. A separate read-only
protected export supplies complete artifacts using process-only maintenance
credentials. Runtime snapshot/receipt grants remain append-only. The order
below applies to the offline insert transaction; it never grants ordinary
runtime replacement power. The command and exact schema/digest/visibility
contract are decision26's implementation authority.

1. Restore GovernanceSnapshot after Tenant, Business, Workspace, Project,
   Repository and ProjectRepository. Validate the immutable ProjectRepository
   reference against its Project/Workspace/Business/Tenant chain and the
   same-Business Repository before inserting evidence; refuse mismatches.
2. Restore ProjectFeature after Project and referenced snapshot.
3. Restore FeatureContribution after ProjectFeature.
4. Restore FeatureWorkLink after ProjectFeature and WorkItem.
5. Restore RequirementBinding after ProjectFeature and GovernanceSnapshot.
6. Restore ProjectFeatureMutationReceipt only after resource and AuditEvent
   references are valid; preserve existing AuditEvent append-only order. The
   receipt is the sixth logical record in this candidate, alongside the four
   product records and GovernanceSnapshot.

Preview and commit validate every present protected family before deletion or
insert. A missing family is distinct from a malformed family. A missing family
is accepted only for a proven legacy snapshot whose corresponding row count is
zero; it is never silently treated as an empty array. Validate scope chains,
active parents, same-Project WorkItems, immutable IDs, versions, hashes and
references before commit. Invalid or partial restore leaves protected rows and
unrelated data unchanged.

Soft delete marks the Feature and only its currently active relationship rows
with one server-generated `deleteBatchId` and one command `deletedAt`, while
retaining IDs, versions and audit history. A child-set replacement creates its
own batch for omitted active children; those rows are never accidentally
restored by a later Feature restore. Re-adding a key revives the existing UUID
and increments its version. The unconditional Feature code key means a new
row with a deleted code returns `409 DELETED_FEATURE_CODE_REQUIRES_RESTORE`;
the original row must be restored. Restore matches the Feature batch exactly,
rechecks the full scope and Project hierarchy, and restores only children that
are still deleted with that batch. It recomputes allocationState per affected
WorkItem without redistribution; any post-restore total above 10000 returns
`409 ALLOCATION_RESTORE_CONFLICT` and leaves the complete transaction
unchanged. Privacy erasure follows approved decision26's reviewed field-target
manifest and Identity-owned atomic transaction. Only explicitly reviewed fields
are replaced with `[erased]`; actor/author inference is forbidden. Unmapped or
unreviewed text remains explicitly UNMAPPED/PENDING. Immutable relationship
identity, revision hash and audit evidence are retained. Rollback disables Feature
read/writer admission or its flag and retains additive evidence; it does not
drop tables or delete historical rows.

## 9. Worker waves, file boundaries and DAG

### 9.1 Waves

The labels B1 and B2 below retain the baseline meanings: B1 is owner approval
of the candidate design, and B2 is root registration of only the approved
canonical subjects. They are approval gates, not worker-wave names. Worker
waves use W0-W7 so a wave cannot be mistaken for either gate.

| Wave | Dependency | Owner and disjoint boundary | Deliverable | Gate |
| --- | --- | --- | --- | --- |
| W0 | Source audit and this candidate plan | Root plus PM/Identity owners; docs/contract composition only | Freeze six logical records (four product records, GovernanceSnapshot and receipt support), sourceNamespace, nullable aggregate snapshot state, child-set transport, lifecycle, receipt and error/CSRF contract | B1 owner-approval request; no code. |
| W1 | B2 registration, after B1 approval | One data worker; Prisma adapters and one additive migration only | Schema parity, checks/indexes/FKs, RLS/grants, rollback and dry-run evidence | Root migration/RLS/restore approval. |
| W2 | W1 | One PM persistence worker; repository and backup/import seams | Scoped ports, transaction, family validation, restore order, privacy erasure | Restore and legacy compatibility evidence. |
| W3 | W1 + W2 and frozen DTO fixtures | PM read worker and UI worker on disjoint files | Read model/routes and Feature list/detail shell; no mutation UI | Direct DTO, scope-first, dedup and state tests. |
| W4 | W2 plus Identity binding | PM mutation worker | Base Feature and complete child-set writers, soft delete/restore, CAS, idempotency, audit | No-partial-write, race, CSRF and replay tests. |
| W5 | W4 | UI worker and backend verifier on disjoint files | Create/edit/binding forms, work allocation explanation, requirement evidence and planned disclosures | A11y/mobile and contract parity. |
| W6 | W5 | Independent verifier | Cross-scope, unknown/unmapped, dedup, snapshot, restore, privacy and browser evidence | Verifier PASS/FAIL packet. |
| W7 | W6 | Root integrator | Compose canonical docs/IDs/generated views and run local/hosted gates | Governance, tests, build, e2e and release decisions. |

The four-slot operating model is root integrator, at most two implementation
workers (backend and UI), and one independent verifier. Before B1/B2, W0 is
documentation-only. After B2, W1/W2 remain serial where their persistence
interfaces require it; W3 may run a read worker and UI worker in parallel only
against frozen DTO fixtures and disjoint files. W6 consumes immutable packets
and occupies the verifier slot; no third implementation worker is added while
it is active. After the verifier is idle, root may compose W7 and, if separately
approved, resume two or three disjoint workers with explicit allowlists.
ProjectTabs, navigation.js, OpenAPI/data model, shared Identity CSRF,
schema/migration and generated governance outputs are serial bottlenecks. The
backend packet's older B0-B5 labels are superseded for scheduling by this
W0-W7 DAG; B1 and B2 retain approval/registration meanings only. No worker
edits another worker's allowlist. Workforce remains an independent priority
lane and does not require this Feature DAG to staff people.

### 9.2 Future file allowlists

These are proposed post-approval boundaries, not files changed by this
document:

* UI/navigation: ProjectFeatureView.jsx, ProjectFeatureForms.jsx and
  ProjectFeaturePickers.jsx; their focused unit/browser tests; the feature-view
  page; and only the
  narrow navigation.js, ProjectTabs.jsx or Project layout seam needed to
  activate Features while preserving FR-250.
* PM backend: project-feature-read-model.js, project-feature-service.js, the
  feature-view/features/detail/relationship-set/delete/restore route seams,
  the project-level `apps/server/src/app/api/projects/[id]/feature-work-links/route.js`
  graph route, its graph DTO/ETag implementation, and focused PM tests
  including `tests/integration/project-feature-graph.test.js`.
* PM data: schema.prisma, schema.postgres.prisma and one reviewed additive
  migration only in W1.
* Reused authority: existing project authorization, WorkItem/read services,
  AuditEvent, Identity viewer/CSRF port, database adapter, progress services
  and backup/import seams.
* Root-owned: canonical PRD/FEATURES/ADR/FR rows, API/data-model source
  composition, ID ledger, generated graphs, governance, integration and
  release files.

No Domain group, grant, ScopeContext, Workforce, agent, provider, MCP,
generated inventory or production configuration is in the Feature allowlist.

## 10. Test and acceptance mapping

The cases below define the approved acceptance mapping; execution results are
recorded in the current entry record and integration report. Existing FR-250
navigation, FR-251 Domain view,
authorization, Import, Work and progress tests remain regression gates.

| Case | Required assertion | Proposed proof |
| --- | --- | --- |
| Six-module navigation | Exactly six sidebar modules; only selected module tabs render; planned Business entries have no href; Features appears only after approval | Existing navigation unit/E2E plus proposed Feature route assertion. |
| Existing reachability | Eight Business destinations, nine Project section meanings, fourteen Project routes and seven Work views remain reachable; Import is one action; Structure is default | Existing FR-250 navigation and route-reachability suites. |
| Project scope first | Viewer/session, selected Business and full scope.projects resolve before Feature/child aggregation | project-feature-view integration and existing guard fixtures. |
| Direct DTO | UI renders direct FeatureView, nullable snapshot and supplied evidence states; no invented envelope | API contract and browser fixture. |
| Machine contract closure | OpenAPI 3.0.3 resolves every Phase B path/schema reference; create and response snapshot pairs reject mixed null/non-null values; source manifests accept only bounded relative paths and lower-case digests; command arrays respect their bounds; every live-session route declares its 503 refusal family | Root Swagger/Ajv contract validation before B1/B2 final gate. |
| Domain versus Feature | Domain rows remain FR-251 projection; Feature rows come only from ProjectFeature/binding records | Read-model unit and browser assertion. |
| List/detail mapping | Code/title/problem/outcome/lifecycle/version, Domain roles, Work links, requirement pins and evidence render in approved sections | Feature view E2E and DTO contract test. |
| Empty and stale transition | Empty is distinct from unavailable; Project switch clears old rows; wrong-project completed DTO shows request-failed, no counters, not perpetual Loading | Feature view unit/browser test. |
| Valid create | Authorized DRAFT creation commits one base row and receipt, then fresh read shows the Feature | Service/integration/browser test. |
| Invalid base/bindings | Duplicate code, deleted-code re-add without restore, missing primary, duplicate contribution, cross-project WorkItem, out-of-range allocation, missing/invalid snapshot/hash and CSRF fail before partial write | Mutation integration tests. |
| Feature capacity | Create and restore refuse atomically at 201 non-deleted Features with `422 FEATURE_LIMIT_REACHED`; the aggregate never truncates and the deleted tombstone page remains paginated | Project-lock service/contract test. |
| Same-WorkItem allocation | Links for one WorkItem across multiple Features total at most 10000 in UNALLOCATED or exactly 10000 in COMPLETE_SPLIT; unrelated WorkItems are not included in that sum. allocationState is derived as UNALLOCATED, PARTIAL or COMPLETE_SPLIT; delete does not redistribute and restore overflow is `409 ALLOCATION_RESTORE_CONFLICT` with no changes | Work-link service test with at least two Features and two WorkItems, delete/restore fixtures. |
| Graph membership/race | Graph `affectedWorkItemIds` equals the union of old active and submitted links for named Feature sets; duplicate Feature keys, missing/extra IDs and an unlisted Feature writer are rejected or serialized under the same Project lock. The ETag hashes all Feature rows including tombstones using the defined canonical bytes | Project-feature-graph integration/concurrency test. |
| Project dedup/progress | Shared WorkItem appears in each Feature but once in Project uniqueWorkCount; Workstream weighted progress is unchanged | Read-model integration test and progress regression. |
| CAS/idempotency | Same scoped hash replays one receipt/audit/effect; changed hash is 409; stale If-Match is 412; missing is 428. Feature, graph and snapshot receipts carry distinct typed targets/resources and graph/snapshot versions are null | Mutation concurrency integration test. |
| Requirement integrity | Canonical subject is read-only; changed revision hash, absent snapshot or invalid snapshot yields UNAVAILABLE/refusal | Requirement binding contract/service test. |
| Refusal/no leak | Missing, foreign, deleted, invalid hierarchy, session, Business change and grant cases use existing redacted 401/403/404 behavior | Guard suite plus Feature route tests. |
| Complete-set atomicity | Child replacement validates every affected WorkItem and snapshot first; failure preserves all old links, rows, receipts and audit state | Mutation integration test. |
| Snapshot provenance | Caller metadata is intent only; only the server-local verifier bound to the same-Business Repository and ProjectRepository checkout can persist a `VALID` snapshot with typed manifest/proof. Invalid/unverifiable capture creates no snapshot or receipt; replay returns `SnapshotCaptureResult` | Governance verifier integration/contract test. |
| Restore/privacy | Malformed or missing protected families refuse; valid dependency order preserves IDs/versions/hashes/audits; deleteBatch cohorts and protected receipt/snapshot families survive refusal; privacy erasure is audited | Backup/restore integration test. |
| A11y/mobile | Semantic list/table, labels, fieldsets, focus summary, Escape restoration, Back/history, planned disclosures and 390px no-overflow pass | Proposed project-feature-view.spec.js plus FR-250 browser proof. |

## 11. Approval and final-gate checklist

### B1 owner approval scope — completed

* the six logical records: four product records (ProjectFeature,
  FeatureContribution, FeatureWorkLink and RequirementBinding), immutable
  GovernanceSnapshot evidence and scoped mutation receipt support, including
  their fields, uniqueness and scope rules;
* direct FeatureView/FeatureRecord DTOs, nullable snapshot semantics,
  sourceNamespace, lifecycle, deletedAt and canonical key/snapshot pairing;
* the typed SourceManifest input/output boundary, 40/64-character lower-case
  commit SHA rule, operator-registered same-Business checkout verifier,
  server-produced VALID proof, separate snapshot list metadata, and bounded
  command arrays;
* the chosen complete-set child PUT and project graph routes, WorkItem-grouped
  allocation behavior, derived allocationState, delete/restore conflict and
  exact graph ETag/lock membership;
* the generic Identity API CSRF issuer/verifier (`issueApiWriteCsrfToken` /
  `assertApiWriteCsrfToken`), `zuri_api_write.v1` audience, live-session
  binding, exact configured-origin check and client delivery path;
* Project read versus Business mutation authority, redacted error/header
  behavior, If-Match/ETag and scoped idempotency;
* GovernanceSnapshot producer, VALID-only persistence, immutable verifier
  provenance, SnapshotCaptureResult replay semantics and requirement
  revision-hash semantics;
* adapter, migration/RLS, backup/restore and privacy-erasure boundaries; and
* the selected /feature-view?featureId=UUID accessible drawer behavior and the
  lifecycle transition policy.

### B2/root final gates

After B1 owner approval and B2 registration, root pins the approved canonical
baseline. The composed implementation then requires:

1. OpenAPI/data-model/runtime route parity for the selected design;
2. SQLite and Postgres schema/RLS/grant/transaction evidence;
3. scope-first, no-leak, CSRF, CAS, idempotency, audit and race tests;
4. WorkItem-grouped allocation, shared-work dedup and unchanged progress
   proof;
5. malformed/missing protected-family restore and privacy evidence;
6. Feature/Domain navigation, direct DTO, empty/loading/unknown/unavailable,
   keyboard and mobile browser evidence;
7. independent verifier review of immutable worker packets; and
8. root-owned governance, focused/full tests, build, e2e and any separately
   authorized release gate.

Historical W0 evidence was limited to documentation/schema/diagram validation,
and that proposal's independent re-review was interrupted by a model usage
limit. Those historical NOT_RUN labels do not describe the current approved
implementation. Current independent source, isolated migration/provider and
local runtime results are recorded above and in the integration report. Hosted
CI and production activation remain separate gates; other releases are outside
this document.

## 12. Explicit reconciliation list for root

1. Use this plan's WorkItem-grouped allocation rule when composing the final
   backend packet; do not sum Bps for unrelated WorkItems under one Feature.
   Derive allocationState per WorkItem, never redistribute on delete, and
   refuse restore overflow atomically with ALLOCATION_RESTORE_CONFLICT.
2. Keep sourceNamespace as the single API/storage spelling.
3. Make FeatureView.snapshotId always nullable `null` with
   snapshotState `UNAVAILABLE` in Phase B; per-Feature/RequirementBinding
   references remain the evidence authority.
4. Keep the direct DTO and exact candidate error/header contract aligned across
   OpenAPI, route implementation and browser fixtures, including bounded
   `fields[]` entries `{path,code,message}` and 503 on every live-session
   route.
5. Treat the nested complete-set relationship routes and project-level graph
   route as one approved design under the completed B1/B2 gates. The graph ETag must
   hash all ProjectFeature rows including tombstones, lock the Project first,
   validate unlisted Feature links and require exact affected-WorkItem
   membership; do not mix this with flat contributingDomainIds or
   requirementRefs.
6. Keep the six-record contract (four product records, GovernanceSnapshot and
   receipt support) and its backup family/typed resource target aligned with
   the data-model overlay; no universal Feature foreign key is implied.
7. Keep snapshot capture intent separate from server-verified output: only a
   same-Business Repository plus active ProjectRepository checkout binding may
   produce a persisted VALID snapshot and SnapshotCaptureResult receipt.
8. Pin the final backend packet's corrected source digest and timestamp before
   changing this document from candidate. The older UX packet is superseded
   for implementation decisions by this plan and overlay.
9. Close the production runtime-role/least-privilege dependency documented in
   the carry-forward RCA before any Phase B production write or migration; no
   credential remediation is designed here.
10. Allocate no new canonical IDs inside this worker packet; root owns the
    registry and any required ADR/FR/FEAT declarations.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.5.0b | 2026-09-17 | beta | Reconcile implemented owner forms, independent source PASS and final 6376-test/build evidence; distinguish historical W0 labels from completed approval and current gates | 052821a7 + 892f23f3 | RWANG |
| 0.4.4b | 2026-09-17 | beta | Record 19-case PM and 14-case CRM provider gates, 122 focused checks and initial composed build; make UI component ownership explicit while closing existing section 7 conformance findings | 052821a7 + 892f23f3 | RWANG |
| 0.4.3b | 2026-09-17 | beta | Record W3 browser, W4 PostgreSQL and composed 61-test evidence; clarify owner read CAS headers and committed capture receipt identity while retaining final UI/release gates | 052821a7 + 892f23f3 | RWANG |
| 0.4.2b | 2026-09-17 | beta | Distinguish historical W0 approval and execution states from completed B1/B2 and current per-wave implementation evidence | 052821a7 | RWANG |
| 0.4.1b | 2026-09-17 | beta | Record W1/W2 local completion and W5 executable commit-provenance refinement within the approved six-record/14-operation scope | 052821a7 | RWANG |
| 0.4.0b | 2026-09-17 | beta | Record approved decision26 and select offline clean-target recovery, protected export and reviewed field erasure for W2 | bd99651f | RWANG |
| 0.3.3b | 2026-09-17 | candidate | Reconcile restore prerequisites and owner-only snapshot listing; record B1/B2 completion and explicit independent/root pre-DDL RLS policy gate | 61e28ac9 | RWANG |
| 0.2.0b | 2026-09-17 | candidate | Composed candidate Phase B Feature authority, typed machine contract input, source provenance bounds, approval-gate/wave separation, UX/state model, restore/privacy and acceptance gates; no implementation or IDs. | f061a113 | Luna Max |
| 0.3.0b | 2026-09-17 | candidate | Closed verifier contract findings: six-record authority, Project Feature capacity, WorkItem-derived allocation and graph lock/ETag rules, VALID-only snapshot proof, typed receipts, Identity CSRF/Origin, redacted fields and worker allowlists; no implementation or IDs. | f061a113 | Luna Max |
| 0.3.1b | 2026-09-17 | candidate | Correct the ERD to optional typed receipt references and the canonical snapshot pin; preserve the selected storage/API contract | composed ecc30b94 | RWANG |
| 0.3.2b | 2026-09-17 | candidate | Reconcile candidate lifecycle and validation status; distinguish historical worker provenance from composed authority and disclose incomplete independent re-review | a965f194 | RWANG |
