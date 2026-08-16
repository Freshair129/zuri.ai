# Future Integration Map — Current Zuri → Zuri v2

## Current observed Zuri patterns

The current app:
- uses Next.js App Router
- has dashboard route group
- wraps dashboard in `TenantProvider`
- renders shared `Topbar` and `Sidebar`
- registers modules through `src/config/modules.js`
- uses Prisma/Postgres
- uses Zuri Heritage CSS variables

## What can be reused conceptually

Reuse:
- module registry pattern
- Topbar / Sidebar interaction pattern
- Zuri Heritage design tokens
- App Router organization
- Prisma
- Zod
- Vitest / Playwright
- Lucide icons

Do not blindly copy:
- Tenant-only context assumptions
- auth coupling
- production database
- live integrations

## v2 context candidate

Current:

```text
TenantProvider
```

Future:

```text
PortfolioScopeProvider
  ↓
TenantScope
  ↓
BusinessScope
  ↓
WorkspaceScope
  ↓
ProjectScope
```

Do not implement this globally in current Zuri until Project Manager validates it.

## Database strategy

MVP:
```text
SQLite
```

Future Zuri v2:
```text
PostgreSQL
```

Migration should be handled by:
- domain-level export
- schema migration
- import/reconciliation
not by copying the local SQLite file into production.

## Decision after MVP

Perform a migration impact assessment against:
- auth
- tenant isolation
- employees
- CRM/customer ownership
- conversations
- orders
- marketing
- POS
- schedule
- courses
- module registry
- route middleware

Only then decide module merge vs Zuri v2.
