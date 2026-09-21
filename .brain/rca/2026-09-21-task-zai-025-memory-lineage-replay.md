---
version: "0.1.0b"
created_at: "2026-09-21T00:00:00+07:00,Luna Max,working-tree"
last_update: "2026-09-21T00:00:00+07:00,Luna Max"
status: "candidate"
superseded_by: null
attributes:
  domain: "agent-governance"
  doc_type: "root-cause-analysis"
  scope: "TASK-ZAI-025 Memory lineage, replay and the no-silent-replay guarantee"
---

# RCA — TASK-ZAI-025 replay could reuse current memory without a lineage check

## Symptom

The native agent runtime preserves optional MSP memory evidence, but there is no
runtime boundary that compares the memory identity, version and captured-content
hash from a recorded context with the context selected for replay. A replay
caller could therefore assemble a newer memory snapshot and have no local
fail-closed result identifying the divergence.

## Evidence

- `apps/server/src/modules/agent/context.js` retrieves the current authorized
  memory and returns its entries/evidence, but has no recorded-lineage comparison.
- `apps/server/src/modules/agent/runtime.js` composes memory and knowledge ports
  only; it exposes no lineage capture or replay guard.
- `apps/server/src/modules/agent/execution-trace.js` playback is intentionally
  data-only and validates stored context hashes; it does not resolve or compare
  a later memory source.
- Existing trace tests cover missing context and request-hash mismatch, while
  runtime/MSP tests cover adapter wiring and evidence capture; no focused test
  rejects a newer memory version during replay.

## Root Cause

Memory provenance was preserved as evidence at the adapter boundary, but the
runtime contract stopped at capture. The stored evidence was not promoted to a
replay precondition, so current-memory retrieval and recorded-context replay
had no shared comparison seam.

## Why the issue escaped detection

FR-171-P1 proved read-only playback of retained trace rows, and FR-171-P2 proved
that API-009 identity/version evidence survives the adapter. Those tests did not
join the two contracts at the runtime replay boundary. The task container also
had no linked test for its version-divergence criterion.

## Proposed prevention

1. Capture a deterministic memory-lineage envelope from the context evidence.
2. Compare recorded and replay-time references in stable order, including the
   MSP memory id, version, vault, source hash and captured snapshot hash.
3. Refuse missing or divergent lineage before a replay result is returned, and
   expose the recorded/current versions in the error details.
4. Keep the guard pure: it performs no MSP call, model call, side effect,
   persistence or authorization change.

## Scope and release limit

This RCA covers the local runtime guard and its focused deterministic tests. It
does not claim MSP operations, cross-repository parity, production activation,
migrations, deployment or live replay of external side effects.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-21 | candidate | Documented the missing runtime memory-lineage comparison before implementation. | working-tree | Luna Max |
