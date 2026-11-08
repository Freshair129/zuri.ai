# P0b — Superseded FR readiness projection

**Disposition:** P0b/P0c product changes and the missing FR-069 fixture metadata are in place. The lead's Windows run had 43 passed and 1 fixture failure before that metadata was added; the post-correction test result is not yet known. Generated runtime files were not edited in this follow-up.

## Root cause

The canonical graph already identifies FR-189 as `status: superseded` while its `declared` value is `n/a`; this is not a status-parser defect. In `apps/server/scripts/domain-state.mjs:248-276`, `isSuperseded()` recognizes the graph status, but the active-bundle loop previously removed every current FEAT member from the excluded set. That unconditional deletion reactivated individually superseded FRs bundled by a current FEAT. The fix preserves the annotation-lag rule only when the FR's own row is not superseded.

The lead's Windows `govern` run then exposed a consumer gap: `data-pipeline-map.mjs` indexed FR status only from active and historical feature projections. A retired FR inside a still-active FEAT was correctly absent from active readiness membership, but the map could not resolve its historical `not_applicable` row and stopped `docs:graph` on FR-144.

## Diff summary

- `apps/server/scripts/domain-state.mjs`: keep individually superseded FRs excluded; project their domain rows as `[historical]` / `not_applicable`; use zero progress and omit them from active feature/domain/readiness rollups and feature requirement lists; prevent historical evidence from creating test, MCP or runtime-contract findings; move an all-retired FEAT projection to history with zero progress and a blocker.
- `apps/server/tests/unit/domain-state.test.js`: add regressions for a superseded FR in a current FEAT, historical test evidence, an all-retired FEAT, and a current FR whose declaration annotation lags; strengthen the existing superseded-FEAT case.
- No doc-graph parser change and no generated file edit.

## Consumer check

`apps/server/src/modules/project-manager/application/product-readiness-read-model.js:1` imports `apps/server/runtime/domain-state.json` directly. Its test checks active `requirementIds` against `overall.requirementCount`, and the UI test checks active nested feature requirements against the same denominator. Therefore mixed active FEAT projections retain active IDs and requirements only; superseded FRs remain resolvable in the domain's `[historical]` / `not_applicable` requirement row. The data-pipeline map now indexes that row without reintroducing it into readiness. A historical row found only at domain level has no FEAT association in the map; active FRs retain their existing FEAT association.

## Verification

- Passed earlier, before the FR-069 fixture follow-up: `node --check scripts/domain-state.mjs`; `node --check tests/unit/domain-state.test.js`; `git diff --check` on the two scoped files.
- Passed earlier: direct Node projection harness covering an individually superseded FR, a superseded FEAT, an all-retired FEAT, declaration lag, the FR-124 count invariant, and AJV schema validation.
- Passed earlier: direct collector harness confirms historical test evidence does not create `TEST-001`, `CONTRACT-001`, or `REQ-FR-189` findings.
- Earlier local Vitest attempt blocked before test execution: `npx.cmd vitest run tests/unit/domain-state.test.js tests/unit/fr124-product-readiness-read-model.test.js tests/unit/doc-graph-retired-rules.test.js` failed at startup with `spawn EPERM` from esbuild. The lead later ran the specified four-file command on Windows; see the P0c follow-up below.
- Earlier local `npm.cmd run docs:graph` and `npm.cmd run govern` attempts reached `spawnSync git EPERM` in `apps/server/scripts/canonical-document-registry.mjs:91`. That `govern` run completed registry, inventory, and identity checks before stopping at graph generation; the lead's later run is recorded below.

## Remaining lead verification

From `apps/server`:

```text
npx vitest run tests/unit/domain-state.test.js tests/unit/fr124-product-readiness-read-model.test.js tests/unit/doc-graph-retired-rules.test.js tests/unit/data-pipeline-map.test.js
```

After the lead regenerates the stale view, from the repository root:

```text
npm run docs:views
npm run govern
```

After those complete, inspect the regenerated `apps/server/runtime/domain-state.json` and confirm there are no FR-189 or FR-260–FR-264 findings and no superseded FR in active readiness at verified/100%.

## P0c follow-up (2026-11-08)

- `domain-state.mjs` keeps active FEAT `requirementIds` and nested requirements limited to active members so the FR-124 read-model/UI denominator remains consistent. The generated domain evidence retains individually retired rows as `[historical]` / `not_applicable`; active progress, blockers, readiness and findings continue to use active members only.
- `data-pipeline-map.mjs` now resolves `not_applicable` rows from domain requirements when no feature projection contains that FR. It carries the historical label/status into the map. `not_applicable` is neutral when deriving node build status; a node with only retired requirements remains `DECLARED`.
- The mixed-bundle regression now has one active FR and one superseded FR. It asserts the active FEAT remains ready at 100%, the retired FR remains in domain evidence without a finding, and the data-pipeline map resolves a retired FR while excluding it from active build status.
- Passed: direct Node domain-state-to-pipeline harness for the mixed active/superseded case; syntax checks for the four scoped code/test files; `git diff --check`.
- Earlier local attempt blocked before test execution because esbuild returned `spawn EPERM`; the lead subsequently ran the requested four-file command on Windows and reported 43 passed / 1 failed before the fixture correction.
- The lead's post-P0c `npm run govern` found no remaining FR-189, FR-26x or FR-14x `is ...` findings; FR-189 is `[historical]` / `not_applicable`. Governance stopped only at `docs:views:check` because `docs/features/FEAT-017/verification.md` is stale. The lead will regenerate it with `docs:views`.
- Independent read-only review: no blocking findings.

### Lead Windows run and fixture correction (2026-11-08)

- The sole test failure was in `keeps one superseded FEAT member resolvable while readiness uses only its active member`: the explicit presentation omitted FR-069.
- This is a fixture defect, not a product projection defect. The synthetic `featureNodes` already includes FR-069, and the synthetic `featureEdges` bundle FEAT-999 only to FR-003. The projection correctly treats an FR with no bundle edge as a standalone candidate and requires its presentation row. P0c records all bundle targets before filtering retired members, so its active-member filtering does not turn a previously bundled FR-069 into a standalone candidate. The canonical FR-069 record belongs to FEAT-003; the test graph models a separate graph shape.
- Added FR-069 presentation metadata to the failing test fixture using the same project-manager use case already used by neighboring standalone-FR fixtures. No product code changed for this failure.
- Post-correction Vitest has not been run. The lead owns the `docs:views` regeneration and follow-up governance check; no generated file was edited here.

**Final state:** the P0c implementation and fixture correction are in place; post-correction Vitest remains unverified. The lead's only reported governance failure is the stale FEAT-017 verification view. Generated snapshots and unrelated workspace state remain untouched by this follow-up; no Git writes were made.
