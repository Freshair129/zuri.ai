---
id: ZAI:LINE-OA-P3-MEMORYOS-CIN-EVIDENCE
version: "0.1.2b"
created_at: "2026-09-17T03:15:00+07:00,RWANG,base fb4b047a"
last_update: "2026-09-17T03:53:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: agent
  scope: approved LINE OA P3 MemoryOS and CIN evidence
---

# P3 MemoryOS and CIN: local evidence

Implements P3 of [the approved plan](LINE-OA-LOCAL-LLM-CIN-EXECUTION.md), under
FR-232/FR-234 and ADR-091. Risk HIGH. MSP owns memory lifecycle; CIN introduces
no second store. Production opt-in is unchanged.

## Version diff

- Server API-011 transport adds only required MSP runtime variable names. Signed
  grants now carry the configured agent/workspace and fresh nonce. Unsupported
  `context_receipt_id` is replaced by the supported injection id correlation.
- Trusted lifecycle adapter methods enforce explicit participant/relink and
  data-subject permissions. Ordinary model tools cannot call them.
- Edge claim preparation creates an ephemeral packet only for opted-in,
  verified DIRECT participants, bounded to 24 slices and 6,000 UTF-8 bytes.
  Job state, account epoch, identity and memory policy are rechecked around
  reads. The whole preparation has a bounded deadline.
- CIN runs at the provider invocation boundary. Trusted policy, current question
  and tool protocol remain mandatory; excess mandatory content fails before
  inference. Memory is untrusted user data before the active user/tool sequence.
  Its lower-priority slices are scoped, trimmed and hashed with the exact
  messages/tools passed onward. The budget unit is UTF-8 bytes, not model tokens.
- `POST /api/edge/conversation-jobs/[id]/context` authenticates the Edge claim,
  repeats current policy/MSP checks and rejects a changed packet hash. Optional
  injection lifecycle records bind the CIN receipt id and exact selected MSP
  refs to API-011 receipts. Only the server sees signing keys and private route
  identities; the endpoint returns 204 and no content.
- Existing accepted-delivery outbox already applies to Edge jobs. Its real MSP
  delivery DTO and recalled assistant text are verified; no second assistant
  append path was added.

## Verification

Pinned provider: MSP `4ca98c3008d43c6295e886a2c1382d49172d274f`.

Run from repository root (PowerShell):

```powershell
$env:MSP_REPO_PATH='C:/Users/pc/workspace/Memory-and-Soul-Passport'
node --test apps/server/tests/acceptance/msp-memoryos-real-process.mjs
```

The harness creates a new temporary database and random test keys. It starts a
fresh real MSP process for every operation and fails if no checkout is provided.
Observed PASS: signed routing/append, same-person recall after restart, other
person denied, other agent denied, actual API-011 receipt state transitions,
accepted assistant delivery and recall, participant leave, relink closure,
erasure and same-idempotency-key replay with the same provider receipt id.
MSP-to-GKS child filtering excludes thread signing and identity-HMAC keys.
Its model is explicitly synthetic; provider-memory correctness is the assertion.

Edge `tests/unit/context-injection.test.ts`: 5/5 PASS, including actual Thai
sales system policy and product tool schemas fitting the default 16,384-byte
mandatory budget, exact input hash, one receipt per invocation, thread/audience
isolation, record precedence and UTF-8/contiguous-window trimming.

Focused Server run: 70/70 PASS across thread adapter, LINE memory worker,
environment allowlist, runtime, ephemeral packet/deadline and invocation
lifecycle tests. Full composed-suite evidence is owned by the integrator.

Composed provider review added 7 tests for actual multi-round receipt hashes,
revocation before inference, no receipt for a refused invocation, malformed
provider data, uncertain SUBMITTED/FAILED acknowledgements and decode-time
abort. Four reproduced failures were corrected. The combined Edge run
(provider lifecycle, CIN, existing model-port tests) passes 26/26.

## Deployment and evidence gates

The invocation fence now reads the exact scoped execution's persisted
`CONTEXT_COMMITTED` contract and original memory hash. REPLY and DELAYED_PUSH
use their original absolute deadline; revalidation never starts a new budget.
Deadline, lease and job expiry are checked after receipt acknowledgement too.
Focused invocation tests: 7/7 PASS.

## Real MSP and local model integration

Runnable opt-in harness: `apps/edge/tests/acceptance/memoryos-local-model.ts`.
Run from `apps/edge` with `MSP_REPO_PATH` set to the pinned checkout and
`MEMORY_MODEL_SAMPLES=100`, using `node --import tsx`.

Classification: **SYNTHETIC_MEMORY_MODEL_INTEGRATION**. The harness uses real
MSP processes and the actual Edge provider/CIN against Ollama `qwen3.5:9b`
Q4_K_M (digest `1bdc07fcb6394b54a1174a466d2606c169c68b0fdb92c678dddf12cc533bbd66`).
It creates an isolated temporary database, random keys and a synthetic DIRECT
participant. Scenarios cover recall, a current-price tool overriding historical
memory, and participant revocation before inference. Only counts, timings and
quality/error classifications are written to the ignored JSON artifact.

The per-request MSP limit stays 750 ms and the turn limit 24 seconds. A separate
15-second bootstrap limit initializes the empty test database before measurement.
The initial 100-sample attempt stopped after three consecutive integration
errors before inference, following a successful 6,360 ms warmup. Those errors
were not classified at source; their precise cause is UNKNOWN. A diagnostic
rerun passed 3/3: recall 4,081/4,792 ms, current-record tool round 8,530 ms;
revocation denied before model submission in 205 ms. That rerun made 88 MSP
calls and four model calls. A single recall required 23 fresh MSP processes;
the two-round price answer required 42. Counts and cumulative timing show
repeated MSP process work dominates this synthetic path.

