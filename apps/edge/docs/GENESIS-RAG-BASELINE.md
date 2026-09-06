---
id: "GENESIS-RAG-BASELINE"
version: "0.1.2b"
status: "candidate"
owner: "zuri-edge-device"
scope: "Read-only baseline for the current GenesisBlock and product-answer retrieval paths"
created_at: "2026-08-22T00:00:00+07:00, ATHER"
last_update: "2026-08-22T00:00:00+07:00, ATHER"
as_of: "2026-08-22, Asia/Bangkok"
approval: "pending"
---

# Genesis Graph/Vector RAG — Baseline

## 0. Reading guide

นี่เป็น baseline จากการตรวจแบบ read-only ก่อนเปลี่ยนระบบ ไม่ใช่ผลการรับรองว่า
ระบบพร้อม production และไม่ใช่ benchmark ของ vector search เพราะ vector payload
ยังไม่ถูกยืนยันว่ามีอยู่จริง

แยกหลักฐานเป็น:

- **FACT** — ผลที่อ่าน/วัดได้จากไฟล์หรือ endpoint
- **OBSERVATION** — ความหมายเชิงระบบที่อนุมานจาก FACT
- **HYPOTHESIS** — สิ่งที่ต้องพิสูจน์ต่อใน P0/P1

## 1. FACT — Store state

| Item | Result |
|---|---|
| Store | `data/genesis_smartgift_store` พบอยู่จริง |
| `state.json` | collection `default`, `dim=384`, `metric=L2`, `model=default` |
| `nodes.bin` | 269,094 bytes |
| `edges.bin` | 4,275,121 bytes |
| `projection.sqlite` | 13,160,448 bytes |
| `vec_default.bin` | **0 bytes** |
| Current logical state | `schema_version=3`, journal `frontier_seq=32896` |

## 2. FACT — Catalog sources

| Path | Records | Meaning |
|---|---:|---|
| `C:\Users\freshair\Downloads\catalog-2026.json` | 994 | Genesis RAG default input |
| `D:\workspace\smartgift-pricing\public\catalog\giftset.json` | 1,017 | SmartGift pricing web catalog |
| `D:\workspace\zuri-edge-device\state\catalog` | missing | Current answer-layer default directory is absent |

The 994/1,017 difference is unresolved and blocks a safe re-ingest decision.

### 2.1 Read-only code reconciliation

Comparing normalized `code` values:

| Comparison | Result |
|---|---:|
| Shared codes | 994 |
| Codes only in Genesis input | 0 |
| Codes only in pricing catalog | 22 |
| Duplicate codes in Genesis input | 0 |
| Duplicate codes in pricing catalog | 1 |

The two files therefore carry overlapping product identity but different field families:

- Genesis input: `branding`, `category`, `description`, `englishName`, `mode`, `moq`,
  `tiers`, `visual`
- Pricing catalog: `dims`, `e`, `img`, `kg`, `rmb`, `upc`

The shared codes also have different display-language/name representations in 983 of 994
records. The pricing catalog contains one duplicate `TPT11-7`; the two duplicate rows are
identical in the inspected fields. This is evidence for a reconciliation/normalization step
with source lineage, not evidence that either raw file can be discarded safely.

## 3. FACT — Native Genesis capability surface

The checked-in N-API declaration at `G:\GenesisBlock_Dev\GenesisBlock\index.d.ts` exposes:

| Capability | Declaration |
|---|---|
| attach an embedding during node ingest | `NodeInput.embedding` |
| add/update vector payload | `GenesisDatabase.addVector()` |
| vector/graph search | `hybridSearch()` and HQL `MATCH ... SIMILAR` support |
| machine query contract | `executeQueryIr()` with vector/hybrid/lexical modes |
| index readiness | `flushIndex()` and `indexLag()` |
| collection inspection | `listCollections()` with count, dimension and index lag |

The same engine documentation states that vector HNSW indexing is asynchronous and vectors
are eventually searchable. This makes `flushIndex()`/`indexLag()` part of the readiness proof;
opening a store alone is insufficient.

## 4. FACT — Current query paths

| Path | Current behavior | Vector | Graph |
|---|---|---:|---:|
| `GenesisLocalRag.searchProducts()` | HQL `Product.name CONTAINS` | no evidence | product property lookup |
| `GenesisLocalRag.getGraphData()` | reads Catalog JSON and builds arrays | no | no live Genesis query |
| `src/catalog/store.ts` | in-memory code/name substring search | no | no |
| `src/answer/respond.ts` | deterministic fallback plus optional Headless path | no | no |
| MCP `search_catalog` | delegates to `searchProducts()` | no | indirect |
| MCP `execute_hql` | currently passes HQL text to `searchProducts()` | no | not true arbitrary HQL execution |

## 5. FACT — Runtime liveness

