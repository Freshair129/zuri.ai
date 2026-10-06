---
id: ZAI:FILE-MANAGEMENT-HANDOFF
title: File Management service extraction handoff
version: "0.1.3b"
created_at: "2026-09-24T10:57:59+07:00,Codex, base fad8ec6"
last_update: "2026-10-06T07:08:00+07:00,Codex"
status: beta
superseded_by: null
attributes:
  domain: file-management
  scope: service-extraction-status
relations:
  - type: relates_to
    target: ZAI:ADR-107
---

# File Management service extraction handoff

This handoff records the approved local implementation scope and the evidence
available on the isolated branch. It does not authorize merge, deployment,
production migration, provider activation, or business-content publication.

## Current tranche status

| Tranche | Status | Evidence and boundary |
| --- | --- | --- |
| T0 catalog upload outcome | MERGED | PR #543 merged on 2026-09-27. File and Knowledge outcomes are reported separately; a missing Business Knowledge binding does not undo the saved Business catalog FileAsset or fall back to another Business. |
| T1 independent FilePort service | LOCAL PASS; PRIOR-HEAD HOSTED CI PASS | Standalone Node ESM service, Postgres repository, S3-compatible exact-version adapter, HTTP API, authority client, migration, contracts and isolated tests are present under services/file-management/. The operation intent is persisted before the HTTP body stream. Hosted CI passed on PR #635 head 40ec4daa; the composed head requires a new run. |
| T2 LINE and CRM handoff | PARTIAL | LINE_CAPTURE has strict channel binding, message id, attachment ordinal and provider type. Only synthetic authority and byte fixtures were exercised. No LINE webhook/media request or CRM attachment integration ran. |
| T3 Knowledge and pipeline lineage | NOT STARTED | Owner references and state projection remain contracts; no Knowledge or Integration runtime was changed or contacted. |
| T4 bound SOT module | NOT STARTED | ADR-107 records the target boundary. No browser SOT read/history/diff, review, restore or provider action is implemented here. |
| T5 consumer migration and release gates | NOT STARTED | A standalone service CI job passed on the prior PR head; consumer cutover, production migration, deployment and rollback rehearsal have not run. |

## T1 service boundary

The service owns file operation records, immutable file-version metadata,
storage identity bindings, provenance and exact-version receipts. It does not
import Next.js or share the Server Prisma client. Authorization is requested
through a narrow external capability port and fails closed when unavailable.
No FileAsset, CRM, Knowledge or Integration table is read or written by this
service.

Original bytes are stored through a private S3-compatible adapter. The receipt
binds provider, storage binding, bucket, key and exact object version to the
declared SHA-256 and byte length. Reads request that exact provider version.
A PENDING operation survives a client disconnect and may be retried with the
same idempotency identity; the service does not create the object until the
complete body has passed length and digest checks.

LINE source metadata is recorded only after source-specific authority grants
files:line-capture. Files does not verify LINE signatures, hold channel secrets,
or fetch provider media. CRM remains responsible for attachment meaning,
consent, retention and unsend.

## Local verification

| Check | Result |
| --- | --- |
| services/file-management: npm test | PASS, 33 passed, 0 failed, 0 skipped |
| services/file-management: npm run check | PASS, Node syntax checks |
| FilePort and authority contract JSON parsing | PASS |
| PostgreSQL migration on a disposable live database | NOT RUN |
| Docker Engine image build and inspect | PASS — file-management-service:codex-3263ddf42e16-20260924-rootapi; image sha256:0e557eafb9f49675f0feba85193b0828e1b9bd79caaad7ec1c7c4b6bcf2dcd35; Docker Engine 29.8.0/API 1.56; 16-file build context. No container started. |
| Live authority provider and real consumer integration | NOT RUN |
| Hosted CI for the standalone service | PASS on PR #635 head 40ec4daa, Actions run 37358294077; composed head NOT RUN pending new CI |
| Browser/user UAT and production verification | NOT RUN |

The passing isolated suite uses memory storage/repository and mocked database
and provider boundaries. It does not prove runtime PostgreSQL, MinIO, authority
availability, consumer compatibility, composed-head CI, or production readiness.

## Shared documentation serial window

The original T1 checkpoint did not edit the shared ID ledger, generated graph,
OpenAPI inventory, API appendix, or root CI. The PR #635 composition has since
pinned ADR-107 through the sanctioned ID writer and regenerated shared views.
The composed head still needs its own governance, tests and CI. Session 4 has
not reserved a new FR or SDD.

The Session 4 OpenAPI inventory delta and ADR-108 were merged through PR #545
and PR #544 on 2026-09-24. Their historical test and CI observations are tied
to their own heads; they are not proof of this File Management branch.

## Release boundary

T0 PR #543 is merged. Its earlier automatic review block is historical. T1 remains an isolated handoff branch pending review and the runtime and integration gates. Its passing prior-head CI does not authorize merge or deployment. T2 requires
LINE and CRM owner approval before integration. External owner changes require
their own repository and authority. No production database migration, live
LINE fetch/send, MinIO volume/configuration change, business document publish,
service deployment, merge, or cutover was performed by this work.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0b | 2026-09-24 | beta | Record File Management implementation status, evidence boundaries, and shared serial-window inputs | working-tree | Codex |
| 0.1.1b | 2026-09-24 | beta | Record Docker image build proof and PR #543 review state | working-tree | Codex |
| 0.1.2b | 2026-09-24 | beta | Record automatic review gate blocking PR #543 | working-tree | Codex |
| 0.1.3b | 2026-10-06 | beta | Reconcile merged T0 and prior-head T1 CI while preserving pending composed-head and runtime gates | working-tree | Codex |
