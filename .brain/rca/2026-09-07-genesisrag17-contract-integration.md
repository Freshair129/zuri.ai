---
version: "0.2.0b"
created_at: "2026-09-07T23:30:00+07:00,RWANG"
last_update: "2026-09-08T00:08:00+07:00,RWANG"
status: beta
attributes:
  domain: knowledge
  doc_type: root-cause-analysis
  scope: isolated cross-repository implementation validation
---

# GenesisRAG17 integration failures caught before acceptance

## Symptom

Individual subsystem tests passed while the real raw-to-native chain stopped at decision validation, graph acknowledgement or the quality gate. These are development failures in the isolated implementation, separate from the original unimplemented pipeline RCA.

## Evidence

- The actual four-process acceptance initially returned `DECISION_HASH_MISMATCH`. GKS used sorted objects followed by JSON.stringify; the worker serialized sorted keys directly. A stageMetrics object containing keys 9 and 10 reproduces the difference because JavaScript enumerates integer-looking keys numerically.
- The same acceptance subsequently returned `graph receipt nodeCount does not match the immutable decision`. Native projection includes source, parsed, chunk, entity, fact and provenance objects; the initial GKS expectation counted canonical entities only.
- The quality gate then refused `bitemporal lane is unsupported`. Worker validation required temporal.status, while the frozen GKS contract expresses applicability through validFrom/validTo, including the explicit not_applicable sentinel.
- Review found a prepared snapshot file could exist before pointer publication. Historical query authorization must consult the atomically published history, not infer publication from file existence.
- Governance reported four GenesisRag17 models absent from backup although the actual backup/restore acceptance restored their rows. The snapshot-list parser accepted letters only, so it silently discarded valid Prisma accessor names containing digits. The parser now accepts the same identifier characters as Prisma model enumeration.
- With allowPublication=false, GKS correctly returned quality PASS with permission denied and terminal FAILED evidence. The Tier1 legacy gate adapter treated PASS as publishable and demanded a snapshot, blocking evidence import. The adapter now maps this combined legacy state to QUARANTINE while retaining the original quality/permission fields in immutable evidence; the run closes FAILED and the old snapshot remains visible.

## Root Cause

Producer and consumer implementations encoded separate interpretations of hash ordering, physical versus canonical counts, temporal applicability and snapshot visibility. Successful isolated tests did not establish a shared cross-process contract.

## Why the issue escaped detection

Subsystem fixtures were authored against their own implementation. They did not start from the real raw entrypoint, exercise the other repositories' serializers, or terminate the native process at publication boundaries.

## Proposed prevention

Use the frozen contract and one real integration corpus across all repositories. Compare exact physical counts separately from canonical decisions. Keep strict hash checks, serialize integer-looking keys consistently, test explicit temporal applicability, and require published-history membership for named snapshots. The acceptance suite kills the actual worker at native-commit and pointer boundaries and requires resolvable historical citations after restart. The full native acceptance now passes17/17 with no skips, including publication-policy denial; final repository checks and their unrelated exclusions are recorded in the acceptance report.
