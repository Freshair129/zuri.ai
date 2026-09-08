---
id: ZAI:KNOWLEDGE-INGESTION-17-STAGE-SPEC
title: Zuri 17-Stage Knowledge Ingestion and GraphRAG Preparation Pipeline Specification
version: "1.4.1b"
status: beta
created_at: "2026-08-27T00:00:00+07:00,Boss"
last_update: "2026-09-08T19:37:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:ADR-050
  - type: references
    target: ZAI:ADR-073
  - type: relates_to
    target: ZAI:GENESISRAG17-CONTRACT
---

# Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification

Isolated acceptance: Business owner Files browser admission and session HTTP/MCP reached the real native pipeline; four document runs each have 17 successful evidence rows, four native snapshots and five corpus generations. Project-scoped and bearer/API-grant paths have unit/Prisma authorization evidence, not native browser proof. Browser query controls and production activation are not claimed. See the [phase report](../.brain/reports/2026-09-08-knowledge-admission-phase0-4.md) for versions, test counts and limits.

For actual UI/API/MCP entrypoints, file/project/domain connections and proposed user journeys, read the [surface and user-flow inventory](KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md). Its current-versus-proposed labels are explicit: passing the isolated 17-stage chain does not imply that every product input surface is connected.

The approved [ADR-072 admission/corpus contract](decisions/ADR-072-KNOWLEDGE-ADMISSION-AND-CORPUS-PUBLICATION.md) connects authorized Text/Markdown and FileAsset requests before Stage 1. One source version still executes all 17 stages. A Tier 1 corpus manifest then composes verified document snapshots for explicit-snapshot retrieval after Stage 17; it does not claim cross-document native graph traversal or replace GKS quality authority. Corrections rerun the same stage chain and replace only their own source membership. Current source/file/project authorization is rechecked when serving queries or citations. See the [integration contract](plans/KNOWLEDGE-ADMISSION-CONTRACT.md) for runtime configuration, source/version identity, leases and backup recovery.

**Document Type:** Technical Specification  
**Target System:** Zuri AI / GKS / GenesisBlockDB  
**Pipeline Type:** Knowledge Ingestion, Knowledge Graph Construction, GraphRAG Preparation  
**Architecture Style:** Hybrid Cloud + Local Edge / Modular Pipeline  
**Primary Output:** Published, scoped, provenance-backed, retrieval-ready knowledge

> **This document is the source specification adopted by
> [ADR-050 — Knowledge Ingestion Tier Boundary and Stage Ownership](decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md).**
> FR-109, FR-110, FR-111, SDD-057, SDD-058, NFR-020, BR-021, BR-022 and SEC-021
> in [`PRD-SDD-v1.0.md`](PRD-SDD-v1.0.md), and FEAT-013 in
> [`FEATURES.md`](FEATURES.md), are declared from it and cite its sections by
> number. The original product specification is broader than the implemented
> isolated test profile. [ADR-073](decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md)
> authorizes that profile: zuri executes 1–8, MSP authenticates/relays, passive
> GKS decides 9–14 and the quality gate, and the separate GenesisBlock worker
> performs physical 13/15/16 and atomic publication. Each stage below identifies
> its current behavior and extension boundary. This does not authorize production
> deployment or declare all examples in the original specification implemented.

| Field | Value |
|-------|-------|
| **Version** | 1.4.0b |
| **Status** | Beta — product specification with verified isolated execution profile |
| **Author** | Boss |
| **Created** | 2026-08-27 |
| **Last Updated** | 2026-09-08 |

## Reading and extension guide

**จะเพิ่มอะไร ให้เริ่มที่ [17-stage flow และ extension map](KNOWLEDGE-INGESTION-17-STAGE-FLOW.md).**
หน้านั้นระบุ stage, input/output, terminal condition, เจ้าของ repo, ไฟล์ code/tests
และผลกระทบต่อ stage ถัดไป ส่วน [wire contract](plans/GENESISRAG17-CONTRACT.md)
เป็นแหล่งอ้างอิง schema/hash/attempt/receipt ที่ต้องแก้ร่วมกันก่อนเปลี่ยน API

Sections 1–42 และ requirement IDs รักษาหมายเลขเดิมเพื่อให้ citations ยังใช้ได้
ข้อความ “Current isolated profile” ที่เพิ่มใน v1.1.0b อธิบาย implementation ที่มีจริง
ตัวอย่าง/รายการ capability เดิมที่กว้างกว่านั้นเป็น product target ไม่ใช่ runtime claim
ต้นฉบับก่อน annotation ยังตรวจได้ใน Git ที่ acceptance commit
`b64b46df057d3160c659afa3c34628ee86520257`.

Current profile: synthetic text/Markdown, one document/run, private exact six-field
scope, separate databases, durable worker loops, rule-based extraction, pinned local
CPU E5 embeddings. ไม่มี LLM extraction, production deployment, new UI หรือ concurrent
multi-source ingestion. [Acceptance report](../.brain/reports/GENESISRAG17-ACCEPTANCE.md)
บันทึก tests และ versions ของรอบ implementation; การอัพเดทเอกสารนี้ไม่ใช่หลักฐาน rerun.

### Approved audit corrections — v1.2.0b

