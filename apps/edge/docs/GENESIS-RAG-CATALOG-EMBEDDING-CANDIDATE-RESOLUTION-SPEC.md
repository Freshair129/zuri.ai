---
id: "GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-SPEC"
version: "0.1.0b"
created_at: "2026-08-23T11:58:10+07:00, ATHER"
last_update: "2026-08-23T11:58:10+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Sidecar ProductMaster-to-ProductMaster candidate resolution using E5 vectors, graph evidence, and owner hard rules"
  parent: "GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC"
  peer: "GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-SPEC"
  approval: "approved by owner, 2026-08-23; sidecar resolution only"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Catalog — Embedding Candidate Resolution P4

## 1. Goal

เปลี่ยนผล embedding จาก retrieval benchmark ให้เป็นรายการตัดสินที่ใช้งานตรวจสอบได้ว่า
`ProductMaster` คู่ใดมีโอกาสเป็นสินค้ากายภาพเดียวกัน โดยยังไม่เขียนทับ identity review,
active Genesis store, taxonomy, ราคา, quote, stock หรือ delivery

P4 ตอบคำถามสองข้อแยกกัน:

1. embedding พบ ProductMaster ที่มีความหมายใกล้กันคู่ใดบ้าง;
2. graph evidence และ owner hard rules อนุญาตให้เสนอ merge, variant หรือบังคับแยกหรือไม่

Vector similarity เป็น candidate evidence ไม่ใช่ merge authority

## 2. Approved inputs

| Input | Contract |
|---|---|
| Baseline identity review | 425 atomic ProductMasters, snapshot `5488a37eec8819bf1b744e0a2e6b09e7b7afe832dbcda99cba53ff14859bc8e0` |
| Owner-logic review | ใช้ type, score, hard-rule และ component evidence ประกอบ แต่ไม่แทน baseline identity |
| Selected vector run | `RUN1_BMR1_5921CC9447EA_ve_20260823T025634936Z_01` |
| Embedding model | `intfloat/multilingual-e5-small` revision `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| Embedding space | `SPACE1_MODEL1_HF_in_384_cosine_l2` |
| Index | exact Flat over 425 ProductMaster vectors |

P4 อ่าน vector ที่สร้างเสร็จแล้วจาก `documents.jsonl` และ `embeddings.f32.bin` จึงไม่ต้อง
download หรือ execute embedding model ซ้ำ การตรวจ input SHA-256 ต้องผ่านก่อนเริ่มทุก run

## 3. Processing flow

```text
425 ProductMaster vectors
  -> exact cosine ProductMaster-to-ProductMaster top-k
  -> canonical unordered candidate pairs
  -> component/physical/variant/branding/lineage hard rules
  -> pairwise identity score
  -> same_product | variant_of | kept_separate | review_required | unclassified
  -> proposed merge groups + review queue + metrics
```

ใช้ exact Flat เพราะ corpus มีเพียง 425 records; approximate index ไม่มีประโยชน์ด้าน latency
ที่คุ้มกับ recall loss ในขอบเขตนี้

## 4. Pair identity and graph contract

- candidate pair ใช้ key แบบ unordered: `min(productId)|max(productId)` เพื่อไม่สร้าง A→B
  และ B→A ซ้ำ
- ไม่สร้าง self-pair
- candidate edge เป็น sidecar relation `CANDIDATE_SAME_PRODUCT`; ไม่เพิ่มเข้า active graph
- offer, variant, customization และ component edges เดิมเป็น evidence แบบ bounded lookup
- merge group สร้างจาก connected components ของคู่ `same_product` หรือ `variant_of`
  ที่ผ่าน hard rules เท่านั้น
- ทุก decision ต้องผูก `datasetRevisionId`, vector `runId`, `modelId`,
  `embeddingSpaceId`, pair id, score factors, hard rules และ source product ids

## 5. Hard rules

Hard rule มีผลก่อนคะแนน:

| Condition | Mandatory result |
|---|---|
| component signature เป็นคนละประเภทที่ระบุได้ | `kept_separate` |
| ฝั่งใดเป็น `unclassified` หรือไม่มี physical anchor | `unclassified` หรือ `review_required`; ห้าม merge |
| material, capacity, dimension, model หรือ construction ขัดกัน | `kept_separate` |
| ต่างเฉพาะสีหรือ customer branding และ physical anchor ตรงกัน | `variant_of` |
| เป็น set/bundle composition | ใช้ `CONTAINS_COMPONENT`; ห้ามนับ set เป็น ProductMaster |
| vector ใกล้กันแต่ graph/physical evidence ไม่พอ | `review_required` |

คำว่า bag/box, ราคาหรือ source code ไม่ใช่ hard evidence ว่าเป็นคนละ ProductMaster

## 6. Pair score and decisions

ใช้สูตร owner logic เดิมต่อคู่ candidate:

```text
IdentityScore =
  0.35 * AnchorAgreement
