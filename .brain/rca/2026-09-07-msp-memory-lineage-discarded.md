# MSP memory lineage is discarded at the Zuri port

## Symptom

The authorized memory context contains remembered bodies but cannot identify the
MSP entity revision that supplied each body. A write returns a later list rather
than the receipt of the actual write.

## Evidence

- `apps/server/src/modules/agent/msp-memory-port.js`: `listVault` maps entities
  through `entryFromEntity`, retaining only `body_json`.
- `rememberAuthorized` awaits `msp_memory_upsert` without preserving its result,
  then performs another authorized recall.
- `apps/server/src/modules/agent/context.js` projects only key and entries from
  the recall, dropping any additional metadata a port could return.

## Root Cause

The original MemoryPort contract was an opaque body list. It predated FR-171's
versioned replay requirements, so entity provenance and write receipts were
discarded at both the adapter and context projection boundaries.

## Why the issue escaped detection

Existing tests assert remembered content, vault authorization and principal
isolation. Their response fixtures often contain only `body_json`; they do not
assert entity identity, revision availability or exact write receipt provenance.

## Proposed prevention

Preserve bounded, detached per-entry metadata from the actual MSP contract and
carry it through the authorized context seam. Keep missing revisions explicit;
never derive an MSP version from a local timestamp or a hash. Preserve the actual
write result separately from any subsequent recall. Test response mutation,
scope mismatch, missing revisions and writes followed by later memory changes.
Native SERVER private-memory activation remains a separate gate.

## Follow-up residual review (2026-09-08)

The bounded P2 review closed the original four defects but found two remaining
implementation items:

- Duplicate returned entries with the same `memoryId` and `current_version`
  currently need conflict detection against both the local `snapshotHash` and
  the MSP-provided `sourceHash`. The intended fix is to compare the pair and
  reject a contradictory source revision instead of treating it as equivalent
  evidence.
- The explicit legacy compatibility resolver currently checks only that a
  returned vault string contains `tenant:` and `principal:`. The intended fix
  is to bind the exact `tenant:` and `principal:` slash segments to the
  authorized AuthContext before API-009 access. Unqualified `recall(key)` is
  unchanged.

Five regression cases reproduced these findings before the fix (one conflicting
source hash and four resolver scope substitutions). Comparing both hashes and
requiring exactly one matching tenant/principal segment now passes all five;
the focused five-file suite passes 56 tests. Full final verification is recorded
in the P2 phase report.