| Endpoint | Result |
|---|---|
| `http://localhost:8787/api/graph` | HTTP 200; 817,291-byte response |
| `http://localhost:8989/health` | HTTP 200; reports GenesisBlock Native Rust service |

Health is liveness only. It does not prove that the store handle is ready, that vector
search is populated, or that `execute_hql` executes arbitrary HQL

## 6. FACT — Timing measurements

### 6.1 Graph endpoint

Three warm calls to `/api/graph` returned the same 817,291-byte response:

| Call | Status | Time |
|---:|---:|---:|
| 1 | 200 | 2,258 ms |
| 2 | 200 | 2,097 ms |
| 3 | 200 | 2,089 ms |

### 6.2 Raw Catalog parse

Three direct JSON parse measurements for the 994-record Catalog:

| Call | Records | Time |
|---:|---:|---:|
| 1 | 994 | 131 ms |
| 2 | 994 | 55 ms |
| 3 | 994 | 41 ms |

These two measurements are not equivalent workloads. The gap indicates that graph API
read/build/serialization or runtime overhead is material, but it does not isolate one
root cause yet

## 7. OBSERVATION

1. GenesisBlock currently contains graph/projection artifacts and a configured vector
   collection, but the zero-byte vector file means vector readiness is not evidenced.
2. The active product lookup is primarily name/property matching, not semantic retrieval.
3. The graph viewer is a Catalog-derived projection and can be stale or divergent from
   the native store unless versioned against it.
4. There are at least three Catalog resolution paths, creating a source/version mismatch risk.
5. Headless answer generation is a separate latency component and should not be blamed on
   database query time without stage-level timing.
6. The native engine is capable of real vector/hybrid retrieval, so the current gap is primarily
   application wiring, vector population and readiness verification—not an absent database feature.

## 8. HYPOTHESIS TO TEST

| ID | Hypothesis | Test in next phase |
|---|---|---|
| B-H1 | repeated initialization causes unnecessary catalog ingest | instrument one init/restart and compare logical counts/write events |
| B-H2 | graph endpoint rebuild/serialization dominates its 2-second response | time read, transform and serialization separately |
| B-H3 | answer latency is dominated by Headless LLM after lookup | disable only Headless in a controlled local run and compare stages |
| B-H4 | the 994 and 1,017 records are different snapshots or schemas | compare codes, fields, duplicates and source timestamps |
| B-H5 | store lock handling can report initialized without a usable local handle | run a controlled second-owner/readiness test without modifying the active store |

## 9. Baseline limitations

- No vector similarity benchmark is valid until vector population and model contract are confirmed.
- No recall/precision claim is made because a labeled golden query set does not exist yet.
- `/health` was not treated as a query test.
- No production readiness claim is made.
- The preflight report was generated on 2026-08-10; it reported 0 critical findings and
  5 warnings, but it predates this RAG work and must be rerun after P0 docs stabilize.

## 10. P0 exit criteria

- Define a canonical normalized snapshot with source lineage for the shared and 22 extra codes.
- Resolve the one duplicate code in the pricing catalog.
- Verify the native binding APIs for vector upsert/search and graph query in a fixture store.
- Capture stage-level timing with a reproducible harness.
- Create a small labeled golden query set in a non-production fixture.
- Approve the model/dimension/metric and index refresh authority.

## 11. Evidence sources

- [`src/rag/genesis-rag.ts`](../src/rag/genesis-rag.ts)
- [`src/cli/index.ts`](../src/cli/index.ts)
- [`src/mcp/genesis-mcp-server.ts`](../src/mcp/genesis-mcp-server.ts)
- [`src/catalog/store.ts`](../src/catalog/store.ts)
- [`src/answer/respond.ts`](../src/answer/respond.ts)
- [`docs/.preflight-report.json`](.preflight-report.json)
- `G:\GenesisBlock_Dev\GenesisBlock\index.d.ts` — checked-in N-API capability declaration
- `G:\GenesisBlock_Dev\GenesisBlock\AGENT.md` — engine model and async HNSW behavior

## 12. P1 implementation verification

| Check | Result |
|---|---|
| Normalizer/manifest unit tests | 3 passed, 0 failed |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| Native fixture smoke | passed; 1,016 unique products ingested and manifest written |
| Existing store smoke | failed closed with `GENESIS_STORE_ALREADY_OPEN`; no re-ingest |
| Vector status after P1 | intentionally `not_built` |
| Full suite | 240 passed, 5 unrelated pre-existing LINE history/identity failures, 2 skipped |

The native fixture was created under the OS temp directory and removed after verification.
No existing Genesis store or Catalog file was overwritten.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.2b | 2026-08-22 | candidate | Added P1 implementation verification and native smoke evidence | ATHER |
| 0.1.1b | 2026-08-22 | candidate | Added Catalog reconciliation and native vector capability evidence | ATHER |
| 0.1.0b | 2026-08-22 | candidate | Read-only baseline for current Catalog, store, query paths and latency | ATHER |
