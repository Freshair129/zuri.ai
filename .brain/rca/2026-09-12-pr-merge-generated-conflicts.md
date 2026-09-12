---
version: "0.2.0b"
status: beta
created_at: "2026-09-12T20:26:00+07:00,RWANG,base 00f6d326"
last_update: "2026-09-12T20:54:00+07:00,RWANG"
attributes:
  domain: agent-governance
  scope: PR integration diagnosis
---

# PR merge obstruction: generated conflicts, integration drift and separate CI failures

## Symptom

Several related identity PRs repeatedly needed merge resolution and verification. At inspection on 2026-09-12, PR #350 was CONFLICTING despite successful hosted checks, PR #349 was CONFLICTING with failed verify, and PR #353 was MERGEABLE but BLOCKED while verify ran. These are different obstructions.

This is a C-2 diagnosis, LOW risk, with no application or CI changes. The report is in its own worktree to leave Claude's active merge untouched. Success means identifying current merge blockers, their evidence, and the distinction between local remediation and remote acceptance.

## Evidence

1. GitHub branch protection API returned required contexts `changes`, `verify`, `edge-verify`, with `strict: false`. E2E is not a required status context in that snapshot. Workflow policy and an agent's decision to wait for E2E are separate from this technical gate.
2. PR #353 head `5bb5dc2086d9d91397beab564bc0eefda495891c` merges `00f6d326` into its branch. Its combined diff identifies exactly two resolved conflicts: `apps/server/runtime/domain-state.json` and `docs/.domain-state.json`. Both conflict hunks are the `generatedAt` line: parents contain `2026-09-12T13:00:14.773Z` and `2026-09-12T12:42:27.274Z`; the merge writes `2026-09-12T13:14:12.895Z`.
3. `apps/server/scripts/domain-state.mjs` produces `generatedAt` with `new Date().toISOString()` when no value is supplied. `doc-graph.mjs` writes the serialized state to both tracked files. Its `canonicalDomainState` removes `generatedAt` for freshness comparisons; Git still compares the literal tracked line. Thus semantically acceptable outputs can conflict solely on run time.
4. The active #350 worktree's MERGE_MSG enumerates 15 conflicts: 11 generated outputs and four authoritative shared files (`docs/.id-ledger.json`, `docs/FEATURES.md`, `docs/PRD-SDD-v1.0.md`, `docs/roadmap/ROADMAP.md`). MERGE_HEAD is `00f6d326`. This is a merge in progress locally, not a completed remote fix.
5. Main advanced through #348 (`d1f9758d`), #351 (`7a85b79e`) and #352 (`00f6d326`). Claude's active session records that three sibling lanes branched from the grant-lifecycle branch and shared those registries/generated files. FR ranges had been reserved separately; do not confuse document-version collisions with reused FR identities.
6. Direct inspection of #350's uncommitted changes shows access-invite writers gaining `tenantId`/`businessId` audit columns, person-history queries resolving invite IDs instead of comparing invite entityId to personId, and the operator-issued/action events being included. These are integration contract repairs in addition to textual merge resolution.
7. Claude's session `180e4356-4eb9-407d-9767-bbe61fd99f4b` at 13:21:47Z reports: two local unit failures due to the new `db.accessInvite.findMany` dependency missing from a mock; two stale-count failures because `docs:ids` ran without the full `govern` after merge; fixes and focused tests 39/39 passing, with the full suite rerunning. This is session-reported local evidence, not an independently rerun test or a hosted pass for the uncommitted changes.
8. The same session reports a wrapper ending with `echo` returned exit 0 although the test log said `TEST_EXIT=1`. A notification's successful process status was therefore insufficient evidence of test success.
9. PR #349 hosted run [34687126898](https://github.com/Freshair129/zuri.ai/actions/runs/34687126898) failed `passkey-lifecycle.test.js` with `TypeError: handleApiError is not a function`, at login/verify route line 69; 4,835 passed, one failed, 15 skipped. Its route imports `handleApiError` from `_helpers`, but the inspected branch helper exports `ok`, `httpError`, `handle`, and `queryParams`. This confirms the missing error-handler export contract. The exception that originally entered the catch block remains unverified because this secondary error masks it.
10. PR #353 moves E2E from pull requests to main pushes/nightly runs and widens harness selection. This does not fix generated-file conflicts, #349's missing helper, or #350's integration bugs.

## Root Cause

The recurring integration bottleneck is parallel branches editing shared authoritative registries and committing shared derived outputs. Each merged sibling changes the baseline for the next one. Volatile timestamps add conflicts even without a conflicting product change, concretely proven by #353's two timestamp-only conflicts.

The repeated repair loop in #350 also reflects incomplete composed validation: its reader and the newly merged invitation writer disagreed about audit scope columns and entity identity; a changed dependency was missing from unit mocks; and registries were updated before their generated representations were refreshed. A clean individual branch or a textual auto-merge does not establish correctness of the combined tree.

PR #349 has an additional independent required-CI failure. Slow or cancelled E2E is not the direct branch-protection cause established here.

## Why the Issue Escaped Detection

- Freshness checks intentionally ignore the generation timestamp, while Git merge does not. Passing governance therefore cannot prevent timestamp conflicts.
- Each branch is validated against its own baseline; later sibling merges alter shared registries and service contracts.
- #350's integration test uses a real database, whereas existing unit tests used a mock missing the newly accessed table.
- Tests consuming generated state ran before the full generation chain refreshed it.
- Shell wrapper exit status can hide test failure if the last command succeeds. Claude noticed the actual failure in the log; no claim of completed acceptance follows from the notification.

