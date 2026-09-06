---
id: "GENESIS-RAG-V4-PIPELINE-RUNBOOK"
version: "0.1.0b"
status: "candidate"
owner: "zuri-edge-device"
scope: "Running and repairing the v4 catalog data pipeline: source projection, ingest, serving"
created_at: "2026-09-03T02:00:00+07:00, ATHER"
last_update: "2026-09-03T02:00:00+07:00, ATHER"
approval: "operational runbook; no new architectural decisions"
---

# GenesisRAG v4 Pipeline Runbook

## 0. What this is

How to build the v4 SmartGift catalog store from scratch and serve it, on any machine.

Until this runbook existed the pipeline only ran on one developer's machine: the inputs were
addressed as `D:/workspace/...`, the GenesisBlock engine as `G:/GenesisBlock_Dev/...`, the
identity-review chain read a file from someone's `Downloads`, and the HTTP service lived in a
separate `zuri-rag-service` checkout. None of those resolved on a fresh clone, so ingest could not
run at all. Everything below is now env-driven with repo-relative defaults.

## 1. Prerequisites

| Need | How |
| --- | --- |
| Node dependencies incl. the engine | `npm install` — the engine is `@freshair129/gks-genesis-block-native` ([source](https://github.com/Freshair129/GenesisBlock)) |
| Python sidecar deps | `py -3 -m pip install -r scripts/requirements-sidecar.txt` |
| Upstream catalog export | a `business-01-smart-gift` checkout beside this repo |

Install the engine **from npm, not from the git URL**. The GitHub package's
`optionalDependencies` pin its platform binaries to `0.2.0`, which was never published, so a
`github:` install resolves the JS wrapper with no `.node` binary behind it and fails at require
time. `npm install @freshair129/gks-genesis-block-native@0.2.5` gets both.

## 2. Run it

```bash
npm run embed:serve        # 1. embedding sidecar on :8891 — leave running
npm run catalog:pipeline   # 2. project upstream inputs, then build the store
npm run rag:serve          # 3. serve the store on :8888
```

`catalog:pipeline` is `catalog:source-v4` followed by `catalog:ingest-v4`; run either alone when
you only need that half.

If `torch` will not load (Windows Smart App Control blocks its unsigned DLLs), use
`npm run embed:serve:onnx` instead — same model, same wire contract, onnxruntime backend.

### Verify

```bash
npm run rag:diagnose
```

Rebuilds the passages from the same inputs, re-embeds three of them, and asks the store for each
one's nearest neighbour. Each must return itself at score `1.0000`. If any does not, the vectors
are misaligned from their nodes and the only fix is a reingest — no query tuning will help.

Stop `rag:serve` first: **the engine takes an exclusive lock on a store directory even when opened
`readOnly`**, so the diagnostic and the service cannot both hold the current run.

## 3. Stages

```
business-01-smart-gift/data-pipeline/02_prepared/pricelist_master.json
  │
  │  catalog:source-v4   (src/rag/v4/upstream-projection.ts)
  ▼
data/source/catalog-2026.json                                  1,110 offers
data/catalog_identity_review_user_logic_v1/identity-review.json  427 masters / 3,200 links
data/source/flowaccount-product-2026-06-21.xlsx                copied from upstream 01_raw
  │
  │  catalog:ingest-v4   (src/rag/v4/ingest.ts)     + embed sidecar :8891
  ▼
data/genesis_smartgift_store_v4/<runId>/  +  CURRENT      1,537 vectors / 11,017 edges
  │
  │  rag:serve           (src/rag/v4/serve.ts)
  ▼
POST /api/rag/search   POST /api/rag/price   GET /health      on :8888
```

### Stage 1 — source projection

`identity-review.json` used to be built by `identity:review` + `user-logic:review` from
`../smartgift-pricing/public/catalog/giftset.json` and a `catalog-2026.json` in a developer's
Downloads. Both leaf inputs are gone from every machine, which made the artifact unregenerable.

It is now projected from `pricelist_master.json`, which the upstream data-pipeline exports from the
same `smartgift_*` SQL tables those files were themselves derived from. The lineage is verifiable,
not assumed: its 32 `product_families` and 4 `source_group_id`s match `src/rag/v4/config/*.json`
**exactly**, and its 427 product masters match the count the v4 design doc records for this
snapshot.

**One documented fidelity gap.** The retired chain split each master into several PhysicalVariants
by physical signature (1,128 across 427 masters). `pricelist_master.json` keeps colours on the
master and does not carry that split, so the projection emits one variant per master holding all
its colours. Colour attributes, SKU display codes and search are unaffected; what is lost is
variant-level separation *within* one master. `variantsPerMaster: 1` in the projection stats keeps
this visible rather than letting the artifact be mistaken for the richer one.

`npm run catalog:source-v4 -- --check` verifies the generated files still match upstream and exits
non-zero when they are stale — useful in CI, and cheaper than a reingest to find out.

### Stage 2 — ingest

Skips when the five input hashes and `SCHEMA_VERSION` are all unchanged, so re-running is cheap.
Exit codes: `2` embedding failed (sidecar down) before any database write, `3` store open or
post-write verification failed. `CURRENT` is only swung after the collection count is verified, so
a failed ingest never becomes the served run.

The projection is byte-deterministic — offer groups and the links inside them are both sorted — so
an upstream re-export that reorders rows without changing data will **not** force a reingest.

### Stage 3 — serving

One process opens the store; everything else goes over HTTP. That is not a preference, it is the
engine's exclusive lock. Ingest writes a *new* run directory beside the served one and swings
`CURRENT`, so the service keeps serving the old run until restarted — `/health` reports
`staleRun: true` when that has happened, and ingest prints a warning saying so.

## 4. Environment

Every path has a repo-relative default; a fresh checkout needs none of these set. See
`.env.example` for the full annotated list. The ones worth knowing:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ZURI_DATA_ROOT` | `./data` | Root of all generated pipeline data |
| `SMARTGIFT_UPSTREAM_PRICELIST` | `../business-01-smart-gift/…/pricelist_master.json` | The upstream export |
| `GENESIS_SMARTGIFT_STORE_V4_ROOT` | `./data/genesis_smartgift_store_v4` | Store root holding `<runId>/` + `CURRENT` |
| `GENESIS_NATIVE_MODULE` | *(npm package)* | Point at a local engine build |
| `EMBED_URL` | `http://127.0.0.1:8891` | Sidecar |
| `RAG_PORT` / `RAG_HOST` | `8888` / `127.0.0.1` | Service socket |

Both sockets bind loopback deliberately. Reaching them from another machine is a tunnel's job.

## 5. Quality gate

```bash
npm run catalog:eval-v4          # needs rag:serve running
```

Measured on the full catalog, 2026-09-03 (`--mode v4`, gate on → **pass**):

| Metric | Value | Target |
| --- | --- | --- |
| `RECALL_AT_5` | 0.8030 | ≥ 0.80 |
| `MRR` | 0.6755 | ≥ 0.65 |
| `NEG_CONSTRAINT_PASS` | 1.0000 | = 1.00 |
| `PRICE_LINK_COVERAGE` | 1.0000 | = 1.00 |
| `VARIANT_COVERAGE` | 0.8993 | ≥ 0.85 |
| `DUPLICATE_RESULT_RATE` | 0.0000 | = 0 |
| `LATENCY_P95_MS` | 89.4 | ≤ 800 |
| `TRACE_COVERAGE` | 1.0000 | ≥ 1.00 |
| `OFFER_SELF_RECALL_AT_5_RESTRICTED` | 0.8955 | ≥ 0.86 |
| `PRICE_COVERAGE` | 0.5520 | (advisory) |

`PRICE_COVERAGE` is a property of the source data, not of retrieval: only 221 of 1,110 offers carry
a price row upstream, and the FlowAccount export lifts the store to 669 priced CommercialSKUs. The
remaining gift-set bases with no price at all are written to
`<runId>/review/unpriced-offers.jsonl` (99 rows) as the sales worklist — see
`.brain/rca/2026-08-24-rca-price-data-loss.md`.

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `GENESIS_NATIVE_BINDING_UNAVAILABLE` | engine not installed, or installed from the git URL | `npm install @freshair129/gks-genesis-block-native@0.2.5` |
| `database is already open by another GenesisBlockDB process` | `rag:serve` holds the lock | stop the service before `rag:diagnose` or an in-process store test |
| ingest exits `2` | sidecar down | `npm run embed:serve`, confirm `curl :8891/health` |
| `RAG_STORE_EMPTY` on serve | never ingested | `npm run catalog:pipeline` |
| `/health` shows `staleRun: true` | ingest ran since startup | restart `rag:serve` |
| missing generated inputs | stage 1 not run | `npm run catalog:source-v4` |
| Thai queries return unrelated items | **usually the client, not the store** | see below |

On that last row: Thai query text is easy to corrupt before it reaches the service. Sending a Thai
query as a `curl` command-line argument through Git Bash on Windows re-encodes it, and the service
then embeds mojibake and returns whatever is nearest to noise — the same handful of degenerate
items for every query, which looks exactly like a broken index. Send the body as UTF-8 bytes from a
file or a real HTTP client before concluding the store is at fault, and confirm with
`npm run rag:diagnose`, which does its own embedding in-process.

## 7. Tests

```bash
npm test                        # 615 tests; the pipeline units are v4-upstream-projection + v4-paths
RUN_STORE_TESTS=1 npm run test:store   # real engine + real sidecar, end to end
```

`test:store` self-skips without `RUN_STORE_TESTS=1`; it needs the sidecar already running and takes
the store lock, so `rag:serve` must be stopped.
