---
version: "0.1.0b"
created_at: "2026-09-06T19:13:50+07:00,RWANG"
last_update: "2026-09-06T19:13:50+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "marketing"
  doc_type: "root-cause-analysis"
  scope: "Persisted Marketing PM handoff replay scope and receipt integrity"
---

# RCA — Marketing handoff replay bypassed Business visibility and full receipt binding

## Symptom

The historical-receipt branch of PM handoff preparation checked the `growth`
domain but did not check whether the viewer could see the requested Business.
It also trusted receipt fields without matching them back to the persisted
handoff row and loaded revision.

## Evidence

- Historical replay ran before the live approval reader and only called
  `assertDomainVisible`.
- Receipt lookup could therefore run by `planId`, `workspaceId` and
  `expectedVersion` for a viewer with no `visibleBusinessIds` entry. PM's real
  target authorization still refused that viewer; the missing Marketing check
  made its own boundary depend on the downstream adapter. The regression uses
  an injected PM adapter to prove refusal before that adapter is consulted.
- The branch verified the envelope hash but did not require row and receipt
  `planVersionId`, `payloadHash`, and `envelopeHash` to agree.
- It also did not recompute the immutable revision hash from `payloadJson`.
- Integration regressions now cover hidden-Business replay refusal and a
  persisted row-hash and revision-content mismatch.

## Root Cause

The replay path was treated as a read-only shortcut around the live approval
reader, but it still returns scoped Business and PM receipt data and must carry
the same Business visibility boundary. Receipt validation covered content
integrity without validating the identity and hash joins between receipt, row,
and immutable Marketing revision.

## Why the issue escaped detection

Existing handoff fixtures used a viewer visible to the fixture Business and
tested replay idempotency with internally consistent rows. They did not model a
hidden Business or tamper a persisted row field after commit.

## Proposed prevention

1. Apply `seesBusiness` before both live and historical handoff preparation.
2. Validate receipt-to-row-to-revision identity, recompute the revision content
   hash, and compare payload/envelope hashes before replaying a stored result.
3. Keep hidden-scope and receipt-tamper regressions beside the handoff adapter.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Recorded historical handoff replay scope and receipt binding gaps | pending | RWANG |
