# Architecture Notes — zuri-v2-lab

| Field | Value |
|-------|-------|
| **Version** | 1.0.1 |
| **Status** | Approved |
| **Author** | Claude (build agent) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-11 |

## Layering

```text
Next.js App Router (src/app)
  UI routes (pm group) — client components, Zuri Heritage tokens
  API route handlers (src/app/api) — thin, call application services
        ↓
Application services (src/modules/project-manager/application)
  scope / project / work / milestone-gate / dependency / repository /
  progress / backup / audit
        ↓
Pure domain logic (progress/strategies.js, rollup.js, import/plan-schema.js)
        ↓
Prisma client (src/lib/db.js singleton)
        ↓
SQLite (prisma/dev.db; tests use prisma/test.db)
```

- Route handlers never touch Prisma models directly for business operations; they
  call services. Services own validation (Zod), human-code generation, audit, and
  transactions. Progress calculators and plan validation are pure functions —
  fully unit-testable without a database.
- The app shell (`src/components/layouts`, `src/config/modules.js`) knows only
  routes exported by the module — the module boundary of `src/modules/project-manager`
  holds all PM domain knowledge.

## Persistence conventions

- UUID PKs (`@default(uuid())`), unique human `code` per entity for display/import.
- `createdAt`/`updatedAt` everywhere; `version` optimistic counter on aggregate roots;
  `deletedAt` soft delete for Project/Workstream/WorkItem.
- Persisted enums are strings; the single source of truth is
  `src/lib/validation/enums.js` (Zod enums) — Postgres migration requires no
  connector enum work.
- JSON columns (`viewConfigJson`, `metricDataJson`, `metadataJson`, `evidenceJson`,
  `payloadJson`) are stringified and Zod-validated at the boundary.

## Progress engine

Calculators receive a hydrated bundle `{workstream, viewConfig, items, containers,
milestones, gates}` and return `{percent, evidence, warnings}`. The service adds
`calculatedAt` and refreshes `Workstream.progressCache` (cache is advisory —
progress is always recomputable). Roll-up: `Σ(ws% × weight) / Σ(weight)`.

## Import pipeline

`zPlanEnvelope` (strict Zod) → `validatePlanSemantics` (codes/refs) → `dryRunPlan`
(read-only diff vs DB, workspace resolution) → `commitPlan` (single transaction,
upsert-by-code, dependency code→id resolution, AuditEvent). Conflicts always block.

## Known trade-offs

- Client-side data fetching (SWR-less `useFetch`) keeps the MVP simple; a server-
  component read path is a natural next step.
- Kanban transitions use selects, not drag-and-drop.
- Snapshot restore is whole-database replace (previewed + confirmed), not a merge.
- `infrastructure/` folder from the target tree was folded into `application/`
  (services are already the Prisma adapters); a Postgres port would extract the
  Prisma calls behind repository interfaces per service.
