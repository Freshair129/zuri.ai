# zuri-v2-lab — Project Manager

Offline-first Project Manager for business **and** software execution — the first
production-shaped module of the future Zuri v2. Built standalone per
[ADR-001](../docs/ADR-001-STANDALONE-ZURI-V2.md); the current Zuri app is untouched.

## Quick start

```bash
npm install          # also runs prisma generate
npm run db:push      # create prisma/dev.db (SQLite)
npm run db:clean     # reset local SQLite to an empty, non-demo state
npm run db:seed      # idempotent demo dataset (4 tenants, 7-mode demo project)
npm run dev          # http://localhost:3000 — fully offline after install
```

Reset everything with the demo fixture: `npm run db:reset`. Use `npm run db:clean`
when Overview must show only real imported data and empty states.

## What's inside

- **Scope hierarchy** — Portfolio → Tenant → Business → Workspace → Project → Workstream,
  with topbar selectors. Tenant is a data-isolation boundary, never a branch.
- **Seven execution modes** on one neutral core (WorkContainer/WorkItem):
  Software Sprint, Data Migration, B2B Sales, B2C Campaign, Product Launch,
  Operations, Business Expansion. A project may mix modes.
- **Strategy-based progress** — seven deterministic calculators with evidence and
  warnings; project progress is the weighted roll-up `Σ(ws% × weight)/Σ(weight)`.
  Every displayed percentage has an "Explain" affordance.
- **Universal views** — Overview, All Work (filters/search), Timeline, Dependencies
  (cycle-safe), Milestones & Gates, plus a Ctrl+K command palette.
- **Agent plan import** — paste a PlanEnvelope JSON (`contracts/plan-envelope.schema.json`):
  Zod validation → seven-mode semantic checks → dry-run preview → transactional commit → audit.
  Human creation is edit/review-oriented after intake; direct workstream/item add controls are not
  part of the execution views. SmartGift business knowledge is a separate public projection and
  is never represented as Project work items.
- **Backup** — full snapshot export/import with preview + confirmation.
- **Audit log** — immutable event stream.

## Tests

```bash
npm test             # 75 unit + integration tests (isolated prisma/test.db)
npm run db:seed      # e2e prerequisites
npm run test:e2e     # Playwright smoke over all routes (port 3100)
```

## Stack

Next.js 14 App Router · React 18 · Tailwind 3 · Prisma 5 + SQLite · Zod ·
date-fns · lucide-react · Vitest · Playwright. JavaScript with Zod-validated
boundaries; persisted enums are strings for painless Postgres migration.

## Out of scope (MVP)

Production auth, LINE, Supabase, Redis, Pusher, cloud sync, external AI APIs,
live GitHub API, billing, CRM/POS/marketing, customer PII, current-Zuri DB migration.

See `.agent/reports/FINAL.md` for the acceptance matrix and the Zuri v1 module /
Zuri v2 foundation assessment.
