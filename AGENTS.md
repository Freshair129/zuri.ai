# AGENTS.md — Zuri.Ai v2 Project Manager

## Mission

Implement an offline-first Project Manager that can later become a first-class Zuri
module or the first module of Zuri v2.

The system must model business execution, not just software delivery.

## Non-negotiable rules

### 1. Do not modify current Zuri

The existing `Freshair129/zuri` repository is read-only reference during this build.
The existing `G:\zuri` is the current working Zuri V1 project — **read-only compatibility
reference**. Do not copy it into this repo; `zuri-v2-lab` is built standalone per
ADR-001. Porting V1 modules happens only in a later integration phase
(see `zuri-v2-lab/docs/ZURI-INTEGRATION-ASSESSMENT.md`), decided after MVP dogfooding.
The existing `D:\workspace\zuri-command-agent` is a LINE OA agent — out of MVP scope
(LINE is on the do-not-implement list). Never read or copy its `.env` (secrets).
Revisit merge-vs-rebuild at the integration phase.

> Resolution note (2026-08-11, confirmed by owner): an earlier revision of this
> section both forbade and required copying `G:\zuri`. Standalone build is the
> confirmed interpretation, consistent with MASTER-PROMPT scope and ADR-001.
>
> **Amendment (2026-08-12, ADR-003):** the destination changed — V2 now replaces V1
> by reusing it. **Copying V1 → V2 is permitted and expected** (web UI except
> auth/identity, lifted per module at that module's cutover). Everything below still
> holds: `G:\zuri` itself is never edited, its database is never mutated, and its
> auth is never changed. The rule is one-directional reuse, not shared ownership.

Do not:
- edit it
- migrate its production database
- change its auth
- change its Tenant semantics in place

### 2. New root hierarchy

Canonical hierarchy:

```text
Portfolio / Business Group
  ↓
Tenant
  ↓
Business
  ↓
Workspace
  ↓
Project
  ↓
Workstream
```

Supporting entities:

```text
LegalEntity
Branch
Product
Person
Membership
Repository
Milestone
Gate
Dependency
WorkContainer
WorkItem
Metric
Artifact
AuditEvent
```

### 3. Tenant is isolation, not branch

Never model a branch as a Tenant.

```text
tenant_id   = security/data isolation boundary
business_id = operating business
branch_id   = branch/location
```

### 4. External IDs are not primary keys

Tax ID, DBD number, GitHub repo ID, LINE user ID, etc. are external identifiers.

Use internal UUID primary keys plus human-readable codes.

### 5. No template picker

Do not start Project creation with:

```text
Choose Software / Sales / Marketing template
```

Instead:
- user/agent creates objective
- planning agent decomposes Workstreams
- every Workstream has `executionMode`
- UI activates the correct view automatically

Manual mode override may exist in Settings/Advanced, not as the primary creation flow.

### 6. Only seven canonical execution modes in v1

```text
SOFTWARE_SPRINT
DATA_MIGRATION
B2B_SALES
B2C_CAMPAIGN
PRODUCT_LAUNCH
OPERATIONS
BUSINESS_EXPANSION
```

Do not invent new canonical modes.

### 7. Universal core, domain views

The seven execution views must use one neutral core data model.

Do not create seven unrelated mini-applications.

### 8. Progress is strategy-based

Never use `tasks_done / tasks_total` as universal project progress.

Each Workstream has:
- executionMode
- progressStrategy
- progressWeight
- progress evidence

Project roll-up is weighted.

### 9. Offline-first, sync-ready

MVP uses local SQLite only.

All domain services must go through repository interfaces so a future Postgres adapter
can replace local persistence.

Persist:
- `createdAt`
- `updatedAt`
- `deletedAt` when applicable
- `version`

Maintain an immutable AuditEvent stream for meaningful state changes.

Do not implement network sync in MVP.

### 10. Zuri Heritage UI

Use Zuri design tokens.

Primary:
```text
#E8820C Amber Citrus
#F09420 Brand Hover
#B86A08 Brand Dark
#FDE8D0 Brand Tint
#FFF8F0 Brand Surface
#F7F8FA App Surface
#FFFFFF Card
#EFF1F3 Mid Surface
#D6ECFA Rest Blue
#3D7A9E Rest Blue Text
#C6A052 Mustard
```

Navigation glass:
```text
rgba(31, 41, 55, 0.98)
```

Font stack:
```text
IBM Plex Sans Thai, Manrope, sans-serif
```

Use `lucide-react` icons.

### 11. UI architecture

Universal views:
```text
Overview
All Work
Timeline
Dependencies
Milestones & Gates
Calendar
Table
```

Execution views:
```text
Sprint
Migration
B2B Sales
B2C Campaign
Product Launch
Operations
Business Expansion
```

Context selectors:
```text
Portfolio
Business
Workspace
Project
```

### 12. Agent plan import

The application must accept a structured plan generated outside the app.

Contract:
```text
contracts/plan-envelope.schema.json
```

Import flow:
```text
Agent JSON
  ↓
Zod/JSON Schema validation
  ↓
dry-run preview
  ↓
conflict check
  ↓
transactional import
  ↓
AuditEvent
```

Never execute arbitrary code from imported plans.

### 13. Repository tracking is local metadata in MVP

Repository records may store:
- provider
- external repository id
- owner/name
- URL
- default branch
- project role
- optional path scope

Do not require GitHub API access.

### 14. Testing is part of implementation

Every phase ends only after:
- tests pass
- build passes
- no TypeScript/ESLint blocking errors
- agent writes phase report

### 15. Do not fake completion

Mock/seed data is allowed for demos.

Core CRUD, persistence, progress calculation, filtering, plan import, and at least one
working view for each of the seven execution modes must be functional.
