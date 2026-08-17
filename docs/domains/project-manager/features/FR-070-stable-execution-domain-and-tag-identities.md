---
domain: project-manager
feature: FR-070
module: project-manager
source: v2-native
version: 0.7.0
status: proposed
---

# FR-070 — Stable execution, domain, goal, risk, tag and supporting identities

## Intent

Every execution plan carries stable references for its execution mode, owning
plan, product domain, technical owner, linked goals, linked risks, tags and
applicable supporting execution records.
Human-readable labels remain available as projections, but no label, route key or
free-text goal/risk/tag is used as a foreign key or authorization input.

## Identity contract

```text
    Product Domain ID
      → Execution Mode ID
        → Plan ID (= Workstream UUID)
          → Phase/Sprint/Stage/Batch/Wave ID (= WorkContainer UUID)
            → Task/Deal/Dataset/etc. ID (= WorkItem UUID)
              → Tag ID(s)
```

Execution itself has a separate trace identity graph:

```text
executionContractId
  → executionRunId
    → executionStepId + stepKey
      → attemptId
        → auditEventId
```

The plan graph identifies the business objects; the trace graph identifies a
specific run, step, retry and immutable evidence. A replay always creates new
runtime IDs and links back to the source with `replayOfExecutionRunId` and/or
`replayOfExecutionStepId`.

The technical owner of the execution records is separate from the product domain
that the work serves:

```text
technicalOwnerDomainId = TD-PROJECT-MANAGER
primaryDomainId        = DOM-COMMERCE / DOM-MARKETING / DOM-OPERATIONS / ...
executionModeId        = EXM-B2B-SALES / EXM-B2C-CAMPAIGN / ...
planId                 = Workstream.id
```

## Product-domain registry

These IDs map to the accepted domain navigation in
[SITEMAP-DOMAIN-NAV.md](../../../SITEMAP-DOMAIN-NAV.md). The route key and label
are projections and may change without changing the ID.

| Product domain ID | Current route key | Current label | Execution role |
|---|---|---|---|
| `DOM-BUSINESS-HOME` | `business-home` | Business Home | shell-level cross-domain projection; never an execution owner |
| `DOM-COMMERCE` | `commerce` | Commerce | commerce, B2B/wholesale, products and orders |
| `DOM-CRM` | `customer` | CRM | people/customer/account context and relationship data |
| `DOM-MARKETING` | `growth` | Marketing | campaigns, audiences, channels and KPI outcomes |
| `DOM-OPERATIONS` | `operations` | Operations | operational periods, processes, SLA and incidents |
| `DOM-PEOPLE` | `people` | HR / People | workforce and accountable Human context |
| `DOM-DEVELOPMENT` | `projects` | Development | project execution and delivery views |
| `DOM-PLATFORM` | `platform` | Platform | configuration, identity, audit and system capabilities |

## Technical-owner registry

| Technical domain ID | Charter domain | Owns execution records? |
|---|---|---|
| `TD-PROJECT-MANAGER` | `project-manager` | yes — Project, Workstream, WorkContainer, WorkItem, Dependency, Tag attachment and AuditEvent shape |
| `TD-CRM` | `crm` | no — provides Person/Customer/Conversation/Message context |
| `TD-IDENTITY` | `identity` | no — resolves viewer, Membership and authorization |
| `TD-KNOWLEDGE` | `knowledge` | no — provides governed knowledge context |
| `TD-AGENT` | `agent` | no — proposes plans and consumes authorized capabilities; owns no Prisma work model |

## Seven execution-mode IDs and domain map

