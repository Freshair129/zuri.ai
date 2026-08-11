# Acceptance Criteria

MVP is complete only when all boxes pass.

## Runtime

- [ ] `npm install` succeeds
- [ ] `npm run dev` boots locally
- [ ] `npm run build` passes
- [ ] application works with network disconnected after dependencies are installed
- [ ] no cloud service is required at runtime

## Persistence

- [ ] SQLite file is created locally
- [ ] CRUD persists across app restart
- [ ] seed command is idempotent or safely resettable
- [ ] export snapshot works
- [ ] import snapshot has preview and confirmation

## Scope

- [ ] Portfolio selector works
- [ ] Business selector works
- [ ] Workspace selector works
- [ ] Project selector works
- [ ] Tenant ID is never used as Branch ID
- [ ] Business records carry Tenant ownership
- [ ] Workspace belongs to explicit scope

## Project

- [ ] create/edit/archive Project
- [ ] create/edit/archive Workstream
- [ ] Workstream has executionMode
- [ ] Workstream has progressStrategy
- [ ] project may mix execution modes
- [ ] repository links are many-to-many
- [ ] dependencies can block work
- [ ] milestones and gates persist

## Seven modes

- [ ] Software Sprint view works
- [ ] Data Migration view works
- [ ] B2B Sales Pipeline works
- [ ] B2C Campaign view works
- [ ] Product Launch view works
- [ ] Operations view works
- [ ] Business Expansion view works

## Progress

- [ ] software progress calculates deterministically
- [ ] migration progress derives from validation evidence
- [ ] B2B weighted pipeline calculates correctly
- [ ] B2C KPI score calculates correctly
- [ ] launch readiness calculates correctly
- [ ] operations score calculates correctly
- [ ] expansion readiness calculates correctly
- [ ] project weighted roll-up is tested
- [ ] UI can explain where a displayed percentage came from

## Agent import

- [ ] JSON Schema/Zod validation
- [ ] rejects unknown execution modes
- [ ] rejects malformed IDs/references
- [ ] dry-run displays inserts/updates/conflicts
- [ ] import is transactional
- [ ] audit event recorded

## UI

- [ ] Zuri Heritage tokens used
- [ ] no purple/cyber theme
- [ ] sidebar/topbar responsive
- [ ] context selectors visible
- [ ] universal views do not use software-only vocabulary
- [ ] mode-specific vocabulary shown only inside correct view
- [ ] empty states are usable
- [ ] command palette works

## Tests

- [ ] unit tests for progress engine
- [ ] integration test for project creation
- [ ] integration test for plan import
- [ ] tenant/business isolation test
- [ ] Playwright smoke test for all 7 views
- [ ] backup export/import test
