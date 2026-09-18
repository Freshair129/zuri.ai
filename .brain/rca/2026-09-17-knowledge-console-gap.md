# Knowledge visibility gap — TASK-ZAI-047 / FR-253

Version: 0.1.1b

Status: confirmed design gap; Console implemented and validated in isolation, production unchanged

Date: 2026-09-17

Risk: HIGH (cross-module authority and immutable evidence); complexity C-3

## Symptom

The owner opened the live Files view in the SmartGift Business and saw no managed files, then asked whether the view was connected to the data pipeline. There was no dedicated console for inspecting knowledge sources, ledger runs and published corpus generations.

## Evidence

- `apps/server/src/modules/project-manager/components/ManagedFilesPanel.jsx` reads the managed FileAsset inventory and separately uses existing FR-173 admission/query APIs. A FileAsset inventory is not the corpus membership registry.
- `apps/server/src/modules/knowledge/knowledge-repository.js` and `knowledge-corpus-service.js` already own source/ingestion/corpus records and immutable generation/citation contracts.
- Before this change, `apps/server/src/modules/knowledge/pipeline-map/KnowledgeDashboard.jsx` advertised TASK-ZAI-047 as planned. The enumerated knowledge pages provided Dashboard and Data Pipeline Map, without the requested source console.
- The GKS task consulted in this session confirmed Tier 1 aggregation belongs in zuri-ai. Discovery of sources unknown to Tier 1 would require a separate public read contract; this task does not read external stores.

## Root cause

The available Files surface describes registered files, while knowledge admission, pipeline evidence and publication are separate existing records. TASK-ZAI-047's planned console had not connected those records into an authorized user-facing view. An empty FileAsset list cannot establish whether the knowledge pipeline is configured or contains data.

This diagnosis does not establish that production has missing files, that all upstream data should become FileAssets, or that new UI alone activates the native runtime.

## Why the issue escaped detection

Existing tests covered Files intake and service-level admission/query/lineage. They did not exercise the planned Console navigation, complete ledger pagination or the combined source-to-publication-to-citation browser journey.

## Proposed prevention

FR-253 provides a separate Knowledge console over existing authorities. Current Business/Project/source/FileAsset grants and retained artifact hashes are checked before disclosure and after slow reads. Runtime unavailability, missing historical evidence and empty lists have distinct states. New integration tests cover pagination, corrupt identities and revoked access; UI fixtures are explicitly separate from native browser acceptance. Production activation/backfill remains separately authorized work.
