---
version: "1.0.0"
created_at: "2026-09-01T00:00:00+07:00,Codex"
last_update: "2026-09-01T00:00:00+07:00,Codex"
status: "complete-red"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "phase-evidence"
  scope: "Phase 3 requirements, immutable IDs and intentional focused RED evidence for ZV2-CR-009"
---

# ZV2-CR-009 — Phase 3 documents and RED tests

## Outcome

Phase 3 declared the Asset Management foundation under immutable global IDs, added
the accepted charter/context/feature documentation and wrote focused executable tests
before product implementation. The focused run reached intentional assertion RED:
the tests loaded correctly and failed only because the Asset contract, calculator,
domain registry, pipeline catalog, schema, backup entries and migration did not yet
exist.

## Allocated identities

`npm run docs:ids -- --write` pinned 12 new subjects and left the full ledger at 451
IDs:

| Family | IDs | Subject |
|---|---|---|
| Feature | FEAT-015 | Asset Management Foundation |
| Functional | FR-133..136 | domain/register, evidence intake, temporal allocation, depreciation candidate |
| Non-functional | NFR-021 | deterministic, replay-safe, explainable Asset intake/calculation |
| Business rules | BR-023, BR-024 | single writers; payment/PR/PO/lot approval gates |
| Security | SEC-023 | scope/evidence/model fail-closed boundary |
| Design | SDD-078..080 | separate identities; convergent pipeline; temporal/projection/Finance candidate |

ADR-055, CR-014, ZV2-CR-009 and their established subjects remained collision-free.

## Source documents

### Added

- `docs/domains/asset-management/CHARTER.md`
- `docs/domains/asset-management/CONTEXT-MAP.md`
- `docs/domains/asset-management/features/FR-133-asset-management-foundation.md`
- Phase 1, Phase 2 and this Phase 3 evidence report.

### Updated

- `docs/PRD-SDD-v1.0.md`
- `docs/FEATURES.md`
- `docs/SITEMAP-DOMAIN-NAV.md`
- `docs/roadmap/ROADMAP.md`
- CR-014, ADR-055, ZV2-CR-009 and the four-phase plan.

The feature note owns the detailed user stories, canonical envelope, intake and
validation rules, Excel/Sheet columns, LINE handoff boundary, Project allocation,
depreciation behavior and low-fidelity wireframes. No disconnected UX authority was
created.

## Tests written before implementation

| File | Behavior fixed by the test |
|---|---|
| `tests/unit/asset-management-contract.test.js` | strict envelope, payment/PR/PO, lot/expiry, scope, OCR candidate, temporal overlap |
| `tests/unit/asset-depreciation.test.js` | straight-line schedule, residual floor and rounding remainder |
| `tests/unit/asset-management-navigation.test.js` | unique live domain, deep-link ownership and Business visibility |
| `tests/unit/asset-management-pipeline-contract.test.js` | distinct definition/contract and stable nine-stage catalog |
| `tests/unit/asset-management-schema-contract.test.js` | nine additive models, FileAsset separation, backup allow-list and non-destructive migration |

## Intentional RED evidence

Command:

```text
npx vitest run tests/unit/asset-management-contract.test.js \
  tests/unit/asset-depreciation.test.js \
  tests/unit/asset-management-navigation.test.js \
  tests/unit/asset-management-pipeline-contract.test.js \
  tests/unit/asset-management-schema-contract.test.js --reporter=dot
```

Result: **5 test files failed; 29 tests failed, 1 passed, 30 total**.

Representative assertion gaps:

- `Asset intake contract must exist before this behavior can pass`;
- `Asset depreciation calculator must exist`;
- domain registry contained zero `assets` entries and `/assets` resolved to `projects`;
- Asset pipeline exports were `undefined`;
- all nine Prisma models, backup entries and additive migration were absent.

The single pass proves the existing `isDomainVisible` predicate already denies an
unlisted domain; Phase 4 must register Asset without weakening that predicate.

The first sandboxed test attempt could not load `vitest.config.js` because esbuild
was denied parent-directory traversal. It was rerun with approved test-command access;
that infrastructure failure is not counted as RED. The recorded run fully bootstrapped
Prisma/Vitest and failed at assertions only.

## External gates preserved

No test or document reports the following as implemented: LINE attachment-byte fetch,
OCR/Vision provider execution, live Google Sheet synchronization, Procurement PR/PO
lookup, Finance posting or Project Inventory allocation projection.

## Exit decision

Phase 3 is complete at the required internal RED checkpoint. Proceed to Phase 4 and
turn these exact tests green before widening verification.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-01 | complete-red | Pinned 12 IDs, updated approved sources, wrote 30 focused tests and recorded 29 expected assertion failures before implementation | working-tree | Codex |