| Execution mode ID | Legacy enum alias | Primary product domain | Supporting domains | Domain-binding rule |
|---|---|---|---|---|
| `EXM-SOFTWARE-SPRINT` | `SOFTWARE_SPRINT` | `DOM-DEVELOPMENT` | — | fixed unless the Project explicitly declares a business capability context |
| `EXM-DATA-MIGRATION` | `DATA_MIGRATION` | `DOM-DEVELOPMENT` by default | selected target domain | if migrating CRM, Commerce, Marketing, Operations or People data, the target domain ID is required; never infer it from a label |
| `EXM-B2B-SALES` | `B2B_SALES` | `DOM-COMMERCE` | `DOM-CRM` | B2B/wholesale is Commerce per sitemap; CRM supports account/person context; Marketing is optional, not default |
| `EXM-B2C-CAMPAIGN` | `B2C_CAMPAIGN` | `DOM-MARKETING` | `DOM-CRM` | audience/customer context is CRM; Commerce is added only when offer/order conversion is in scope |
| `EXM-PRODUCT-LAUNCH` | `PRODUCT_LAUNCH` | `DOM-DEVELOPMENT` by default | `DOM-COMMERCE`, `DOM-MARKETING`, `DOM-OPERATIONS` | user may select another truthful primary domain; the selected binding is required before commit |
| `EXM-OPERATIONS` | `OPERATIONS` | `DOM-OPERATIONS` | `DOM-PEOPLE`, `DOM-COMMERCE` | Operations owns the operating outcome; People/C-commerce are supporting contexts only |
| `EXM-BUSINESS-EXPANSION` | `BUSINESS_EXPANSION` | `DOM-OPERATIONS` by default | `DOM-COMMERCE`, `DOM-PEOPLE`, `DOM-PLATFORM` | site/process readiness defaults to Operations; sales-led expansion may select Commerce as primary |

All seven rows also carry `technicalOwnerDomainId: TD-PROJECT-MANAGER`.
`DOM-BUSINESS-HOME` is never a primary execution domain because it is a
non-owning aggregation surface.

## Plan identity

`Execution Plan` is the user-facing name for a `Workstream`:

| User/API field | Source of truth | Rule |
|---|---|---|
| `planId` | `Workstream.id` | server UUID, assigned after creation; no second Plan table |
| `planCode` | `Workstream.code` | stable human/reference code used in draft/import refs |
| `projectId` | `Workstream.projectId` | owning Project UUID |
| `executionModeId` | catalog registry | canonical mode identity; legacy `executionMode` is normalized only |
| `primaryDomainId` | domain registry | selected/default product domain ID |
| `supportingDomainIds[]` | domain registry | explicit supporting product domains |
| `technicalOwnerDomainId` | charter registry | `TD-PROJECT-MANAGER` for execution records |
| `goalIds[]` / `goalId` | `BusinessGoal.id` through `ProjectGoal` | Authorized Business-goal links; `goalId` is the identity of each link, not the goal title/code |
| `riskIds[]` / `riskId` | Project Manager Risk record ID | Authorized risk links; `riskId` is unavailable until a first-class Risk record is provided and is never inferred from a label |

During dry-run, envelope `code` values are local reference keys. After commit,
the response and every Roadmap/Board/Schedule/Dependency DTO must expose both
the UUID and the code. A code is never treated as a database primary key.

## Goal and risk identity

Goals and risks are context links on the Project Manager execution graph; they do
not replace the Project, Workstream, WorkContainer or WorkItem identities.

| Axis | API/read field | SQL/storage field | Canonical source | Rule |
|---|---|---|---|---|
| Goal link | `goalId` within `goalIds[]` | `goal_id` | `BusinessGoal.id` via the existing `ProjectGoal` link | The Project may link multiple goals; `goalCode`, title and progress are projections |
| Risk link | `riskId` within `riskIds[]` | `risk_id` | Project Manager Risk record UUID | Optional until a Risk record exists; risk title, severity, status and mitigation are projections |

`goalIds[]` and `riskIds[]` are empty when no authorized link exists. The
Project's human-readable goal/outcome remains required for planning even when no
`goalId` has been linked. A risk reference may be attached to a Project,
WorkItem or execution step only after the owning Risk service resolves it; a
client or Agent cannot invent a `riskId`. The current repository has the
first-class `BusinessGoal`/`ProjectGoal` models, but no first-class Risk model;
the `riskId` field is therefore a target contract and must render as unavailable
until that owner/model is approved and implemented.

## Supporting identity registry

The following requested IDs are part of the same identity contract. The storage
key is the snake_case form; API and event payloads use the camelCase form. An ID
is server-owned and must resolve through its owning service before commit. A
label, code, route key, hash or generated composite is never a substitute.

