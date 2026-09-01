---
version: "1.0.0"
created_at: "2026-09-01T00:00:00+07:00,Codex"
last_update: "2026-09-01T00:00:00+07:00,Codex"
status: "accepted"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "implementation-plan"
  scope: "Four-phase evidence-gated plan for surveying, specifying, testing and implementing Asset Management"
---

# Asset Management — Four-phase implementation plan

**Status:** Accepted planning sequence. Runtime work begins only after Phase 3
declares and pins the implementation requirements.

**Decision:** [`ADR-055`](../decisions/ADR-055-ASSET-MANAGEMENT-DOMAIN-AND-PHYSICAL-ASSET-LIFECYCLE-BOUNDARY.md)

**Change envelope:** [`ZV2-CR-009`](../changes/ZV2-CR-009-ASSET-MANAGEMENT-DOMAIN.md)

**Planning baseline:** `4306a294ada8ac002bd80dd07735361fc8d2999e`

## Objective

Add Asset Management as a Business-bound Zuri Product Domain and deliver the MVP
path from equipment inspection through Asset ID issuance, register visibility and
custody transfer, with Tenant/Business isolation, authorization and immutable audit
evidence.

The work is ordered as requested:

1. Survey the repository document and code structure.
2. Survey the documents and code relevant to Asset Management.
3. Update source-of-truth documents and write tests first.
4. Implement code and pass all tests before delivery.

## Rules before work starts

1. Fetch/rebase and enumerate the current registries before using any new ID. If `main` takes an ID, this branch moves to the next free ID; published IDs are never repurposed.
2. Every writing lane uses a dedicated git worktree under ADR-051. The primary checkout is read-only reference state.
3. A lane that runs tests/build/database uses its own real dependency installation, never a junctioned `node_modules`.
4. `G:\zuri` is prior art only and is never modified.
5. Generated views and reports are updated only by `npm run govern`, never hand-edited.
6. Non-trivial source files carry truthful `@req`, `@spec` and `@tested` annotations.
7. Phase 3 RED is an internal test-first checkpoint. Phase 3 and Phase 4 ship as one PR; no RED state is merged.

---

# Phase 1 — Survey repository document and code structure

## Goal

Create an evidence-backed repository map from authoritative enumeration before
making product claims or changing source-of-truth files.

## Work

### Repository and governance

- Read `CLAUDE.md` and `AGENTS.md` completely.
- Record `git status`, branch, worktree and commit baseline.
- Enumerate tracked files with `git ls-files`.
- Inspect `package.json`, `.github/workflows/`, `scripts/` and governance commands.
- Inspect the ID ledger through `npm run docs:ids`; never edit it manually.

### Documentation architecture

Enumerate:

- `docs/PRODUCT.md`;
- `docs/PRD-SDD-v1.0.md`;
- `docs/FEATURES.md`;
- `docs/ARCHITECTURE*.md`;
- `docs/domains/*/CHARTER.md`;
- `docs/decisions/ADR-*.md`;
- sitemap and route inventories;
- roadmap, changes and change-request records;
- generated maps, trace and appendices.

### Code architecture

Enumerate:

- `src/app/` page/layout groups;
- `src/app/api/` handlers;
- `src/modules/` domain/application/infrastructure/components;
- `src/config/` domain/module/navigation registries;
- `src/platform/` shared platform seams;
- Prisma schemas, migrations and seed;
- contracts and import boundaries.

### Test architecture

Enumerate unit, integration, e2e, factories, bootstrap helpers, Vitest/Playwright
configuration and annotation conventions.

## Deliverable

`phase-1-repository-structure-report.md` in the implementation lane, recording:

- commit SHA and survey time;
- document/code/test inventory;
- generated-file ownership;
- build/test/govern commands;
- concurrent-worktree and ID-collision risks;
- unknowns Phase 2 must resolve.

## Exit gate

- No product docs/code/schema changed by the survey.
- No existence claim is inferred from a search miss; enumeration is authoritative.
- Baseline passes:

```text
npm test
npm run build
npm run govern
```

If baseline fails, record the failure and commit SHA and stop. Do not mix baseline
repair with Asset Management work.

---

# Phase 2 — Survey documents and code relevant to Asset Management

## Goal

Fix the real ownership, reuse seams, scope and MVP file set before declaring
requirements or tests.

## Work

### Domain/navigation boundary