The [audit remediation contract](plans/GENESISRAG17-CONTRACT.md#audit-remediation-contract-130b)
is binding for the repaired profile. Source intents precede Stage1 and preserve
derivation configuration and Stage8 occurrence output for automatic recovery.
Stage9 cannot merge incompatible semantic types by name alone; Stage10 must
preserve supported coordinated subjects and negation. Stage12 holds invalid
intervals and distinguishes unrecognized temporal claims from no temporal claim.
Structured temporal metadata and unsupported recognizers must be rejected rather
than silently discarded or mislabeled. These boundaries do not add new parsers
or extraction predicates.

Stage13 remains graph-only. Stage16 owns lexical/vector index construction.
Native transaction intent is durable before either commit and is replayed
byte-equivalently after uncertainty; receipt state precedes outbox deletion.
Stage17 publication in this profile requires PASS, policy permission and the
matching receipt. WARN never publishes. Pointer replacement failure retains the
old pointer, and tests must terminate actual processes within the commit/receipt
gaps. A populated two-tenant retrieval test supplements the fixed-corpus score.

---

# 1. Purpose

เอกสารนี้กำหนดมาตรฐานของ **17-Stage Knowledge Ingestion Pipeline** สำหรับแปลงข้อมูลจากแหล่งต่าง ๆ ให้เป็น knowledge ที่พร้อมสำหรับ:

- Semantic RAG
- Lexical RAG
- GraphRAG
- Structured RAG
- Temporal RAG
- Provenance RAG
- Hybrid Retrieval
- Agentic RAG
- Business Intelligence Agents

Pipeline ต้องรักษา:

- Source lineage
- Tenant isolation
- Business scope
- Entity identity
- Temporal validity
- Provenance
- Access control
- Version history
- Retrieval quality

ตลอด lifecycle ของข้อมูล

---

# 2. Architectural Position

**Current isolated profile:** ภาพด้านล่างเป็น logical product target ไม่ใช่ RPC topology.
การเรียกจริงคือ zuri/worker → MSP → passive GKS; GKS ไม่เรียก worker ออกไปเอง.
Query ใน acceptance คือ caller → MSP → worker published snapshot. ดู sequence diagram
ใน [execution flow](KNOWLEDGE-INGESTION-17-STAGE-FLOW.md#flow-ที่รันจริง).

```text
External / Internal Data Sources
              │
              ▼
┌──────────────────────────────┐
│  Knowledge Ingestion Pipeline│
│        Stage 1–17            │
└──────────────┬───────────────┘
               │
               ▼
        Published Knowledge
               │
               ▼
┌──────────────────────────────┐
│ GKS                          │
│ Knowledge Authority          │
│ RAG / GraphRAG Orchestration │
└──────────────┬───────────────┘
               │ query-ir.v1
               ▼
┌──────────────────────────────┐
│ GenesisBlockDB               │
│ 6-Lane Retrieval Substrate   │
└──────────────────────────────┘
```

Pipeline เป็น **logical pipeline**

แต่ละ Stage ไม่จำเป็นต้องเป็น microservice แยก

หลาย Stage สามารถ execute ภายใน:

- Edge Worker
- Background Worker
- GKS
- Genesis Adapter
- Cloud Pipeline Worker

ได้ตาม deployment topology

---

# 3. Core Principles

## 3.1 Raw Data Must Remain Recoverable

Raw input ห้ามถูก overwrite หลัง normalization

```text
Raw
↓
Canonical
↓
Knowledge
```

ต้องสามารถย้อนกลับไปยัง source เดิมได้เสมอ

---

## 3.2 Every Knowledge Object Must Have Provenance

Entity, Fact, Relation, Chunk และ Derived Knowledge ต้องสามารถตอบได้ว่า:

```text
มาจากไหน?
มาจาก source version ไหน?
ถูก extract เมื่อไร?
extract ด้วย pipeline version ไหน?
confidence เท่าไร?
```

---

## 3.3 Tenant Scope Before Retrieval

ข้อมูลต้องได้รับ scope ก่อนเข้าสู่ indexing

ห้ามใช้ pattern:

```text
Index everything
↓
Retrieve everything
↓
Filter afterward
```

ต้องใช้:

```text
Classify
↓
Scope
↓
Index
↓
Scoped Retrieval
```

---

## 3.4 Canonical Identity Belongs to GKS

Pipeline สามารถสร้าง `EntityCandidate`

แต่ canonical entity identity ต้องได้รับการ resolve ผ่าน GKS

```text
"ABC"
"ABC Co Ltd"
"บริษัท เอบีซี จำกัด"

        ↓

customer_01HXYZ...
```

---

## 3.5 GenesisBlockDB Is Retrieval Substrate

GenesisBlockDB ไม่รับผิดชอบ:

- Query planning
- Ontology governance
- Entity identity policy
- Hallucination correction
- Agent reasoning

Genesis รับผิดชอบ:

- Storage
- Graph traversal
- Vector retrieval
- Lexical retrieval
- Structured filtering
- Temporal retrieval
- Provenance retrieval
- Multi-lane fusion

---

# 4. Canonical Pipeline

```text
Raw Data
   │
   ▼
1.  Ingestion
   │
   ▼
2.  Parsing / Extraction
   │
   ▼
3.  Provenance Capture
   │
   ▼
4.  Normalization
   │
   ▼
5.  Classification / Access Scope
   │
   ▼
6.  Deduplication / Versioning
   │
   ▼
7.  Chunking
   │
   ▼
8.  Entity Extraction
   │
   ▼
9.  Entity Resolution
   │
   ▼
10. Relation / Fact Extraction
   │
   ▼
11. Schema / Ontology Mapping
   │
   ▼
12. Temporal Mapping
   │
   ▼
13. Graph Construction
   │
   ▼
14. Knowledge / Graph Enrichment
   │
   ▼
15. Embedding
   │
   ▼
16. Multi-Lane Indexing
   │
   ▼
17. Graph + Retrieval Quality Gate
   │
   ▼
Published Knowledge
   │
   ▼
GraphRAG Ready
```

---

# 5. Pipeline State Model

แต่ละ ingestion job ต้องมี lifecycle:

```text
RECEIVED
↓
PROCESSING
↓
VALIDATING
↓
READY_TO_PUBLISH
↓
PUBLISHED
```

Failure states:

```text
RETRYABLE_FAILED
QUARANTINED
REJECTED
SUPERSEDED
```

ห้าม publish partial graph โดยไม่มี explicit policy รองรับ

---

# 6. Stage 1 — Ingestion

**Current isolated profile:** รับ source text/version/scope ผ่าน `ingestGenesisRag17Raw`,
บันทึก `RawExternalRecord` และ immutable `KnowledgeRawArtifact` แล้วจึงรายงาน Stage 1.
เพิ่ม connector ที่นี่; รายการ source ด้านล่างเป็นเป้าหมาย ไม่ใช่ทุก connector ที่ต่อแล้ว.

## Objective

นำข้อมูลเข้าสู่ pipeline โดยไม่เปลี่ยน semantic content ของต้นฉบับ

## Supported Sources

ตัวอย่าง:

- REST API
- Webhook
- Database
- CDC
- CSV
- Excel
- JSON
- XML
- PDF
- DOCX
- Markdown
- Email
- LINE Event
- CRM
- ERP
- FlowAccount
- Meta
- GA4
- TikTok
- File upload
- Object storage
- Local filesystem

## Input

```text
External Source
```

## Output

`RawArtifact`

ตัวอย่าง:

```json
{
  "artifact_id": "raw_...",
  "source_type": "FLOWACCOUNT",
  "source_ref": "...",
  "content_type": "application/json",
  "received_at": "...",
  "checksum": "...",
  "pipeline_version": "..."
}
```

## Requirements

- ต้อง generate internal immutable `artifact_id`
- External ID ห้ามใช้เป็น primary key
- ต้องคำนวณ checksum
- ต้อง capture ingestion timestamp
- ต้อง support idempotent ingestion
- Raw payload ต้องเก็บก่อน transformation

---

# 7. Stage 2 — Parsing / Extraction

**Current isolated profile:** `genesisrag17-parser-1` เก็บ exact text/Markdown heading
structure ลง versioned parsed artifact; `tables` ยังว่าง. ต่อ PDF/OCR/table parser ที่นี่
โดยออกแบบ raw-to-text mapping ที่ Stage 3/7/8/9 ร่วมด้วย ไม่อ้างว่า binary offset เป็น text offset.

## Objective

แปลง raw source ให้เป็น machine-readable structured representation

## Responsibilities

- Text extraction
- Table extraction
- Metadata extraction
- Structural extraction
- JSON/XML parsing
- Spreadsheet sheet/row extraction
- Document hierarchy preservation

ตัวอย่าง:

```text
Document
├── Heading
├── Section
│   ├── Paragraph
│   └── Table
└── Appendix
```

## Output

`ParsedArtifact`

```json
{
  "document_id": "...",
  "structure": [],
  "text_blocks": [],
  "tables": [],
  "metadata": {}
}
```

## Requirements

ต้องรักษาความสัมพันธ์กับ raw artifact

```text
ParsedArtifact
    ↓ parsed_from
RawArtifact
```

---

# 8. Stage 3 — Provenance Capture

**Current isolated profile:** ตรวจ parent raw/parsed และบันทึก provenance digest/IDs;
chain ถาวรอยู่ใน lineage repository. เพิ่ม page/cell/evidence spans ที่นี่และส่งผ่าน
fact references, physical projection และ citation contract จน resolve หลัง restart ได้.

## Objective

สร้าง lineage chain ตั้งแต่ต้น pipeline

## Required Fields

อย่างน้อย:

```text
source_id
source_type
source_uri
source_version
artifact_id
ingested_at
parsed_at
pipeline_version
extractor_version
checksum
```

เมื่อเป็น knowledge derived object ต้องเพิ่ม:

```text
evidence_span
source_chunk_id
confidence
derivation_method
model_id
```

## Provenance Chain

```text
Fact
 ↓ DERIVED_FROM
Chunk
 ↓ PART_OF
ParsedArtifact
 ↓ PARSED_FROM
RawArtifact
 ↓ INGESTED_FROM
Source
```

## Invariant

ห้าม publish Fact หรือ Relation ที่หา source กลับไม่ได้ เว้นแต่ถูกประกาศอย่างชัดเจนเป็น:

```text
DERIVED
INFERRED
COMPUTED
```

---

# 9. Stage 4 — Normalization

**Current isolated profile:** คำนวณ canonical text hash พร้อม raw hash ด้วย rule;
ไม่ได้แทน raw/parsed/chunk text ด้วย normalized text. เพิ่ม canonical fields ที่นี่
โดยเก็บต้นฉบับและ offset mapping; ไม่ทำ source hash เปลี่ยนโดยไม่มี version ใหม่.

## Objective

ทำให้ representation ของข้อมูลมีรูปแบบ canonical โดยไม่ทำลาย raw value

## Normalize

- Unicode
- Whitespace
- Date/time
- Timezone
- Currency
- Unit
- Phone number
- Email
- Organization name
- Product code
- Country/region
- Identifier format

## Example

```text
raw:
"25/8/69"

canonical:
"2026-08-25"
```

หรือ:

```text
raw_name:
"บริษัท เอบีซี จำกัด"

normalized_name:
"เอบีซี"
```

Raw value ต้องยังคงอยู่

---

# 10. Stage 5 — Classification / Access Scope

**Current isolated profile:** ใช้ scope ที่ผูก run และ flags `allowEmbedding` /
`allowPublication`; exact scope ตรวจที่ MSP/GKS/worker ด้วย. ยังไม่ใช่ runtime ของ
ทุก classification/policy ด้านล่าง. เพิ่ม sensitivity ที่นี่พร้อม policy enforcement
ที่ 15/17/query; flag false ไม่ทำให้ Stage 5 ล้มทันที แต่ห้าม operation ปลายทางนั้น.

## Objective

กำหนด security boundary ก่อนข้อมูลถูก chunk/embed/index

## Scope Dimensions

```text
portfolio_id
tenant_id
business_id
workspace_id
project_id
```

Optional:

```text
branch_id
department_id
vault_id
```

## Data Classification

ขั้นต่ำ:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
```

## Additional Policy

```text
allowed_roles
allowed_agents
allowed_vaults
retention_policy
export_policy
cloud_processing_allowed
embedding_allowed
```

## Critical Invariant

ทุก object ที่ index ต้องมี enforceable scope

ห้ามสร้าง unscoped business knowledge

---

# 11. Stage 6 — Deduplication / Versioning

**Current isolated profile:** เปรียบเทียบ source versions/hashes ใน scope เดียวและรายงาน
relationship; ไม่ลบ/rewrite raw เดิม. Delivery retry ใช้ batch เดิม; correction/reprocess
ใช้ version หรือ FR-071 attempt ใหม่ตามเหตุผล. เพิ่ม dedup policy ที่นี่และทดสอบ old citations.

## Objective

แยก:

- Duplicate
- Revision
- Replacement
- Independent artifact

ออกจากกัน

## Dedup Strategies

- Exact checksum
- Canonical checksum
- Source-native ID
- Content similarity
- Structural similarity

## Example

```text
invoice.pdf
invoice-copy.pdf

→ same artifact
```

แต่:

```text
contract-v1.pdf
contract-v2.pdf

→ different versions
```

## Version Relationships

```text
SUPERSEDES
SUPERSEDED_BY
REVISION_OF
DERIVED_FROM
DUPLICATE_OF
```

---

# 12. Stage 7 — Chunking

**Current isolated profile:** heading sections + whitespace-token limit (default 80),
persist exact source substrings/hash/ordinal/UTF-16 offsets. Token count นี้ไม่ใช่ E5
tokenizer count. เพิ่ม structural chunker ที่นี่และตรวจ mention offsets/benchmark downstream.

## Objective

แบ่งข้อมูลตาม semantic/structural boundaries ที่เหมาะกับ retrieval

## Strategies

- Structural chunking
- Semantic chunking
- Record chunking
- Sliding-window fallback
- Parent-child chunking

## Preferred

```text
Document
  ↓
Section
  ↓
Semantic Chunk
```

แทนการ chunk ทุก 500 token แบบตายตัว

## Required Metadata

```text
chunk_id
parent_id
document_id
sequence
heading_path
token_count
scope
provenance
```

---

# 13. Stage 8 — Entity Extraction

**Current isolated profile:** rule recognizer ผลิต typed occurrences; ทุก occurrence มี
`sourceMentionId` แยกจาก `resolutionKey` และ chunk-local UTF-16 offsets. ส่งรวมหนึ่ง batch
ต่อ Stage 9 attempt. เพิ่ม recognizer/type ที่นี่; canonical matching เป็น Stage 9 และ
predicate endpoint types ต้องสอดคล้อง Stage 11.

## Objective

ตรวจหา entity candidates จาก structured และ unstructured data

## Example Entity Types

```text
Person
Organization
Customer
Supplier
Product
Service
Invoice
Order
Project
Location
Event
Campaign
Document
Contract
Asset
Concept
```

## Output

`EntityCandidate`

```json
{
  "candidate_id": "...",
  "type": "Organization",
  "mention": "ABC",
  "normalized_name": "ABC",
  "source_chunk_id": "...",
  "confidence": 0.93
}
```

EntityCandidate ยังไม่ใช่ canonical entity

---

# 14. Stage 9 — Entity Resolution

**Current isolated profile:** GKS รับทั้ง batch ตรวจ source/chunk hashes และ mention spans
ก่อน resolve โดยคง occurrence ทุกตัว. หนึ่ง terminal ต่อ attempt ไม่ใช่ report ต่อ entity.
เพิ่ม alias/matching/merge strategy ที่ GKS stage นี้; Tier 1 ห้ามตัดสิน canonical identity.

## Owner

**GKS**

## Objective

เชื่อม EntityCandidate เข้ากับ canonical identity

## Strategies

ตามลำดับ confidence:

```text
Internal ID
ExternalRef
Exact match
Alias match
Deterministic rule
Fuzzy match
Embedding similarity
LLM-assisted resolution
Human review
```

## Example

```text
ABC
ABC Co Ltd.
ABC COMPANY LIMITED
บริษัท ABC จำกัด

        ↓

Organization: org_01H...
```

## Resolution Outcomes

```text
MATCHED
CREATED
AMBIGUOUS
REVIEW_REQUIRED
REJECTED
```

ห้าม auto-merge entity ที่ confidence ต่ำกว่าค่า policy

---

# 15. Stage 10 — Relation / Fact Extraction

**Current isolated profile:** GKS `rule_v1`: explicit rule confidence .90, structured .85,
inferred/co-occurrence ≤.70; write floor .80. Predicate ยัง raw; ต่ำกว่า floor เป็น HELD.
เพิ่ม relation pattern/extractor ที่นี่พร้อม provenance; predicate ใหม่ต้องเพิ่ม Stage 11.
LLM extraction เป็นงานต่อยอดที่ต้องออกแบบ ไม่ได้ทำแล้วใน profile นี้.

## Objective

สร้าง structured assertions จาก source data

## Relation Example

```text
Person ──WORKS_FOR──> Organization
Customer ──PURCHASED──> Product
Project ──OWNED_BY──> Organization
```

## Fact Model

สำหรับ business data แนะนำให้ Fact เป็น first-class object

```text
Fact
├── subject
├── predicate
├── object/value
├── confidence
├── evidence
├── valid_time
└── provenance
```

ตัวอย่าง:

```text
ABC Hotel
   │
   ▼
PurchaseFact
├─ product = MUKU
├─ quantity = 100
├─ amount = 25,000 THB
├─ valid_at = 2026-08-20
└─ source = invoice_982
```

---

# 16. Stage 11 — Schema / Ontology Mapping

**Current isolated profile:** `ontology_v1`: works for/employed by/works_for → `WORKS_FOR`
(Person → Organization); purchased/bought/purchased_from → `PURCHASED`
(Person หรือ Organization → Product). Unknown predicate/invalid endpoint เป็น HELD
พร้อมเหตุผล. เพิ่ม synonym/predicate/type ที่นี่และ version ontology; ห้ามเปลี่ยนความหมายเดิมเงียบ ๆ.

## Owner

**GKS**

## Objective

map extracted concepts เข้าสู่ canonical knowledge model

## Example Problem

ห้ามปล่อย relation:

```text
WORKS_FOR
EMPLOYED_BY
IS_EMPLOYEE_OF
STAFF_OF
```

เกิดพร้อมกันโดยไร้ governance

ต้อง map เป็น canonical:

```text
WORKS_FOR
```

## Ontology Responsibilities

- Canonical entity type
- Canonical predicate
- Alias
- Parent-child taxonomy
- Allowed relations
- Cardinality
- Domain constraints
- Required properties

## Validation

ตัวอย่าง:

```text
Invoice ──EMPLOYED_BY──> Person
```

ควรถูก reject เป็น ontology violation

---

# 17. Stage 12 — Temporal Mapping

**Current isolated profile:** GKS temporal mapping แยก unmapped, open-ended และ explicit
`not_applicable`; parity fixtures อ้าง MSP source commit
`8b8667dadf01fd7f421260af8b8b260f6cac267f` โดยไม่เรียก MSP temporal runtime มาตัดสิน stage.
เพิ่ม date/interval semantics ที่นี่พร้อม projection/readback ที่ 13/16 และ gate applicability.

## Objective

ระบุ temporal semantics ให้ Fact และ Relation

## Required Temporal Dimensions

เมื่อ applicable:

```text
valid_from
valid_to

tx_from
tx_to
```

หรือ equivalent:

```text
valid_time
transaction_time
```

## Meaning

`valid_time`

> ความจริงนี้มีผลในโลกจริงเมื่อไร

`transaction_time`

> ระบบทราบหรือบันทึกความจริงนี้เมื่อไร

## Example

```text
Person A WORKS_FOR Company B

valid_from:
2025-01-01

valid_to:
2026-06-30

recorded_at:
2026-08-01
```

ต้องสามารถตอบ query:

```text
Who worked for Company B on June 1, 2026?
```

---

# 18. Stage 13 — Graph Construction

**Current isolated profile:** GKS สร้าง immutable graph decision/hash; worker ดึงผ่าน MSP
แล้วทำ graph-only transaction/flush/readback. Stage 13 จบเมื่อ GKS ตรวจ `graph_receipt`
ตรง identity/counts จริง. `decided counts` ไม่ใช่ `written counts`. เพิ่ม assertion/class
ที่นี่โดยแก้ decision schema, worker projection และ gate expectations ร่วมกัน.

## Objective

สร้าง graph representation จาก canonical knowledge

## Core Node Classes

ตัวอย่าง:

```text
Entity
Fact
Chunk
Document
Event
Source
Community
```

## Core Edge Classes

```text
MENTIONS
ASSERTS
DERIVED_FROM
PART_OF
RELATES_TO
SUPERSEDES
HAS_SOURCE
```

รวม domain predicates เช่น:

```text
PURCHASED
WORKS_FOR
OWNS
BELONGS_TO
MANAGES
```

## Graph Requirement

ทุก edge ที่เป็น business assertion ต้องรองรับ:

```text
provenance
confidence
temporal semantics
scope
```

---

# 19. Stage 14 — Knowledge / Graph Enrichment

**Current isolated profile:** หลัง Stage 13 receipt เท่านั้น GKS ทำ `enrich_v1` สรุปจำนวน
distinct documents/chunks/verified facts ต่อ entity พร้อม source refs. Derived rows/hash
แยกจาก verified facts และ immutable decisionHash. Worker เขียน derived projection ใน
final candidate transaction. เพิ่ม summary/derived feature ที่นี่; รายการกว้างด้านล่างยังเป็นเป้าหมาย.

## Objective

เพิ่ม knowledge ที่ derive จาก graph ปัจจุบัน

## Supported Enrichment

- Alias generation
- Entity description
- Hierarchy
- Taxonomy
- Derived attributes
- Derived relations
- Graph statistics
- Community detection
- Community summary
- Entity summary
- Topic classification
- Similarity linkage

## Derived Knowledge

ทุก derived knowledge ต้องระบุ:

```text
derivation_method
source_objects
confidence
generated_at
pipeline_version
```

ต้องแยกจาก verified source fact อย่างชัดเจน

---

# 20. Stage 15 — Embedding

**Current isolated profile:** worker สร้าง chunk vectors จริงด้วย local CPU
`intfloat/multilingual-e5-small`, revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`,
384 dimensions/cosine; ตรวจ artifact hashes ไม่มี fallback. Policy deny ทำ Stage 15 FAILED.
เพิ่ม model/object selection ที่นี่พร้อม generation/index schema และ fixed benchmark ใหม่.

## Objective

สร้าง vector representation สำหรับ semantic retrieval

## Embeddable Objects

สามารถรวม:

```text
Chunk
Entity
Entity Summary
Fact
Community Summary
Document Summary
```

ไม่ควร embed object เพียงเพราะทำได้

ตัวอย่าง:

```text
invoice_number = INV-98217
```

เหมาะกับ lexical/structured retrieval มากกว่า vector retrieval

## Metadata

Embedding ต้องผูกกับ:

```text
object_id
embedding_model
embedding_version
dimension
created_at
scope
content_hash
```

Model เปลี่ยนต้องรองรับ re-index โดยไม่ overwrite lineage

---

# 21. Stage 16 — Multi-Lane Indexing

**Current isolated profile:** worker final candidate transaction, flush/checkpoint/readback
และ six-lane manifest (`status`, `reason`, `objects`). Lexical เป็น derived worker SQLite FTS5;
ไม่ใช่ native text-index API. Temporal applicability/API limits รายงานตามจริง; required lanes
ต้อง ready. เพิ่ม lane ที่นี่และตรวจ gate จริง; candidate ยังไม่ query-visible.

## Objective

ส่ง knowledge ไปยัง retrieval substrate ตาม capability ที่เหมาะสม

GenesisBlockDB มี 6 logical retrieval lanes:

### Lane 1 — Vector

ใช้สำหรับ:

```text
semantic similarity
concept search
document similarity
```

### Lane 2 — Lexical

ใช้สำหรับ:

```text
exact words
SKUs
invoice number
codes
names
identifiers
```

### Lane 3 — Graph

ใช้สำหรับ:

```text
relationships
multi-hop traversal
entity neighborhood
path finding
```

### Lane 4 — Structured

ใช้สำหรับ:

```text
property filters
ranges
counts
aggregations
exact values
```

### Lane 5 — Temporal

ใช้สำหรับ:

```text
valid_at
as_of
historical state
before/after event
```

### Lane 6 — Provenance

ใช้สำหรับ:

```text
source lineage
causality
evidence verification
audit
```

## Routing Example

```text
Customer
→ Graph
→ Structured
→ Lexical
→ Vector optional

Invoice
→ Structured
→ Temporal
→ Provenance
→ Lexical

Chunk
→ Vector
→ Lexical
→ Provenance

Fact
→ Graph
→ Structured
→ Temporal
→ Provenance
```

ห้ามบังคับทุก object ลงทุก lane

---

# 22. Stage 17 — Graph + Retrieval Quality Gate

**Current isolated profile:** GKS ตรวจ data/graph/knowledge/security/retrieval จาก decision
และ physical receipts จริง. Worker publish ได้เมื่อ verdict และ policy อนุญาต แล้วส่ง
matching publication receipt ผ่าน MSP. Stage 17 SUCCEEDED และ finish ต้องรอ receipt นี้.
เพิ่ม check/threshold ที่นี่พร้อม negative case ไม่ publish; ไม่ใส่ success evidence ด้วยมือ.

## Objective

ตรวจสอบ knowledge ก่อน publish

Gate ต้องตรวจอย่างน้อย 5 dimensions

---

## 22.1 Data Quality

ตรวจ:

- Missing fields
- Invalid formats
- Broken references
- Duplicate objects
- Schema violations
- Parsing errors

---

## 22.2 Graph Quality

ตรวจ:

- Orphan nodes
- Dangling edges
- Invalid node type
- Invalid predicate
- Impossible relation
- Duplicate entity
- Supernode anomaly
- Broken hierarchy

---

## 22.3 Knowledge Quality

ตรวจ:

- Unsupported Fact
- Low-confidence extraction
- Contradictory fact
- Stale knowledge
- Ambiguous entity
- Missing provenance
- Unresolved candidate

---

## 22.4 Security Quality

ตรวจ:

- Missing Tenant scope
- Cross-tenant relation
- Access-policy violation
- Classification violation
- Restricted content leakage
- Unsafe cloud processing

Critical security failure ต้อง block publication

---

## 22.5 Retrieval Quality

ต้องรองรับ evaluation metrics เช่น:

```text
Recall@K
Precision@K
MRR
NDCG
Hit Rate
Context Precision
Context Recall
Citation Correctness
Groundedness
Answer Faithfulness
```

ไม่จำเป็นต้องรันทุก metric ทุก ingestion

แต่ต้องมี benchmark/evaluation suite สำหรับ release

---

# 23. Quality Gate Result

**Current isolated profile:** wire ใช้ `PASS` / `WARN` / `FAIL` พร้อม `allowPublication`;
คำด้านล่างเป็น vocabulary ของ legacy snapshot/ledger projection. GKS quality PASS แต่
policy deny ให้ Stage 17 FAILED และ Tier 1 legacy projection เป็น QUARANTINE.

ผลลัพธ์:

```text
PASS
PASS_WITH_WARNINGS
QUARANTINE
FAIL
```

เฉพาะ:

```text
PASS
PASS_WITH_WARNINGS
```

ที่ policy อนุญาตเท่านั้นจึง publish ได้

---

# 24. Publication

**Current isolated profile:** “ผ่าน gate” หมายถึงพร้อมขอ publish ไม่ใช่ Stage 17 เสร็จแล้ว.
worker เปลี่ยน pointer แบบ atomic หลัง candidate flush/readback; query ยึด generation
ครั้งเดียวและเก็บ snapshot เดิม. ส่ง publication receipt ที่ผูก scope/run/attempt,
decisionHash, snapshot/generation, receiptHash, model revision, transaction frontier และ readback
กลับ MSP → GKS → zuri ก่อน finish สำเร็จ. Crash/reply loss ส่ง receipt เดิมซ้ำ.

เมื่อผ่าน Stage 17:

```text
READY_TO_PUBLISH
        ↓
Atomic Publication
        ↓
PUBLISHED
```

ระบบต้องไม่ expose index ใหม่ให้ RAG แบบครึ่งชุด

แนะนำใช้:

```text
knowledge_snapshot_id
index_generation
ontology_version
pipeline_version
```

เพื่อให้ retrieval สามารถอ้างถึง snapshot เดียวกันได้

---

# 25. Published Knowledge Contract

**Current isolated profile:** wire uses camelCase `snapshotId`, `generation`, exact
`scope` and receipt-bound model/transaction metadata; the legacy product shape below
is not the wire payload verbatim. Do not forward it to `msp_pipeline_*` without the
explicit adapter/schema. See [wire contract](plans/GENESISRAG17-CONTRACT.md).

ตัวอย่าง logical structure:

```json
{
  "knowledge_snapshot_id": "ks_...",
  "tenant_id": "...",
  "business_id": "...",
  "ontology_version": "...",
  "pipeline_version": "...",
  "published_at": "...",
  "statistics": {
    "documents": 0,
    "chunks": 0,
    "entities": 0,
    "facts": 0,
    "relations": 0
  }
}
```

---

# 26. GraphRAG Readiness Definition

Knowledge จะถือว่า `GraphRAG Ready` เมื่อ:

- Entity identity resolved
- Relations normalized
- Facts provenance-backed
- Tenant scope valid
- Temporal fields mapped where required
- Required embeddings created
- Graph indexes available
- Retrieval indexes available
- No critical quality failure
- Published snapshot available
- Retrieval query can return evidence with citations

---

# 27. Failure Handling

แต่ละ stage ต้อง classify failure เป็น:

## Retryable

เช่น:

```text
API timeout
temporary model unavailable
rate limit
temporary database error
```

## Non-Retryable

เช่น:

```text
invalid schema
unsupported format
security policy violation
corrupt document
```

## Review Required

เช่น:

```text
entity ambiguity
conflicting high-confidence facts
ontology mapping ambiguity
```

---

# 28. Dead Letter / Quarantine

Object ที่ fail ต้องไม่หาย

ต้องถูกส่งไป:

```text
Quarantine Store
```

พร้อม:

```text
job_id
artifact_id
stage
error_code
error_message
retry_count
first_failed_at
last_failed_at
pipeline_version
```

---

# 29. Idempotency

**Current isolated profile:** delivery retry ใช้ immutable request/key เดิม;
real reprocess ใช้ FR-071 run/step/attempt ใหม่. Importer จับ exact identity ไม่เลือก step ล่าสุด;
legacy evidence ไม่มี attempt อ่านได้แต่ปิด attempt ใหม่ไม่ได้. Cursor ขยับพร้อม durable
page import transaction หลัง validation สำเร็จ. ดู [wire contract](plans/GENESISRAG17-CONTRACT.md).

Pipeline ต้องสามารถ process event เดิมซ้ำโดยไม่สร้าง duplicate knowledge

ใช้:

```text
source identity
+
source version
+
content hash
+
pipeline version
```

ในการตรวจ idempotency

---

# 30. Incremental Processing

**Current isolated profile:** หนึ่งเอกสารต่อ run/candidate generation และ correction
สร้าง snapshot ใหม่พร้อมเก็บ snapshot เก่า. Corpus-wide incremental merging/index reuse
ตามภาพด้านล่างยังเป็น design target ไม่ใช่สิ่งที่ single-document acceptance พิสูจน์.

ระบบต้องรองรับ incremental pipeline

ไม่ควร rebuild knowledge graph ทั้งหมดทุกครั้ง

ตัวอย่าง:

```text
new invoice
      ↓
parse invoice
      ↓
resolve affected entities
      ↓
update facts
      ↓
update affected graph
      ↓
update affected indexes
```

---

# 31. Reprocessing

**Current isolated profile:** FR-071 `replayRunId` ต้องตรง queued run, scope และ immutable
source identity ก่อนสร้างหลักฐานของ attempt ใหม่. รายการ version upgrades ด้านล่างเป็น
เหตุผลสำหรับออกแบบ replay/migration ไม่ใช่ automatic model/parser migration ที่มีแล้ว.

ต้องรองรับ reprocessing เมื่อ:

- Parser version เปลี่ยน
- Embedding model เปลี่ยน
- Ontology เปลี่ยน
- Extraction model เปลี่ยน
- Normalization rule เปลี่ยน

โดยต้องไม่ทำลาย original source lineage

---

# 32. Observability

**Current isolated profile:** durable terminal wire metrics คือ `records_in`, `records_out`,
`records_quarantined`, `error_count`, `retry_count`, `duration_ms`. รายการ product NFR-020
ด้านล่างคงชื่อ `records_failed`/`processing_time` เดิม; error_count ไม่ได้รับรองว่าเท่ากับ
จำนวน failed records ทุกกรณี และไม่ได้ปิด pipeline-level aggregates ทุกตัวด้วย stage metrics.

แต่ละ Stage ต้อง emit metrics อย่างน้อย:

```text
records_in
records_out
records_failed
records_quarantined
processing_time
retry_count
```

Pipeline-level metrics:

```text
ingestion_lag
pipeline_latency
publication_latency
error_rate
quarantine_rate
entity_resolution_rate
retrieval_quality_score
```

---

# 33. Pipeline Job Trace

ทุก ingestion ต้องมี:

```text
pipeline_job_id
```

เพื่อ trace:

```text
Source
 ↓
RawArtifact
 ↓
ParsedArtifact
 ↓
Chunks
 ↓
Entities
 ↓
Facts
 ↓
Graph
 ↓
Indexes
 ↓
Published Snapshot
```

ได้ end-to-end

---

# 34. Security Requirements

Pipeline ต้อง:

- Verify source authenticity เมื่อทำได้
- Encrypt data in transit
- Encrypt sensitive storage
- Enforce tenant scope
- Prevent cross-tenant deduplication
- Prevent unauthorized cloud processing
- Redact secrets
- Never embed credentials
- Never embed access tokens
- Never log raw secrets

---

# 35. Cloud / Edge Execution Policy

Pipeline stage ไม่จำเป็นต้องรันที่เดียวกันทั้งหมด

ตัวอย่าง deployment:

```text
LOCAL EDGE

1  Ingestion
2  Parsing
3  Provenance
4  Normalization
5  Classification
6  Deduplication
7  Chunking
8  Entity Extraction
          │
          ▼

CLOUD GKS

9  Entity Resolution
10 Fact / Relation Processing
11 Ontology Mapping
12 Temporal Mapping
13 Graph Planning
14 Enrichment
          │
          ▼

LOCAL / SELECTED EXECUTION

15 Embedding
16 Genesis Indexing
17 Quality Validation
```

แต่ execution location ต้องเป็น policy-driven

ข้อมูล `RESTRICTED` อาจกำหนด:

```text
cloud_processing_allowed = false
```

และ execute Stage 1–17 local ทั้งหมดได้

---

# 36. Suggested Component Boundaries

```text
knowledge-pipeline/
├── ingestion/
├── parsing/
├── provenance/
├── normalization/
├── classification/
├── deduplication/
├── chunking/
├── extraction/
│   ├── entity/
│   ├── relation/
│   └── fact/
├── resolution/
├── ontology/
├── temporal/
├── graph/
├── enrichment/
├── embedding/
├── indexing/
├── quality/
├── publication/
└── observability/
```

นี่เป็น logical package structure

ไม่ใช่ข้อกำหนดให้แต่ละ directory กลายเป็น network service

---

# 37. GKS Responsibility Boundary

**Current isolated profile:** canonical decisions 9–14 และ Stage 17 quality อยู่ GKS;
GKS เป็น passive server รับผ่าน MSP เท่านั้น. Physical graph/index/publish อยู่ worker;
Stage 13 ปิดหลัง graph receipt, Stage 14 จึงเริ่ม. Logical ownership ไม่ใช่สิทธิ์ให้ GKS call out.

GKS ต้อง own:

```text
Canonical Entity Authority
Ontology Authority
Entity Resolution
Knowledge Promotion
Fact Governance
Relation Governance
Retrieval Strategy
GraphRAG Orchestration
```

GKS ไม่ควร own:

```text
raw file storage
business transaction DB
physical vector index
physical graph index
```

---

# 38. GenesisBlockDB Responsibility Boundary

**Current isolated profile:** engine ยังเป็น client-neutral substrate; orchestration,
embedding, derived FTS5 index, receipts, published pointer และ query server อยู่แพ็กเกจ
`genesisrag17-worker` แยก. Worker pull ผ่าน MSP และไม่ตัดสิน ontology/quality แทน GKS.

GenesisBlockDB ต้อง own:

```text
Vector Index
Lexical Index
Graph Storage / Traversal
Structured Projection
Bitemporal Retrieval
Provenance Retrieval
Multi-Lane Query Execution
```

Genesis ไม่ควร own:

```text
ontology decisions
entity merge policy
business workflow
prompt engineering
LLM reasoning
agent execution
```

---

# 39. RAG Responsibility Boundary

**Current isolated profile:** query ปัจจุบัน caller → MSP → worker published generation
พร้อม citation. ภาพด้านล่างเป็น target สำหรับ query planning/answer composition ที่กว้างกว่า;
ไม่ใช่ลำดับ RPC ที่ acceptance ทดสอบ. เพิ่ม reranking/context/answer หลัง Stage 17 บน read path,
ไม่เพิ่ม Stage 18 หรือ rerun ingestion เป็น side effect ของ query.

RAG เป็น consumer ของ Published Knowledge

Read path:

```text
User Query
   ↓
MSP Scope / Session
   ↓
GKS
   ↓
Query Planning
   ↓
query-ir.v1
   ↓
GenesisBlockDB
   ↓
Evidence Packet
   ↓
Rerank / Context Build
   ↓
LLM / Agent
```

Data Pipeline ไม่ควร execute user-facing RAG query

RAG ไม่ควรทำ ingestion pipeline เป็น side effect ของ query

---

# 40. Minimum Acceptance Criteria

รายการด้านล่างเป็น product-wide target ไม่ใช่ checklist ที่ปิดครบโดย isolated slice.
หลักฐาน profile ที่รันแล้วอยู่ใน [acceptance report](../.brain/reports/GENESISRAG17-ACCEPTANCE.md):
raw entrypoint → 17 stages → native publication/query/citation/restart พร้อม failure tests.
Fixed corpus thresholds: Recall@5 ≥ .80, MRR ≥ .65, citation correctness = 1.00,
cross-tenant leaks = 0. ไม่ยกผลนี้เป็น production quality หรือ proof ของทุก source/RAG feature ด้านล่าง.

17-Stage Pipeline รุ่นแรกถือว่าใช้งานได้เมื่อ:

- [ ] สามารถ ingest structured และ unstructured source อย่างน้อยอย่างละ 1 ประเภท
- [ ] Raw artifact ถูกเก็บและย้อนกลับได้
- [ ] ทุก derived object มี provenance
- [ ] Tenant/Business scope ถูก enforce
- [ ] Duplicate ingestion ไม่สร้าง duplicate knowledge
- [ ] Chunk สามารถ trace กลับ document ได้
- [ ] Entity extraction ทำงาน
- [ ] Entity resolution มี canonical ID
- [ ] Relation/Fact extraction ทำงาน
- [ ] Ontology validation ทำงาน
- [ ] Temporal metadata รองรับเมื่อ source มีข้อมูลเวลา
- [ ] Graph ถูกสร้างโดยไม่มี dangling critical edges
- [ ] Enrichment แยก derived knowledge จาก source fact
- [ ] Embedding มี model/version metadata
- [ ] Genesis สามารถ index knowledge อย่างน้อย Vector + Lexical + Graph + Structured
- [ ] Provenance retrieval ทำงาน
- [ ] Quality Gate block critical failure ได้
- [ ] Published snapshot มี version
- [ ] GKS สามารถ query published snapshot ผ่าน retrieval contract
- [ ] GraphRAG response สามารถคืน evidence พร้อม source reference ได้

---

# 41. Final Architecture Summary

ภาพนี้สรุป logical capabilities. ใช้ [actual sequence](KNOWLEDGE-INGESTION-17-STAGE-FLOW.md#flow-ที่รันจริง)
เมื่อ implement: MSP คั่นทุก caller, Stage 13 ต้องมี physical receipt ก่อน 14 และ Stage 17
รวม gate → atomic pointer → matching publication receipt ไม่ใช่ gate-only completion.

```text
                    DATA SOURCES
                         │
                         ▼
              ┌────────────────────┐
              │ Stage 1–8          │
              │ Acquisition        │
              │ + Preparation      │
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │ Stage 9–14         │
              │ Knowledge          │
              │ Understanding      │
              │ GKS Authority      │
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │ Stage 15–16        │
              │ Retrieval          │
              │ Representation     │
              │ GenesisBlockDB     │
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │ Stage 17           │
              │ Quality Gate       │
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │ Published          │
              │ Knowledge Snapshot │
              └─────────┬──────────┘
                        ▼
                      GKS
                        │
                        ▼
                  RAG / GraphRAG
                        │
                        ▼
                     Agent
```

# 42. Architectural Rule

ใช้กฎนี้เป็น boundary หลักของระบบ:

```text
Pipeline
= ทำให้ข้อมูลพร้อมเป็น Knowledge

GKS
= ทำให้ Knowledge มีความหมายและ identity ที่แน่นอน

GenesisBlockDB
= ทำให้ Knowledge ถูกค้นคืนได้

RAG / GraphRAG
= เลือกและประกอบ Knowledge ให้เหมาะกับคำถาม

MSP
= ควบคุมว่าคำถามนั้นอยู่ใน session, memory และ access scope ใด

Zuri
= ใช้ผลลัพธ์เพื่อดำเนิน Business Execution
```

**End of Specification**


## Documentation version diff — 2026-09-08

| Version | Change | Runtime impact |
|---|---|---|
| 1.4.0b → 1.4.1b | Record actual Business UI/session HTTP/MCP native acceptance and explicit evidence limits | No stage ownership or IDs changed |
| 1.3.0b → 1.4.0b | Adopt ADR-072 admission and corpus serving around unchanged 17-stage ownership | Authorized phases 0–4 implementation; surface/native acceptance tracked separately |
| 1.2.0b → 1.3.0b | Link enumerated endpoint inventory and detailed source/user flows; separate existing staging/files from proposed admission and sharing | None; documentation only |
| 1.1.0b → 1.2.0b | Approved code-audit remediation and explicit supported-input/publication boundaries | Source durability, semantic/temporal correctness and physical recovery repairs; see remediation evidence |
| 1.0.0 → 1.1.0b | Current isolated profile and extension navigation; stable stage/requirement IDs and original section numbers preserved | None; historical acceptance evidence unchanged |
