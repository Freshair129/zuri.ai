---
version: "0.2.0b"
created_at: "2026-09-07T09:30:00+07:00,RWANG"
last_update: "2026-09-07T09:45:00+07:00,RWANG"
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

The full Playwright suite first failed two LINE Studio console tests twice, including their retries.
Both tests timed out while looking for the old `ชื่อ Connection` field on
`/line-oa?tab=edge-connection`. After the form contract was updated, the latest main branch's
automatic Server activation exposed two more stale state assertions in the same specs.

## Evidence

- `npm run test:e2e` ran 114 tests and reported 108 passed, 4 skipped and 2 failed.
- `fr149-line-server-console.spec.js` and `fr151-line-oa-rich-menu-console.spec.js` both waited for
  `getByLabel('ชื่อ Connection', { exact: true })`.
- The rendered page showed the current one-click form, whose field is
  `ชื่อบัญชี LINE OA (Display Name)` and whose submit action is
  `เชื่อมต่อ LINE Official Account ทันที`.
- Main commit `b6277061` replaced the two-step Connection/Account form with the one-click form;
  the two console specs still exercised the retired two-step labels and actions.
- The current `LineStudioEdgeConnection` performs a third step after account creation: it calls
  `ENABLE_SERVER`, so the new account is `LIVE` and the card exposes `ปิด Server transport`.
- The rich-menu page consequently reports the draft blocker `ส่งขึ้น LINE: ต้อง Freeze ฉบับร่างก่อน`,
  instead of the old `บัญชีนี้ยังไม่ได้เปิด Server transport` blocker.

## Root Cause

The LINE Studio UI contract changed in two compatible steps: provisioning a Connection and account
became one submit, then the current flow automatically enables Server transport. The implementation
and the old console specs were therefore out of sync: the page had no `ชื่อ Connection` control and
the resulting account no longer stayed in the pre-activation state those assertions expected.

## Why the issue escaped detection

- Unit and integration tests cover the route and service behavior but do not assert the rendered form
  labels used by these browser flows.
- The UI refactor and the automatic activation change were committed separately, so the stale console
  specs were not updated with either the form or resulting-state change.
- The e2e gate uses `--fail-on-flaky`; it correctly exposed the deterministic failure instead of
  accepting a retry as green.

## Proposed prevention

1. Keep the two LINE console specs aligned with the current one-click form, automatic Server
   activation and persisted account result.
2. Run `npm run test:e2e` after any change to the LINE Studio form or tab routing.
3. Preserve accessible labels and submit names as part of the browser contract; change the specs in
   the same change when the product wording intentionally changes.

## Current resolution state

- The specs are being updated to submit the current one-click form, assert automatic Server ownership,
  and use the draft-specific Rich Menu queue blocker before continuing with the remaining assertions.
- The RCA remains under review until targeted LINE e2e and the complete `--fail-on-flaky` suite pass.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-09-07 | under review | Added automatic Server activation state drift to the LINE Studio RCA | working-tree | RWANG |
| 0.1.0b | 2026-09-07 | under review | Recorded LINE Studio form/spec contract drift and prevention | working-tree | RWANG |