Read ADR-008, ADR-011, ADR-013, ADR-025, ADR-029, ADR-038, the sitemap,
`src/config/domains.js`, domain bar/sidebar/command palette consumers, route guard and
Business/domain visibility implementation.

Prove how an additional domain slot behaves at desktop/mobile widths and how the
same visibility predicate protects both navigation and deep links.

### Viewer, authorization and audit

Inspect viewer/session resolution, `tests/factories/viewer.js`, Business ownership/
visibility predicates, AuditEvent services, version/soft-delete patterns and
backup/export/restore authorization.

The report must show why a client cannot grant itself `tenantId`, `businessId` or a
role.

### Schema and naming

Inspect both Prisma schemas, migrations, charter ownership, backup/restore and seed.
Resolve collisions explicitly:

- `FileAsset` is managed file content and is not physical equipment.
- Project Inventory is not the company asset register.
- Product, Branch, Person, Membership, ExternalRef and AuditEvent stay with their established owners.

Candidate MVP aggregates start as:

```text
RegisteredAsset
AssetInspection
AssetAssignment
AssetTransfer
```

Maintenance, Stocktake and Disposal models are added only when the implementation
slice contains requirements/tests for them; no speculative tables.

### Cross-domain runtime truth

Determine whether Commerce/Procurement, HR/People, Branch/location and attachment
contracts exist in runtime or only in documents. If Procurement runtime is absent,
use a typed optional external reference/non-PO intake and do not build Procurement
inside Asset Management.

### UI and dependencies

Inspect Zuri tokens, Thai typography, page/table/form/dialog, loading/empty/error,
responsive patterns, existing QR/barcode support and the `exceljs` import/export
pattern. Do not add a dependency before proving the repository lacks an adequate
existing path and defining its test strategy.

### Tests to reuse

Read representative navigation/visibility, authorization seam, schema migration/
parity, repository transaction, duplicate identity, audit append, backup/restore,
API/UI contract and e2e workflow tests.

## Deliverable

`phase-2-asset-management-impact-report.md`, containing:

- context map and ownership matrix;
- as-is route/schema/service/test inventory;
- exact expected Phase 3/4 file list;
- smallest MVP model/route/API proposal;
- threat/authorization matrix;
- unit/integration/e2e test matrix;
- blockers requiring owner decisions.

## Exit gate

- ADR-055 is corrected if code evidence contradicts a draft assumption.
- Speculative tables/routes are removed from the MVP.
- Every candidate model has exactly one writer.
- Requirement/feature subjects are named before IDs are allocated.
- Baseline remains green and product code is unchanged.

---

# Phase 3 — Update documentation and write tests first

## Goal

Declare attributable architecture/requirements/traceability and create executable
proof before implementation.

## ID gate

After rebase, enumerate the latest ADR, FR/NFR/BR/SEC/SDD, FEAT, ZV2-CR and ledger
state. Then:

- keep `ADR-055`/`ZV2-CR-009` only if they remain collision-free;
- allocate new global requirement IDs by subject;
- add one FEAT that bundles the Asset Management MVP behaviors;
- run `npm run docs:ids -- --write`;
- never edit the ledger or reuse a burnt/published ID.

## Source-of-truth documents

Update only the sources Phase 2 proves necessary:

1. `docs/domains/asset-management/CHARTER.md`, atomically with the new module;
2. optional context map/feature note when rationale needs its own document;
3. `docs/PRD-SDD-v1.0.md` with testable FR/NFR/BR/SEC/SDD rows;
4. `docs/FEATURES.md` with the MVP FEAT bundle;
5. `docs/SITEMAP-DOMAIN-NAV.md` with stable identity and Tier-3 projection;
6. `docs/roadmap/ROADMAP.md` with the implementation/evidence row;
7. product/architecture docs only when Phase 2 proves they are an authority that changes.

Run `npm run govern` after changing source docs. Do not edit generated views.

## Tests before code

### Unit

- Domain navigation, path ownership and Business visibility.
- Asset identity/serial validation and lifecycle transitions.
- Disposed Asset ID non-reuse.
- Viewer/Business authorization and client-supplied-scope refusal.
- Prisma model/index/relation/version contract and SQLite/Postgres parity.
- Explicit proof that `FileAsset` remains unchanged.
- API/UI DTO and route contract.

### Integration

