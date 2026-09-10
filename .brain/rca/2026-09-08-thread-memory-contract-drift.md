# Thread memory contract drift

Status: confirmed by source inspection and synthetic packet execution; refinement authorized by owner.

## Symptom

The first LINE/MSP implementation was reported as supporting protected memory and summary injection despite mismatched wire fields, inbound-only exchanges and inaccurate gap reporting.

## Evidence

- MSP `thread-memory.mjs:497` returns `threadSummaries` and `protectedRecords`; Zuri `msp-thread-memory-port.js:89` reads `summaries` and `protectedMemory`.
- The record handler returns a record directly while Zuri expects `record.recordId`.
- The builder drops a partially overlapping summary wholesale and checks an object-valued coverage gap using `=== true`. A direct synthetic invocation returned summaryCount=0 and coverageGap=false despite an omitted prefix.
- `turn.js:78` appends inbound only; no complete outbound exchange is persisted in that flow.

## Root cause

Independent fixtures mirrored each implementation's assumptions instead of validating producer output against the consumer. Persistence tests were treated as proof of complete integration. Coverage selection lacked source-range accounting.

## Why the issue escaped detection

The Zuri fixture used the consumer's invented field names; the MSP suite never called the Zuri adapter. Governance links checked existence, not semantic interoperability. Reports did not distinguish implementation slices from actual message delivery.

## Proposed prevention

Cross-repository integration using real MSP handlers/storage, strict canonical responses, scope-negative tests, complete/pending exchange tests, source coverage assertions, and outcome-specific delivery/injection receipts. Report tests by capability exercised, never infer production readiness from counts.

## Follow-up evidence and prevention

Astra's review also identified that a compaction lease did not wait for the answer invocation, fallback delivery could refer to a nonexistent outbound, and delivery invalidation could clear a lease token while a conditional inner check skipped null tokens. The local refinement now waits for terminal/explicit expiry, persists unmatched delivery receipts and creates amendments after late evidence, and checks RUNNING/token/expiry/range unconditionally inside the commit transaction. The worker's eight regression scenarios cover recovery, active-answer waiting, fallback reconciliation, source attribution, and stale leases even when a second receipt leaves the digest unchanged.

## Reproducible cross-repository evidence

The real MSP contract gate was rerun from the MSP worktree with:

`$env:MSP_TEST_ZURI_ROOT='C:\Users\pc\workspace\zuri-ai-finish-memory-20260910'; npm run test:cross-zuri`

It returned one passing file and one passing test while using the actual MSP handlers and storage. The signed direct inbound append deliberately succeeds without an authorization or requesterId claim because the MSP append contract authorizes the human speaker identity and treats the message as non-private input. The same real-server check rejects a cached tenant/business authorization mismatch before dispatch and rejects a delivery route whose business does not match the signed grant. No MSP files were changed.
