# START HERE — Zuri v2 Project Manager Agent Pack

**Pack version:** 1.0  
**Date:** 2026-08-11  
**Target:** Offline-first standalone build, future Zuri v2 module  
**Working codename:** `zuri-v2-lab`

## What you are building

Build a real, local-first Project Tracking / Project Manager module that supports
business and software execution in one system.

This is **not** a Jira clone and **not** a software-only sprint tracker.

The application must support seven canonical execution modes:

1. Software Development
2. Data Migration
3. B2B Sales
4. B2C Marketing
5. Product Launch
6. Operations
7. Business Expansion

A Project may contain multiple Workstreams, and each Workstream may use a different
execution mode.

## Architecture decision

Do **not** refactor the current Zuri application during this build.

Create a new standalone repository/application:

```text
zuri-v2-lab/
```

The Project Manager is the first production-shaped module inside that shell:

```text
src/modules/project-manager/
```

The current Zuri codebase is a compatibility reference only.

## Offline rule

Phase 1 runs entirely on the local machine:

```text
Next.js
  ↓
Server Actions / route handlers
  ↓
Domain services
  ↓
Repository interfaces
  ↓
Prisma
  ↓
SQLite local database
```

No Supabase, Redis, Pusher, LINE, GitHub API, cloud authentication, or external LLM is
required for MVP.

## Future direction

Once stable:

```text
zuri-v2-lab Project Manager
        │
        ├── Option A: merge as Project module into Zuri
        │
        └── Option B: become foundation of Zuri v2
```

The preferred direction is **Option B if the new Portfolio / Tenant / Business /
Workspace hierarchy becomes canonical across the whole product**.

## Agent entrypoint

Read files in this exact order:

1. `AGENTS.md`
2. `MASTER-PROMPT.md`
3. `docs/decisions/ADR-001-STANDALONE-ZURI-V2.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DOMAIN-MODEL.md`
6. `docs/EXECUTION-MODES.md`
7. `contracts/plan-envelope.schema.json`
8. `docs/IMPLEMENTATION-PLAN.md`
9. `docs/ACCEPTANCE-CRITERIA.md`
10. `docs/TEST-PLAN.md`

Then execute `agent/phases/PHASE-00.md` through `PHASE-07.md` in order.

## Source-of-truth rule

If documents conflict, priority is:

```text
AGENTS.md
  >
ADR
  >
ARCHITECTURE
  >
DOMAIN-MODEL
  >
EXECUTION-MODES
  >
IMPLEMENTATION-PLAN
  >
prototype
```

The HTML prototype is visual reference only and is never an architectural authority.
