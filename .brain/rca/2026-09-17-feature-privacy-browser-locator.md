---
id: ZAI:RCA-2026-09-17-FEATURE-PRIVACY-BROWSER-LOCATOR
title: Feature privacy regression was blocked by an unscoped positive browser locator
version: "0.2.0b"
status: beta
created_at: "2026-09-17T20:04:13+07:00,Luna Max,working-tree"
last_update: "2026-09-17T20:25:34+07:00,Luna Max"
attributes:
  domain: project-manager
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# Feature privacy browser locator

## Symptom

The combined browser run reported 42 passed and 4 failed. The new privacy
regression failed at `project-feature-view.spec.js:224` before it reached its
aggregate loading or refusal assertions. The retry failed at the same line.

## Evidence

The preserved trace is
`apps/server/test-results/project-feature-view-FR-25-54265-view-is-loading-and-refused-e2e-retry1/trace.zip`
(SHA256 `B28A38D2D6C40260F2A6073A8684C6F899217632755FCEF1BFB58C9EC64BB6F6`).
Its failure is Playwright strict mode for
`getByText('FEAT-CONFIDENTIAL-999', { exact: true })`: two elements match, the
Feature row and the matching detail record. The trace resources also contain
the same sensitive code and count in the aggregate fixture and detail fixture,
and the preserved screenshot shows the detail drawer rendered with the
expected sensitive values.

After that locator was scoped, the preserved attempt-2 run still reached
45 passed and 1 failed, with the privacy test failing at line 226 because
`feature-detail-content` contains no `uniqueWorkCount`. The attempt-2 retry
trace at the same preserved path has SHA256
`F2BAB9EB7FE09E7CA34EC19FDECA6470926903AEDA5CC5E0F3BA65032E1BB6A1`; its
failure shows the count locator found no element. Source inspection confirms
the count is rendered by the matching `Open Feature <code>` row and the
Project KPI, while `FeatureDetail` renders title and code only.

## Root cause

The positive setup assertion used a page-wide exact-text locator even though
the fixture intentionally renders the same Feature code in both the list row
and detail drawer. The locator was ambiguous; this is a test locator defect,
not evidence that the View leaked data. Because the assertion failed first,
the test did not exercise the later loading/refusal privacy checks.

The first correction exposed a second fixture mismatch: `FeatureDetail` does
not render `uniqueWorkCount`; that value is rendered in the matching Feature
row (and the Project KPI). The detail-scoped count locator consequently found
no element.

## Why it escaped detection

The test author scoped the title assertion to `feature-detail-content` but used
page-wide locators for the code and count. Existing fixtures did not reuse the
same visible code in both the list and detail surfaces for a positive setup
assertion, and the expected count was not checked against the actual detail
component fields.

## Correction and prevention

The positive title/code checks resolve within `feature-detail-content`; the
positive count check now targets the matching Feature row, which is the
component that renders that count. The later whole-page zero-count checks
remain page-wide so they still detect stale values anywhere in the document
during loading and refusal. Future positive assertions should match the
component that owns the field and scope to its stable test or accessible
identity.

## Validation

The corrected test was reviewed against the preserved trace and source. No
browser, server, build, test, or governance command was run for this repair;
the root integrator owns the rerun. Existing product source was not changed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Scope positive privacy setup locators to the detail panel after strict-mode evidence | working-tree | Luna Max |
| 0.2.0b | 2026-09-17 | beta | Target unique-work count at its Feature-row owner after preserved retry evidence | working-tree | Luna Max |
