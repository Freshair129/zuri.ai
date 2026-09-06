---
version: "0.1.0b"
created_at: "2026-09-06T19:09:27+07:00,RWANG"
last_update: "2026-09-06T19:09:27+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "marketing"
  doc_type: "root-cause-analysis"
  scope: "Approved Marketing plan preview and PM handoff authority"
---

# RCA — Marketing approved-plan preview used owner-only authority

## Symptom

The shared approved-plan helper used the Business write gate for every call.
The PM handoff adapter passes an operation marker for both preview and commit,
so a visible growth member could not preview an approved plan even though the
preview performs no persistence. Commit must remain owner-only.

## Evidence

- `getApprovedMarketingPlanForHandoff` called `assertMarketingWriteAccess`
  unconditionally.
- PM handoff preparation passes `operation: 'preview'` before its owner-gated
  commit path.
- The regression now proves a visible-only viewer receives the approved DTO with
  `canWrite: false`, while the same viewer receives a 404 for commit authority.

## Root Cause

The helper combined read-side approval evidence with the mutation authority
check and did not use the operation boundary already supplied by the handoff
adapter.

## Why the issue escaped detection

The handoff integration fixtures injected a read-approved-plan function, so they
exercised the adapter's visible preview contract without invoking the default
Marketing helper. Core approval tests covered owner reads and stale/expired
decisions but had no visible-only preview case.

## Proposed prevention

1. Treat `operation: 'preview'` as Business visibility plus growth visibility.
2. Keep every other operation, including the default, owner-gated for commit.
3. Keep a real integration regression for visible preview and member commit
   denial beside the shared helper.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Recorded owner-gate and preview-read mismatch in the PM approval helper | pending | RWANG |
