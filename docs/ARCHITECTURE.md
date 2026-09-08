---
id: ZAI:ARCHITECTURE
relations:
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-062
  - type: relates_to
    target: ZAI:PLAN-FEAT-019-PHASES
version: "0.2.2b"
status: candidate
last_update: "2026-09-08T00:51:36+07:00,RWANG"
---

# Architecture

> Knowledge execution update (2026-09-08): [ADR-073](decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md)
> implements the isolated GenesisRAG17 profile across four repositories. The
> [spec](KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) and
> [execution flow / extension map](KNOWLEDGE-INGESTION-17-STAGE-FLOW.md) are the
> architecture entrypoints for adding ingestion or retrieval capabilities:
> zuri 1–8, MSP authentication/relay, passive GKS decisions/gate, separate
> GenesisBlock worker writes/publication. This adds no production authorization.

> Current authority (2026-09-06): Zuri is a standalone product under [ADR-024](decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md); legacy V1 replacement language below is historical and grants no migration authority. [ADR-061](decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) governs server-owned LINE and optional Edge computation. [FEAT-019 phase map](roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md) records current domain handoffs and rollout gaps. [ADR-062](decisions/ADR-062-ZURI-SERVER-EDGE-MONOREPO-BOUNDARY.md) governs the approved `apps/server` / `apps/edge` source layout; runtime and release boundaries remain independent.


> The **three-layer** and **system** diagrams live in
> [ARCHITECTURE-DIAGRAMS.md](ARCHITECTURE-DIAGRAMS.md). This document keeps the
> domain-shaped views below (context chain, execution hierarchy, progress engine,
> file workspace).

## System

```text
┌───────────────────────────────────────────────┐
│                    zuri-ai                    │
│                                               │
│  App Shell                                    │
│  ├─ Zuri Heritage Navigation                  │
│  ├─ Scope Selector                            │
│  └─ Module Registry                           │
│                                               │
│  Project Manager Module                       │
│  ├─ Universal Views                           │
│  ├─ 7 Execution Views                         │
│  ├─ Plan Import                               │
│  ├─ Progress Engine                           │
│  └─ Audit                                     │
│                                               │
│  Application Services                         │
│  ├─ ProjectService                            │
│  ├─ WorkstreamService                         │
│  ├─ DependencyService                         │
│  ├─ ProgressService                           │
│  └─ PlanImportService                         │
│                                               │
│  Repository Ports                             │
│        ↓                                      │
│  Prisma Local Adapter                         │
│        ↓                                      │
│  SQLite                                       │
└───────────────────────────────────────────────┘
```

## Module boundary

Everything specific to Project Manager belongs under:

```text
src/modules/project-manager/
```

The app shell must depend on exported PM interfaces/routes, not PM internals.

## Context hierarchy

```text
Portfolio
  ↓
Tenant
  ↓
Business
  ↓
Workspace
  ↓
Project
```

The Project may be omitted from context for portfolio/workspace overview routes.

## Execution hierarchy

```text
Project
  ↓
Workstream
  ├─ WorkContainer
  ├─ WorkItem
  ├─ Milestone
  ├─ Gate
  ├─ Metric
  ├─ Dependency
  └─ Artifact
```

## Plan generation boundary

Planning Agent is outside the application.

```text
Planning Agent
    ↓
PlanEnvelope JSON
    ↓
Import validator
    ↓
Dry Run
    ↓
Domain Service
    ↓
SQLite
```

The Project Manager does not require an LLM to function.

## Repository boundary

```text
Project
  ↓ many-to-many
ProjectRepository
  ↓
Repository
```

A Project is never identified by its repository.

## Progress engine

```text
Workstream
  ├─ executionMode
  ├─ progressStrategy
  ├─ progressWeight
  └─ evidence
        ↓
Progress Calculator
        ↓
0..100 + explanation
```

Project:

```text
Σ(workstream progress × weight)
────────────────────────────────
Σ(weight)
```

## Offline backup

Implement explicit:

```text
Export Snapshot
Import Snapshot
```

Snapshot contains:
- schema version
- exportedAt
- portfolios
- tenants
- businesses
- workspaces
- projects
- workstreams
- work data
- repositories
- gates
- dependencies
- audit metadata

Do not silently overwrite a database on import.
Always preview counts/conflicts first.

## Managed local file workspace (implemented FR-045)

```text
Business / Project File Manager
              |
              v
       File application service
        |                  |
        v                  v
SQLite repository       Filesystem port
(identity, scope,       (content under a
 links, audit, state)    mounted root)
        |
        v
Disposable cache projection (.zuri/cache)
```

SQLite remains the only relational authority. The filesystem port accepts only
normalized relative paths contained by a device-local Business mount. Product and
Workstream relations remain queryable links rather than canonical folders. A local
runtime bridge may reveal a file in Explorer; ordinary hosted web routes may not
launch an OS process. Detailed contracts and migration gates are in ADR-016,
FR-045 and ZV2-CR-001.

Version diff 0.2.0b → 0.2.1b: reflect approved monorepo source topology; preserve existing system diagrams.