+ 0.25 * ComponentAgreement
+ 0.20 * PhysicalSpecAgreement
+ 0.10 * NameDescriptionAgreement
+ 0.05 * BrandingPackagingCompatibility
+ 0.05 * SourceLineageSupport
```

Embedding cosine ใช้ประกอบ `NameDescriptionAgreement` และ ranking เท่านั้น ไม่แปลงเป็น
probability และไม่สามารถลบล้าง hard conflict

| Decision | Gate |
|---|---|
| `same_product` | no hard conflict, classified component ตรงกัน, normalized anchor ตรงกัน, score ≥ 90 และ cosine ≥ 0.90 |
| `variant_of` | no hard conflict, anchor/component ตรงกัน และต่างเฉพาะ variant/customization evidence |
| `review_required` | candidate มี semantic/graph support แต่ยังไม่ผ่าน deterministic same-product gate |
| `kept_separate` | hard conflict หรือ component ต่างกัน |
| `unclassified` | ไม่มี component/anchor evidence พอ |

ทุก `same_product` ใน P4 เป็น merge proposal เท่านั้น `autoMergeAllowed=false` จนกว่าจะมี
independent gold labels และ owner promotion แยกต่างหาก

## 7. Output artifacts

เขียน directory ใหม่เท่านั้น:

```text
data/catalog_embedding_candidate_resolution_v1/
  manifest.json
  candidate-pairs.jsonl
  resolutions.jsonl
  merge-groups.json
  review-queue.jsonl
  metrics.json
  checksums.sha256
```

`metrics.json` ต้องรายงาน input ProductMaster count, unique candidate-pair count,
decision counts, proposed merge-group count, proposed atomic count, review reduction,
hard-rule rejection count, score distribution และ input/output hashes

## 8. Safety and acceptance criteria

- baseline 425 ProductMasters และ source 1,016 offers ไม่ถูกแก้ไข
- input artifact hashes ตรงกับ selected E5 run manifest
- output deterministic: input/config เดิมให้ ordering, IDs และ hashes เดิม
- ทุก candidate pair เป็น unordered unique pair และไม่มี self-pair
- hard conflict ไม่สามารถมี decision `same_product` หรือ `variant_of`
- unclassified ProductMaster ไม่ถูก auto-merge
- merge groups ไม่มี product ซ้ำข้ามกลุ่ม
- ทุก resolution มี factor breakdown, hard rules, evidence และ lineage IDs
- รายงาน authoritative count `425` แยกจาก `proposedAtomicProductCount`
- test ครอบคลุมสี/branding, set component, component conflict, physical conflict,
  unclassified, pair deduplication และ deterministic replay
- ไม่มี production index refresh หรือ active graph mutation

## 9. Definition of Done

P4 พร้อมใช้เมื่อ runner สร้าง artifact ครบจาก selected E5 run, checksum ผ่าน, tests ผ่าน,
และ report ระบุจำนวน merge proposals/review queue จาก run จริงโดยไม่เรียกผลว่า production
truth ก่อน owner promotion

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | beta | Approved sidecar E5 ProductMaster candidate resolution, graph hard rules, merge proposals, and measurable acceptance gates | pending | ATHER |
