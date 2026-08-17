# Domain Model

## Identity vocabulary

| Concept | Purpose |
|---|---|
| `portfolio_id` | business group / owner umbrella |
| `tenant_id` | security and data isolation |
| `legal_entity_id` | legal company identity |
| `business_id` | operating business |
| `branch_id` | location / branch |
| `workspace_id` | working context |
| `project_id` | outcome-oriented project |
| `goal_id` | stable identity of a linked `BusinessGoal` through `ProjectGoal` |
| `risk_id` | stable identity of a linked Project Manager Risk record; target contract until the Risk model exists |
| `workstream_id` | parallel execution stream |
| `repo_id` | internal repository record |
| `product_domain_id` | stable Business-facing domain catalog identity |
| `technical_domain_id` | stable charter/module ownership identity |
| `execution_mode_id` | stable identity for one canonical execution contract |
| `execution_contract_id` | versioned definition of one execution contract |
| `execution_plan_id` | alias of the committed Workstream UUID; no second Plan table |
| `execution_run_id` | one immutable run of a plan/execution contract |
| `execution_step_id` | one concrete lifecycle/evidence step occurrence |
| `attempt_id` | one try of an execution step; retries get new IDs |
| `audit_event_id` | immutable audit record for a state-changing step |
| `data_pipeline_definition_id` | stable definition of a governed source-to-Supabase pipeline |
| `pipeline_stage_id` | stable catalog ID for one data-pipeline stage; not the B2B `pipelineId` |
| `pipeline_record_id` | one source-record execution unit within a pipeline run |
| `doc_id` | stable identity of a source document; not a filename, path or content hash |
| `pic_id` | stable identity of a source picture/image asset; not a blob URL or image bytes |
| `fact_id` | stable identity of the governed fact; `knowledge_id` is its destination compatibility projection |
| `tag_id` | stable identity for an attached Tag record |
| `node_id` | stable identity of a Knowledge/GKS graph node projection |
| `edge_id` | stable identity of a Knowledge/GKS graph relationship projection |
| `artifact_id` | stable identity of an approved source/evidence artifact |
| `contract_id` | stable identity of a CRM Contact; not an Execution or multi-agent workflow contract |
| `meeting_id` | stable identity of a CRM meeting occurrence; not a Project Milestone or Gate |
| `call_id` | stable identity of a CRM call/interaction occurrence; not a Conversation or execution run |
| `followup_id` | stable identity of a CRM follow-up action/reminder; not a Project Manager WorkItem |
| `req_id` | stable reference to a declared FR/NFR/BR/SEC/SDD/FEAT requirement; not a transport request ID |
| `verify_id` | stable identity of a verification result/decision occurrence |
| `gate_id` | stable identity of an existing Project Manager `Gate` record |
| `integration_id` | stable identity of an Integration adapter/bridge; legacy `int_id` is a compatibility alias only |
| `graph_id` | stable identity of a Knowledge/GKS graph/projection containing nodes and edges |
| `workflow_contract_id` | stable identity of a multi-agent workflow contract for roles, handoffs, inputs, outputs, tools, failure handling and approval |
| `workflow_id` | stable identity of a selected workflow definition governed by `workflow_contract_id`; its concrete procedure is `runbook_id` |
| `runbook_id` | stable identity of a concrete operational runbook/procedure selected by a workflow |
| `promotion_id` | stable identity of a governed knowledge candidate-to-canonical promotion occurrence |
| `skill_id` | stable identity of an allow-listed Agent skill/capability |
| `tool_id` | stable identity of an allow-listed Agent tool |

Execution trace IDs are operational identity, not replacements for the business
graph IDs. A trace step may reference `projectId`, `planId`, `containerId` and
`workItemId`; replay creates new run/step/attempt IDs and links to the source
trace rather than overwriting it. Persistence is an approved implementation
follow-up; this vocabulary is the contract boundary.

For the Knowledge data pipeline, `pipeline_record_id` links the source provenance
(`doc_id`/`pic_id`, with multi-source arrays where needed) to the governed
`fact_id` and the destination `knowledge_id` projection. API/event payloads use
`docId`, `picId` and `factId`; SQL/storage uses the snake_case names. These IDs
remain stable across a same-fact replay while execution run/step/attempt IDs are
new. Replay lineage uses `replayOfDocId`, `replayOfPicId` and `replayOfFactId`
alongside the corresponding run, step and pipeline-record lineage fields.

Supporting execution references use the same API/storage naming rule: `nodeId`,
`edgeId`, `artifactId`, `contractId`, `meetingId`, `callId`, `followupId`,
`reqId`, `verifyId`, `gateId`, `integrationId`, `graphId`,
`workflowContractId`, `workflowId`, `runbookId`, `promotionId`, `skillId` and
`toolId` in API/events, with the snake_case forms in SQL/storage. These are owner-resolved
references, not labels or authorization shortcuts. `execution_contract_id` is
the seven-mode Execution contract, `workflow_contract_id` is the multi-agent
workflow contract, and `contract_id` is CRM Contact. `integration_id` is
canonical; legacy `int_id` is not an Intent identity.

