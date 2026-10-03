# Standalone FR implementation report

## Summary

The capability registry distinguishes explicit Feature bundles (`FEAT-*`) from
Standalone Functional Requirements (`FR-*`). Work is on `codex/standalone-fr`,
based on `fad8ec6252941ca3de01afdb3116484f86b366c3`, in an isolated worktree.
Complexity C-3; risk MEDIUM. The owner's supplied specification authorizes this
bounded semantic change. No new requirement IDs, persistence models or routes.

## Before

Unbundled FR = implicitly feature-of-one. ADR-025 D11, FEATURES, the FR-124 note
and the Phase B commit-provenance contract repeated this equivalence. The
generator comment and source-verifier test fixture also repeated it. The mixed
readiness count/list was labelled Features, although the wire projection already
had separate `bundle` and `requirement` kinds.

## After

```text
Capability Registry
├── Explicit Feature (FEAT)
│   └── bundled FR(s)
└── Standalone FR
```

Zero explicit memberships means `standalone-fr`; one means `bundled-fr` with
the existing FEAT ID; multiple memberships are invalid. Standalone FRs remain
requirements and retain their IDs if deliberately bundled later.

Hand-written readiness metadata is unchanged: `{ id, primaryDomain, useCase }`.
The schema 2.0 stored projection keeps its established container/count names and
wire kinds. The read-model DTO derives `kind: feature | standalone-fr` from the
validated ID prefix. No synthetic FEAT identity or second editable registry.

## Inventory

| Measure | Exact count |
|---|---:|
| Explicit FEAT | 45 |
| Total canonical FR | 272 |
| Bundled FR | 158 |
| Standalone FR | 114 |
| Invalid multi-FEAT membership | 0 |
| Unknown FR referenced by FEAT | 0 |
| Duplicate FR within a FEAT | 0 |
| Missing standalone readiness metadata | 0 |
| Readiness items | 159 |

Examples verified against membership: FEAT-023 Commerce — Orders & Payments
bundles FR-166 and FR-163. FR-046 Production viewer entry contract is standalone,
with readiness primary domain identity. The request's illustrative "Credential
Login" label was replaced by the actual canonical subject; the FR row is unchanged.

The generated `docs/TRACE.md` inventory covers every canonical FR, in ID order:
membership, classification, owning domain from a canonical FR note, charter-scoped
implementation lanes, readiness item/domain, metadata/use-case presence and
code/test evidence state. A bundled FR uses its FEAT's presentation entry.
126 FRs have no direct owning feature note; that field reads UNKNOWN rather than
promoting presentation metadata into a charter ownership claim. Implementation
lanes remain available separately. Evidence status is a trace state, not proof
that tests passed or that production is ready.

## Source files changed

| File | Reason |
|---|---|
| `docs/FEATURES.md` | Canonical taxonomy, 0..1 membership, bundling rules, real examples, compatibility contract and corrected terminology |
| `docs/decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md` | Revision 3 amends D11 explicitly without changing ID meanings |
| `docs/PRODUCT.md` | Product-level pointer to the two semantic entity types |
| `docs/PRD-SDD-v1.0.md` | Classification pointer above the unchanged requirement registry |
| `docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md` | Readiness DTO, labels, inventory and governance contract |
| `docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md` | Standalone terminology; historical bound-key/hash authority unchanged |
| `llms.txt` | Index describes both capability types |
| `apps/server/scripts/capability-registry.mjs` | Shared raw-row parsing, membership validation, deterministic inventory and vocabulary guard |
| `apps/server/scripts/doc-graph.mjs` | Validate before duplicate/unresolved-edge normalization; generate classification/TRACE; reject stale capability views and bundled runtime output |
| `apps/server/scripts/doc-preflight.mjs` | Independently revalidate current source membership/metadata and compare the saved projection; enumerate live and orientation documentation for terminology |
| `apps/server/scripts/doc-views.mjs` | FR classification and complete inventory in TRACE |
| `apps/server/scripts/domain-state.mjs` | Refuse invalid membership even for direct generator callers; preserve wire schema and readiness calculations |
| `apps/server/contracts/domain-state.schema.json` | Tie wire kind to ID prefix; standalone item contains one FR |
| `apps/server/src/modules/project-manager/application/product-readiness-read-model.js` | Derive semantic DTO kinds for both summary and domain reads |
| `apps/server/src/modules/project-manager/components/ProductReadinessDashboard.jsx` | Feature / Standalone FR badges, Capabilities aggregates/list and explanation |
| `apps/server/src/modules/platform-control/components/DomainMapView.jsx` | Keep the other visible readiness consumer semantically consistent |
| `apps/server/tests/unit/capability-registry.test.js` | Valid partitions, invalid memberships/metadata, later bundling, deterministic inventory and vocabulary refusal |
| `apps/server/tests/unit/doc-links-cli.test.js` | Real CLI rejection of invalid registry/docs and stale classification views |
| `apps/server/tests/unit/doc-views.test.js` | TRACE shows both FR classifications |
| `apps/server/tests/unit/domain-state.test.js` | Schema rejects kind/prefix mismatch |
| `apps/server/tests/unit/fr124-product-readiness-read-model.test.js` | Semantic kinds and summary/drilldown consistency |
| `apps/server/tests/unit/fr124-product-readiness-ui.test.js` | Rendered labels/explanation and unchanged six-KPI layout |
| `apps/server/tests/unit/platform-control-domain-map.test.js` | Other consumer renders the corresponding type labels |
| `apps/server/tests/unit/governance-source-verifier.test.js` | Remove ambiguous fixture vocabulary while retaining immutable-commit tests |
| `apps/server/tests/e2e/fr124-product-readiness.spec.js` | Browser labels, standalone search and domain drilldown |
| `.brain/rca/2026-10-03-standalone-fr-capability-classification.md` | Evidence-backed cause, detection gap and prevention |
| `.brain/reports/2026-10-03-standalone-fr-implementation.md` | This delivery report |

