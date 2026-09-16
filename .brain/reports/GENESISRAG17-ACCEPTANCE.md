---
version: "1.0.0b"
created_at: "2026-09-08T00:03:00+07:00,RWANG"
last_update: "2026-09-08T00:08:00+07:00,RWANG"
status: beta
attributes:
  domain: knowledge
  doc_type: acceptance-report
  scope: isolated synthetic four-repository GenesisRAG17
---

# GenesisRAG17 implementation and acceptance

The approved isolated implementation is complete. The actual raw-entrypoint pipeline passes all 17 native acceptance cases, with every stage and all six metrics persisted. Repository tests, web build, browser tests and governance pass with the pre-existing non-pipeline exclusions listed below. No production deployment or database migration was performed.

## Version and ownership record

All four worktrees use branch `codex/ki17-integration`.

| Repository/worktree | Implementation commit | Delivered responsibility |
|---|---|---|
| `zuri-ai-ki17` | `7acf739dfd88a50adb55203831c25f2eaabdc7ee` | Immutable raw/parsed/chunks, stages 1–8, Stage9 outbox, attempt-bound importer/cursor, source loop, receipt-required finish |
| `gks-ki17` | `9279cfe0b1c6e6559c9f258ebf5500adb50150ef` | Canonical stages 9–14, physical receipt validation, five-dimension gate and Stage17 evidence |
| `msp-ki17` | `bb6adb63152300eaf1b5e3efbc9ca0332d5f6735` | Nine authenticated pipeline operations, exact scope/role enforcement, passive relay and query proxy |
| `GenesisBlock-ki17` | `48a77a5ce857c1379d41cd7f79816edb05574c63` | Separate native worker package, real CPU embeddings, indexes/readback, atomic pointer, historical queries and recovery |

GenesisBlock engine source remains exactly pinned to `e15e35b0093394e0a8880af7f4e6f63cf81223b7`; its descendant changes only `.gitignore` and the separate worker package. zuri's Tier1 contribution is `830a0b85`; a separate inherited JSX syntax hotfix is `51f770bc`. The final documentation commit may descend from the implementation commits above without changing their code.

| Contract/artifact | Pinned version |
|---|---|
| Wire / pipeline | `genesisrag17.v1`; frozen contract document `1.2.0b` |
| Extraction / ontology / enrichment | `rule_v1` / `ontology_v1` / `enrich_v1` |
| SQLite migration | `20260907150000_genesisrag17_tier1` |
| Postgres migration, generated offline and not applied | `20260907160000_genesisrag17_tier1.sql` |
| GKS migration | `0006_genesisrag17_pipeline.sql` |
| MSP temporal parity source | `8b8667dadf01fd7f421260af8b8b260f6cac267f`, `packages/msp-core/src/domain/temporal-engine.mjs` |
| Embedding model | `intfloat/multilingual-e5-small`, CPU, 384 dimensions, cosine |
| Model revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| ONNX model SHA-256 | `ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665` |
| Runtime | Node `24.18.0`, Python `3.12.10`, numpy `2.5.2`, onnxruntime `1.29.0`, tokenizers `0.23.1` |

The worker verifies all five model artifact hashes and sizes from its executable manifest before use. There is no revision or embedding fallback. Native SQLite bindings were rebuilt against Node24.18 headers in the isolated worktrees; the machine's installed Node was not replaced.

## Actual raw-to-snapshot evidence

The [machine-readable chain](genesisrag17-native-chain.json) contains the 17 terminal rows, actual metrics/timestamps, eight canonical facts and 25 resolved citation chains. [Acceptance results](genesisrag17-acceptance-vitest.json) and the [runner log](genesisrag17-acceptance.log) record 17 passed, zero failed and zero skipped.

- Run: `f4a4e5f3-3a47-4dfb-b7a4-55397d347cb2`
- Snapshot: `snap-a22340ca05fec3ec3dec42b5de096290`
- Generation: `g17-eef63453ea9dcad0c224377367e62632`
- Fixture: `ki17-corpus-v1`, one raw document, eight chunks, sixteen mention occurrences, twelve entities, eight verified facts, five fixed retrieval queries.
- Recall@5 **1.00** (required ≥0.80), MRR **1.00** (required ≥0.65), citation correctness **1.00**, cross-tenant leaks **0**.

Every citation was resolved through Chunk → ParsedArtifact → RawArtifact → RawExternalRecord → Source, with exact substring/hash checks. Repeated names retain separate sourceMentionIds. Stages execute in order: physical graph receipt closes13, then actual GKS enrichment14, then embeddings15 and final index receipt16. Stage17 success follows physical publication receipt; gate PASS alone cannot finish the run.

The acceptance suite also executes lost submit/graph/write/publication delivery, actual native process termination at three commit/pointer boundaries, restart, immutable FR-071 replay with new attempts, late old-attempt rejection, malformed-page cursor rollback/resume, scope/reporter denial, embedding/publication policy denial, index/provenance/security failure, automatic worker loops and real backup/restore. Negative gate tests inject failed readback reports into an otherwise real native candidate before its receipt is hashed; they do not create successful stage rows. Test stores are removed after verification; the fixture and runner reproduce them.

