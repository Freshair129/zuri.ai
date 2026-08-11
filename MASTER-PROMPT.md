# MASTER PROMPT — Build Zuri.Ai (zuri v2) Project Manager

You are the lead implementation agent for `Zuri.Ai`.

Your job is to build the Project Manager described by this repository.

## First action

Do not code immediately.

Read:
- `00-START-HERE.md`
- `AGENTS.md`
- all documents listed by START HERE

Then create:

```text
.agent/reports/00-preflight.md
```

The preflight report must contain:
- understood architecture
- chosen exact dependency versions
- target directory tree
- implementation risks
- any conflicts found in specs
- plan for Phase 00–07

If there is no blocking contradiction, continue without asking for confirmation.

## Technical baseline

Align with current Zuri where useful:

```text
Next.js 14 App Router
React 18
Tailwind CSS 3
Prisma 5
Zod
date-fns
lucide-react
Vitest
Playwright
```

For this standalone local build:

```text
database = SQLite
authentication = local demo identity only
network integrations = disabled
```

Avoid introducing a new state-management library unless there is a clear need.

## Repository structure

Create this shape:

```text
zuri-v2-lab/
├── AGENTS.md
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── seed.js
├── src/
│   ├── app/
│   │   ├── layout.jsx
│   │   ├── page.jsx
│   │   ├── api/
│   │   └── (pm)/
│   ├── components/
│   │   ├── layouts/
│   │   └── ui/
│   ├── config/
│   │   └── modules.js
│   ├── context/
│   │   └── ScopeContext.jsx
│   ├── lib/
│   │   ├── db.js
│   │   ├── ids.js
│   │   └── validation/
│   └── modules/
│       └── project-manager/
│           ├── domain/
│           ├── application/
│           ├── infrastructure/
│           ├── components/
│           ├── views/
│           ├── progress/
│           └── import/
├── tests/
├── docs/
└── .agent/reports/
```

You may improve this tree, but preserve the module boundary.

## MVP functional scope

Implement:

1. Portfolio / Tenant / Business / Workspace selectors
2. Workspace CRUD
3. Project CRUD
4. Workstream CRUD
5. seven execution modes
6. neutral WorkContainer / WorkItem model
7. Milestones / Gates
8. Dependencies
9. Repository records + project linking
10. strategy-based progress calculation
11. Project weighted progress roll-up
12. plan-envelope JSON import with dry run
13. JSON backup export/import
14. audit log
15. seed/demo dataset
16. responsive Zuri Heritage UI
17. command palette
18. filters/search
19. tests

## What not to implement

Do not implement in this build:
- production login
- LINE
- Supabase
- Redis
- Pusher
- cloud sync
- external AI API
- live GitHub API
- billing
- CRM
- POS
- marketing automation
- customer PII
- current Zuri database migration

## Offline data storage

Use Prisma + SQLite.

Represent domain enums as application constants / Zod enums and persisted strings so
the data model can migrate to Postgres without connector-specific enum coupling.

Use transactions for multi-record operations.

## Definition of Done

Do not claim completion until all requirements in:

```text
docs/ACCEPTANCE-CRITERIA.md
```

pass.

Final report:

```text
.agent/reports/FINAL.md
```

It must include:
- implemented features
- screenshots/routes
- schema summary
- test results
- known limitations
- future Zuri integration map
- whether the code is suitable for:
  - merge as Zuri module
  - foundation of Zuri.Ai ( Zuri v2 )