## Proposed Prevention

1. Keep a single integrator for the shared registry/ledger changes; compose sibling changes in their agreed dependency order and regenerate only after source registries and identities are reconciled.
2. Prefer the smallest first repair for #353's demonstrated cause: make tracked derived output deterministic, keeping run timestamps outside committed semantic data. This is a proposal, not implemented here.
3. Evaluate untracking derived views separately with their CI/build/runtime consumers. It removes those files' merge conflicts but leaves the four shared registries and code integration conflicts. It cannot honestly promise zero conflicts across all PRs.
4. On a merged tree, run the complete governance chain before tests that consume generated state; update unit dependency factories and add cross-feature writer-to-reader tests for the observed contract gaps.
5. Preserve the actual child exit code in background wrappers. Fix #349's helper contract and expose the original caught exception before calling its passkey failure resolved.

## Initial Investigation Validation and Limits

Read-only GitHub API/CI inspection, local Git history/merge metadata, active worktree diffs, generator source and narrowly scoped Claude session records support this diagnosis. No merge, push, test cancellation, production operation, or application/CI edit was performed. Live PR states can change while Claude continues working. Proposed implementation requires a separate approved change.

Final GitHub refresh: #353 merged at 13:25:01Z (20:25:01 ICT) as `bec36068527b77890066557fd743affea233e4e8`; its verify passed in 9m42s. #350 remained CONFLICTING on published head `66ac919e`; #349 remained CONFLICTING on `c236f6e8` with the same failed verify. Earlier status descriptions above are observations from the investigation, not the final #353 state.

This report worktree ran `npm run govern` successfully: critical 0, warning 0; monorepo graph validation passed. The initial attempt lacked the `yaml` dependency; a local node_modules junction to the reference checkout allowed the governance-only run without installing or modifying dependencies. No application tests were rerun by this investigation. The only generated differences from that run were the two `generatedAt` timestamps; those report-run-only changes were restored, retaining only this RCA document.

## Owner-Approved Implementation (2026-09-12)

The owner approved the proposed deterministic-output repair with "แก้เลย" after
the explanation of removing committed run timestamps, reconciling source before
generation and validating the composed tree. Risk is MEDIUM: a bundled snapshot
contract and CI ordering change, with no database or external API migration.

- Domain-state schema `1.1` becomes `2.0`, removing `generatedAt` from the builder,
  schema and both serialized outputs. Run timestamps remain in the ignored graph
  diagnostic report. The freshness check compares the complete normalized state.
- Product Readiness renders bundled-version provenance instead of formatting a
  missing timestamp. Its feature specification changes from `1.0.0b` to `1.1.0b`.
- CI checks the submitted graph before generation, retains post-generation Git
  freshness checks including both state copies, and runs governance before unit
  tests and build. Local `verify` also runs governance first. Its E2E requirement
  and the separate CI E2E policy from #353 are preserved.
- AGENTS.md records a single integration owner for shared authoritative registries
  and deterministic generated snapshots; derived views and the LLM corpus are
  regenerated through their tools. No requirement identity is changed.

Regression proof: the new clock-shift test failed against the original generator
using the two timestamp values from #353's conflict, and passed after the repair.
The focused suite passes 24 tests, including actual repeated CLI generation,
stale-state rejection, bundled-state parity, schema validation and real Dashboard
server rendering without a date. Production build passes.

PR #350 merged while draft #354 was being opened. Integration with main
`12664edc` conflicted only in the two domain-state snapshots. Both were
regenerated from the combined source; no additional application change was
needed. The first full suite on `bec36068` passed 4,957 tests; the final suite,
build and browser checks were rerun on the combined tree below.

Final local validation on base `12664edc` plus this change:

| Check | Result |
|---|---|
| Full `npm test` | 4,984 passed, 15 skipped; 604 files passed, 5 skipped; exit 0 |
| Production build | Passed compilation, lint/type validation and prerendering |
| Product Readiness E2E with normal warm-up and `--fail-on-flaky` | 4 passed (one warm-up, three browser tests), zero flaky; 353 modules warmed |
| Full `npm run govern` | PASS, critical 0, warning 0; both graph scopes valid |
| Real-repository repeatability | SHA-256 unchanged for all 11 generated outputs after another full govern and docs:llms run |
| Workflow YAML and gate order | Parsed; submitted-graph check before generation, freshness checks before tests/build |
| `git diff --check` | Passed |

Logs for this local run are in the task host's temporary directory as
`zuri-generated-state-20260912-final-{tests,build,e2e,govern}.log`. These are local
results; no hosted CI, merge or deployment success is inferred from them.

Implementation uses private Server and Edge dependency installations. The earlier
dependency junction was removed before running tests, so Prisma generation and
test-proof files cannot modify another session's dependency tree. Claude's active
#350 worktree was only inspected; it was not modified or messaged. Claude's planned
untracking change is separate: its retained runtime snapshot still benefits from
deterministic content, but its future workflow must reconcile these freshness gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-12 | draft | Initial evidence-backed diagnosis; separate timestamp conflicts, shared registry integration and required CI failures | base 00f6d326 | RWANG |
| 0.2.0b | 2026-09-12 | beta | Owner-approved deterministic snapshot repair, consumer/schema alignment, regression evidence and governance-first verification | base bec36068 | RWANG |
