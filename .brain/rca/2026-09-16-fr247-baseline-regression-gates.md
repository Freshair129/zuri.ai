---
version: "0.2.1b"
created_at: "2026-09-16T17:17:00+07:00,RWANG,d33254aa"
last_update: "2026-09-16T18:13:00+07:00,RWANG"
status: beta
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

The original navigation delivery proposed a separate FR-213 keyboard correction, preserving Enter/Space semantics, and replacement of the FR-243 thread locator with a verified current thread identity while retaining message and separator assertions. These repairs were outside that delivery's approved PM scope, so it recorded the findings without modifying those files. The subsequent authorization and correction are recorded below; no assertion weakening or timeout increase is permitted.

## Authorized correction — 2026-09-16

After reviewing the two findings and their baseline reproduction, the owner instructed **"fix it"**. That authorizes the corrections proposed above as a follow-up to the original navigation delivery. The earlier evidence remains a historical failed run. Classification: **C-2, MEDIUM risk**, because the follow-up spans Knowledge UI behavior and CRM browser verification; no API, schema, authorization or session-assignment rule changes are needed.

The Knowledge worker owns the SVG node keyboard handler and the FR-213 browser regression. The CRM worker owns only the FR-243 browser locator and assertions. A separate Luna Max verifier reviews both packets; root integrates, owns governance, and runs the composed browser suite.

### Acceptance and exit criteria

1. Enter and Space on a focused map node select the same detail as pointer activation; Space does not scroll the page. Selection state and focus remain observable. Chain filtering, list view and existing denial cases retain their assertions.
2. The Inbox test selects exactly one thread card by its current unique customer display name, then verifies all three fixture messages, exactly two session separators, valid session codes and distinct codes. It does not depend on the retired `BR-011` copy or use a first-match shortcut to hide ambiguity.
3. No timeout increase, skip, assertion deletion or unrelated source change hides the failures. Existing event ingestion and session rules are retained.
4. A normal composed browser run must finish with no failures or flaky cases before the repository browser gate can be recorded as passing. An interrupted test harness is never sufficient.
5. Relevant unit checks, optimized build, governance, and independent verification must pass. Hosted CI and production remain separate, unrun gates.

## Verified local correction

Source and tests are frozen at `86de7f61ac02bda893d7ccbc9756957d52ea4c24`. The independent Luna Max source gate accepted the three source/test files at their recorded hashes. Root observed Enter and Space activation on the actual local map, with Space retaining scrollTop 0.

| Gate | Result |
|---|---|
| Relevant unit/integration checks | 47 passed across six files; exit 0; nonzero-execution wrapper passed |
| Optimized build | PASS, exit 0 |
| Complete browser suite | 194 passed, 4 existing skipped, 0 failed, 0 flaky; normal exit 0 in 13.5 minutes |
| Affected browser cases | FR-213 3/3, FR-243 1/1, FR-247 10/10 passed |
| Suite integrity | All 198 case identities and the four skipped case identities match the original complete run |
| Hosted CI / merge / production | NOT_RUN |

The two original failures are closed locally. No assertions were removed, no timeout was raised and no additional case was skipped. The earlier interrupted baseline comparison remains an interrupted historical run; this passing result comes from a separate normal full-suite completion.

Evidence is stored separately under `pm-execution-qa/regression-fix-20260916/`, including the complete JSON report, screenshots, independent review and root receipt. Original failed reports remain unchanged. The earlier full unit result (5,843 passed / 32 skipped) is historical; this correction ran the 47 relevant checks and does not claim another full unit run.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Preserve complete-suite failures, source-supported causes and recurrence on the pre-navigation baseline; distinguish observed test outcomes from incomplete baseline teardown | d33254aa; baseline d23a9396 | RWANG |
| 0.2.0b | 2026-09-16 | beta | Record owner's fix instruction, bounded Knowledge/CRM ownership and acceptance criteria; preserve original failed-run evidence | follow-up base 56b05c8f | RWANG |
| 0.2.1b | 2026-09-16 | beta | Close both findings locally with normal full browser exit, unchanged case/skip inventories, focused unit and build evidence | source 86de7f61 | RWANG |
