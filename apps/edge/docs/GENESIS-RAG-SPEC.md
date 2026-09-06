---
id: "GENESIS-RAG-SPEC"
version: "0.1.3b"
status: "candidate"
owner: "zuri-edge-device"
scope: "Read-only SmartGift catalog retrieval through GenesisBlock graph/vector indexes"
created_at: "2026-08-22T00:00:00+07:00, ATHER"
last_update: "2026-08-22T22:22:17+07:00, ATHER"
approval: "P1 subset approved by user, 2026-08-22; P2+ decisions pending"
---

# Genesis Graph/Vector RAG Specification

## 0. Status and approval boundary

เอกสารนี้เป็นสเปก candidate จาก P0 study; P1 family/variant/offer implementation ได้รับอนุมัติ
เฉพาะในขอบเขต local consolidation แล้ว แต่ยังไม่อนุมัติให้สร้าง embedding, refresh vector
index, หรือเปิด MCP capability ใหม่

ข้อกำหนดทุกข้อที่มี prefix `RAG-` เป็นข้อกำหนดเสนอเพื่อ review และยังไม่เพิ่มเข้า
requirements หลักจนกว่าจะผ่าน approval gate

## 1. Outcome

ระบบต้องค้นข้อมูลสินค้า SmartGift แบบ read-only โดยแยกความรับผิดชอบของแต่ละ retrieval
ให้ตรวจสอบได้:

```text
Catalog Source of Truth
  -> normalized snapshot + manifest
  -> Genesis graph index + vector index
  -> governed retrieval facade
  -> bounded evidence packet
  -> deterministic pricing/answer
  -> optional language-model phrasing
```

โมเดลภาษาไม่มีสิทธิ์กำหนดราคา ต้นทุน MOQ จำนวนผลลัพธ์ หรือสถานะสินค้าเอง

## 2. Parent constraints

สเปกนี้ต้องไม่ขัดกับ:

- [`AGENTS.md`](../AGENTS.md) — tenant boundary, no arbitrary SQL/shell/filesystem,
  no secret/PII leakage, model/provider changes require approval
- [`docs/PRD-SDD-v1.0.md`](PRD-SDD-v1.0.md) — product and security requirements
- [`docs/AGENT-RUNTIME-SPEC.md`](AGENT-RUNTIME-SPEC.md) — local runtime lifecycle
- [`docs/CONVERSATIONAL-ANSWER-SPEC.md`](CONVERSATIONAL-ANSWER-SPEC.md) — evidence,
  number-check and Headless delivery boundary
- [`docs/PRICING-ENGINE-SPEC.md`](PRICING-ENGINE-SPEC.md) — pricing authority and provenance

GenesisBlock เป็น local read-only retrieval component ไม่ใช่ tenant authority,
pricing authority, delivery authority หรือ general-purpose query server

## 3. Terminology

| Term | Meaning |
|---|---|
| Catalog snapshot | Immutable normalized set of product records at one version |
| Manifest | Metadata identifying source, hash, record counts, schema and `as_of` |
| Graph index | Product/category nodes and approved edges used for relationship filtering |
| Vector index | Embedding payloads and similarity index generated from approved text fields |
| Exact retrieval | Code or normalized property lookup with deterministic matching |
| Hybrid retrieval | Exact/property + vector similarity + graph constraints combined by rules |
| Evidence packet | Bounded result with source/version/time/sensitivity used by answer layer |
| Readiness | Whether the selected snapshot and indexes can safely answer a query |

## 4. Proposed requirements

### 4.1 Catalog and provenance

| ID | Requirement | Proposed acceptance |
|---|---|---|
| RAG-FR-001 | One canonical normalized Catalog snapshot per environment | Retrieval and pricing paths resolve the same serving snapshot, with lineage to each upstream source |
| RAG-FR-002 | Every snapshot has a manifest | Source label, content hash, schema version, count and `as_of` are available |
| RAG-FR-003 | Product identity is stable | `product_id` and normalized `code` remain stable across refreshes |
| RAG-FR-004 | Retrieval is read-only | No query path changes Catalog source or pricing policy |
| RAG-FR-005 | Evidence carries provenance | Every returned product includes source/version and query path |

### 4.2 Graph index

| ID | Requirement | Proposed acceptance |
|---|---|---|
| RAG-GR-001 | Product and Category nodes are deterministic | Re-ingest produces the same logical IDs and labels |
| RAG-GR-002 | Approved edges are explicit | `BELONGS_TO_CATEGORY` is preserved; new relations need a separate decision |
| RAG-GR-003 | Graph source is declared | API identifies live Genesis graph or cached projection, never implies the wrong one |
| RAG-GR-004 | Graph counts are verifiable | Manifest/report exposes product, category and edge counts |