## Consumers audited

The summary and `[domain]` pages both authorize server-side before calling the
Product Readiness read model. Platform Control's `program-domain-map.js` projects
that DTO into `DomainMapView`; `ProgramRoadmapBoard.jsx` renders it. The programme
container generator and data-pipeline-map generator read the stored snapshot.
The graph generates domain state, FEATURE-MAP, DOMAIN-MAP, TRACE, Appendix D and
document navigation; preflight and focused governance tests consume those views.
The source-verifier separately proves FEAT/FR keys against immutable bound Git
commits; its runtime semantics and historical evidence are unchanged.

## Generated files

Regenerated through source generators, never hand-edited:

- `apps/server/runtime/domain-state.json` — tracked application snapshot; only
  trace/test evidence additions change, with prior readiness values preserved.
- `docs/.doc-graph.json`, `.domain-state.json`, `.data-pipeline-map.json`,
  `.preflight-report.json`, `.doc-graph-drift-report.json`.
- `docs/FEATURE-MAP.md`, `DOMAIN-MAP.md`, `TRACE.md`, `DOCUMENT-LINKS.md` and
  `docs/appendices/D-traceability.md`.
- `llms-full.txt`.

ADR-081 makes the docs/corpus outputs ignored build artifacts; only the runtime
domain-state snapshot above is a changed tracked generated file. Rebuilding
unchanged outputs does not imply they changed. FEATURE-MAP appends classification
columns so existing delivery-attribution column positions remain stable.

## Governance

Generation refuses unknown FR targets, duplicate members, empty bundles,
multiple FEAT memberships, missing/duplicate/unknown metadata and blank use cases.
Bundling a Standalone FR makes its separate readiness metadata invalid.
Validation occurs before the graph deduplicates or discards unresolved edges.
The vocabulary check uses the graph/preflight live-document enumeration plus
README, CLAUDE, AGENTS and llms.txt; archives remain excluded. Structural rules
use the existing graph and table splitter rather than text-search inference.
`docs:check` additionally refuses stale FEATURE-MAP, TRACE and the runtime snapshot.

## UI

Both `/platform/product-readiness` and `/platform/product-readiness/[domain]`
show **Feature** beside FEAT entries and **Standalone FR** beside direct FR
entries. The mixed count and list use **Capabilities**, with a short Thai
explanation of why an FR appears independently. Use cases, filters, evidence,
readiness calculations, authorization and layout are preserved. Platform
Control's Domain Map uses the same labels.

## Preservation evidence

A direct comparison against HEAD confirmed all FR and FEAT registry rows are
byte-identical after newline normalization. All 159 readiness metadata entries
are deeply equal. Every existing projected ID, wire kind, membership, domain,
use case, readiness status, progress and blocker is unchanged. The ID ledger
is untouched. No network/provider/database production action was performed.

## Version diff

