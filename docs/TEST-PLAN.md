# Test Plan

## Unit

### IDs
- human-code generation
- unique collision retry
- external ID cannot become internal PK

### Progress
Test each strategy with:
- 0 items
- partial progress
- 100%
- invalid denominator
- missing metrics
- blocked gates

### Dependency
- no self-dependency
- cycle detection
- blocked/ready evaluation

### Import
- unknown execution mode rejected
- dangling reference rejected
- duplicate human code detected
- dry run has no writes

## Integration

- portfolio → tenant → business → workspace → project creation
- mixed-mode project
- repository many-to-many
- milestone/gate linkage
- snapshot round trip

## Isolation

Seed:
```text
TNT-001 / BUS-001
TNT-002 / BUS-002
```

Verify:
- BUS-001 workspace is not returned in BUS-002 scoped query
- cross-tenant update is rejected by domain service
- portfolio roll-up receives aggregate results without mutation rights

## E2E

Routes:
- Overview
- Execution All
- Sprint
- Migration
- B2B
- B2C
- Product Launch
- Operations
- Expansion
- Project create/edit
- Import dry run
- Backup export

## Accessibility smoke

- keyboard focus
- labels on controls
- color is not sole status indicator
- no horizontal page overflow at mobile viewport

## FR-045 — Managed local file workspace (implemented beta)

FR-045 coverage includes the legacy ProjectFile contract, additive schema parity,
path/reparse containment, filesystem promotion, Business/Project read models,
managed service/API/UI contracts, reconcile/cache equality, local reveal denial and
portable backup/remount behavior. The release commands below are the final gate.

### Unit

- normalize a valid relative Windows path deterministically
- reject absolute, UNC, drive-relative and `..` traversal input
- reject symlink/junction/reparse-point escape outside mounted root
- validate storage-kind-specific fields
- enforce FileLink entity allow-list and Business ownership
- derive cache key/source revision and classify stale entries
- classify external missing/move and require confirmation for ambiguous relink

### Integration

- staged ingest rolls back metadata/temp content after each injected failure point
- Business aggregation includes Business-owned plus owned-Project assets once each
- Project query and mutation reject cross-Business access
- every ProjectFile migrates or appears in an explicit conflict report
- legacy `/api/projects/{id}/files` fixtures remain compatible
- direct SQLite DTO equals rebuilt-cache DTO
- missing/relink reconciliation is audited and idempotent
- backup preview, optional content export and second-root remount preserve ids/links

### Security and E2E

- hosted reveal returns capability-disabled and launches no process
- local reveal verifies viewer, origin/CSRF and final contained path
- Business and Project File Manager loading/empty/error/missing/quarantined states
- download/open behavior, keyboard navigation and 375px viewport

### FR-045 release commands

```text
npm test
npm run test:e2e
npm run build
npm run docs:graph
npm run docs:check
npm run docs:preflight
```

## FR-046 security matrix (implemented beta)

Coverage is implemented in `tests/unit/fr046-session-port.test.js`,
`tests/unit/fr046-entry-read-model.test.js`, `tests/unit/fr046-api-ui-contract.test.js`,
`tests/integration/fr046-entry-contract.test.js` and
`tests/e2e/fr046-entry-contract.spec.js`. It proves OWNER/MEMBER/trusted DEV/empty
grant behavior, absent/expired/revoked session denial, adapter failure, forged-input
immunity, cross-tenant non-disclosure, one-fetch Business Routing and production
demo-fallback denial. The full regression suite also covers the migrated protected APIs.

Playwright owns `prisma/e2e.db` through `tests/e2e/global-setup.js`: every run removes only
that exact ignored database and journal, applies the schema, runs the idempotent seed, and starts
a non-reused server with the same explicit `DATABASE_URL`. The infrastructure contract is anchored
by `tests/unit/playwright-database-bootstrap.test.js`; clean-worktree browser proof is 34 passed and
4 intentionally skipped.

## FR-051 production isolation hardening (repository-local beta)

- [x] binding resolution is server-owned and rejects an unknown, inactive, or destination-mismatched binding;
- [x] the LINE request body cannot select `tenantId` or `businessId` when the Phase 1 runtime is enabled;
- [x] the knowledge reader uses fixed parameterized SQL in `zuri_core` with constructor-bound Tenant and Business ids;
- [x] the runtime rejects Supabase secret/service-role configuration and non-scope-bound database roles;
- [x] migration contract tests prove private schema, forced RLS, composite Tenant/Business ancestry, least-privilege grants, and no `public.business_knowledge`;
- [x] import tests prove source Business codes map to reserved internal UUIDs;
- [ ] read-only remote inventory, migration application, cross-tenant negative probes, reconciliation, advisors, and canary evidence are captured.

Local exit gate: focused and full tests, build, doc graph/check/preflight, secret scan, and diff check pass. Remote exit gate remains intentionally open; production LINE traffic stays disabled.
