# Native Console acceptance selected an incompatible worker

Version: 0.1.1b

Status: confirmed; compatible isolated acceptance passed

Date: 2026-09-17

## Symptom

The first isolated Console acceptance admitted two sources through the real browser/MCP surfaces. Both remained RUNNING after successful Tier 1/GKS Stage 12 evidence, with no native Stage 13 decision files.

## Evidence

The disposable Tier 1 database contained two RUNNING admissions and 24 successful stage-evidence rows, maximum stage 12. Read-only inspection of its disposable GKS decisions reported `ontologyVersion=ontology_v2`. Running the selected worker's exported `validateDecision` on those same decisions produced `DECISION_VERSION_INVALID` for both.

The selected checkout was `GenesisBlock-ki17-knowledge-corpus-native`, commit `610c1047e06ae96a57849817e64ce9e8fe3202a2`; its validator accepts only ontology_v1. GKS was `ecf1e4de269e949406a6a5f791f9ff8fe30c9578`, which produces ontology_v2.

## Root cause

Runtime selection mixed the retained v1 worker with the current v2 GKS producer. The strict worker refused the decision before beginning Stage 13. This was an incompatible test profile, not missing Console admission or a reason to loosen validation.

## Why the issue escaped detection

The old worker checkout contains a usable native binary and the correct pinned model. Those prerequisites establish loadability but do not establish agreement on the producer's ontology contract. Tier 1 tests and UI fixtures do not exercise this cross-process compatibility boundary.

## Resolution and prevention

The GKS task identified its tested native archive from commit `7c9261c4a4d4193af4e2613db48896533eb28072`, supporting both ontology versions. Before selection, the native addon SHA256 was checked against `108c1fca91be9179ff7c70cd968cb30249e5b8b6415d6035cb4d963e6ed22347`; worker.mjs, msp-stdio.mjs, embedder.py and index.js matched that Git commit exactly after CRLF normalization.

Only the verified stalled test process and its descendants were stopped. The same acceptance code was restarted against this archive with new disposable stores. No archive, companion checkout, validator or production configuration was modified. Record the exact compatible runtime tuple with every acceptance result; directory existence and a loadable addon are insufficient evidence. The phase report records the final execution result separately.

The final clean run passed both native acceptance tests: four runs each persisted 17 successful stage-evidence rows and a matching publication receipt. The Console browser also queried and opened the exact three artifact layers. See [phase report](../reports/2026-09-17-task-zai-047-knowledge-console.md) and its machine-readable receipt ledger. This is isolated Windows evidence; no production compatibility claim follows from it.