| Requested storage ID | API/event field | Owner/source | Current status and rule |
|---|---|---|---|
| `node_id` | `nodeId` | Knowledge/GKS graph projection | Target stable identity of one projected graph node; it is not a `WorkItem.id`. The current project graph emits generic `id`, so an adapter must bind it explicitly before implementation. |
| `edge_id` | `edgeId` | Knowledge/GKS graph projection | Target stable identity of one graph relationship; never derive it from labels or `from`/`to` text. The current project graph has no edge identity yet. |
| `artifact_id` | `artifactId` | Source/evidence artifact owner | Target stable identity of an approved source or evidence artifact. `FileAsset.id`, path and SHA-256 are related metadata, not interchangeable identity. |
| `contract_id` | `contractId` | CRM Contact owner | Stable identity of one CRM Contact. It is a CRM context reference, not a document contract, workflow contract or the seven-mode `execution_contract_id`. |
| `meeting_id` | `meetingId` | CRM/Collaboration owner | Target identity of one scheduled or held meeting occurrence; distinct from a Project Milestone or Gate. |
| `call_id` | `callId` | CRM/Interaction owner | Target identity of one call or call occurrence; distinct from a CRM `Conversation` and from `execution_run_id`. |
| `followup_id` | `followupId` | CRM/Interaction owner | Target identity of one CRM follow-up action/reminder; it is not a Project Manager `WorkItem.id`. |
| `req_id` | `reqId` | Requirement/document registry | Stable requirement reference such as `FR-070`, `NFR-*`, `BR-*`, `SEC-*`, `SDD-*` or `FEAT-*`; it is not a transport request ID or a generated runtime UUID. |
| `verify_id` | `verifyId` | Verification/evidence owner | Target identity of a verification result or decision occurrence; distinct from `artifact_id`, `execution_step_id` and `audit_event_id`. No first-class Verify model exists yet. |
| `gate_id` | `gateId` | Project Manager `Gate.id` | Existing Gate identity. Only an authorized existing Gate may be referenced; gate status is a projection and cannot create a new gate ID. |
| `integration_id` | `integrationId` | Integration/adapter owner | Stable identity of an Integration adapter or bridge used by the workflow or pipeline. `int_id` is a legacy shorthand only and is not canonical. |
| `int_id` | `intId` (legacy input only) | Compatibility alias for Integration | Accepted only at normalization and mapped one-to-one to `integration_id`; it is never persisted or emitted as the canonical field and is not an Intent identity. |
| `graph_id` | `graphId` | Knowledge/GKS graph projection | Target identity of the graph/projection containing `node_id` and `edge_id`; it is not the generated document graph file and does not authorize a write. |
| `workflow_contract_id` | `workflowContractId` | Multi-agent workflow owner | Stable identity of the contract governing multi-agent roles, handoffs, inputs, outputs, tools, failure handling and approval. It is distinct from `execution_contract_id` and `workflow_id`. |
| `workflow_id` | `workflowId` | Workflow owner | Target identity of the selected workflow definition governed by `workflow_contract_id`; its concrete procedure is `runbook_id`, and it is distinct from `execution_contract_id`, `execution_run_id` and `execution_step_id`. |
| `runbook_id` | `runbookId` | Workflow/runbook owner | Target identity of the concrete operational runbook/procedure selected by a workflow; it is distinct from `workflow_id` and `execution_run_id`. |
| `promotion_id` | `promotionId` | Knowledge/GKS/MSP promotion ledger | Target identity of one governed candidate-to-canonical promotion occurrence; it is distinct from `fact_id`, `knowledge_id` and execution trace IDs. |
| `skill_id` | `skillId` | Agent capability registry | Target identity of an allow-listed Agent skill/capability. Agent consumes this reference; it does not own a Project Manager model. |
| `tool_id` | `toolId` | Agent tool registry | Target identity of an allow-listed Agent tool. The current tool `name` is a selector/label, not a stable production foreign key. |

`execution_contract_id` is the canonical identity of one of the seven
Project Manager execution contracts. `workflow_contract_id` is the separate
multi-agent workflow contract. `contract_id` is the CRM Contact identity by
product contract and must not be interpreted as either contract family.
`integration_id` is the canonical Integration identity; `int_id` may be read
only as a legacy compatibility alias and must not be used for Intent. These
distinctions prevent speech/abbreviation aliases from creating duplicate or
cross-domain identities. `runbook_id` is the concrete procedure selected by a
`workflow_id`; it is not another workflow contract. `promotion_id` identifies
the promotion occurrence, while `fact_id`/`knowledge_id` identify the governed
fact and destination projection.

Supporting references are optional by execution mode and by lifecycle step. An
unknown, unauthorized or owner-unavailable reference fails closed for a write;
read models may return an explicit `unavailable` state. These references do not
widen tenant, business, project, Agent skill or tool authorization.

