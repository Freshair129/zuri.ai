---
version: "1.0.0b"
status: resolved
created_at: "2026-09-17T03:30:00+07:00,RWANG,uncommitted"
last_update: "2026-09-17T03:30:00+07:00,RWANG"
---

# Native acceptance selected an obsolete Tier 4 worker

## Symptom
The first FR-252 native regression run failed with DECISION_VERSION_INVALID.
No computed price publication was claimed from that run.

## Evidence
The locally retained GenesisBlock-ki17 worker at ce558a7 accepts only
ontology_v1 in worker.mjs:280. Current GKS emits ontology_v2. The deployment
manifest apps/server/deploy/ki17/pins.json names GenesisBlock
7c9261c4a4d4193af4e2613db48896533eb28072, whose worker accepts both versions.

## Root cause
The test command selected a historical local checkout from an old acceptance
report rather than reconciling it with the current deployment manifest.

## Why it escaped detection
The directory existed and its native addon started successfully. Startup
health did not prove compatibility with the source decision ontology.

## Prevention and resolution
Use an isolated git archive of the manifest's worker revision. The tested
Windows native artifact SHA-256 is
108c1fca91be9179ff7c70cd968cb30249e5b8b6415d6035cb4d963e6ed22347.
No companion checkout, runtime gate, contract or production store was modified.
With the matching worker, all 36 native cases passed, including the computed
ledger product and price records, Stage 17 receipts and cited retrieval.
This is Windows isolated runtime evidence; it does not replace Linux image
acceptance, production activation or production retrieval benchmarks.