The subsequent 100-sample run completed at concurrency 1, with **99/100 quality
passes and one fail-closed `MSP_INJECTION_RECEIPT_UNKNOWN`**. The transport
observed one `MSP_INITIALIZE_TIMEOUT`; its other rejection was the intentional
revocation probe. Warmup was 4,066 ms, excluded from the table. All values below
are attempt latency (successful and failed attempts), not a full-path SLO.

| Scenario | Samples | Quality pass | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|
| Combined | 100 | 99 | 5,565 | 8,406 | 9,882 |
| Recall | 50 | 50 | 3,985 | 5,196 | 6,397 |
| Current-record tool | 50 | 49 | 7,276 | 9,881 | 10,647 |

There were 3,223 fresh MSP calls (583,799 ms cumulative) and 149 model calls
(64,307 ms cumulative). These durations overlap during SUBMITTED recording and
must not be summed into elapsed latency. Revoked-context rejection took 172 ms
and submitted zero model requests. The result demonstrates real composition,
not production reliability: the 99/100 result fails a zero-error qualification.
The earlier failed attempt is retained above; reruns do not erase it.

This harness bypasses Server HTTP, identity/consent database resolution and the
builder's aggregate 3,000 ms timeout, while retaining its four-call refresh
shape. It excludes LINE acceptance/delivery, real GKS/product corpus and
physical Edge GUI. Its percentiles cannot qualify the full LINE business path.

## Live invocation telemetry (P5 integration)

Previously the Web journal received the Edge context receipt only at final
settlement. The existing `/context` and `/tools` helpers now queue content-free
events during execution, without awaiting logging or changing answer deadlines.
Successful appends use the existing durable `AgentTraceEvent` journal; queue or
database failure produces only `EDGE_INVOCATION_TRACE_UNAVAILABLE`, with no
inference/tool failure. The process-local queue holds at most 128 pending writes;
database lock wait and transaction limits are 250/1,000 ms. A process crash can
lose pending telemetry. Actual MSP receipt writes retain their fail-closed rules.

Scope, job and execution come from the persisted claimed job and are rechecked
inside the append transaction. Erasure/retention guards remain active. Technical
model/receipt tags reject whitespace and other content-bearing characters.

| Existing kind | Phase | Payload beyond phase |
|---|---|---|
| `EVIDENCE_SELECTED` | `CONTEXT_RESOLVED`, `MODEL_SUBMITTED`, `MODEL_UNKNOWN` | receiptId, modelRef, EDGE_REPORTED, CONTENT_NOT_RETAINED |
| `MODEL_COMPLETED` | `MODEL_COMPLETED` | same model tags and evidence disposition |
| `MODEL_FAILED` | `MODEL_FAILED` | same model tags and evidence disposition |
| `TOOL_INVOKED` | `STARTED` | server-generated toolInvocationId, toolName, SERVER_OBSERVED |
| `TOOL_RESULT` | `COMPLETED`, `FAILED` | same tool identity and evidence disposition |

No arguments, outputs, memory slices, error messages or new ContextReceipt are
copied into these events. `EVIDENCE_SELECTED` is ignored by replay's context/call
projection, so pre-inference phases cannot create a fake snapshot or execution
start. Terminal model events have no retained input and cannot claim replayability.
Model phases are authenticated Edge reports, while tool phases are Server observations.

The tool helper also requires its exact scoped v2 execution commitment and
uses the original negotiated REPLY/DELAYED_PUSH deadline before and after the
tool. A missing, wrong-execution or expired commitment fails closed; expiry
during a database search prevents returning its result. Logging cannot renew
the budget or authorize a delayed send.

Focused validation: **32/32 PASS** across real SQLite Project/Work and model
phase traces, memory invocation fences, tool route boundaries and asynchronous
writer tests. Assertions cover exact content-free fields, idempotent model
phase replay, no cross-scope denied-call events, stale execution suppression,
bounded technical tags, preserved UNKNOWN semantics, original tool deadlines,
and fixed diagnostics without waiting on slow writes.

## Production gates

- Server requires independently provisioned `ZURI_MSP_THREAD_SERVICE_KEY`
  (signer), `MSP_THREAD_SERVICE_KEY` or provider keyring (verifier),
  `MSP_IDENTITY_HMAC_KEY`, and explicit `ZURI_MSP_THREAD_WORKSPACE_ID`.
  `ZURI_MSP_THREAD_AGENT_ID` defaults to the configured actor. No credential or
  opt-in was written to any production environment.
- Invocation checkpoint validation currently rereads MSP on every state. It
  trades speed for fresh authority and may exceed the proposed SLO. The exact
  target machine, model, complete LINE path and offered load must qualify before
  production activation; these results provide no latency guarantee.
- Per-call erasure/consent checks cannot retroactively un-send a prompt already
  submitted. Abort or reject the next invocation and never retry an ambiguous
  provider submission. Provider-side lifecycle fences remain in force.
- Retention scheduling, complete deployed identity/consent withdrawal journeys,
  physical native UI and real OA canary are NOT_RUN by this P3 harness.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | P3 implementation and isolated evidence with explicit limits | working tree | RWANG |
| 0.1.1b | 2026-09-17 | beta | Persisted invocation deadline fence and real synthetic memory/model evidence | working tree | RWANG |
| 0.1.2b | 2026-09-17 | beta | Best-effort live model/tool journal events with content-free payloads | working tree | RWANG |
