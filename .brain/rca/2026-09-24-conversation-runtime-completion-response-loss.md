---
version: "0.2.0b"
created_at: "2026-09-24T07:57:21+07:00,Codex"
last_update: "2026-09-24T08:27:13+07:00,Codex"
status: "beta"
superseded_by: null
attributes:
  domain: "conversation-runtime"
  doc_type: "root-cause-analysis"
  scope: "durable completion and Work receipts across response loss and process restart"
---

# RCA — uncertain Core outcomes could misreport or repeat a committed operation

## Symptom

Core can commit a turn as `READY` and lose the HTTP response. The previous Runtime
path treated the thrown request error as an execution failure and called `fail()`
without first reading the durable turn state. A process can also stop after a
canonical Work mutation commits but before the response reaches Runtime. A reclaimed
process must use the same logical operation identity and read its durable receipt
before deciding to retry or send.

## Evidence

- At the reviewed baseline `189c60766323655149b84928e5db4c16c5e6afb8`,
  `services/conversation-runtime/src/turn-runtime.js` called `job.complete()` once
  and sent every non-delivery exception through the same `job.fail()` catch.
- The current Runtime uses the stable operation id `${jobId}:turn-answer`, reads
  Core status after a lost completion response, accepts the committed `READY`
  receipt, and skips `fail()` while completion remains uncertain.
- `services/conversation-runtime/test/turn-runtime.test.js` injects a committed
  `READY` followed by a lost response and asserts one model call, one complete
  call, one delivery call, and no failure call.
- `apps/server/tests/integration/conversation-runtime-vertical-slice.test.js`
  kills the separate Runtime after the canonical Work mutation and receipt commit,
  expires the lease, and starts a fresh Runtime. It reads the original proposal
  receipt before retrying; one WorkItem and one recovery delivery are recorded.
- The same integration file kills Runtime while the Core context request is held,
  before `MODEL_STARTED` or a provider request. A fresh process reclaims the lease,
  calls the controlled provider once and records one fake delivery.
- During that READY path, `ownedClaim` treated `checkLease: false` as requiring a
  non-null lease anyway, although completion had intentionally cleared it. The
  post-completion `ANSWER_READY` trace request was rejected even though Core had
  already stored its authoritative READY trace.

## Root Cause

The Runtime had no operation-status reconciliation between an uncertain Core
response and its generic failure handler. A network response describes delivery
of the result to the caller; it does not establish whether the server-side
transaction committed. Work execution checked status only after an exception, so
a newly started process could not reconcile a pre-existing receipt before its
first execute request. The Core readiness-trace guard also failed to honor its
explicit lease-check bypass after the durable completion cleared the lease.

## Why the issue escaped detection

The earlier tests exercised successful calls and errors before a durable commit.
They did not inject a response loss after `READY` had committed, and the Runtime
was not connected to a real Core facade or durable queue in the prior checkpoint.

## Proposed prevention

- Use one stable answer operation id per job and consult Core's durable status
  before deciding to retry, fail, or deliver.
- Query Work receipt status by the stable logical mutation id before every retry
  or execution after reclaim; keep confirmation, canonical write and receipt in
  the same Core transaction.
- Preserve operation-specific identity across reclaim. Model starts without a
  durable completion receipt remain `UNKNOWN`; they are not invoked again blindly.
- Keep `checkLease: false` limited to lease validation; the READY trace remains
  fenced by execution identity, tenant/business/account, identity, and transport
  epoch after the lease is cleared.
- Keep delivery outcome separate. Core's durable `SENDING` / `ACCEPTED` state
  decides whether another transport effect may start; this is not an exactly-once
  delivery guarantee.
