---
status: active
superseded_by: null
version: "0.1.0"
---

# Runtime consumer discovery gap

Inspected baseline: a787834ea422363f3eaf7fbdf472c53eb6c7d2be.
This is a test-selection inventory gap, not a diagnosed deployed regression or
a root cause for the unidentified historical 60+ minute CI run.

## Symptom

The Runtime service-isolated selector finds 15 Core tests by literal service path.
Three additional Core checks verify related preparation, HTTP-contract or
persisted-state semantics but contain no such literal, so the shadow candidate
inherited an incomplete known semantic inventory.

## Evidence

[contractTestsFor](../../scripts/ci-change-scope.mjs) includes test sources only
when they contain services/conversation-runtime/. A read-only scopeOutputs probe
for services/conversation-runtime/src/context.js returned 15 test paths.

[Grounding parity](../../apps/server/tests/integration/conversation-runtime-grounding-parity.test.js)
imports Core prepare and compares legacy/Core knowledge selection.
[OpenAPI](../../apps/server/tests/integration/openapi-docs.test.js) checks the
internal Runtime operation route and conversation-runtime.v1 marker.
[Job state invariant](../../apps/server/tests/unit/line-job-answer-text-marker.test.js)
pins answerText writers and the READY boundary.
All three are absent from the literal-discovery set at the inspected revision.

## Root Cause

Textual package-reference discovery cannot model every HTTP, Core-only semantic
or persisted-state consumer. Reusing a nonempty discovered set establishes that
some valid files were found, not that relevant checks without the literal are absent.

The evidence does not prove every omitted test detects every Runtime-only change.
External consumer completeness still needs review.

## Why the issue escaped detection

The initial shadow pilot intentionally preserved the active selector and disclosed
its limitations in the policy. Existing-path/nonempty guards validate selected
files but cannot discover unselected semantic consumers. Full main CI may execute
these checks while service-only selection still lacks their mapping.

## Proposed prevention and implementation

The owner approved Q1 on 2026-10-07: metadata v2 declares three additional tests;
shadow/qualification takes their union with discovered files. Empty discovery,
missing/escaped paths and invalid metadata fail conservatively. Contract changes
need wider qualification. Ordinary CI selection remains unchanged until a later
review explicitly integrates the expanded set.

Regressions cover metadata, union provenance, path containment, contract fallback,
control-run identity, full/PG/image/drain steps and failed engine evidence.
[Qualification](../../docs/migrations/scoped-verification/QUALIFICATION.md) owns the
implementation and execution record; profile PASS is not adoption or deployment.

During implementation, a pagination test fixture incorrectly used substring
page=1, also matching per_page=100. The failing two-page case exposed the fixture
error; parsing the page query parameter directly corrected it. This was a fixture
defect, not a production API or selector root cause.

Receipt review also found that validating a failed report before assigning its
counts would omit the failed count from the receipt, despite preserving raw JSON.
Record the observed counts before enforcing PASS and add a regression for a
failed SQLite report with PostgreSQL left NOT_RUN. This prevents sparse failure
receipts without weakening the passing-report checks.

Version diff 0.0 → 0.1.0: promotes the inspected, owner-approved RCA and prevention
to the implementation worktree, preserving the gap's bounded meaning.
