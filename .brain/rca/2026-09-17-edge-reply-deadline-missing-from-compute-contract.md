# Edge reply deadline missing from the compute contract

Owner-approved correction: LINE-OA-LOCAL-LLM-CIN-EXECUTION v0.1.0b, 2026-09-17.
Classification C-3; HIGH cross-app contract risk. No production incident or measured timeout rate is claimed.

## Symptom
The requested local-model reply-before-expiry guarantee cannot be established from the compute contract.

## Evidence
At fb4b047a, line-conversation-jobs.js persists replyExpiresAt at the conservative ingress/event anchor +45 seconds. claimEdgeConversation serializes only leaseExpiresAt with a 300-second lease. Edge contract.ts is strict v1; executor.ts gives the model at least 30 seconds, bounded by that lease. client.ts spends up to 15 seconds on a request independently. The answer path performs retrieval before model generation.

## Root Cause
Execution lease lifetime and LINE reply lifetime are separate clocks, but only the first crosses the compute boundary. Independent retrieval/model/completion timeouts do not constitute a whole-turn reply budget.

Follow-up review found two awaited gaps: completion's initial contract read was outside its elapsed timer, and delivery selected Reply before vault/account resolution and its send-claim transaction. Either could cross the cutoff using an earlier time. Regressions advance monotonic time during the contract read and the worker clock during account resolution/SEND_STARTED; all must leave the provider uncalled or the answer discarded. Completion now charges the initial read, settlement charges manifest reads, and delivery checks expiry after resolution and immediately before provider invocation.

## Why the issue escaped detection
Existing tests cover lease expiry, durable delivery and optional delayed Push. They do not require a v2 edge result to return before the persisted Reply deadline, account for claim transit or cancel a tool/model operation at a shared deadline.

## Proposed prevention
Negotiate v2 explicitly; retain v1 for old clients. Carry execution identity and a server-derived relative budget plus absolute deadline. Subtract full claim round-trip time conservatively; consume the budget with a monotonic clock. Pass cancellation through retrieval/model calls; refuse late completion and report a typed failure. Keep LINE send authority and final deadline enforcement on Server. Test late admission, mixed protocol versions, malformed/expired budgets, cancellation and completion uncertainty.

## Acceptance-review correction: published retrieval cancellation

The initial v2 executor bounded the answer with an abort signal, and local HTTP RAG consumed it, but the published path used `wrapAnswerRag` -> published client -> `MspToolCall` without a signal. The outer race could abandon a result while MSP continued its independently timed initialize/tool request. Repeated expired turns could leave concurrent retrieval processes. Existing deadline tests used a signal-aware computation; existing MSP tests proved timeout/cleanup without a per-turn cancellation case.

The published/product adapters and client now accept a per-turn optional signal, passed to the MSP transport. A pre-aborted call cannot spawn; an active abort rejects pending requests and kills that call's child. The listener is removed on completion. Queued primary reads check the signal before starting, and cancellation cannot authorize legacy fallback or become ordinary unavailable evidence. The shared runtime does not retain the signal between turns. The executor supplies its current turn signal at the wrapper seam.

On 2026-09-17 the published Edge/product/deadline suites passed 35/35 and Edge typecheck passed. Real local Node fixtures verified termination during initialize and tools/call, refusal before spawn, no queued read after cancellation, and a clean next worker claim on the same runtime. This proves local transport cancellation, not target MSP/GKS latency or production process supervision.