### 4.3 Vector index

| ID | Requirement | Proposed acceptance |
|---|---|---|
| RAG-V-001 | Embedding model is approved before build | Model name/version, dimension, metric and normalization are documented |
| RAG-V-002 | Embedding text is deterministic | Same snapshot and model produce the same input text and identity mapping |
| RAG-V-003 | Vector records map to products | Each vector has stable product identity and snapshot version |
| RAG-V-004 | Vector population is verified | Eligible vector count, index state and sample similarity query are recorded |
| RAG-V-005 | Incompatible index fails closed | Model/dimension/version mismatch does not silently answer from stale vectors |

Dimension `384` and metric `L2` are current store observations, not an approved model
contract. They remain provisional until the native binding and embedding provider are
verified in P0.

### 4.4 Retrieval modes

| ID | Mode | Rule |
|---|---|---|
| RAG-Q-001 | Exact | Prefer exact code and normalized code before semantic retrieval |
| RAG-Q-002 | Property/HQL | Only registered, bounded, parameterized queries are allowed |
| RAG-Q-003 | Vector | Use similarity only when vector index is ready and query embedding is compatible |
| RAG-Q-004 | Graph | Apply only relations and properties present in the approved graph contract |
| RAG-Q-005 | Hybrid | Merge, deduplicate, constrain and rerank deterministically |
| RAG-Q-006 | Fallback | If vector/graph is unavailable, report the active fallback path truthfully |

Proposed retrieval order:

```text
exact code/name
  -> property constraints
  -> vector top-k
  -> graph expansion/filter
  -> deterministic rerank
  -> evidence packet
```

The exact ordering and scoring weights require a golden query set; this document does
not freeze a scoring formula yet

### 4.5 Runtime and MCP

| ID | Requirement | Proposed acceptance |
|---|---|---|
| RAG-R-001 | Runtime exposes readiness separately from liveness | Query before ready returns a governed unavailable state |
| RAG-R-002 | One process owns a store for write/refresh lifecycle | Store collision is explicit and observable |
| RAG-R-003 | CLI, MCP and LINE use one retrieval facade | No path silently uses a different Catalog or search algorithm |
| RAG-R-004 | `search_catalog` is bounded and read-only | Query, limit, fields and sensitivity are fixed by contract |
| RAG-R-005 | `execute_hql` is not arbitrary user code | Keep only if it can be registered/parameterized; otherwise remove it |
| RAG-R-006 | Direct facts do not require Headless LLM | Code/name/MOQ/price lookup can return deterministic evidence |

### 4.6 Performance and observability

| ID | Requirement | Proposed acceptance |
|---|---|---|
| RAG-P-001 | Stage latency is measured independently | Cold/warm ingest, exact, vector, graph, pricing and answer are separate metrics |
| RAG-P-002 | Query path is observable without business-row leakage | Logs contain stage, duration, counts, version and status, not raw secrets/PII |
| RAG-P-003 | Cache policy is explicit | Cache key includes snapshot/index/model version and expiry policy |
| RAG-P-004 | Slow model path is not mistaken for DB latency | Answer response identifies retrieval and generation timing separately |

## 5. Data contract

### 5.1 Canonical product record

The normalized record is proposed as:

| Field | Required | Notes |
|---|---:|---|
| `product_id` | yes | Stable internal identity derived from approved code rule |
| `code` | yes | Normalized uppercase code where available |
| `name` | yes | Original catalog name preserved |
| `englishName` | no | Optional original field |
| `description` | no | Original description, not model-generated |
| `category` | no | Controlled category value or explicit `null` |
| `branding` | no | Supported branding/printing facts only |
| `mode` | yes | Catalog quoting mode |
| `rmb`, `upc`, `dims`, `kg`, `e` | pricing-dependent | Passed to pricing authority, not invented by retrieval |
| `img` | no | Catalog image reference; image generation is out of scope |
| `source` | yes | Source label |
| `catalog_version` | yes | Snapshot version/hash |
| `as_of` | yes | Source observation time |

### 5.2 Source reconciliation

Historical reconciliation evidence shows 994 shared product codes, 22 pricing-only codes and
one duplicate code in the pricing catalog. For the active P1 runtime, the excluded semantic
download source is not read; the active snapshot is pricing-only and exposes 1,016 offers,
845 provisional families and 1,016 variants. The serving contract still exposes one
snapshot/version and preserves field-level lineage. The normalization policy must define:

1. identity and duplicate resolution by code
2. precedence when the same field exists in both sources
3. treatment of the 22 pricing-only records
4. whether records without semantic fields are vector-eligible
5. how source changes produce a new snapshot hash
6. how provisional name-based families move to confirmed variants after semantic/manual evidence

