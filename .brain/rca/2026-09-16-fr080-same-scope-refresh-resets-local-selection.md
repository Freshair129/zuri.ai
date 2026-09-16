---
version: "0.1.0b"
created_at: "2026-09-16T19:15:00+07:00,RWANG,c3b88da2"
last_update: "2026-09-16T19:15:00+07:00,RWANG"
status: beta
attributes:
  domain: platform-control
  scope: existing FR-080 Business selection during the approved PM release regression gate
---

# Same-scope inventory refresh resets the local Integration Business

## Symptom

The composed release browser run on `c3b88da2` completed with 193 passing cases, four existing skips and one flaky FR-080 delayed-read case. The first attempt could not find the Settings button after choosing Business B; the retry passed. The wrapper correctly rejected the run.

## Evidence

- The failed-attempt screenshot shows Business 01 (A) selected and the connector list loading, although the test had already asserted Business B and fulfilled B's read.
- `ScopeContext.refresh` replaces `businesses` with a new response array; it refreshes when the pathname changes.
- Integrations' synchronization effect depends on the entire `businesses` array and unconditionally resets `targetBusinessId` to the shell Business A. A refresh of the same authorized inventory therefore invalidates an intentional local B selection.
- The test holds A's integration response until after opening Settings. Resetting to A puts the list back in loading state, making the Settings click and the still-held A response time out. The latter timeout is secondary.
- Evidence: `pm-execution-qa/release-20260916/final-browser.log`, `final-browser-report.json`, and the first-attempt FR-080 screenshot. The initial E2E run remains failed; a retry is not accepted as proof.

## Root cause and controlled proof

Business-list reference identity is incorrectly used as a signal that the shell's selected Business changed. The correct synchronization key is the resolved shell Business ID plus loss of the authorized local target.

Luna's controlled pre-fix browser run on isolated port 3159 finished with one pass and one failure, retries disabled. After releasing the held same-scope response, waiting for `response.finished()` and two animation frames, the assertion expected Business B but received Business A. The screenshot and `.last-run.json` are preserved under `pm-execution-qa/release-20260916/fr080-before-fix-artifacts`. The run's owned Next process required cleanup after teardown; that run is failure evidence only.

## Why the issue escaped detection

The existing delayed-response test controls the Integration reads but does not control the shell inventory refresh, so the wrong reset depends on response ordering. The earlier full run happened to finish the shell response first.

## Correction, authorization and scope

The owner's current commit/push/merge/deploy instruction follows approval of the existing navigation specification. This correction closes its required regression gate and preserves the already-declared FR-080 Business-scope behavior and FR-250 acceptance criterion 10; it introduces no new requirement, grant, API, schema, credential handling or provider action. Parent: ADR-032 / ADR-060; peer: FR-080 / SDD-044 scoped reads and writes.

Use the resolved scalar shell Business ID and a scalar flag for a nonempty local target missing from the authorized inventory as the synchronization dependencies. Refreshing the same authorized inventory must preserve the local Business; an actual shell Business change still resets selection. Removing a locally selected Business must reset both the displayed selection and the request fence to the authorized fallback. A scalar-ID-only correction would leave the select pointing at a removed option even though reads fall back; the independent review caught this before implementation. Keep the existing delayed-read/write sequence guards.

Risk: MEDIUM; complexity C-2. Strengthen the real browser test to control the same-scope refresh and preserve all original stale-response assertions. Do not increase timeouts, skip tests, or weaken scope isolation. The independent verifier reviews the source/test delta before root reruns relevant checks, complete E2E and hosted CI.

## Acceptance and prevention

1. A fresh same-scope inventory after selecting B leaves B selected and its settings visible.
2. Releasing the delayed A Integration response never renders A's connections in B.
3. Real shell Business changes and unavailable local Business fallback retain existing semantics.
4. Existing delayed-save protection remains passing; full browser run has no flakes.

## Correction verification

- 27 affected unit/contract tests pass across four files.
- The corrected browser run on isolated port 3161 passes all three cases with retries disabled and normal exit 0: delayed A save, delayed A read plus same-scope inventory refresh, and removal of B while its form contains unsaved values. Removal returns both settings and the selector to A, removes B's option and clears the stale form.
- The original full release run remains failed. A fresh complete browser run and hosted CI are required on the committed correction before merge and deployment; exact final receipts belong to the release report.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | beta | Record the release-gate failure, source-backed cause and bounded correction to existing scope behavior | c3b88da2 | RWANG |
