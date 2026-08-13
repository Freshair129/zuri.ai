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
