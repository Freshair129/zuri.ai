---
status: active
superseded_by: null
version: "0.1.1"
---

# Service verification policy and documentation drift

## Symptom

The documented goal of independently verifiable services is difficult to use
consistently: adding explanation to a service change can select Server build,
and operating guides still describe full E2E on every PR. The owner reports a
60+ minute CI experience, but that particular run has not been identified.

## Evidence

At baseline `71e5dde0`, `scripts/ci-change-scope.mjs` recognizes isolation only
when the entire diff matches registered service roots. Adding a docs path returns
no isolated-service set. `.github/workflows/governance.yml` runs Server build
when `server != false`, all three service jobs on non-scheduled events, and E2E
only on schedule/manual dispatch. AGENTS.md and CLAUDE.md still describe full
E2E on every PR. Read-only selector probes confirmed service-only, service-plus-doc,
docs-only and shared-config branches before this implementation.

## Root cause

There is no common explicit contract tying business ownership, executable service
boundaries, permitted inert documentation and verification dependencies together.
The existing selector deliberately chooses conservative behavior for mixed paths;
documentation did not evolve with later CI selection and scheduling changes.
This establishes the scope/policy mismatch, not the cause of the unidentified
60+ minute run. Recent sampled runs must not be used to deny an older incident.

## Why the issue escaped detection

Selector tests correctly preserve conservative fallback and CI can pass while
doing more work than necessary. They do not establish a performance budget or
check that prose about job scheduling remains current. Service existence and a
passing job were treated as adequate navigation without a shared execution map.

## Proposed prevention

Adopt a canonical verification policy, service documentation, explicit bounded
metadata, a shared local/CI plan and regression cases for mixed changes. Begin
with shadow comparison; keep current gates until omission coverage is proven.
Measure elapsed and summed-job work independently and retain exact-run evidence.

## Pilot validation finding — Windows case-only rename

Symptom: renaming `src/context.js` to `src/Context.js` in an isolated Windows
fixture incorrectly produced an eligible shadow candidate. Evidence: the old
path still returned true from `existsSync`, and the planner reported
`candidateEligible: true`. No CI omission occurred because this was shadow mode.

Root cause: the first planner inferred deletion only from filesystem existence;
a case-insensitive filesystem can still resolve Git's deleted spelling. A staged
deletion with an untracked replacement at the same path has the same ambiguity.
The ordinary different-name rename test did not exercise these cases.

Prevention: collect deletion status directly from Git's `--name-status
--no-renames` output, preserve it across compared revisions and working changes,
and reject a candidate for those paths even when they still resolve on disk.
Add regressions for case-only rename and staged deletion/replacement. This
implements the already-approved conservative rename/deletion requirement.
## Review finding - cancelled staged changes

### Symptom

The local shadow report can classify partially staged Core and Runtime work as
Runtime-only when a staged Core edit is reversed in the working copy.

### Evidence

Independent review of `abf707d3f536132daf85865427fa66b8b1757de3` reproduced this
in a disposable Git fixture. A tracked Core authority file was modified and
staged, its working copy was restored to HEAD, and a Runtime file was modified.
`git diff --cached --name-only` contained the Core path; `git diff --name-only`
contained both Core and Runtime. `collectChanges` returned only Runtime and
`candidate.eligible` was true. `omissionsAllowed` remained false, so no CI job
was omitted. The approved local-input contract requires staged and unstaged work.

### Root cause

Local collection used only `git diff HEAD`, which compares HEAD with the final
working copy. Opposing staged and unstaged edits cancel in that net comparison,
even though the index still contains a pending Core change.

### Why the issue escaped detection

The existing mixed local-state test changes different files in each Git state.
It never stages an edit and then reverses that same path in the working copy.
Hosted clean-checkout validation cannot exercise this local index divergence.

### Proposed prevention

Collect the union of index-versus-HEAD and working-copy-versus-index changes,
retaining deletion evidence from both. Add a regression for the reproduced
Core/Runtime case and verify the conservative candidate result. This corrects
the approved input contract; it adds no omission or execution authority.

Version diff 0.1.0 -> 0.1.1: records independent review evidence and prevention
for cancelled staged changes; earlier findings remain historical.
