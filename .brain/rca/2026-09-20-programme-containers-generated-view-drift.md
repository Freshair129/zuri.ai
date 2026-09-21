# RCA: programme container projection drift after docs:graph

Date: 2026-09-20
Scope: PR #485 and #486 / generated programme projection gate
Risk: MEDIUM (generated projection and required CI gate)

## Symptom

The hosted governance/tests job failed two tests/unit/programme-containers.test.js
assertions. generateProgrammeModules({ check: true }) reported only
apps/server/src/modules/platform-control/program-roadmap-containers.js as stale,
while the same focused test passed before the full CI sequence.

## Evidence

- .github/workflows/governance.yml runs npm run docs:graph before npm test.
- ADR-081-GENERATED-VIEWS-ARE-BUILT-NOT-COMMITTED.md and .gitignore define
  docs/FEATURE-MAP.md, docs/TRACE.md, docs/DOMAIN-MAP.md,
  docs/DOCUMENT-LINKS.md, Appendix D and the graph/preflight JSON as build output.
- Reproducing the CI order in the PR worktree made the generator check fail. The
  generated/current comparison identified six tasks whose document link state
  changed from missing to present solely because docs:graph had created the
  ignored views.
- The production image carries neither the repository docs tree nor tests, so
  those generated views are not stable repository links.

## Root Cause

generateProgrammeModules used existsSync for every declared link. The predicate
therefore treated ignored ADR-081 build outputs as repository files when CI had just
generated them, even though the committed projection was generated from a clean
checkout where those paths were absent. The projection depended on test-step order.

## Why the issue escaped detection

The local focused test and generator check were run before docs:graph, so the
temporary generated views did not exist. No regression test asserted that generated
documentation remains excluded from link-state.

## Proposed prevention

Centralise the repository-link predicate and explicitly exclude the ADR-081 output
set. Add a unit test that simulates every generated view existing and verifies that
it remains missing, while a canonical roadmap file remains present. Run the
generator check after the same docs:graph pre-step used by CI.
