---
version: "0.1.1b"
created_at: "2026-09-17T03:15:00+07:00,RWANG,base fb4b047a"
last_update: "2026-09-17T03:35:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: agent
  scope: MSP API-011 and Edge CIN
---

# MSP API-011 compatibility and missing Edge context injection

## Symptom

Existing signed Zuri thread-memory adapter could not interoperate with MSP
`4ca98c3008d43c6295e886a2c1382d49172d274f`; Edge local model rounds had no
server-authorized MemoryOS context or per-invocation composition receipt.

## Evidence

- `msp-stdio-transport.js` omitted `MSP_THREAD_SERVICE_KEY` and
  `MSP_IDENTITY_HMAC_KEY`; the spawned process lacked thread grant verification
  and pseudonymization configuration.
- Zuri's grant contained no agent/workspace identity or nonce. MSP
  `thread-access.mjs` requires both identities on every API-011 call and
  `thread-guard.mjs` requires a nonce for mutation tools.
- Zuri sent `context_receipt_id` to `msp_thread_injection_record`; pinned API-011
  declares `additionalProperties: false` and has no such field.
- Existing integration tests mostly injected permissive transports rather than
  spawning the pinned server. The real-process harness now passes independent
  Zuri signing against that server using an isolated temporary SQLite database.

## Root cause

The client adapter had not been reconciled with the provider's shipped strict
API-011 contract. The transport environment and grant shape lagged behind that
contract, and the previous CIN path covered server composition only.

## Why the issue escaped detection

Mock transports accepted otherwise rejected grant/payload fields and omitted
provider lifecycle state validation. Presence of source/tests was previously
treated as compatibility evidence without a cross-process contract check.

## Prevention and implemented correction

Use explicit MSP runtime environment names, require a configured workspace for
signed thread ports, sign agent/workspace identity and a fresh nonce, and use
API-011's supported injection id to correlate CIN receipts. Keep the runnable
real-process harness as a separate mandatory opt-in qualification step; a missing
checkout fails rather than silently passing. The pinned MSP's GKS environment
allowlist independently excludes thread-service and identity-HMAC secrets.

Edge CIN counts the actual UTF-8 request messages and tool schemas, filters
authorized memory, preserves mandatory tool protocol, and produces a separate
receipt per model round. Server rechecks the claimed job, account, identity,
consent and fresh MSP packet before accepting invocation lifecycle writes.

## Limits

No production activation, live LINE send or target-machine latency acceptance is
proved by these tests. Fresh MSP calls on every lifecycle checkpoint are safe
but expensive; benchmark the complete path before enabling an OA. Erasure is
not a permanent identity blacklist; consent withdrawal and job fencing remain
necessary. Lifecycle adapter operations are available only to trusted callers
with explicit capabilities, not exposed as ordinary model tools.

## Composed-provider review

The new provider lifecycle initially awaited SUBMITTED acknowledgement without
aborting the pending model request on an uncertain acknowledgement, left JSON
decode failures at SUBMITTED, and did not normalize FAILED acknowledgement
uncertainty. A signal abort during decode could return a completed answer.
Four executable provider tests reproduced these defects before correction.

The provider now owns an invocation AbortController, cancels an uncertain
submission, sanitizes decode errors, records the failure state, and preserves
UNKNOWN when receipt writes are uncertain. It checks abort after decode and
emits a CIN invocation receipt only after initiating the model call. These
paths plus actual two-round prompt hashes and refused pre-inference checkpoints
pass 7 provider tests; the focused Edge run passes 26/26 including existing
model-port behavior and the CIN composer.

## Persisted invocation budget review

Symptom: a correctly negotiated DELAYED_PUSH invocation was rejected once the
original LINE reply window expired. Evidence: the invocation helper derived
`replyExpiresAt - 5000` while claim had already persisted its explicit execution
budget in `CONTEXT_COMMITTED`. It also checked time before an asynchronous
receipt write, allowing an acknowledgement after the answer deadline.

Root cause: the helper recomputed a reply-only budget instead of reading the
exact scoped execution commitment. Initial tests covered only active reply
windows and immediate receipt writes. Prevention: require that commitment and
its original memory hash, use its absolute deadline without renewal, and check
deadline/lease/job expiry after receipt acknowledgement. Seven focused tests
pass, including explicit delayed push, immutable reply deadline, missing or
mismatched commitment and receipt-time expiry. Risk: HIGH, authorization and
deadline fence; no production activation.

The Project/Work Edge tool helper had the same reply-only calculation. It now
requires the exact scoped v2 commitment and checks its original deadline both
before and after the handler. Real SQLite coverage includes delayed push,
missing/expired/wrong-execution commitments and expiry during an actual search.

## Live telemetry gap

Web trace previously received Edge context receipts only on final settlement,
so it could not show intermediate model/tool phases. That final-settlement
test coverage did not assert live journal events. Approved P5 adds bounded,
asynchronous content-free event writes using existing kinds and transactionally
fences the original claimed execution. Failures log only a fixed diagnostic;
they do not block model/tool work or replace actual MSP receipt handling.
UNKNOWN uses nonterminal evidence, preserving uncertainty. Focused proof:
32/32 tests pass, including real persisted events, exact payload allowlists,
idempotency, denied calls, stale callbacks and slow/failed logging isolation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Evidence-backed API-011 incompatibility and correction | working tree | RWANG |
| 0.1.1b | 2026-09-17 | beta | Persisted execution deadline and asynchronous receipt fence | working tree | RWANG |
