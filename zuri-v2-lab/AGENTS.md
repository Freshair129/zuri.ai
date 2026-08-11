# AGENTS.md — zuri-v2-lab

Working rules for agents in this repository. Full authority chain lives in the
spec pack at the repository parent (`D:\zuri-ai`): AGENTS.md > ADR > ARCHITECTURE >
DOMAIN-MODEL > EXECUTION-MODES > IMPLEMENTATION-PLAN > prototype.

## Hard rules (inherited)

1. Never modify current Zuri (`G:\zuri`) — read-only reference.
2. Hierarchy: Portfolio → Tenant → Business → Workspace → Project → Workstream.
3. `tenant_id` = isolation. Never model a branch as a tenant.
4. External IDs (tax id, GitHub repo id, LINE id) are never primary keys. Internal UUIDs + human codes.
5. No template picker in project creation; execution mode belongs to Workstreams.
6. Only seven canonical execution modes (see `src/lib/validation/enums.js`).
7. One neutral core (WorkContainer/WorkItem) behind all seven execution views.
8. Progress is strategy-based; project roll-up is weighted. Never global tasks_done/tasks_total.
9. Offline-first: SQLite via Prisma; services behind repository-friendly modules; persisted enums are strings.
10. Zuri Heritage tokens (`src/app/globals.css`); no purple/cyber theme.
11. Plan import: validate → dry-run → confirm; plans are data, never executed.
12. Immutable AuditEvent stream for meaningful state changes.

## Layout

- `src/modules/project-manager/` — module boundary (domain/application/progress/import/components/views).
- `src/app/api/` — route handlers (thin; call application services).
- `src/app/(pm)/` — UI routes.
- `prisma/seed.js` — idempotent demo dataset (`npm run db:seed`, reset via `npm run db:reset`).
- `tests/` — unit, integration (Vitest, isolated `prisma/test.db`), e2e (Playwright, port 3100).

## Commands

```bash
npm run dev        # local app (SQLite, no cloud)
npm run build
npm test           # unit + integration
npm run test:e2e   # Playwright (seeds must exist: npm run db:seed)
```
