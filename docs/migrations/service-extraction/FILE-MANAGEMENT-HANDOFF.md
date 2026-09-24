---
id: ZAI:FILE-MANAGEMENT-HANDOFF
title: File Management service extraction handoff
version: "0.1.1b"
created_at: "2026-09-24T10:57:59+07:00,Codex, base fad8ec6"
last_update: "2026-09-24T23:10:00+07:00,Codex"
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
| T0 catalog upload outcome | READY_FOR_REVIEW | Root cause was the upload path treating a missing Business Knowledge binding as failure of the already-saved Business catalog FileAsset. Fix commit 3263ddf is on PR #543, now marked ready for review. S1 received a REVIEW_REQUEST for head 3263ddf42e16ca1b6736af25e73e9c987e843593 and confirmed a read-only review; no review result is available yet. File and Knowledge outcomes are now reported separately; no fallback to another Business. |
| T1 independent FilePort service | LOCAL PASS | Standalone Node ESM service, Postgres repository, S3-compatible exact-version adapter, HTTP API, authority client, migration, contracts and isolated tests are present under services/file-management/. The operation intent is persisted before the HTTP body stream. |
| T2 LINE and CRM handoff | PARTIAL | LINE_CAPTURE has strict channel binding, message id, attachment ordinal and provider type. Only synthetic authority and byte fixtures were exercised. No LINE webhook/media request or CRM attachment integration ran. |
| T3 Knowledge and pipeline lineage | NOT STARTED | Owner references and state projection remain contracts; no Knowledge or Integration runtime was changed or contacted. |
| T4 bound SOT module | NOT STARTED | ADR-107 records the target boundary. No browser SOT read/history/diff, review, restore or provider action is implemented here. |
| T5 consumer migration and release gates | NOT STARTED | No consumer cutover, production migration, CI service job, deployment or rollback rehearsal has run. |

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
| Hosted CI for the standalone service | NOT RUN |
| Browser/user UAT and production verification | NOT RUN |

The passing isolated suite uses memory storage/repository and mocked database
and provider boundaries. It does not prove runtime PostgreSQL, MinIO, authority
availability, consumer compatibility, hosted CI, or production readiness.

## Shared documentation serial window

This branch has not edited the shared ID ledger, generated graph, OpenAPI
inventory, API appendix, or root CI. Reconcile the new ADR-107 source together
with ADR-106 from PR #542 and ADR-108 from PR #544, then run the sanctioned ID
writer and governance chain once for the composed tree. Session 4 has not
reserved a new FR or SDD.

The user-requested Session 4 delta was forwarded to the serial owner. PR #545
adds one OpenAPI path and two operations to the reported inventory (336 to 337
paths; 442 to 444 operations), and changes the API appendix and OpenAPI
inventory test. The linked comment reports ADR-108 pinned on #544. Its test and
CI observations are tied to code head b53d849; the current open draft #544 head
was observed as ad69952, so refresh those observations before promoting them.
At the time of this handoff, #545 is still an open draft at 19f8ee41.

## Release boundary

T0 is ready for S1 review and awaits the review result. T1 remains an isolated handoff branch pending the runtime and integration gates. Neither state authorizes merge or deployment. T2 requires
LINE and CRM owner approval before integration. External owner changes require
their own repository and authority. No production database migration, live
LINE fetch/send, MinIO volume/configuration change, business document publish,
service deployment, merge, or cutover was performed by this work.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0b | 2026-09-24 | beta | Record File Management implementation status, evidence boundaries, and shared serial-window inputs | working-tree | Codex |
