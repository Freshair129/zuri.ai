---
version: "0.1.0b"
created_at: "2026-09-20T17:30:00+07:00,Luna Max"
last_update: "2026-09-20T17:30:00+07:00,Luna Max"
status: "candidate"
superseded_by: null
attributes:
  domain: "line-oa-studio"
  doc_type: "root-cause-analysis"
  scope: "TASK-ZAI-036 FR-190 transport health sweep"
---

# RCA — FR-190 sweep omitted the account connection scope

## Symptom

The per-account FR-190 read scopes inbound silence to the selected LINE OA
account, but the hourly worker sweep can evaluate silence without the account's
connection id. A quiet or active account can therefore receive a warning based
on another connection's latest raw record.

## Evidence

- `readSilence` queries `RawExternalRecord` with
  `where: { connectionId: account.integrationConnectionId }`.
- `sweepLineTransportHealth` selected the account fields used by the sweep but
  omitted `integrationConnectionId`.
- The sweep then passed those incomplete rows to `readSilence`; the existing
  single-account test fixture returned a complete row and therefore did not
  exercise the projection boundary.

## Root Cause

The worker sweep's explicit Prisma `select` was not kept in sync with the
account-scoped silence query. The field was present on `LineOaAccount` and on
the full `findUnique` result used by the route, but was dropped from the
separate `findMany` projection used by the worker.

## Why the issue escaped detection

The focused sweep test used one fixture whose `findMany` double ignored the
requested select and returned the full account row. It asserted warning counts
and log shape, but not the connection id supplied to the raw-record aggregate.

## Proposed prevention

Keep `integrationConnectionId` in the sweep projection and assert both the
projection and aggregate filter for two accounts with different connections.
This preserves the existing read-only contract without adding a model field,
migration, provider call, or production activation step.

## Evidence scope

This RCA and its regression are isolated source changes. They do not prove
hosted CI, provider reachability, a LINE canary, or production health.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-20 | candidate | Recorded and corrected the missing account connection scope in the FR-190 worker sweep | working-tree | Luna Max |
