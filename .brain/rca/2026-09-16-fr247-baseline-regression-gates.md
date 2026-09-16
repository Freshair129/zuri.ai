---
version: "0.1.0b"
created_at: "2026-09-16T17:17:00+07:00,RWANG,d33254aa"
last_update: "2026-09-16T17:35:00+07:00,RWANG"
status: candidate
attributes:
  domain: cross-domain-verification
  scope: existing FR-213 and FR-243 failures observed during FR-247 acceptance
---

# Existing cross-domain browser gate findings

## Symptom

The complete browser run of the PM navigation candidate ended with 192 passed, 4 existing skipped, 2 failed and 0 flaky tests. Both failures repeat on retry. The navigation scenarios pass. Repository-wide browser acceptance remains failed.

## Evidence

1. `tests/e2e/fr213-data-pipeline-map.spec.js:44` cannot find `pipeline-detail-in.line-webhook` after focusing the webhook node and pressing Enter. The screenshot still shows the CH-01 chain detail. `DataPipelineMapView.jsx` renders that node as an SVG `<g role="button" tabIndex={0}>` with `onClick`, without a keyboard handler.
2. `tests/e2e/fr243-conversation-sessions.spec.js:81` cannot find `.card` containing `BR-011`. The failure screenshot shows all three expected messages and two session separators. The current Inbox renders no visible `BR-011` marker; the string exists only in source comments. The test fails before it reaches its session-divider assertions.
3. Both test files, the Inbox page and DataPipelineMapView are byte-for-byte unchanged by the PM implementation (`git diff --exit-code d23a9396 HEAD -- <these four paths>`). Root preserved the complete report, both retries' screenshots and traces under `pm-execution-qa/navigation-implementation/full-browser-artifacts/`.
4. A separate Luna Max worker ran the two original spec files against the pre-navigation baseline `d23a93969ae2a550ba15381d471b751a7b7b993c` on its own worktree, port 3159 and seeded database. The normal 395-module warmup passed, followed by two passing denial checks. Both failing test cases repeat on initial attempt and retry, matching the complete-suite failures. The run then stalled during final cleanup before emitting the JSON summary or a normal exit. `baseline-browser.log` retains the observed results; process recovery and artifact preservation are recorded in the final gate receipt. The incomplete harness exit is not represented as a completed baseline gate or a green run.

## Root cause

- FR-213: an SVG group does not acquire native button keyboard activation from its ARIA role. Enter does not invoke the existing click callback, so the selected chain detail remains unchanged.
- FR-243: the test identifies the thread using a retired implementation label instead of a current visible thread identity. Message ingestion and session rendering are visible in the screenshot, but the stale container locator cannot resolve.

## Why the issue escaped detection

Pointer interaction exercises the map's click handler but does not establish keyboard support. The CRM assertion depends on presentation copy that had already changed. Focused PM tests cannot detect unrelated application test failures; the complete suite surfaced them.

## Proposed prevention and boundary

Track a separate FR-213 keyboard correction, preserving Enter/Space semantics, and replace the FR-243 thread locator with a verified current thread identity while retaining message and separator assertions. Do not weaken these assertions, raise timeouts or label the full suite green. These source/test repairs are outside the approved PM navigation slice; this delivery records them without modifying those files.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Preserve complete-suite failures, source-supported causes and recurrence on the pre-navigation baseline; distinguish observed test outcomes from incomplete baseline teardown | d33254aa; baseline d23a9396 | RWANG |
