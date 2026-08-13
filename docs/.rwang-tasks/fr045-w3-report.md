# FR-045 W3 — File Manager read-model report

**Status:** DONE — pure read-model lane only; no commit created.

## Files changed

- `src/modules/project-manager/application/file-manager-read-model.js`
- `tests/fixtures/fr045-file-manager-read-model.js`
- `tests/unit/fr045-file-manager-read-model.test.js`
- `docs/.rwang-tasks/fr045-w3-report.md`

## Delivered contract

- `buildBusinessFileManagerReadModel` requires a viewer-visible selected Business,
  aggregates that Business's direct assets and assets of its owned Projects, and
  returns one stable metadata DTO per `FileAsset` id.
- `buildProjectFileManagerReadModel` requires both viewer-visible Business scope and
  direct Project ownership, then returns only that Project's assets.
- Cross-Business, unknown, deleted, empty-string-owner and null-owner/shared Project
  rows are excluded or denied. `ACTIVE`, `MISSING` and `QUARANTINED` are retained as
  DTO state, with deterministic counts, ordered groups, `isEmpty`, and local runtime
  capability availability.
- The module has no Prisma, filesystem, route, or UI imports and deliberately
  whitelists metadata instead of copying asset content or secondary links.

## TDD evidence

### RED 1 — missing implementation

Command:

```powershell
npm test -- tests/unit/fr045-file-manager-read-model.test.js
```

Result: failed during collection with `Cannot find module
'@/modules/project-manager/application/file-manager-read-model'`. This was the
expected pre-implementation failure; no tests executed.

### GREEN 1 — core projection

Same focused command: passed, **1 file / 5 tests**.

### RED 2 — fail-closed malformed owner

After adding the empty-string `projectId` fixture case, the focused command failed:
**1 of 6 tests** failed because the row was incorrectly included as Business-owned.

### GREEN 2 — malformed owner excluded

Command:

```powershell
npm test -- tests/unit/fr045-file-manager-read-model.test.js
```

Result: passed, **1 file / 6 tests**. Coverage includes aggregation, ID deduplication,
cross-Business isolation, null/shared and unknown Project exclusion, Project filtering,
all three states, capability availability, and stable output independent of input order.

## Validation

```powershell
git diff --check
```

Result: exit 0; no whitespace errors reported.

## Concerns / follow-up boundary

- W1's additive schema and W2's local filesystem port are separate owned lanes and
  were not read or changed by this module.
- This projection consumes plain records only. A later controller/service must load
  only authorized canonical SQLite data before calling it; it must not treat this
  pure module as persistence or filesystem authorization.
- No routes, UI, schema, migration, cache, or filesystem behavior was implemented.

## Independent six-point review (2026-08-14)

**Overall verdict: WARN**

1. **Contract completeness — PASS.** The two exported pure projections enforce a viewer-visible Business and owned Project boundary, aggregate direct Business plus owned-Project assets, retain one metadata DTO per asset id, and expose assets, counts, ordered groups and `isEmpty`.
2. **Isolation and null/shared handling — PASS.** Cross-Business, unknown, deleted and null-owner/shared Projects are excluded; a Project view denies a Project that is not directly owned by the selected visible Business. Empty-string project ownership is also fail-closed.
3. **Deduplication and determinism — PASS.** Deduplication is by immutable asset id before projection; assets and Project groups are code/id sorted, and the focused test proves equivalent output for reversed input.
4. **State, capability and purity — PASS.** `ACTIVE`, `MISSING` and `QUARANTINED` are whitelisted and preserved; normalized local capability is carried at model and DTO level. The module has no imports, database, filesystem, route or UI dependency and whitelists DTO fields rather than copying content or links.
5. **Traceability and ownership — WARN.** The W3 source, fixture and test carry truthful `@req FR-045`, `@spec SDD-023, ADR-016` and `@tested` anchors, and the changed files match W3's exclusive scope. However, `npm run docs:check` currently fails because the generated doc graph is stale; `docs/appendices/D-traceability.md` therefore still shows FR-045 as unanchored. Regenerate and review the graph at the controller-owned integration step.
6. **TDD and focused verification — WARN.** The lane report records RED/GREEN evidence and the focused post-state command passed independently: `npm test -- tests/unit/fr045-file-manager-read-model.test.js` (1 file, 6 tests). Historical RED execution cannot be independently replayed from the final working tree. `git diff --check` passed during this review; the broader generated-doc check remains the outstanding warning above.