## Work-period and work-item identity

Every mode-specific period is still one canonical `WorkContainer` record. The
mode-facing name is a typed alias for `containerId = WorkContainer.id`; it is not
a second table or a second UUID.

| Mode | Container subtype | User-facing ID | Canonical source |
|---|---|---|---|
| `SOFTWARE_SPRINT` | `RELEASE` | `releaseId` | `containerId` |
| `SOFTWARE_SPRINT` | `SPRINT` | `sprintId` | `containerId` |
| `SOFTWARE_SPRINT` | `EPIC` | `epicId` | `containerId` |
| `DATA_MIGRATION` | `MIGRATION_STAGE` | `stageId` | `containerId` |
| `DATA_MIGRATION` | `MIGRATION_BATCH` | `batchId` | `containerId` |
| `B2B_SALES` | `SALES_PIPELINE` | `pipelineId` | `containerId` |
| `B2B_SALES` | `SALES_STAGE` | `stageId` | `containerId` |
| `B2C_CAMPAIGN` | `CAMPAIGN` | `campaignId` | `containerId` |
| `B2C_CAMPAIGN` | `CAMPAIGN_WAVE` | `waveId` | `containerId` |
| `B2C_CAMPAIGN` | `CHANNEL` | `channelId` | `containerId` |
| `PRODUCT_LAUNCH` | `LAUNCH_PHASE` | `phaseId` | `containerId` |
| `OPERATIONS` | `OPS_PERIOD` | `periodId` | `containerId` |
| `OPERATIONS` | `OPS_PROCESS` | `processId` | `containerId` |
| `BUSINESS_EXPANSION` | `EXPANSION_INITIATIVE` | `initiativeId` | `containerId` |
| `BUSINESS_EXPANSION` | `EXPANSION_SITE` | `siteId` | `containerId` |

The alias is valid only when the subtype matches. A `phaseId` cannot point to a
`SPRINT`, and a `sprintId` cannot be used in a migration plan. If a generic API
does not need the mode alias, it uses `containerId` plus `subtype`.

Every period read model must expose this minimum identity envelope:

| Read node | Required identity fields | Source mapping |
|---|---|---|
| Work period | `projectId`, `planId`, `containerId`, the valid typed alias, `parentContainerId`, `subtype`, `code` | `planId = WorkContainer.workstreamId`; `containerId = WorkContainer.id`; `parentContainerId = WorkContainer.parentId` |
| Work item | `projectId`, `planId`, `containerId`, `workItemId`, the valid typed item alias, `subtype`, `code` | `planId = WorkItem.workstreamId`; `containerId = WorkItem.containerId`; `workItemId = WorkItem.id` |

`parentContainerId` is `null` for a root period. It is an API/read-model name
for the existing `WorkContainer.parentId`; it does not introduce another
database key. The same envelope must be returned by the Roadmap, Structure
Plan, Board, Schedule and Dependency Map views.

The same rule applies one level below the period:

| Mode | WorkItem subtype | User-facing ID | Canonical source |
|---|---|---|---|
| `SOFTWARE_SPRINT` | `TASK` / `BUG` | `taskId` / `bugId` | `workItemId = WorkItem.id` |
| `DATA_MIGRATION` | `DATASET` / `VALIDATION` / `RECONCILIATION` | `datasetId` / `validationId` / `reconciliationId` | `workItemId` |
| `B2B_SALES` | `ACCOUNT` / `DEAL` / `ACTIVITY` | `accountId` / `dealId` / `activityId` | `workItemId` |
| `B2C_CAMPAIGN` | `CREATIVE` / `AUDIENCE` / `EXPERIMENT` | `creativeId` / `audienceId` / `experimentId` | `workItemId` |
| `PRODUCT_LAUNCH` | `DELIVERABLE` | `deliverableId` | `workItemId` |
| `OPERATIONS` | `CHECKLIST_ITEM` / `ISSUE` / `SLA` | `checklistItemId` / `issueId` / `slaId` | `workItemId` |
| `BUSINESS_EXPANSION` | `SETUP_ACTION` / `APPROVAL` | `setupActionId` / `approvalId` | `workItemId` |

The canonical persisted chain is therefore:

