# FR-045 W3 task brief — File Manager read model

## Role

Pure read-model lane owner. Use TDD and touch only the files below.

## Exclusive write scope

- `src/modules/project-manager/application/file-manager-read-model.js`
- `tests/fixtures/fr045-file-manager-read-model.js`
- `tests/unit/fr045-file-manager-read-model.test.js`
- `docs/.rwang-tasks/fr045-w3-report.md`

## Contract

Create pure, database-free functions for:

- Business File Manager: require selected Business to be viewer-visible; include
  Business-owned assets and assets of Projects owned by that Business; one DTO per
  asset even when secondary links repeat; never copy/mutate content.
- Project File Manager: require the Project belongs to the selected/visible
  Business; include only that Project's assets.
- Preserve `ACTIVE`, `MISSING`, `QUARANTINED` state and local-capability availability
  in the DTO; expose deterministic counts/grouping suitable for loading/empty/error
  UI later.

No Prisma, filesystem IO, route or UI work. Unknown/cross-Business rows are excluded
or denied explicitly; do not silently attribute shared/null-owner Projects.

## TDD / exit

RED fixture tests first for aggregation, dedupe, isolation, Project filtering and
state preservation. GREEN with pure deterministic functions. Run focused tests and
`git diff --check`.
