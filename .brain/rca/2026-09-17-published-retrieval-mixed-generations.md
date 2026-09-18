# Published retrieval could mix generations or backends in one answer

Risk HIGH, C-3. Implements the approved LINE OA Local LLM/CIN plan, P2.

## Symptom

Several tools in one answer could use different published snapshots, or combine
published search evidence with legacy price/budget evidence.

## Evidence

The former published adapter independently queried the latest pointer each call,
did not send the already-supported snapshotId selector, and caught every failure
as permission to use legacy fallback. Price/budget were unsupported in the
published contract. A diagnostic-store exception could also enter the fallback.

## Root cause

Backend/generation selection belonged to each tool invocation instead of one
answer turn. The fallback catch combined availability, authorization, integrity
and diagnostics failures.

## Why the issue escaped detection

Fixtures used one stable snapshot and checked each tool independently. They did
not race the first reads or publish a new generation between tool invocations.

## Prevention

Bind the wrapper to one snapshot/generation or legacy backend per turn, serialize
initial selection, verify citation hashes and fail closed after integrity errors.
The new corpus path pins one immutable Server-selected manifest for all product
tools and never falls back. Regression tests cover concurrent/sequential changes,
turn isolation, backend mixing, diagnostic failure and typed price provenance.

## Final-answer fallback review

Review of `respond.ts` and `executor.ts` found a second boundary gap: the responder built a local-catalog fallback before published retrieval, and the executor accepted it whenever a legacy catalog was populated. Published retrieval outage or model failure could therefore bypass the selected corpus even after its adapter stopped fallback. Corpus-bound execution now omits the legacy catalog, requires the instrumented compatible provider, and permits only explicit verified published/operational answer markers or fixed safe refusals. Regression tests use a populated legacy JSON catalog with real answer orchestration and failed published/model calls. No legacy price, fabricated live quote, tax/shipping claim or calculated total may escape through the fallback.
