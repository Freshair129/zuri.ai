# Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification

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
> number. Those rows are documentary declarations: nothing described below
> executes, and no route, model or code is authorized by this specification.
> ADR-050 is the tier boundary they depend on —
> zuri-ai declares the stage catalog, the snapshot contract, the classification
> lattice and the provenance envelope, and never executes the substrate-writing
> stages ADR-043 D2.1 and ADR-046 reserve to GKS and GenesisBlockDB.

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft — adopted as the source specification by ADR-050 |
| **Author** | Boss |
| **Created** | 2026-08-27 |
| **Last Updated** | 2026-08-27 |

<!-- EDITORIAL HEADER ENDS HERE — SOURCE DOCUMENT BEGINS BELOW -->

> *Everything **above** this line is editorial, added 2026-08-27 when this
> specification was adopted into the governed spec pack (ADR-050): the adoption
> banner, and the `Status` value naming that adoption. Everything **below**
> this line is the specification as received — sections 1–42, unaltered. A
> fidelity check "against the source" must therefore start below this line;
> the text above it was written by the change that cites this document, not by
> its author.*

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

ต้องรองรับ reprocessing เมื่อ:

- Parser version เปลี่ยน
- Embedding model เปลี่ยน
- Ontology เปลี่ยน
- Extraction model เปลี่ยน
- Normalization rule เปลี่ยน

โดยต้องไม่ทำลาย original source lineage

---

# 32. Observability

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