- Inspection → approval → Asset ID in one transaction.
- Duplicate code/serial policy.
- Assignment/transfer history and AuditEvent append.
- Transaction rollback on failure.
- Cross-Business list/detail/mutation isolation.
- Backup/export/restore treatment.

### E2E

- Authorized domain/dashboard visibility.
- Receive → approve → issue Asset ID → find in register.
- Search by Asset ID and serial number.
- Unauthorized domain hidden and deep link denied.
- Responsive navigation and form flow.

## RED checkpoint

Run focused new tests and record failures caused by missing behavior. Expected RED is
an assertion failure, never syntax/import/fixture/bootstrap failure. Do not skip,
weaken or fake an implementation. Phase 3 is not a merge/release state.

## Deliverable

`phase-3-docs-and-red-test-report.md` with IDs, files, commands, generated outputs
and focused RED evidence.

## Exit gate

- `npm run govern` passes.
- Unrelated existing tests remain green.
- New focused tests fail only on the implementation gap Phase 4 owns.
- No product implementation is hidden in this phase.

---

# Phase 4 — Implement code and pass tests before delivery

## Goal

Implement the smallest code/schema/UI change that satisfies Phase 3 requirements and
turns the new tests green without regressing existing behavior.

## Implementation order

### Domain skeleton and registry

- Create `src/modules/asset-management/` according to Phase 2 conventions.
- Add the stable domain projection to the canonical registry.
- Drive domain bar, sidebar and command palette from that registry.
- Connect Business visibility and route guard.
- Add truthful `@req`, `@spec`, `@tested` annotations.

### Schema and migration

- Add only MVP models with declared tests.
- Add resolved relations/indexes/unique constraints.
- Keep SQLite/Postgres parity through the repository workflow.
- Deliver additive migrations; never reset/drop user data.
- Update backup/restore/seed only where requirements demand it.
- Validate both providers and a populated database copy.

### Application and infrastructure

- Domain validation and lifecycle state machine.
- Repository interface and Prisma adapter.
- Inspection/registration transaction.
- Concurrency-safe Asset ID issuance.
- List/detail/search read models.
- Custody assignment/transfer with immutable history.
- Server-side authorization and AuditEvent append.
- Attachment references without changing `FileAsset` semantics.

### API

Freeze routes in Phase 3; likely MVP candidates are:

```text
GET/POST  /api/assets
GET/PATCH /api/assets/[id]
POST      /api/assets/inspections
POST      /api/assets/inspections/[id]/approve
POST      /api/assets/[id]/assignments
POST      /api/assets/[id]/transfers
```

Every mutation resolves the viewer on the server, validates input, derives authorized
Business scope, calls the application service, appends audit evidence in the required
transaction and returns a safe DTO.

### UI

Deliver the Phase 3-declared subset of:

- `/assets` Dashboard;
- `/assets/receiving`;
- `/assets/register`;
- `/assets/[assetId]`;
- assignment/transfer flow.

Use the existing Zuri shell, Heritage design tokens, Thai copy, typography and
`lucide-react`. Cover loading, empty, error, denied and responsive states.

## RED → GREEN sequence

1. Domain validation/state tests.
2. Schema/migration/parity tests.
3. Repository/application transaction tests.
4. Authorization/audit tests.
5. API/UI contract tests.
6. Navigation/visibility tests.
7. E2E happy and denial paths.

Run focused tests after each layer and progressively widen the suite.

## Final verification

Run from an isolated test-capable worktree:

```text
npm test
npm run build
npm run govern
npm run test:e2e
npm run verify
```

Also prove:

- no new skipped/flaky or zero-test run;
- Prisma/migration parity;
- generated docs are current;
- `git diff --check` passes;
- only in-scope files are changed;
- QR/export payloads contain no unnecessary secret/PII;
- denial tests cover Tenant/Business boundaries;
- migration succeeds on populated data.

## Definition of Done

- Architecture and implementation IDs remain collision-free and pinned.
- Asset Management appears only for authorized Business/users.
- Receive → approve → Asset ID → register works.
- Asset IDs are unique and never recycled after disposal.
- Cross-Business reads/writes fail closed.
- Custody transfer has immutable history and audit evidence.
- `FileAsset` behavior and meaning remain intact.
- `npm run verify` passes.
- `phase-4-implementation-report.md` records commit SHA, migrations, commands, test counts and known limitations.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-01 | accepted | Fixed the four ordered survey → relevant survey → docs/tests-first → code/full-verification phases and their evidence gates | working-tree | Codex |