The current repository has a real `Gate.id`, while the first-class Artifact,
Contact, Meeting, Call, Follow-up, Verify, Integration, Workflow, Runbook,
Promotion, Skill, Tool and graph projection identities
are target contracts. The current Knowledge project graph returns generic node
`id` values and relation `from`/`to` values; it does not yet provide
`graph_id`/`node_id`/`edge_id`. No implementation may fabricate these IDs from
labels, paths, hashes or edge endpoints.

## Human codes

Use internal UUIDs as database PKs.

Expose readable codes:

```text
PF-001
TNT-001
LE-001
BUS-001
BR-001
WS-B01-MIG
PRJ-B01-MIG
WST-DATA-CUSTOMER
REP-ZURI
GATE-DATA-ID
```

Human codes are stable display identifiers, not relational PKs.

## Legal entity

```text
LegalEntity
  └─ LegalEntityIdentifier
       ├─ TH_DBD_REGISTRATION
       └─ TH_TAX_ID
```

Legal identifiers identify the company.

They do not prove employee authority.

## Membership

```text
Person
  ↓
Membership
  ├─ tenant
  ├─ business?
  ├─ branch?
  ├─ employeeRef?
  └─ role
```

MVP may seed one local owner Person.

Do not implement full auth yet.

## Project

Required:
- id
- code
- workspaceId
- name
- description
- status
- startAt?
- targetAt?
- createdAt
- updatedAt
- version

Project Manager read/import contracts expose linked `goalIds[]` and `riskIds[]`;
each element uses `goal_id`/`risk_id` as its canonical identity. `goal_id` is
already backed by `BusinessGoal.id` and the `ProjectGoal` join. `risk_id` must be
resolved by an authorized Risk owner once that first-class model exists; until
then it is explicit `unavailable`, never a free-text or code-derived ID.

## Workstream

Required:
- id
- code
- projectId
- name
- executionMode
- progressStrategy
- progressWeight
- status
- viewConfigJson
- createdAt
- updatedAt
- version

Target identity additions are defined by FR-070: `executionModeId`,
`primaryDomainId`, `supportingDomainIds[]`, `technicalOwnerDomainId` and
`planId = id` as a read-model alias. The legacy `executionMode` string remains
only as a compatibility input during migration.

## Neutral work primitives

### WorkContainer

A methodology-specific grouping.

Examples:

```text
SPRINT
EPIC
MIGRATION_STAGE
MIGRATION_BATCH
SALES_PIPELINE
SALES_STAGE
CAMPAIGN
CAMPAIGN_WAVE
LAUNCH_PHASE
OPS_PERIOD
OPS_PROCESS
EXPANSION_INITIATIVE
EXPANSION_SITE
```

Every listed `WorkContainer` has a canonical `containerId = WorkContainer.id`.
Mode-facing IDs are typed aliases of that UUID: `releaseId`, `sprintId`,
`epicId`, `stageId`, `batchId`, `pipelineId`, `phaseId`, `campaignId`,
`waveId`, `channelId`, `periodId`, `processId`, `initiativeId` and `siteId` as
applicable. WorkItems follow the same rule with
`workItemId = WorkItem.id` and aliases such as `taskId`, `dealId`, `datasetId`,
`deliverableId` and `approvalId`. See FR-070 for the complete matrix.

### WorkItem

Atomic tracked object.

Examples:
- software task
- migration dataset
- sales deal
- marketing creative
- launch deliverable
- operations checklist item
- expansion setup action

Target identity addition: attached tags are `tagIds[]`/Tag references. Tag
labels and codes are read projections; they are not relational identity.

Store domain-specific numeric values in explicit common fields where useful and in
validated metadata JSON for mode-specific fields.

## Dependency

A dependency links domain objects by stable internal IDs.

MVP allowed dependency endpoints:
- Project
- Workstream
- Milestone
- Gate
- WorkContainer
- WorkItem

Types:
```text
BLOCKS
REQUIRES
RELATES_TO
START_AFTER
FINISH_BEFORE
```

## Repository

Repository is local metadata.

Fields:
- id
- code
- provider
- externalRepoId?
- ownerName?
- repoName?
- fullName?
- url?
- defaultBranch?
- status

## AuditEvent

Immutable.

Fields:
- id
- entityType
- entityId
- action
- payloadJson
- actorType
- actorId?
- occurredAt

## Managed local files (implemented FR-045)

`FileAsset` is the stable identity and metadata record for one file. It carries
Tenant/Business authorization, optional primary Project/WorkItem scope, explicit
storage kind, normalized relative path or external reference, hash, size, status,
version and timestamps.

`FileLink` links one FileAsset into approved secondary entity views. Its typed
target is validated by the application service for existence and Tenant/Business
scope; clients cannot invent an arbitrary entity type.

`LocalWorkspaceMount` maps a Business and device to an absolute filesystem root.
The root is device-local configuration, not portable identity. FileAsset relative
paths and UUIDs survive remounting at another root.

```text
Business ----< Project
   |             |
   +----< FileAsset >---- FileLink ----> approved entity
                |
                +---- relative path ----> LocalWorkspaceMount root
```

The existing `ProjectFile` remains active behind the compatibility adapter during
the evidence window. Removal requires a separate future change; FR-045 does not
delete legacy rows or routes.
