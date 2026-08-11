# Architecture

## System

```text
┌───────────────────────────────────────────────┐
│                Zuri v2 Lab                    │
│                                               │
│  App Shell                                    │
│  ├─ Zuri Heritage Navigation                 │
│  ├─ Scope Selector                           │
│  └─ Module Registry                          │
│                                               │
│  Project Manager Module                      │
│  ├─ Universal Views                          │
│  ├─ 7 Execution Views                        │
│  ├─ Plan Import                              │
│  ├─ Progress Engine                          │
│  └─ Audit                                    │
│                                               │
│  Application Services                        │
│  ├─ ProjectService                           │
│  ├─ WorkstreamService                        │
│  ├─ DependencyService                        │
│  ├─ ProgressService                          │
│  └─ PlanImportService                        │
│                                               │
│  Repository Ports                            │
│        ↓                                      │
│  Prisma Local Adapter                        │
│        ↓                                      │
│  SQLite                                      │
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