## Repository verification

| Gate | Result |
|---|---|
| Actual four-repository native acceptance | 17/17 passed; no skips |
| MSP complete suite | 185 Vitest + 45 security passed; no skips |
| GKS complete suite with `MSP_REPO_ROOT` | 150 Vitest + 10 security passed; no skips |
| Native worker package | 6/6 passed with real NAPI/model |
| Native engine checks | NAPI debug build passed; Query IR 5/5 and bitemporal 7/7 Rust tests passed |
| Worker Python/JS and model artifacts | Syntax, dependency versions and all five artifact checks passed |
| GKS/MSP packaging | Package dry-runs and changed JS syntax checks passed; no separate build scripts |
| zuri migration checks | 3 migration + 19 schema-drift + 3 version-uniqueness tests passed; both Prisma clients generated |
| zuri full unit/integration | 4,163 passed, zero failed; 14 existing environment-gated exclusions listed below |
| zuri web build | Passed after the isolated baseline syntax hotfix |
| zuri full browser e2e | 112 passed, zero failed, zero flaky; 4 pre-existing skipped legacy shell cases |
| zuri root governance | Passed: zero critical, zero warning, no dangling/duplicate cross-app links |

Full proofs: [zuri Vitest](zuri-full-vitest.json), [zuri Playwright](zuri-full-playwright.json). The native acceptance and GKS/MSP integration have **zero skips**. The unrelated full-repository exclusions were not counted as proof:

| Existing excluded suite | Count | Reason |
|---|---:|---|
| Controlled Postgres LINE activation | 3 | `ZURI_FR055_TEST_POSTGRES_URL` unset |
| Composed Postgres LINE binding activation | 5 | Disposable target and explicit destructive opt-in unavailable |
| LINE CLI round trip | 5 | `ZURI_CLI_DIST` unset |
| Postgres runtime isolation | 1 | `ZURI_TEST_POSTGRES_URL` unset |
| Old overview/adaptive-shell browser cases | 4 | Existing `test.skip` entries in `smoke.spec.js`; current FR-041 business-first coverage ran |

## Reproduce the isolated native acceptance

Install each repository's dependencies separately and build the pinned native addon (`npm run build:debug` in GenesisBlock). Install the exact worker `requirements.txt` dependencies and acquire the pinned model snapshot; its README contains all artifact hashes. Then run from `C:\Users\pc\workspace\zuri-ai-ki17\apps\server`:

```powershell
$env:PATH = 'C:\Users\pc\workspace\ki17-runtime;' + $env:PATH
$env:KI17_MSP_ROOT = 'C:\Users\pc\workspace\msp-ki17'
$env:KI17_GKS_ROOT = 'C:\Users\pc\workspace\gks-ki17'
$env:KI17_GENESIS_ROOT = 'C:\Users\pc\workspace\GenesisBlock-ki17'
$env:KI17_MODEL_DIR = 'C:\Users\pc\.cache\huggingface\hub\models--intfloat--multilingual-e5-small\snapshots\614241f622f53c4eeff9890bdc4f31cfecc418b3'
npm run test:genesisrag17
```

Use `GENESISRAG17_PYTHON` to select an explicit virtual-environment Python executable when necessary. The runner rejects missing prerequisites instead of skipping, removes ambient production connection variables and creates isolated databases with explicit synthetic runtime credentials. It starts/stops process-owned loops; it installs no scheduled task. Source entrypoints are `ingestGenesisRag17Raw` and `createGenesisRag17SourceWorker`; queries pass through MSP.

## Version diff and limits

Before this change the reporter/run-close/evidence-pull slices existed, but there was no complete durable forward worker, GKS processing chain or native publication path. See the [original RCA](../rca/2026-09-07-genesisrag-17-stage-incomplete.md) and [integration RCA](../rca/2026-09-07-genesisrag17-contract-integration.md). The change adds seven Tier1 persistence models, one GKS migration, nine MSP relay operations and a separate native worker package; existing requirement IDs retain their meanings. Postgres migration is supplied for schema consistency and remains unapplied.

The six-lane manifest is explicit: vector uses native HNSW, lexical uses worker-owned SQLite FTS5 because the pinned native binding lacks that API, graph/SQLite/provenance use physical readback. The fixed corpus's facts use explicit temporal `not_applicable`; mapped temporal behavior has pinned parity and native Query IR tests. Unsupported optional native temporal capabilities are reported honestly, never treated as a production temporal-index claim. The pinned addon lacks native close, so true handle restart is a dedicated process restart.

These five-query synthetic benchmark results do not establish production retrieval quality. Production rollout, real data migration, LLM extraction, new UI and multiple concurrent sources remain outside this delivery.
