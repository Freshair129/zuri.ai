# PR #12 semantic conflict repair report

## Luna implementation checkpoint

**Status:** DONE_WITH_CONCERNS

**Result:** Rebase completed at `4bcf4ce`; no push or merge was performed.

**Mapping applied:**

- Phase 1 production retained `FR-051..055`, `NFR-011..013`, `BR-012..014`,
  `SDD-026..028`, `SEC-010..012`, `ADR-018..020`.
- Landing moved to `FR-056`, `SDD-029`, `ADR-021`.
- PR #12 MSP authorization moved to `FR-057`, `NFR-014`, `BR-015`,
  `SDD-030`, `SEC-013`, `ADR-022`.
- `FR-058`, `BR-016`, `SDD-031`, `SEC-014`, `ADR-023` remain reserved for
  the separate local Typed Agent work.

**Outputs:** 31 files changed versus `origin/main`, including Landing renames,
PR #12 authorization files, PRD registry restoration, code/test annotations, and
the rebase commit.

**Concerns:** The controller checkpoint interrupted Luna before the independent
review, report, generated-document refresh, tests, build, and integrity scans.
Those gates remain pending.

## Independent document/code traceability review — 2026-08-15

**Reviewer verdict: BLOCK — not merge-ready.** The human-authored registry repair
preserves the required semantic mapping, but the generated traceability artifacts
were not refreshed and the required `docs:check` gate fails. The FR-057 code also
does not yet enforce two security properties its requirement, ADR, and annotations
claim. No product/source file was changed by this review; this section is the only
reviewer write. No push or merge was performed.

### Scope and evidence

- Compared `origin/main...HEAD` at `4bcf4ce323e3c6133c3b4b16574d21eb28a0e57b`.
  The PR has 31 tracked changed/renamed paths; the untracked RCA was read.
- `git diff --check origin/main...HEAD`: PASS. Repository-wide conflict-marker
  scan (excluding `.git`): PASS. `docs/v1-inherited/` has no diff from
  `origin/main...HEAD`: PASS.
- Reserved IDs `FR-058`, `BR-016`, `SDD-031`, `SEC-014`, and `ADR-023` have no
  non-review/RCA use: PASS.
- The first-merged Phase 1 registry at `f196212` and current PRD agree that
  `FR-051..055`, `NFR-011..013`, `BR-012..014`, `SDD-026..028`, `SEC-010..012`,
  and `ADR-018..020` retain their production meanings. Landing is registered as
  `FR-056` / `SDD-029` / `ADR-021`; MSP authorization is registered as
  `FR-057` / `NFR-014` / `BR-015` / `SDD-030` / `SEC-013` / `ADR-022`.
- `npm run docs:check`: FAIL — `doc-graph is stale — run: npm run docs:graph`.
  `npm test`: NOT VERIFIED. Vitest failed in global setup before collecting tests
  because `prisma/test.db` already contains `BusinessRoadmap`; this is an
  environment/worktree-state failure, not evidence that the PR test suite passes
  or fails on a clean database.
- The RWANG annotation scanner named by the local audit procedure is unavailable:
  `scripts/scan-annotations.ps1` does not exist. Scanner coverage therefore could
  not be used as independent approval evidence.

### Six-point gate

| Gate | Result | Review conclusion |
|---|---|---|
| Completeness | FAIL | Required generated graph/traceability refresh is missing; the test gate has no clean-run result. |
| Requirement traceability | FAIL | Source and PRD annotations use the repaired IDs, but committed derived outputs still assign Landing to `FR-051` / `SDD-026` / `ADR-018` and contain deleted paths. |
| Internal consistency | FAIL | PRD/ADR/feature notes are internally consistent, but they contradict `FEATURE-MAP.md`, `.doc-graph.json`, and Appendix D. |
| Standards compliance | FAIL | This violates the AGENTS.md rule that generated traceability is source-derived and `docs:check` must pass after requirement/document changes. |
| Code alignment | FAIL | FR-057 currently defaults transport verification to allow and does not resolve/authorize workspace/project scope before turning it into a private vault key. |
| Writing quality | PASS WITH NOTE | The PRD, ADR-021, ADR-022, feature notes, plan, and RCA are readable and state the intended mapping clearly; derived-document contradictions make the published documentation set unreliable. |

