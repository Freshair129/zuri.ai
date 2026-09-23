# RCA: LINE webhook acknowledgement before durable admission intent

Date: 2026-09-24
Scope: Freshair129/zuri.ai, isolated `codex/conversation-runtime-service` checkout

## Symptom

The native LINE webhook can return 2xx after recording a `RawExternalRecord` while
the record is still `RECEIVED`. Admission then starts asynchronously. If the web
process stops before the admission function marks the row `ADMITTING`, LINE has
already been told the request was accepted and the reconciler will not select the
row.

## Evidence

- `apps/server/src/app/api/line-oa/accounts/[id]/webhook/route.js` calls
  `admitCaptured(...)` without awaiting it and returns the capture count.
- `admitCapturedLineEvents` in
  `apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js`
  writes `ADMITTING` only after that asynchronous function begins.
- `reconcileAbandonedLineAdmissions` selects only
  `RawExternalRecord.processingStatus = 'ADMITTING'` rows older than its stale
  threshold.
- ADR-105 D3 says admission is durable before ingress is considered accepted;
  the current route's capture-only acknowledgement does not satisfy that wording.

## Root Cause

The acknowledgement boundary was moved from the slow CRM/job admission transaction
to raw evidence capture to avoid LINE webhook retries. The implementation did not
make the post-ack admission work durable before returning 2xx: its recovery marker
was written by the same in-process continuation that could be terminated.

## Why the issue escaped detection

Existing tests prove that `ADMITTING` is written before the admission attempt, but
they invoke the admission function directly and do not terminate the process between
webhook response and continuation. The webhook integration test checks capture and
response behavior, not whether every acknowledged row is discoverable by restart
reconciliation.

## Proposed prevention

Persist the outbox state `ADMITTING` for each captured event before returning 2xx.
Treat failure to write that state as an ingress failure so LINE can retry. Keep
admission idempotent and owned by the existing core queue/CRM transaction. The
bounded reconciler remains the restart path; it retries `ADMITTING` rows and the
new Conversation Runtime consumes only jobs that the core has durably admitted.
Do not publish to a second queue or add a second database owner.