```text
projectId
  ├→ goalId = BusinessGoal.id (via ProjectGoal)
  ├→ riskId = Project Manager Risk record ID (when linked)
  └→ planId = Workstream.id
       → containerId = WorkContainer.id
         → workItemId = WorkItem.id
           → tagId = Tag.id
```

Mode-specific aliases (`phaseId`, `sprintId`, `batchId`, `waveId`, `dealId`,
etc.) are returned by read models for Human clarity and are always traceable to
the canonical UUID. They are never independently generated identity.

Every execution-step event serializes one `identityRefs` object with the complete
supporting key set. A value is `null`/`[]` when the reference is not applicable;
omitting a key is invalid because it would make two agents emit incomparable
trace shapes. The supporting relationships are:

```text
projectId
  ├→ contractId / meetingId / callId / followupId
  ├→ reqId
  ├→ integrationId
  └→ graphId → nodeId / edgeId
workflowContractId → workflowId → runbookId → skillId / toolId
factId → promotionId
executionStepId → gateId / artifactId / verifyId
```

These are references alongside the business and trace graphs, not replacement
nodes. `contractId` is the CRM Contact reference, `integrationId` is the
Integration reference, `workflowContractId` governs the selected `workflowId`,
`executionContractId` remains the seven-mode execution contract identity, and
`executionRunId` remains the canonical run identity.

## Tag identity

The required future attachment contract is:

```json
{
  "tagId": "server UUID",
  "tagCode": "TAG-BLOCKED",
  "label": "Blocked",
  "ownerDomainId": "TD-PROJECT-MANAGER",
  "productDomainId": "DOM-DEVELOPMENT"
}
```

`tagCode` and `label` are read projections. A committed WorkItem or
ExecutionStep mutation accepts `tagId` only. A dry-run may return an unresolved
`requestedTagCode` as a proposal, but commit must stop until the user or an
authorized Tag service resolves it to a `tagId`. A step tag is attached to
`executionStepId`; it does not replace structured failure or audit fields.

Global execution tags such as `blocked`, `high`, `doc`, `code` and `test` still
have `ownerDomainId: TD-PROJECT-MANAGER`; `productDomainId` may be null only for
an explicitly declared global tag scope. Domain-specific tags must carry the
product domain ID.

## PlanEnvelope target shape

The next additive envelope version must normalize to this shape:

```json
{
  "schemaVersion": "1.2",
  "trace": {
    "correlationId": "request-uuid",
    "idempotencyKey": "client-key",
    "replayOfExecutionRunId": null,
    "replayOfExecutionStepId": null
  },
  "project": {
    "code": "PRJ-001",
    "name": "Enterprise Sales Pipeline",
    "goalIds": ["goal-uuid"],
    "riskIds": ["risk-uuid"]
  },
  "domainBinding": {
    "primaryDomainId": "DOM-COMMERCE",
    "supportingDomainIds": ["DOM-CRM"],
    "technicalOwnerDomainId": "TD-PROJECT-MANAGER"
  },
  "identityRefs": {
    "gateIds": [],
    "artifactIds": [],
    "contractIds": [],
    "meetingIds": [],
    "callIds": [],
    "followupIds": [],
    "reqIds": [],
    "verifyIds": [],
    "integrationId": null,
    "graphId": null,
    "nodeIds": [],
    "edgeIds": [],
    "workflowContractId": null,
    "workflowId": null,
    "runbookIds": [],
    "promotionIds": [],
    "skillIds": [],
    "toolIds": []
  },
  "workstreams": [
    {
      "code": "WST-B2B",
      "name": "Enterprise Sales Pipeline",
      "executionContractId": "EXC-B2B-SALES-V1",
      "executionModeId": "EXM-B2B-SALES",
      "executionMode": "B2B_SALES",
      "progressStrategy": "WEIGHTED_PIPELINE",
      "tagRefs": [{ "tagId": "tag-uuid" }],
      "containers": [
        {
          "code": "STAGE-QUALIFY",
          "subtype": "SALES_STAGE",
          "title": "Qualification"
        }
      ],
      "items": [
        {
          "code": "DEAL-001",
          "containerCode": "STAGE-QUALIFY",
          "subtype": "DEAL",
          "title": "Enterprise account"
        }
      ]
    }
  ]
}
```

