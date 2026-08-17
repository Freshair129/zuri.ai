# W1/S2 — import child scoping

**Status**: DONE

## The design

`classify()` in `src/modules/project-manager/import/plan-import-service.js` now
takes a mandatory `scope` argument — the foreign key(s) a candidate row must
carry (`{ workstreamId }` for a container/item, `{ projectId, workstreamId }`
for a milestone/gate, `{ workspaceId }` for the project itself). A row is never
found by a global `findUnique({ where: { code } })` and judged afterward:

- The code-matched path is a `findFirst({ where: { code, ...scope } })` —
  out-of-scope rows are never even read as candidates.
- If `scope` resolves but nothing matches inside it, the code is checked
  globally; if it exists anywhere else, that is pushed to `conflicts` with a
  reason naming the violation — never silently downgraded to an insert (which
  would collide with the column's `@unique` constraint at commit) and never
  silently dropped (which would make the preview lie).
- If any `scope` value is itself unresolved — the plan's own parent
  (project/workstream) is a fresh insert with no id yet — a match is
  impossible by definition, and this is handled explicitly rather than handed
  to Prisma as `undefined` (which would silently drop that filter and widen
  the query back to global — the exact trap the F1 workstream-variant bug
  fell into: `existingProject && ...` skipped the check whenever the project
  was new).
- The external-id match path (FR-019) resolves to a record independently of
  `scope`, so the same `scope` check now runs against that record too, before
  it can be treated as an update. An external ref can no longer reach a
  record `scope` would otherwise exclude.
- `classify()` throws immediately if called without a `scope`. A future
  `classify('risk', ...)` for a new envelope array is safe by construction:
  either its author states the scope (and the row is constrained by
  construction, same as every existing kind) or the call throws the first
  time it runs — there is no code path where a new entity kind is silently
  wired up unscoped, which is what happened to `workContainer`/`workItem`/
  `milestone`/`gate` here.

## Red state proof

`tests/integration/plan-import-scope.test.js`, run against the code exactly
as found (before any edit):

```
 ❯ tests/integration/plan-import-scope.test.js (5 tests | 3 failed) 1585ms
   × RED-PROOF / F1: a plan targeting workspace B must not match, preview as
     "update", or overwrite workspace A's item by its globally-unique code
     → expected true to be false // Object.is equality   (dry.valid)
   × F1 (workstream variant): a plan whose project is a fresh insert must not
     silently claim an existing workstream code from another project
     → expected true to be false // Object.is equality   (dry.valid)
   × external-ref match cannot be used to bypass scoping: an id mapped to an
     out-of-scope record is a conflict, not a cross-workspace update
     → expected true to be false // Object.is equality   (dry.valid)

 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

The two that already passed pre-fix are the in-scope update and in-scope
external-ref relabel tests — confirming the failures are specific to
cross-scope matching, not a broken harness. The three failures reproduce F1
exactly: the dry run reported `valid: true` (a routine "update") for a plan
naming another tenant's item code, another tenant's workstream code, and an
external id stolen across scope.

## After

Same file, after the fix, plus the pre-existing import suite run alongside it
to check for regressions:

```
 ✓ tests/integration/plan-import-scope.test.js (5 tests) 1059ms
 ✓ tests/integration/external-ref-import.test.js (11 tests) 804ms
 ✓ tests/integration/xlsx-intake.test.js (7 tests) 781ms
 ✓ tests/integration/plan-import.test.js (7 tests) 717ms

 Test Files  4 passed (4)
      Tests  30 passed (30)
```

5/5 new tests pass (was 2/5); all 25 pre-existing import tests (plan-import,
external-ref-import, xlsx-intake) still pass unchanged.

## What I did not change, and why

- **`external-ref.js`** — out of scope for this task (controller boundary
  wasn't the issue here, but the file wasn't assigned to me either); its
  `resolveEntityIdentity`/`byCode` global lookups are still used only to
  *detect* an identity (match/conflict/dangling/duplicate), never to
  authorize a write — `classify()` now re-checks the record they hand back
  against `scope` before trusting it.
- **F2 (parent-linkage P2025 on externalRef-relabelled containers)** and
  **F3/F4/F5** from `pm-r3-intake.md` — different defects, not assigned here.
  Left untouched.
- **Repositories/dependencies** — not part of F1's scoping gap (repositories
  are explicitly code-only, "our own registry, not a customer record", per
  the existing comment) and not flagged in either source finding. Left
  unchanged.
- **Envelope schema / preview shape** — unchanged, per constraint. `conflicts`
  entries use the same `{ kind, code, reason }` shape as before; only the
  `reason` text is new for these cases.
- **Dry run stays read-only** — the fix only adds `findFirst`/`findUnique`
  reads inside `dryRunPlan`'s `classify()`; no write was added or removed on
  that path. `commitPlan` still re-runs `dryRunPlan` and refuses on any
  conflict before opening its transaction, so the same scoping protects
  commit automatically.
- Did not touch `project-team-service.js` or `team/route.js` (controller's
  concurrent work), git, or governance/build commands, per instructions.

## Concerns

- The workstream/container/item/milestone/gate scope keys assume the shape
  the commit path already writes (e.g. milestones and gates always get
  `workstreamId` set to the current workstream on write, even though the
  Prisma model allows `workstreamId: null`). A pre-existing milestone/gate
  created outside this import pipeline with `workstreamId: null` will now be
  treated as out-of-scope (a conflict) rather than silently adopted into a
  workstream on import — I believe this is correct behavior (adopting it
  would silently change its home), but it is a small behavior change beyond
  the pure-hijack case and worth a product-level sanity check if it surfaces.
- I did not add a test for the milestone/gate cross-scope case specifically
  (only project/workstream/item + one external-ref-bypass case) — the same
  `classify()` code path covers them, but a reviewer wanting kind-by-kind
  coverage may want one more test added.
