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
| `workstream_id` | parallel execution stream |
| `repo_id` | internal repository record |

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