The create/dry-run envelope uses `code` and `containerCode` as local references
because server UUIDs do not exist yet. The committed response must return
`executionContractId`, `executionRunId`, `planId`, `containerId`/mode alias,
`workItemId`/item alias, `goalId`/`goalIds[]`, `riskId`/`riskIds[]` and `tagId`
for every applicable record. Every lifecycle step
returns `executionStepId`, `stepKey`, `attemptId`, status and `auditEventId`;
failed steps return `failureCode` and replay lineage. Dependencies resolve to
canonical endpoint UUIDs after commit.

The caller may supply `correlationId`, `idempotencyKey`, approved identity
references and replay source references. The server generates
`executionRunId`, `executionStepId`,
`attemptId` and `auditEventId`; clients and Agents must not fabricate those
server-owned IDs.

`executionMode` is retained only as a compatibility echo while schema 1.0/1.1
inputs are migrated. New producers must send `executionModeId`; new consumers
must authorize and persist the resolved ID. The exact JSON Schema/Zod changes,
Tag model and join table are implementation work after ADR-029 approval.

## Acceptance criteria

- **AC-070.1** The product-domain registry gives every domain a stable ID and
  maps it to the current route key and display label without using either as a
  foreign key.
- **AC-070.2** Each of the seven execution modes has a stable `executionModeId`
  mapped to exactly one legacy enum alias, progress strategy, subtype allowlist
  and evidence contract.
- **AC-070.3** A committed Execution Plan exposes `planId = Workstream.id`,
  `planCode = Workstream.code` and `projectId`; no second ExecutionPlan entity
  is introduced.
- **AC-070.4** Every committed WorkItem tag attachment uses `tagId`. Labels and
  codes are projections or dry-run proposals only.
- **AC-070.5** Every committed plan carries `primaryDomainId`,
  `supportingDomainIds[]` and `technicalOwnerDomainId`; the technical owner is
  `TD-PROJECT-MANAGER` for Project Manager execution records.
- **AC-070.6** `B2B_SALES` maps to Commerce primary and CRM supporting;
  `B2C_CAMPAIGN` maps to Marketing primary and CRM supporting; `OPERATIONS` maps
  to Operations primary; all other mappings follow the table above and require
  explicit selection when the mode is cross-domain.
- **AC-070.7** Dry-run resolves all mode, domain, plan and tag references before
  authorization and reports unresolved IDs without partial writes.
- **AC-070.8** Agent import cannot invent a mode, domain or tag by sending a new
  label. Unknown IDs and unauthorized cross-domain bindings fail closed.
- **AC-070.9** Roadmap, Structure Plan, Board, Schedule, Dependency Map and
  Agent import show the same IDs and labels for the same records.
- **AC-070.10** AuditEvent records the affected entity ID, actor ID,
  `executionModeId`, domain binding IDs and tag IDs for identity-bearing
  mutations.
- **AC-070.11** Every committed `WorkContainer` returns its canonical
  `containerId` and the mode-valid alias (`phaseId`, `sprintId`, `stageId`,
  `batchId`, `waveId`, `periodId`, etc.); aliases resolve to the same UUID and
  cannot cross subtype boundaries.
- **AC-070.12** Every committed `WorkItem` returns `workItemId` and its
  mode-valid alias (`taskId`, `dealId`, `datasetId`, `deliverableId`, etc.),
  plus `planId`, `containerId` and attached `tagId` references where present.
- **AC-070.13** Dependency endpoints persist/use canonical `endpointType` plus
  `endpointId`; draft/import codes are resolved to UUIDs before commit and are
  never retained as the only relationship identity.
- **AC-070.14** Every period read model returns `projectId`, `planId`,
  `containerId`, its valid typed alias, `parentContainerId`, `subtype` and
  `code`; `parentContainerId` resolves to the existing parent container UUID
  or `null` for a root period.
- **AC-070.15** Every mode contract has a stable `executionContractId` and
  explicit `contractVersion`; it is distinct from `executionModeId` and
  `planId`.
- **AC-070.16** Every execution run and step exposes
  `executionRunId`, `executionStepId`, `stepKey`, `attemptId`, applicable
  business IDs, `correlationId`, status and audit linkage.
- **AC-070.17** Step-level tags use `tagId` and target the exact
  `executionStepId`; labels and tag codes remain projections only.
- **AC-070.18** A failed step exposes `failureCode`, `errorRef`, `retryable`,
  `auditEventId` and explicit downstream skipped/not-started state.