| Document/contract | Before → after |
|---|---|
| FEATURES | 1.63.0b → 1.64.0b |
| ADR-025 | revision 2 → revision 3 |
| FR-124 note | 1.1.0b → 1.2.0b |
| PRODUCT | 1.2.0b → 1.3.0b |
| PRD-SDD | latest history 1.248.0b → 1.249.0b; stale frontmatter/control fields aligned |
| Phase B commit-provenance contract | 0.1.1b → 0.1.2b |
| Stored domain-state schema | 2.0 → 2.0 (same fields and valid wire values, stricter constraints) |
| FR/FEAT identities, subjects and membership | unchanged |

## Verification

All commands ran locally in this worktree. No hosted CI result is inferred.

| Command/check | Exact outcome |
|---|---|
| `npm --prefix apps/server ci --no-audit --no-fund` | PASS, exit 0 |
| `npm --prefix apps/edge ci --no-audit --no-fund` | PASS, exit 0 |
| Initial `npm test` before generating this worktree's derived docs | FAIL, exit 1: 6,704 passed, 32 skipped, 5 failed due to missing generated inputs; this was not a pristine baseline proof |
| Focused tests, first attempt | FAIL: 55 passed, 1 failed; strict AJV required an explicit array type in the added conditional schema; corrected |
| Expanded focused tests, next attempt | FAIL: 61 passed, 1 failed; CLI test exposed unknown membership being dropped before validation; validation moved before graph normalization |
| Focused nine-file suite, after corrections | PASS, exit 0: 62 tests in 9 files |
| `npm --prefix apps/server test -- tests/unit/doc-links-cli.test.js` after root-document guard | PASS, exit 0: 1 test |
| `npm run govern` (graph → check → strict preflight for both scopes) | PASS, exit 0: latest server preflight 0 critical, 1 warning, 32 info |
| `npm run docs:llms` | PASS, exit 0 |
| `npm run docs:check` | PASS, exit 0 |
| `npm run docs:llms:check` | PASS, exit 0 |
| `npm run verify`, with `E2E_SERVER_MODE=production` | **FAIL**, exit 1 at browser suite; governance PASS, unit/integration 6,717 passed / 32 skipped, production build PASS including lint/type checks |
| Browser stage of that first `verify` | FAIL: 219 passed, 4 skipped, 2 failed, 1 flaky. Our new FR-124 search assertion matched multiple cards and was corrected to select the exact FR-046 card. The other failures were pairing cases in unchanged files |
| `npm --prefix apps/server run test:e2e`, with `E2E_SERVER_MODE=production`, after the FR-124 assertion correction | **FAIL**, exit 1 under the strict flaky gate: 221 passed, 4 skipped, 1 flaky. All FR-124 cases and the previously failing pairing cases passed |
| Local Playwright visual probe against the production build | PASS, exit 0: summary, FEAT-023, FR-046, identity drilldown, mobile 390×844 without horizontal overflow; 0 console errors |
| Registry/metadata/readiness comparison against HEAD | PASS: all original FR/FEAT rows, metadata and readiness values preserved |
| `git diff --check` | PASS, exit 0 |

The focused nine-file command was:

```powershell
npm --prefix apps/server test -- tests/unit/doc-links-cli.test.js tests/unit/capability-registry.test.js tests/unit/domain-state.test.js tests/unit/doc-views.test.js tests/unit/fr124-product-readiness-read-model.test.js tests/unit/fr124-product-readiness-ui.test.js tests/unit/platform-control-domain-map.test.js tests/unit/governance-source-verifier.test.js tests/unit/doc-graph-delivery-attribution.test.js
```

Verification logs and screenshots are retained locally under
`output/playwright/standalone-fr-*`; failure screenshots/traces are under
`.playwright-cli/standalone-fr-first-run` and `standalone-fr-second-run`.
The isolated visual probe stopped its own browser and server after inspection.

## Remaining issues

**Full repository acceptance is not satisfied.** The latest browser run passed
the FR-252 Project Feature snapshot/tombstone case only on retry:
`apps/server/tests/e2e/project-feature-mutations.spec.js:362`; its dialog did not
close within 10 seconds at line 422. That test and its mutation implementation
were not changed here. Its root cause and relationship to this branch remain
unverified; the observed flake is not asserted to be a proven baseline defect.
The strict gate remains intact. Expanding into this separate workflow was raised
with the owner; no out-of-scope repair is included in this diff.

Governance retains one warning for 10 annotations pointing at unknown nodes.
It does not block strict preflight and was not broadened into this change.

The verification above predates the owner's subsequent commit/push authorization.
No deployment, remote CI or merge is claimed by this report.