Source precedence is not needed for the active pricing-only snapshot; any future semantic source
must be approved separately before it is added to the merge path.

The verified local serving store for this snapshot is
`data/genesis_smartgift_store_family_v2`; the older unmanifested
`data/genesis_smartgift_store` remains preserved for rollback/reference. The active store has
manifest schema v2, snapshot
`d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31`, and vector status
`not_built`.

### 5.3 Embedding document

The embedding input must be built from approved fields only. Proposed order:

```text
code | name | englishName | category | description | branding
```

The exact separator, language normalization, stopword handling and model version are
P0 decisions. No embedding should be generated from raw chat history or hidden user data

## 6. Evidence packet

The retrieval facade must return a bounded structure equivalent to:

```json
{
  "queryPath": "exact|property|vector|graph|hybrid|fallback",
  "catalogVersion": "...",
  "source": "...",
  "asOf": "...",
  "results": [
    {
      "productId": "...",
      "code": "...",
      "name": "...",
      "matchType": "exact|property|vector|graph|hybrid",
      "score": 0,
      "matchedConstraints": [],
      "allowedFields": {}
    }
  ],
  "truncated": false
}
```

`score` is not a price or confidence claim unless its semantics are documented. Pricing
fields must be produced by the pricing engine and may be omitted according to caller scope

## 7. Failure and fallback policy

| Condition | Required behavior |
|---|---|
| Catalog source missing | `unavailable`, include safe diagnostic, do not claim no products exist |
| Store lock conflict | `not_ready` or explicit active-owner state; do not mark local DB ready without a handle |
| Vector index empty/stale | Use approved exact/property fallback and label it |
| Graph projection stale | Use live graph only if verified; otherwise label snapshot/stale state |
| Embedding provider unavailable | Do not ingest partial vector set as ready unless contract allows it |
| Headless timeout | Return deterministic evidence/fallback path where applicable |
| Catalog version mismatch | Fail closed or use an explicitly pinned compatible version |

## 8. Security and governance

- No arbitrary SQL, shell or filesystem execution through MCP or chat text
- No direct Zuri PostgreSQL or LINE credential access
- No raw tokens, secrets, OTPs or unredacted PII in index, logs or evidence packet
- User text is data, not an instruction to change query authority or policy
- Index refresh is an operator-approved lifecycle action, not a model action
- Any external embedding/model provider requires explicit provider, budget and retention review

## 9. Verification plan

Before implementation is considered complete, tests must cover:

1. same snapshot ingested twice with no logical duplicates
2. catalog refresh changes only affected records
3. exact code lookup and case/spacing normalization
4. Thai, English and mixed-language semantic queries
5. budget/MOQ/category constraints are not bypassed by vector similarity
6. vector dimension/model mismatch fails closed
7. graph relation and stale projection behavior
8. MCP limit, malformed input and injection-like input
9. readiness/lock/restart/failure paths
10. deterministic answer without Headless LLM for direct facts
11. p50/p95 stage-level latency and response provenance

## 10. Decisions still required

| Decision | Current state | Owner/gate |
|---|---|---|
| Catalog Source of Truth | unresolved: 994-record and 1,017-record snapshots differ | P0 approval |
| Embedding model/provider | unresolved; 384 is store schema observation only | P0 approval |
| Graph API source | unresolved: live Genesis graph or cached projection | P0 approval |
| Latency/recall targets | baseline recorded; target not frozen | P0 approval |
| MCP `execute_hql` | current implementation is not true HQL execution | security review |
| Index refresh authority | not yet assigned | operations approval |

## 11. Change boundary

This candidate specification authorizes the approved P1 family/variant/offer projection in the
current phase. P2 vector, P3 hybrid ranking and P4 MCP/answer changes remain gated. Only approved `RAG-*`
requirements may be implemented, in phase order from
[`GENESIS-RAG-IMPLEMENTATION-PLAN.md`](GENESIS-RAG-IMPLEMENTATION-PLAN.md)

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.3b | 2026-08-22 | candidate | Recorded the verified family_v2 serving store and preserved legacy-store rollback boundary | ATHER |
| 0.1.2b | 2026-08-22 | candidate | Recorded pricing-only active source and P1 family/variant/offer projection; vector and hybrid remain gated | ATHER |
| 0.1.2b | 2026-08-22 | candidate | Recorded P1 approval boundary; vector and hybrid work remain gated | ATHER |
| 0.1.1b | 2026-08-22 | candidate | Added source reconciliation and canonical normalized snapshot rules | ATHER |
| 0.1.0b | 2026-08-22 | candidate | Initial Genesis Graph/Vector RAG contract proposal | ATHER |
