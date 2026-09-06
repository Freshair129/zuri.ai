---
version: "0.1.0b"
created_at: "2026-09-07T09:30:00+07:00,RWANG"
last_update: "2026-09-07T09:30:00+07:00,RWANG"
status: "under review"
attributes:
  domain: "line-oa-console"
  doc_type: "root-cause-analysis"
  scope: "LINE Studio connection form and console e2e contract"
---

# RCA - LINE Studio console e2e contract drift

## Complexity and risk

- **Complexity:** C-2 - documentation-driven test contract repair
- **Risk:** LOW - test and RCA changes only; the current one-click production flow is retained

## Symptom

The full Playwright suite failed two LINE Studio console tests twice, including their retries.
Both tests timed out while looking for the old `ชื่อ Connection` field on
`/line-oa?tab=edge-connection`.

## Evidence

- `npm run test:e2e` ran 114 tests and reported 108 passed, 4 skipped and 2 failed.
- `fr149-line-server-console.spec.js` and `fr151-line-oa-rich-menu-console.spec.js` both waited for
  `getByLabel('ชื่อ Connection', { exact: true })`.
- The rendered page showed the current one-click form, whose field is
  `ชื่อบัญชี LINE OA (Display Name)` and whose submit action is
  `เชื่อมต่อ LINE Official Account ทันที`.
- Main commit `b6277061` replaced the two-step Connection/Account form with the one-click form;
  the two console specs still exercised the retired two-step labels and actions.

## Root Cause

The LINE Studio UI contract changed from provisioning a Connection and then connecting an account
to provisioning both in one submit. The implementation and the old console specs were therefore
out of sync: the page had no `ชื่อ Connection` control, so Playwright waited until the test timeout.

## Why the issue escaped detection

- Unit and integration tests cover the route and service behavior but do not assert the rendered form
  labels used by these browser flows.
- The UI refactor and its test contract were committed separately, so the stale console specs were
  not updated with the form change.
- The e2e gate uses `--fail-on-flaky`; it correctly exposed the deterministic failure instead of
  accepting a retry as green.

## Proposed prevention

1. Keep the two LINE console specs aligned with the current one-click form and its persisted account
   result.
2. Run `npm run test:e2e` after any change to the LINE Studio form or tab routing.
3. Preserve accessible labels and submit names as part of the browser contract; change the specs in
   the same change when the product wording intentionally changes.

## Current resolution state

- The specs are being updated to submit the current one-click form and assert the resulting account
  card before continuing with transport and Rich Menu assertions.
- The RCA remains under review until targeted LINE e2e and the complete `--fail-on-flaky` suite pass.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-07 | under review | Recorded LINE Studio form/spec contract drift and prevention | working-tree | RWANG |