### Actionable findings

| Priority | File:line | Finding and required action |
|---|---|---|
| P0 | `docs/FEATURE-MAP.md:68` | The generated map still defines Landing as `FR-051` and links the deleted `features/FR-051-zuri-branded-entry-landing.md`. Regenerate the graph and all derived traceability from the repaired source, then commit only the generated deltas and require `npm run docs:check` to pass. |
| P0 | `docs/.doc-graph.json:3364` | The committed graph still has the obsolete `doc:FR-051-zuri-branded-entry-landing` node/path (and the obsolete ADR node at `:5241`). This is the direct cause of `docs:check` failing and leaves the new FR-056/FR-057 nodes absent. Regenerate rather than hand-edit. |
| P0 | `docs/appendices/D-traceability.md:73` | The generated traceability matrix still assigns the Landing prose and source/test edges to `FR-051`; `:117` likewise assigns Landing design prose to `SDD-026`. Regenerate Appendix D with the graph so Landing is exclusively FR-056/SDD-029/ADR-021 and production IDs retain their original edges. |
| P1 | `src/modules/agent/auth-context.js:84` | `transportVerified` is true unless a caller explicitly supplies `false`. That permits direct `assembleAgentContext`/`handleAgentTurn` callers without a verified transport receipt to receive an ALLOW decision, contrary to FR-057 and ADR-022's verified-transport, fail-closed contract. Require an explicit trusted verification receipt (default deny) and add a regression test for the omitted/unverified case. |
| P1 | `src/modules/agent/auth-context.js:75` | Membership is checked against caller-supplied `businessId`, while `serverScope.businessId`, `workspaceId`, and `projectId` are accepted at `:87-99` and incorporated into the authorized vault without a server-side resolver or membership/authorization check. Resolve the effective scope from the trusted binding/policy authority first, authorize workspace/project membership before vault construction, and test mismatched business plus unauthorized project/workspace cases. |
| P2 | `tests/integration/agent-multi-principal.test.js:36` | The new tests prove two-principal isolation and membership revocation, but they omit the explicit-unverified-transport default-deny and the required cross-tenant/project/workspace denial cases. Add those acceptance tests after the authorization seam is made fail-closed. |

### Release conditions

1. Address P0 generated-document drift and pass `npm run docs:check`.
2. Address both P1 authorization-boundary defects and add the stated regression
   coverage.
3. Re-run the full suite from a clean disposable SQLite test database, then build
   and record results. Do not promote this review's partial/environment-failed test
   invocation to a passing result.

## Controller resolution and final independent re-review — 2026-08-15

**Status:** PASS — ready to update PR #12; merge remains a separate owner action.

The controller addressed every prior finding. Private retrieval now requires an
explicit verified transport receipt, resolves Business/Workspace/Project records
against persisted active Tenant ancestry before vault construction, evaluates
Membership/Customer access against the resolved Business, and fails closed for
missing, archived, cross-Business, and cross-Tenant scope. Landing acceptance IDs
were corrected to `AC-056.*`, and generated traceability was rebuilt from source.

**Final independent review:** Tesla returned PASS with no actionable findings.
The review confirmed P0 generated-document drift, P1 authorization gaps, and P2
negative-coverage gaps are resolved.

**Verification:**

- Focused FR-057 regression: 14/14 passed, including omitted transport,
  cross-Business, cross-Tenant, Workspace, Project, archived Project, Membership
  revocation, and two-principal isolation.
- Full Vitest: 102 files passed, 3 PostgreSQL opt-in files skipped; 595 tests
  passed, 9 skipped.
- Production build: PASS (`next build`, 25 static pages generated).
- Playwright: 34 passed, 4 superseded tests skipped.
- Documentation: 785 nodes, 1476 edges, 0 dangling; FR code/test coverage 57/57;
  preflight 0 critical / 0 warning; `docs:check` PASS.
- Integrity: `git diff --check` PASS; conflict markers 0; connection URL and named
  secret assignment patterns 0. Three `service_role` references are policy prose,
  not credentials.

No file under `docs/v1-inherited/` or the primary worktree `D:\zuri-ai` was
modified. No merge was performed.
