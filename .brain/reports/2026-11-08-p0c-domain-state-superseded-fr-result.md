# P0c Result — Superseded FR Pipeline Resolution

**Disposition:** The lead's Windows run found 43 passed and one fixture-only failure. The missing FR-069 presentation row is now in the synthetic test fixture. Post-correction unit tests are unverified; the lead's `npm run govern` reached only the stale feature-view check. This follow-up did not edit generated files or make Git writes.

## Outcome

The active FEAT projection continues to include active requirement members only, preserving readiness counts and progress semantics. Individually superseded FRs remain resolvable from domain requirement rows as `[historical]` / `not_applicable`. The data-pipeline map now resolves those rows without assigning a feature association or counting them as active build evidence; a node containing only retired requirements remains `DECLARED`.

The regression coverage uses a feature with one active and one superseded FR. It checks both IDs remain resolvable, while readiness and progress use only the active member. The pipeline-map regression also covers a mixed active/historical node and a historical-only node.

## Verification

- Earlier P0c run: direct Node integration harness passed for domain-state projection and pipeline resolution.
- Earlier P0c run: `node --check` passed for the four scoped source and test files.
- Earlier P0c run: `git diff --check` passed for the then-current scoped files and report.
- An earlier local attempt at the requested Vitest command stopped before test execution because esbuild returned `spawn EPERM` while loading Vitest; the lead later ran the command on Windows as recorded below.
- The lead ran `npm run govern`; it found no remaining FR-189, FR-26x or FR-14x `is ...` findings, and FR-189 is `[historical]` / `not_applicable`. It stopped only at `docs:views:check` because `docs/features/FEAT-017/verification.md` is stale. The lead will regenerate the view with `docs:views`.
- Independent read-only review reported no blocking findings.
- No Git writes were made; generated files were not changed.

## Lead Windows run and fixture correction (2026-11-08)

- From `apps/server`, the lead ran the specified four-file Vitest command: 43 passed, 1 failed. The failure was `domain-state.test.js` / `keeps one superseded FEAT member resolvable while readiness uses only its active member`, with `Readiness metadata is missing projected features: FR-069`.
- This was a fixture defect. The shared `featureNodes` fixture contains `req:FR-069`; its `featureEdges` bundle FR-003 to FEAT-999 but leave FR-069 unbundled. `buildFeatureProjection` therefore correctly projects FR-069 as a standalone candidate, which requires presentation metadata. The P0c active-member filter did not create this candidate: bundle targets are recorded before retired members are filtered. The canonical FR-069 record is bundled by FEAT-003; the test graph is an isolated synthetic graph.
- Added the matching `{ id: 'FR-069', primaryDomain: 'project-manager', useCase: 'A Human previews an execution plan.' }` row to this test's `featurePresentation`. No product projection code changed.
- The selected Vitest command has not been rerun after this fixture correction. The lead's `npm run govern` status is described above; the only reported failure is the stale FEAT-017 verification view, which the lead will regenerate.
- No generated files were edited and no Git writes were made in this follow-up.

**Next verification:** rerun the same four-file Vitest command after the fixture correction, then complete the lead-owned `docs:views` regeneration and governance check.