- **AC-070.19** Replay is append-only: new run/step/attempt IDs link to the
   source run/step, revalidate contract/version/authorization/input hashes and
   never overwrite the original trace.
- **AC-070.20** A Project Manager read/import contract exposes `goalId`/`goal_id`
  for each authorized `BusinessGoal` link and supports an aggregate `goalIds[]`;
  goal codes, titles and progress remain projections.
- **AC-070.21** A Project Manager read/import contract exposes `riskId`/`risk_id`
  only when an authorized Risk record resolves; it never fabricates a risk from
  free text, and unavailable Risk data is explicit.
- **AC-070.22** Roadmap, Structure Plan, Board, Schedule, Dependency Map,
  Agent import, AuditEvent and execution-step context preserve the same goal and
  risk IDs when those links are present; no view creates a second identity.
- **AC-070.23** Goal and risk links are revalidated against the authorized
  Project/Business scope before commit or replay; `goal_id` and `risk_id` cannot
  widen authorization or replace execution trace IDs.
- **AC-070.24** The supporting identity registry preserves
  `node_id`, `edge_id`, `artifact_id`, `contract_id`, `meeting_id`, `call_id`,
  `followup_id`, `req_id`, `verify_id`, `gate_id`, `integration_id`, `graph_id`,
  `workflow_contract_id`, `workflow_id`, `runbook_id`, `promotion_id`,
  `skill_id` and `tool_id` as explicit
  references with camelCase API projections; no label, hash, route key or
  composite is accepted as their identity.
- **AC-070.25** `node_id`/`edge_id` resolve inside an owning `graph_id` through
  the Knowledge/GKS projection and remain distinct from Project Manager
  `projectId`, `planId`, `containerId` and `workItemId`; the generated document
  graph is not an execution data source.
- **AC-070.26** `artifact_id` and `verify_id` preserve source/evidence lineage
  without replacing `executionStepId`, `attemptId` or `auditEventId`; missing
  owner records are explicit `unavailable` and cannot be fabricated by an Agent.
- **AC-070.27** `gate_id`, `meeting_id`, `call_id`, `followup_id`, `req_id`,
  `integration_id`, `workflow_contract_id`, `workflow_id`, `runbook_id`,
  `promotion_id`, `skill_id` and `tool_id` resolve through their owning
  services before commit. `skill_id` and `tool_id` are allow-listed capability
  references and never grant authorization by themselves. `int_id`, when
  received from a legacy caller, normalizes to `integration_id` before
  authorization.
- **AC-070.28** `contract_id` resolves to CRM Contact and is never silently
  treated as `execution_contract_id` or `workflow_contract_id`; the CRM
  context and both contract families retain separate owners, versions and
  lifecycles.
- **AC-070.29** `req_id` resolves only to a declared requirement/feature key;
  it is not a transport request ID. `runbook_id` remains the concrete
  procedure selected by a workflow, and `promotion_id` remains the governed
  promotion occurrence distinct from `fact_id`, `knowledge_id` and execution
  trace IDs.

## Non-goals

- Adding real authentication or changing Membership grants.
- Making a product domain a technical model owner.
- Creating seven Plan tables or seven import pipelines.
- Treating labels, route keys or human codes as database primary keys.
- Creating a Risk persistence model or route in this identity-only change.
- Creating Artifact, Contact, Meeting, Call, Follow-up, Verify, Workflow,
  Runbook, Promotion, Integration, Skill, Tool or graph
  persistence models in this identity-only change.
- Treating `contract_id` as an execution/workflow contract, or collapsing
  `execution_contract_id` and `workflow_contract_id`.
- Treating `int_id` as a canonical Intent identity; it is only a compatibility
  alias for `integration_id`.
- Editing generated `DOMAIN-MAP.md`, `TRACE.md` or `.doc-graph.json` by hand.

## Related documents

- [ADR-029 — Stable identity bindings](../../../decisions/ADR-029-STABLE-IDENTITY-BINDINGS-FOR-EXECUTION-PLANS.md)
- [FR-069 — Seven execution-plan contracts](FR-069-plan-blueprint-and-intake.md)
- [Seven Execution Modes](../../../EXECUTION-MODES.md)
- [Sitemap domain map](../../../SITEMAP-DOMAIN-NAV.md)
- [PlanEnvelope schema](../../../../contracts/plan-envelope.schema.json)
- SDD-041 — execution trace, failure localization and replay lineage
