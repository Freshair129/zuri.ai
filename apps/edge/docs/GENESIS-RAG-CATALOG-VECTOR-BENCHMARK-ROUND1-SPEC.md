---
id: "GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-SPEC"
version: "0.7.0b"
created_at: "2026-08-23T08:35:00+07:00, ATHER"
last_update: "2026-08-23T11:40:57+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Round-1 local embedding benchmark and sidecar backfill comparing taxonomy projection and owner logic"
  parent: "GENESIS-RAG-TAXONOMY-PROJECTION-SPEC"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
  approval: "approved_for_benchmark_only"
  measurement_contract: "benchmark-measurement-v1"
---

# SmartGift Catalog — Vector Benchmark and Backfill Round 1

## 1. Purpose and boundary

สร้างชุดทดสอบ semantic retrieval รอบแรกจาก catalog จริง เพื่อวัดว่า embedding
สามารถหา `ProductMaster` ที่เกี่ยวข้องกับ `CatalogOffer` ได้หรือไม่ โดยเปรียบเทียบ
ลำดับการแยกข้อมูลที่มีอยู่แล้ว 2 รอบ:

1. **Round A — taxonomy projection:** ใช้
   `GENESIS-RAG-TAXONOMY-PROJECTION-SPEC.md` และผลใน
   `GENESIS-RAG-TAXONOMY-PROJECTION-REPORT.md`; ผลไม่ดีตาม owner review
2. **Round B — owner logic:** ใช้
   `GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-SPEC.md` และผลใน
   `GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-REPORT.md`; เป็น logic ที่ owner ปรับและ
   approve แล้ว แต่ยังเป็น `review_only`
3. **Round C — vector benchmark:** สร้าง embedding/backfill เป็นผลชุดใหม่เพื่อ
   เปรียบเทียบกับ Round A และ Round B

ทั้ง Round A และ Round B **ไม่มี embedding/vector**. `Luna 5.6` เป็นโมเดลที่ใช้
ช่วยเขียน/แก้สคริปต์เท่านั้น ไม่ใช่ embedding model และไม่ใช่ source ของ business
mapping

ผล Round C เก็บเป็น artifact ชุดใหม่และไม่เขียนทับ identity review เดิม,
owner-logic review เดิม, `family_v2`, active taxonomy หรือ Genesis serving store

รอบนี้เป็น **benchmark/reference projection** ไม่ใช่การอนุมัติให้ vector เป็นผู้ตัดสิน
การรวมสินค้า และไม่เปลี่ยน production retrieval path

## 2. Prior-round provenance and count contract

| Round | Logic/spec | Result snapshot | Key result | Vector |
|---|---|---|---|---|
| A | `taxonomy-p0-v1` + `GENESIS-RAG-TAXONOMY-PROJECTION-SPEC` | `GENESIS-RAG-TAXONOMY-PROJECTION-REPORT` | 845 families; taxonomy 611/222/12; 29 candidate categories | `not_built` |
| B | `catalog-user-logic-review-v1` + `GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-SPEC` | `GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-REPORT` | 427 atomic ProductMasters; 1,016 offers; 986 sets; 3,170 component links | `not_built` |
| C | this benchmark | new sidecar artifact | semantic candidates and backfill evidence | model below |

The reports in A and B are rule/projection results, not model-embedding results.
Their authoring/runtime provenance is:

| Field | Value |
|---|---|
| Script authoring model | `Luna 5.6` |
| Business mapping authority | versioned deterministic spec and owner logic |
| Embedding provider | none |
| Vector payload | `not_built` |

The pricing source and canonical identity counts used for the offer-level benchmark are:

| Layer | Round-1 contract | Meaning |
|---|---:|---|
| Raw pricing rows | 1,017 | Source rows ที่ผู้ใช้ระบุ |
| Canonical offers | 1,016 | unique source codes; `TPT11-7` มี duplicate row 1 แถว |
| Baseline ProductMaster | 425 | graph-native identity baseline used to bind the first cohort |
| Baseline classified reference | 370 | 43 auto + 327 review-required |
| Owner-mapped reference | 5 | `Wireless Earphone`, `Nail Clipper Box`, `Lighter`, `2026 Diary`, `Backpack` |
| Round-1 resolved view | **375** | 370 baseline + 5 owner mappings |
| Frozen baseline-unclassified view | **55** | original unclassified cohort retained for benchmark coverage |
| Unique baseline ProductMaster rows | **425** | five owner-mapped records overlap the original 55 |
| Remaining unclassified after owner mapping | 50 | current B projection after the five mappings |

ข้อสรุปนี้แยก `375 resolved` กับ `55 frozen baseline-unclassified` เป็นคนละมุมมอง
ของ reference set และเก็บ overlap 5 รายการด้วย `cohortMembership[]`; ห้ามสร้าง
ProductMaster ซ้ำเพียงเพื่อให้เลข 375 + 55 กลายเป็น 430

## 2.1 Experiment identity contract

ID ที่เป็นตัวตนของข้อมูลต้อง deterministic และไม่ใช้เวลารันเป็นส่วนหนึ่งของ
`datasetId`; ID ที่เป็นตัวตนของการทดลองต้องผูกกับ configuration และ model; ส่วน
`runId` ต้องเปลี่ยนทุกครั้งที่ execute จริง

| ID | รูปแบบ | อายุ/ความหมาย |
|---|---|---|
| `datasetId` | `DS1_SMARTGIFT_<SHA256(sourceManifest\|canonicalizationVersion)[:20]>` | dataset เดียวกันต้องเหมือนเดิมทุก replay |
| `datasetRevisionId` | `DSR1_<SHA256(datasetId\|cohortDefinitionVersion)[:20]>` | revision ของ cohort/label contract |
| `cohortId` | `COHORT_R1_<ALL_OFFERS\|RESOLVED_375\|UNCLASSIFIED_55\|SINGLE_30\|SET_986\|COMPONENT_3170>` | กลุ่มวัดผลที่ตายตัว |
| `logicRunId` | `LOGIC_A_TAXONOMY_<reportHash[:12]>`, `LOGIC_B_USER_<artifactHash[:12]>`, `LOGIC_C_VECTOR_<configHash[:12]>` | แยก logic Round A/B/C |
| `authoringModelId` | `AUTHMODEL1_LUNA_5_6` | โมเดลที่ช่วยสร้าง/แก้สคริปต์เดิม; ไม่ใช่ embedding model |
| `logicEvidenceId` | `EVIDENCE1_<specId>@<version>_<reportId>@<version>` | เอกสาร/ผลลัพธ์ที่ logic run อ้างอิง |
| `benchmarkId` | `BMR1_<datasetRevisionId[:12]>_<protocolVersion>_<configHash[:12]>` | ตัวตนของ benchmark configuration |
| `runId` | `RUN1_<benchmarkId[:12]>_<UTC_START_YYYYMMDDTHHMMSSZ>_<attemptNo>` | ตัวตนของการ execute จริง |
| `environmentId` | `ENV1_<SHA256(normalizedEnvironmentManifest)[:20]>` | เครื่อง/runtime/config ที่ใช้รัน |
| `modelId` | `MODEL1_<provider>_<modelName>_<revision[:12]>` | model ที่สร้าง embedding; ห้ามใช้ Luna แทน field นี้ |
| `embeddingSpaceId` | `SPACE1_<modelId[:12]>_<dimension>_<metric>_<normalization>` | vector space ที่เทียบกันได้เท่านั้น |
| `indexId` | `INDEX1_<embeddingSpaceId[:12]>_<corpusHash[:12]>_<indexType>` | index/corpus/config ชุดนั้น |
| `querySetId` | `QUERYSET1_<SHA256(cohort IDs\|query ordering)[:20]>` | ชุด query และลำดับที่วัด |
| `metricSetId` | `METRICS1_benchmark-measurement-v1` | สูตรและ version ของ metrics |
| `artifactId` | `ART1_<runId[:20]>_<artifactKind>` | ไฟล์ output แต่ละชนิด |

### Current preflight ID resolution

จาก source snapshot ที่ตรวจได้ ณ 2026-08-23 ก่อนเริ่ม vector run:

| Field | Current value |
|---|---|
| `datasetId` | `DS1_SMARTGIFT_2A40933922C181C2440C` |
| `datasetFingerprint` | `2A40933922C181C2440C352C25AB6FC66FBB58F094E287D801AB8B6B04789EF4` |
| `datasetRevisionId` | `DSR1_5921CC9447EA2EE8B125` (`cohort-definition-r1-v1`) |
| canonical snapshot | `5488a37eec8819bf1b744e0a2e6b09e7b7afe832dbcda99cba53ff14859bc8e0` |
| Round-A `logicRunId` | `LOGIC_A_TAXONOMY_9097E821B16B` |
| Round-B `logicRunId` | `LOGIC_B_USER_CD7ACF8D6B1F` |
| `authoringModelId` | `AUTHMODEL1_LUNA_5_6` |
| `LUNA_MODEL_ID` | `gpt-5.6-luna` |
| `SOL_MODEL_ID` | `gpt-5.6-sol` |
| Codex CLI probe | `codex-cli 0.147.0`, `SOL_PROBE_OK`, read-only/ephemeral |
| Round-C factorial `benchmarkId` | `BMR1_5921CC9447EA_authoring-factorial_238EBF5AB9B5` |
| Round-C factorial `environmentId` | `ENV1_0AADB8F22BFD673516B8` |
| Round-C selected GPU `runId` | `RUN1_BMR1_5921CC9447EA_ve_20260823T025634936Z_01` |
| Round-C factorial `runId` | `RUN1_BMR1_5921CC9447EA_au_20260823T031942000Z_01` |
| Round-C `modelId` | `MODEL1_HF_intfloat_multilingual_e5_small_614241f622f5`; LLM IDs `gpt-5.6-luna`, `gpt-5.6-sol` |
| Round-C selected GPU `environmentId` | `ENV1_A6A63ABE91F3F1F1E001` |
| Round-C `embeddingSpaceId` | `SPACE1_MODEL1_HF_in_384_cosine_l2` |
| Round-C `indexId` | `INDEX1_SPACE1_MODEL1_HF_in__40233A471F37_flat_exact` |

ค่าที่เหลือเป็น IDs ของ model sweep รอบถัดไปเท่านั้น; ห้ามใช้ค่าประมาณแทนผลจริง

`datasetId`, `datasetRevisionId`, `logicRunId`, `benchmarkId`, `environmentId`,
`modelId`, `embeddingSpaceId`, `indexId`, `querySetId`, `metricSetId` และ `runId`
ต้องปรากฏใน `manifest.json` และทุก row-level result ต้องมีอย่างน้อย `runId`,
`benchmarkId`, `datasetRevisionId`, `cohortId`, `querySetId`, `metricSetId`

## 2.2 Dataset and cohort manifest

`dataset-manifest.json` ต้องเก็บข้อมูลต่อไปนี้:

`datasetId` ต้องคำนวณจาก stable JSON ที่ sort key และ sort source/offer IDs แล้ว:

```json
{
  "schemaVersion": 1,
  "canonicalizationVersion": "catalog-family-v1",
  "sources": [
    {"role": "pricing", "sha256": "<pricing-sha>", "recordCount": 1017, "uniqueCodeCount": 1016},
    {"role": "semantic", "sha256": "<semantic-sha>", "recordCount": 994, "uniqueCodeCount": 994}
  ],
  "canonicalOfferIds": ["OFFER_<sorted all 1016 IDs>"]
}
```

แล้วใช้ `DS1_SMARTGIFT_` + SHA-256 ของ JSON นี้ 20 ตัวแรกเป็น `datasetId`.
จึงสามารถระบุ dataset ได้ก่อนรัน แต่ `environmentId`, `modelId`, `indexId` และ
`runId` จะถูกเติมด้วยค่าที่วัดได้จริงตอน execute

```json
{
  "datasetId": "DS1_SMARTGIFT_<content-hash>",
  "datasetRevisionId": "DSR1_<cohort-hash>",
  "sourceRows": 1017,
  "canonicalOffers": 1016,
  "productMasters": 425,
  "sourceFiles": [
    {"role": "pricing", "sha256": "...", "rows": 1017, "uniqueCodes": 1016},
    {"role": "semantic", "sha256": "...", "rows": 994, "uniqueCodes": 994}
  ],
  "cohorts": [
    {"cohortId": "COHORT_R1_RESOLVED_375", "count": 375, "labelStatus": "provisional"},
    {"cohortId": "COHORT_R1_UNCLASSIFIED_55", "count": 55, "labelStatus": "unclassified"}
  ]
}
```

`sourceRows`, `canonicalOffers`, `productMasters`, source SHA และ cohort membership
ต้องตรวจซ้ำก่อน encode; mismatch ให้หยุด run เป็น `preflight_failed` ไม่สร้าง partial
benchmark result

## 2.3 Environment manifest

`environmentId` คำนวณจาก normalized manifest โดยไม่ใส่ timestamp, absolute path,
secret, token หรือ raw hostname ลงใน hash input ที่เผยแพร่ รายการที่ต้องบันทึกคือ:

| Dimension | Required fields |
|---|---|
| Host | `hostFingerprint`, OS name/version, architecture, timezone |
| CPU/RAM | model class, logical cores, RAM total/available |
| GPU | vendor/model/VRAM/driver; ถ้าไม่มีให้ `null` และ `device=cpu` |
| Runtime | Node, npm, Python, PyTorch, sentence-transformers, NumPy/ONNX versions |
| Repository | repo ID, branch, commit SHA, `gitDirty`, script version |
| Model | `modelId`, revision SHA, tokenizer revision, precision, max sequence length |
| Execution | device, batch size, worker count, threads, seed, deterministic flags |
| Index | type, dimension, metric, normalization, `topK`, HNSW/Flat parameters |
| Config | normalized config hash; no credentials or raw `.env` values |

ถ้าค่าใดอ่านไม่ได้ ให้เก็บ `null` พร้อม `availability: "unavailable"`; ห้ามเดาเป็น 0
หรืออ้างว่า benchmark ครบถ้วน

## 2.4 Run lifecycle and timing

ทุกเวลาใช้ ISO-8601 UTC เป็น authority และเก็บ `timezone: Asia/Bangkok` สำหรับการอ่าน
รายงาน:

```json
{
  "runId": "RUN1_..._20260823T020000Z_01",
  "startedAt": "2026-08-23T02:00:00.000Z",
  "endedAt": "2026-08-23T02:04:12.531Z",
  "durationMs": 252531,
  "status": "completed",
  "stages": {
    "preflight": {"startedAt": "...", "endedAt": "...", "durationMs": 1000, "status": "passed"},
    "normalize": {"startedAt": "...", "endedAt": "...", "durationMs": 1000, "status": "passed"},
    "encode": {"startedAt": "...", "endedAt": "...", "durationMs": 120000, "status": "passed"},
    "index": {"startedAt": "...", "endedAt": "...", "durationMs": 30000, "status": "passed"},
    "retrieve_exact": {"startedAt": "...", "endedAt": "...", "durationMs": 1000, "status": "passed"},
    "retrieve_vector": {"startedAt": "...", "endedAt": "...", "durationMs": 5000, "status": "passed"},
    "retrieve_hybrid": {"startedAt": "...", "endedAt": "...", "durationMs": 6000, "status": "passed"},
    "evaluate": {"startedAt": "...", "endedAt": "...", "durationMs": 5000, "status": "passed"},
    "export": {"startedAt": "...", "endedAt": "...", "durationMs": 500, "status": "passed"}
  }
}
```

`runId` ใหม่ทุก attempt; retry ต้องเพิ่ม `attemptNo` และเก็บ `parentRunId` ถ้ามี
การรันเดิมซ้ำ ห้ามรวมเวลาหรือ metrics ข้าม run โดยไม่ระบุ aggregation method

## 3. Reference logic for round 1

ใช้ `catalog-user-logic-review-v1` เป็น reference label รอบ C และใช้
`taxonomy-v3-projection-v1` เป็น comparator ของ Round A. Graph-native identity เดิม
เป็น provenance/binding layer เท่านั้น; embedding ห้ามสร้าง label ใหม่เอง

ลำดับการตัดสิน:

1. normalize source text แบบ deterministic: Unicode NFKC, trim, whitespace และ
   separator normalization
2. bind source rows, `ProductMaster`, `CatalogOffer`, `PhysicalVariant` และ
   `CONTAINS_COMPONENT` จาก owner-logic artifact เป็น gold-like reference
3. ใช้ exact code/name/alias เป็น baseline leg
4. ใช้ embedding top-k เพื่อสร้าง semantic candidate pairs
5. ใช้ hard graph/business rules ตรวจซ้ำ
6. รายงาน `hit`, `review_required`, `hard_conflict`, `unclassified` โดยไม่ promote

Hard rules รอบนี้:

- Set offer ห้ามถูกจับคู่เป็น ProductMaster เดียวกับตัว Set เอง
- `CONTAINS_COMPONENT` เป็น positive binding ของ offer-to-component
- สี ขนาด วัสดุ รุ่น packaging และ customer branding เป็น evidence ของ variant,
  option หรือ customization ก่อนพิจารณา identity merge
- physical component, model, capacity หรือ construction conflict เป็น hard negative
- คะแนน vector สูงไม่สามารถลบล้าง hard conflict หรือสร้าง type ที่ไม่มี evidence ได้
- 55 baseline-unclassified ใช้ทดสอบ coverage/nearest candidate แต่ไม่นับเป็น
  precision/recall gold ถ้ายังไม่มี reference target ที่ยืนยันโดย owner

## 4. Embedding model contract

รอบแรกใช้ model เดียวเพื่อให้ผล replay และเปรียบเทียบได้ชัดเจน:

| Field | Round-1 value |
|---|---|
| Model | `intfloat/multilingual-e5-small` |
| Provider/runtime | local Python `sentence-transformers`; ไม่เรียก external API |
| Language target | Thai + English + mixed catalog text |
| Dimension | 384 |
| Metric | cosine similarity |
| Normalization | L2-normalize ทุก vector ก่อนเก็บ/ค้น |
| E5 prefix | query document ใช้ `query:`; corpus document ใช้ `passage:` |
| Revision | ต้องบันทึก Hugging Face commit SHA จริงใน manifest ตอน build |
| Runtime package | ต้องบันทึก Python, PyTorch, sentence-transformers version ใน manifest |

เหตุผลที่เลือก `multilingual-e5-small` เป็น P1 คือรองรับ Thai/English, reproducible,
ใช้ dimension 384 ซึ่งตรงกับ native vector schema ที่ตรวจพบ และเหมาะกับการวัด
baseline. `BAAI/bge-m3` เป็น P3 follow-up ที่ต้องสร้าง vector space และ sidecar
แยกต่างหาก เพราะมี dimension 1024; การทดสอบนี้ไม่เปลี่ยน native store เดิมโดยปริยาย
และไม่ใช้ Headless LLM เป็น embedding provider

## 4.1 Factorial model comparison

Round A/B เดิมไม่สามารถใช้ตอบว่า Luna หรือ Sol มีผล เพราะทั้งสองรอบเป็น deterministic
script execution และไม่มี LLM call ตอนแยกข้อมูล การวัดใหม่ต้องรัน model ที่ขั้นตอน
ตัดสินจริงด้วย prompt, evidence packet, candidate budget และ output schema เดียวกัน

| Arm ID | Language model ตอน execute | Embedding | Candidate source | จุดประสงค์ |
|---|---|---|---|---|
| `CTRL_RULE_TAXONOMY_A` | none | none | taxonomy rules | comparator Round A |
| `CTRL_RULE_USER_B` | none | none | owner rules | comparator Round B |
| `CTRL_LEXICAL_ONLY` | none | none | exact/lexical top-k | control ไม่มี model |
| `LLM_NOEMB_LUNA` | `LUNA_MODEL_ID` | none | exact/lexical bounded packet | วัด Luna ล้วน |
| `LLM_NOEMB_SOL` | `SOL_MODEL_ID` | none | exact/lexical bounded packet | วัด Sol ล้วน |
| `LLM_EMB_LUNA_E5S` | `LUNA_MODEL_ID` | `intfloat/multilingual-e5-small` | vector top-20 | วัด Luna + embedding |
| `LLM_EMB_SOL_E5S` | `SOL_MODEL_ID` | `intfloat/multilingual-e5-small` | vector top-20 | วัด Sol + embedding |
| `EMB_ONLY_E5S` | none | `intfloat/multilingual-e5-small` | vector top-20 | control embedding ไม่มี LLM |
| `EMB_ONLY_BGE_M3` | none | `BAAI/bge-m3` | vector top-20 | P3 embedding-only sweep |
| `LLM_EMB_LUNA_BGE_M3` | `LUNA_MODEL_ID` | `BAAI/bge-m3` | vector top-20 | P3 Luna + embedding |
| `LLM_EMB_SOL_BGE_M3` | `SOL_MODEL_ID` | `BAAI/bge-m3` | vector top-20 | P3 Sol + embedding |
| `EMB_ONLY_BGE_M3_OLLAMA` | none | `bge-m3:latest` via Ollama | vector top-20 | actual local runtime execution |

`LUNA_MODEL_ID` ใช้ `gpt-5.6-luna` ตาม `.env`. `SOL_MODEL_ID` ที่ resolve ผ่าน
Codex CLI คือ `gpt-5.6-sol`; ห้ามใช้ alias `sol` ใน benchmark manifest เพราะ CLI
รายงาน alias นี้เป็น unknown model. Probe ผ่าน `codex-cli 0.147.0`, provider `openai`,
และ `sandbox=read-only` แล้วเมื่อ 2026-08-23; actual benchmark ยังต้องบันทึก model
metadata/revision ที่ provider เปิดเผยได้

ใน arm ที่ไม่มี embedding ให้ใช้ exact/lexical candidate packet ที่ deterministic และ
มีขนาดเท่ากัน; ใน arm ที่มี embedding ให้เปลี่ยนเฉพาะ candidate source เป็น vector
top-20. LLM จะเห็น evidence schema เดียวกันและต้องตอบ JSON ที่ validate ได้เท่านั้น

## 4.2 Causal effect calculations

ให้ `M(arm, metric, cohort)` เป็นค่าของ metric เดียวกัน บน querySet และ environment
เดียวกัน:

```text
LLM_effect_no_embedding
  = M(LLM_NOEMB_LUNA) - M(LLM_NOEMB_SOL)

Embedding_lift_Luna
  = M(LLM_EMB_LUNA_E5S) - M(LLM_NOEMB_LUNA)

Embedding_lift_Sol
  = M(LLM_EMB_SOL_E5S) - M(LLM_NOEMB_SOL)

Model_embedding_interaction
  = (M(LLM_EMB_LUNA_E5S) - M(LLM_NOEMB_LUNA))
  - (M(LLM_EMB_SOL_E5S) - M(LLM_NOEMB_SOL))
```

คำนวณสูตรนี้แยกทุกมิติ ไม่ใช่เฉพาะ accuracy: retrieval quality, identity/set quality,
unclassified coverage, latency, throughput, resource, cost, variance และ replay
determinism. สำหรับ LLM ที่อาจมี stochastic behavior ให้รัน arm เดียวกันอย่างน้อย 3
ครั้งด้วย `seed` และ generation config เดียวกัน แล้วรายงาน mean, standard deviation,
min/max และ 95% CI แยกจาก single-run latency

## 4.3 Embedding model sweep

หลัง causal run ของ E5-small ให้ทดสอบ embedding space แยกกัน ห้ามนำ vector คนละ
dimension/model มาปน index เดียวกัน:

| Priority | Model | Dimension | เหมาะสำหรับ |
|---:|---|---:|---|
| P1 | `intfloat/multilingual-e5-small` | 384 | baseline Thai/English และตรง native schema ที่พบ |
| P2 | `intfloat/multilingual-e5-base` | 768 | quality uplift เทียบ latency/หน่วยความจำ |
| P3 | `BAAI/bge-m3` | 1024 | multilingual quality baseline ตาม Genesis benchmark เดิม |
| P4 | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | 384 | lightweight alternative |

Model sweep ต้องสร้าง `modelId`, revision SHA, `embeddingSpaceId`, `indexId` และ
artifact แยกต่อ model. สำหรับ P3 รอบนี้รัน `EMB_ONLY_BGE_M3`,
`LLM_EMB_LUNA_BGE_M3` และ `LLM_EMB_SOL_BGE_M3` บน corpus/query/metric เดียวกับ
P1 เพื่อวัดทั้ง retrieval และผลจาก language model โดยตรง

ไม่มีการใช้ `Luna 5.6` หรือ `Sol` เป็น embedding provider. ทั้งสองเป็น language-model
factor; embedding เป็น model factor แยกต่างหากและต้องบันทึก runtime/version จริง

## 5. Embedding documents

สร้างเอกสาร 2 ระดับ:

1. `product_master`: 425 records ครอบคลุม 375 resolved view และ 55 frozen
   baseline-unclassified view พร้อม `cohortMembership[]`
2. `catalog_offer`: 1,016 records ครบทุก canonical offer รวม single และ set

ข้อความที่ embed ใช้เฉพาะ field ที่อนุมัติ:

```text
code | name | englishName | category | description | branding
```

ห้ามใส่ `productId`, `offerId`, score, decision, status, source hash หรือข้อความ
จาก chat ลงใน embedding text เพราะจะทำให้ benchmark รั่ว label และวัดความหมายผิด

สำหรับ set ให้เก็บ `offerKind=set`, component IDs และ description เป็น metadata/graph
evidence; ไม่เอา ProductMaster ID ของ component ไปต่อท้าย text

## 6. Stable ID and lineage contract

ทุก record ต้องผูกกลับได้ถึง source row และ graph relation:

| ID | Construction | Purpose |
|---|---|---|
| `snapshotId` | canonical catalog manifest fingerprint | ระบุชุดข้อมูลทั้งรอบ |
| `sourceRowId` | `SRCROW_<ROLE>_<SHA256(stable raw row)>` | ผูก raw row ทุกแถว รวม duplicate |
| `offerId` | existing `OFFER_<UPPER_SOURCE_CODE>` | canonical SKU/offer |
| `productId` | existing owner/identity stable ID | ProductMaster authority ของ reference |
| `physicalVariantId` | existing variant ID | ผูกสี/ขนาด/วัสดุ/packaging |
| `componentLinkId` | existing directed edge ID | ผูก Set → component พร้อม quantity/position |
| `benchmarkRecordId` | `VBR1_<KIND>_<SHA256(snapshotId\|nativeId)>` | ID ของ row ใน benchmark |
| `textHash` | SHA-256 ของ normalized embedding text | ตรวจ text drift |
| `embeddingId` | `EMB1_<SHA256(modelId\|revision\|recordId\|textHash)>` | ผูก vector กับ model และ document |
| `candidatePairId` | `PAIR1_<SHA256(queryEmbeddingId\|candidateEmbeddingId)>` | ผูกผล top-k แต่ละคู่ |
| `decisionId` | `DEC1_<SHA256(candidatePairId\|ruleVersion)>` | ผูกผล deterministic rule |

ทุก embedding record ต้องมีอย่างน้อย `snapshotId`, `logicRunId`, `benchmarkRecordId`, `embeddingId`,
`documentKind`, `nativeId`, `sourceRowIds`, `offerIds`, `productIds`, `textHash`,
`modelId`, `modelRevision`, `dimension`, `metric` และ `createdAt`. `logicRunId` ต้องชี้
กลับไปยัง `taxonomy-v3-projection-v1`, `catalog-user-logic-review-v1` หรือ
`vector-benchmark-round1-v1` ตาม record นั้น

กรณี duplicate `TPT11-7`: source row สองแถวต้องมี `sourceRowId` คนละค่า แต่ชี้ไปที่
`offerId` เดียวกัน และห้ามสร้าง embedding/canonical ProductMaster ซ้ำโดยไม่มีเหตุผล

## 7. Benchmark protocol

สำหรับแต่ละ `CatalogOffer`:

1. embed offer เป็น query vector
2. ค้น ProductMaster corpus แบบ exact baseline และ cosine top-20
3. ตรวจ target product IDs จาก direct `OFFERS` หรือ `CONTAINS_COMPONENT`
4. บันทึก rank, cosine score, target hit, hard-rule result และ reason
5. สำหรับ set วัด component recall แยกจาก set identity
6. สำหรับ unclassified บันทึก nearest candidates และ coverage แยก ไม่ให้เป็น false
   negative ของ model

Metrics ที่ต้องรายงาน:

- `Recall@1`, `Recall@5`, `Recall@10`, `MRR` สำหรับ resolved 375 reference view
- `componentRecall@k` สำหรับ set offers
- `hardConflictRate` และ `falseMergeCandidateRate`
- `unclassifiedCoverage` สำหรับ frozen 55
- exact baseline เทียบกับ vector top-k และ hybrid rule result
- build time, encode time, query time และ artifact byte/hash

รอบนี้ยังไม่กำหนด production threshold จากผล benchmark เพียงครั้งเดียว คะแนนใช้
เพื่อจัด candidate/review เท่านั้น:

```text
hard conflict              -> kept_separate_by_rule
target in top-k             -> semantic_hit
ไม่พบ target แต่มี evidence  -> review_required
ไม่มี target/evidence       -> unclassified
```

## 7.1 Measurement matrix

ทุก metric ต้องมี schema เดียวกัน:

```json
{
  "metricId": "MET_QUALITY_RECALL_AT_10",
  "metricSetId": "METRICS1_benchmark-measurement-v1",
  "runId": "RUN1_...",
  "cohortId": "COHORT_R1_RESOLVED_375",
  "querySetId": "QUERYSET1_...",
  "method": "vector_only",
  "status": "measured",
  "value": 0.0,
  "unit": "ratio",
  "numerator": 0,
  "denominator": 0,
  "calculationVersion": "benchmark-measurement-v1",
  "confidenceInterval": null,
  "evidence": []
}
```

ค่าที่ไม่มีหลักฐานต้องใช้ `status=unavailable` หรือ `status=not_applicable` พร้อม
`reason`; ห้ามใส่ `0` แทนค่าที่ไม่ได้วัด

| Dimension | Metrics ที่ต้องวัด | Breakdown/cohort |
|---|---|---|
| Dataset integrity | source row count, unique code count, duplicate count, missing-field rate, source-lineage coverage, ID completeness, hash verification | all source files, all 1,016 offers |
| Label/reference coverage | resolved count, frozen-unclassified count, overlap count, target coverage, ambiguous-target rate | 375, 55, 425 ProductMasters |
| Retrieval quality | `Recall@1/5/10`, `Precision@1/5/10`, hit rate, MRR, MAP, nDCG@5/10 | exact, vector-only, hybrid; resolved 375 |
| Identity quality | pairwise precision/recall/F1, B-cubed precision/recall/F1, same-product candidate rate, false-merge candidate rate | variant/branding/packaging vs physical conflict |
| Set/component quality | component `Recall@1/5/10`, component precision, quantity accuracy, position accuracy, set-self false-match rate | 986 sets, 3,170 component links |
| Unclassified behavior | nearest-candidate coverage, abstention rate, unresolved rate, unclassified false-positive rate | frozen 55 and unclassified offers |
| Taxonomy comparison | type/category agreement, parent/subtype agreement, Round-A → Round-B changed count, vector suggestion agreement | Round A, Round B, Round C |
| Ranking/calibration | score distribution, threshold curve, precision-recall curve, ROC-AUC where binary labels exist, Brier/ECE only if score is treated as probability | per cohort and method |
| Error analysis | top error pairs, hard-rule violations, language bucket, missing description, material/size/model conflict, set/component confusion | Thai, English, mixed; single/set |
| Latency | preflight, normalize, encode, index build, exact query, vector query, hybrid query, evaluation, export; p50/p95/p99 and max | cold vs warm, per stage |
| Throughput | records/sec, vectors/sec, queries/sec, candidates/sec | encode, index, retrieval |
| Resource | peak RSS, CPU time/utilization, RAM peak, GPU utilization/VRAM if available, index bytes, vector bytes, artifact bytes | per stage and total |
| Reproducibility | output hash equality, ID/order equality, model/revision match, config/environment match, replay delta | replay run pair |
| Governance/safety | source mutation, old-artifact mutation, active-store mutation, secret leakage scan, snapshot mismatch handling, partial-output handling | preflight and export |
| Operational cost | model load/download bytes, disk growth, retry count, failed stage count, manual review count | per run; unavailable if telemetry absent |

## 7.2 Statistical and comparison rules

- รายงานทุกวิธีใน query order เดียวกัน: `exact_baseline`, `taxonomy_round_a`,
  `user_logic_round_b`, `vector_only`, `hybrid_graph_vector`
- รายงาน `delta_vs_round_a`, `delta_vs_round_b` และ `delta_vs_exact` แบบ paired ต่อ
  query เดียวกัน ไม่ใช้ค่าเฉลี่ยจากคนละชุดข้อมูลมาเทียบกัน
- สำหรับ metric ที่เป็นอัตราส่วน ให้เก็บ numerator/denominator และคำนวณ 95% CI ด้วย
  deterministic bootstrap `1,000` resamples, seed `20260823`; ถ้ากลุ่มไม่มี target ให้
  `not_applicable`
- ระบุ `referenceLabelStatus=provisional_owner_reference`; ผลจาก 375 ยังไม่ใช่
  independent gold set และห้ามเรียกว่า production precision/recall
- แยก cold run กับ warm run; ห้ามนำ model-load/index-build time ไปปน query latency
- metric ทุกตัวต้องมี `availability` และ `evidence` เพื่อบอกว่าวัดจาก counter, file,
  process timer หรือ inference runtime

## 7.3 Fixed test protocol

สร้าง query set แบบไม่มีการสุ่มเพื่อให้ทุกวิธีเห็น query เดียวกัน:

```text
QUERYSET_R1_ALL_OFFERS_1016
  ├─ QUERYSET_R1_RESOLVED_375
  ├─ QUERYSET_R1_UNCLASSIFIED_55
  ├─ QUERYSET_R1_SINGLE_30
  ├─ QUERYSET_R1_SET_986
  └─ QUERYSET_R1_COMPONENTS_3170
```

การวัดหลักเป็น catalog retrieval ไม่ใช่ model generalization; จึงต้องระบุ corpus
construction ในผลทุกครั้ง และควรมี secondary masked run ที่ไม่ใส่ source offer text
ซ้ำใน ProductMaster document เพื่อเปิดเผย leakage:

- `closed_catalog`: ใช้ ProductMaster document เต็มสำหรับ operational recall
- `masked_holdout`: ตัด source-specific offer text ออกจาก document ที่เป็น target ของ
  query นั้น แล้ววัด semantic generalization แยก

ถ้า masked run ทำไม่ได้เพราะไม่มี field แยก source ให้ระบุ `status=unavailable` และ
เหตุผล ไม่อนุมานว่า closed-catalog score เป็น generalization score

## 8. Backfill artifacts

เขียนใน directory ใหม่เท่านั้น:

```text
data/catalog_vector_benchmark_round1_v1/
  manifest.json
  dataset-manifest.json
  environment-manifest.json
  run-manifest.json
  documents.jsonl
  embeddings.f32.bin
  candidate-links.jsonl
  benchmark-results.jsonl
  metrics.jsonl
  error-analysis.jsonl
  checksums.sha256
docs/GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-REPORT.md
```

`manifest.json` ต้องระบุทุก identity ID ใน §2.1, source SHA, snapshot ID, model
revision, dimension, metric, counts, rule version, code version, start/end time,
stage timing, metric availability และ hashes ของทุก artifact

ผลนี้ไม่เขียนเข้า `data/catalog_identity_review_v1`,
`data/catalog_identity_review_user_logic_v1` หรือ active Genesis store จนกว่าจะผ่าน
benchmark acceptance และได้รับ approval สำหรับ vector index refresh แยกต่างหาก

## 9. Acceptance gates

- source rows = 1,017 และ canonical offers = 1,016
- มี `datasetId`, `datasetRevisionId`, `logicRunId`, `benchmarkId`, `runId`,
  `environmentId`, `modelId`, `embeddingSpaceId`, `indexId`, `querySetId` และ
  `metricSetId` ครบใน manifest และ row-level results
- มี `startedAt`, `endedAt`, `durationMs` ของ run และทุก stage; `endedAt` ต้องไม่น้อยกว่า
  `startedAt`
- environment manifest ระบุ runtime/hardware/model/config และ hash โดยไม่เปิดเผย secret
- Round A ต้องอ้างอิง taxonomy projection report ที่ระบุ 845 families,
  taxonomy 611/222/12 และ vector `not_built`
- Round B ต้องอ้างอิง owner-logic report ที่ระบุ 427 ProductMasters,
  1,016 offers และ vector `not_built`
- Round A/B ห้ามถูกอ้างเป็นหลักฐานว่า Luna หรือ Sol ถูก execute ตอนแยกข้อมูล
- ทุก LLM arm ใช้ exact model ID, provider, revision, prompt hash, output schema,
  seed และ generation config; `SOL_MODEL_ID` ไม่อาจคงเป็น alias `Sol`
- อย่างน้อยต้องมีผลครบ `LLM_NOEMB_LUNA`, `LLM_NOEMB_SOL`,
  `LLM_EMB_LUNA_E5S`, `LLM_EMB_SOL_E5S` และ controls ก่อนสรุป model effect
- ทุก embedding model ต้องอยู่คนละ `embeddingSpaceId` และห้ามใช้ vector ข้าม dimension
- ProductMaster unique = 425; reference view = 375 resolved + 55 frozen baseline
  unclassified; overlap = 5; remaining unclassified after mapping = 50
- ระบุ `Luna 5.6` เป็น script-authoring model แยกจาก embedding model อย่างชัดเจน
- ทุก canonical offer มี `offerId`, source row lineage และ benchmark record
- ทุก ProductMaster มี `productId`, cohort membership และ benchmark record
- ทุก vector มี model revision, dimension 384, cosine/L2 normalization และ text hash
- duplicate source code ไม่ทำให้เกิด duplicate canonical offer/vector identity
- ทุก candidate pair ผูกกลับถึง query/candidate embedding และ graph target
- replay เดิมสร้าง IDs, ordering, counts และ hashes เดียวกัน
- metrics ทุกตัวมี `metricId`, `status`, `value`/`reason`, numerator/denominator เมื่อใช้ได้,
  cohort, method, evidence และ calculation version
- รายงานแยก cold/warm, latency/throughput/resource, quality/error, integrity,
  reproducibility และ governance dimensions
- old identity artifact และ owner-logic artifact ไม่ถูกเขียนทับ
- รายงานแยก benchmark evidence ออกจาก owner reference label และไม่อ้าง production
  precision/recall ก่อนมี manual golden-set confirmation

## 10. Approval boundary

เอกสารนี้เสนอการสร้าง local benchmark และ sidecar backfill เท่านั้น ไม่อนุมัติให้
เปลี่ยน active retrieval, เปิดใช้ vector ใน answer path, เปลี่ยน native store dimension,
หรือให้ embedding รวม ProductMaster อัตโนมัติ

## 10.1 Execution evidence (2026-08-23)

รันจริงแล้วตาม contract โดยเก็บผลแยกใน sidecar directory ใหม่:

- `LLM_NOEMB_LUNA`, `LLM_NOEMB_SOL`, `LLM_EMB_LUNA_E5S` และ
  `LLM_EMB_SOL_E5S` ส่ง `55/55` records และผ่าน schema validation
- selected GPU `EMB_ONLY_E5S` encode `1,441` vectors ใน `14.317s` บน RTX 3060;
  CPU comparison ใช้ `120.185s`
- corrected vector input SHA-256:
  `632E1C32B4B8F7B5B82F31C83C614D9C0008FB83E3D3433F86606488D3D33CB1`
- E5-small revision:
  `614241f622f53c4eeff9890bdc4f31cfecc418b3`
- quality/causal details อยู่ใน
  `GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-REPORT.md`

การทดสอบ P3 `BAAI/bge-m3` เป็น follow-up run แยก vector space จาก P1 โดยใช้
Ollama model `bge-m3:latest`, dimension 1024, model-specific text contract และ
GPU เดียวกัน; execute เสร็จแล้วและบันทึก identity/lineage ครบ:

| Field | Actual value |
|---|---|
| `benchmarkId` | `BMR1_5921CC9447EA_vector-benchmark-round1-ollama-v1_291C1B3F485E` |
| `runId` | `RUN1_BMR1_5921CC9447EA_ve_20260823T041000389Z_01` |
| `environmentId` | `ENV1_2A2F1427CD826CD7A6AC` |
| `modelId` | `MODEL1_OLLAMA_bge_m3_latest_790764642607` |
| model revision/digest | `7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab` |
| `embeddingSpaceId` | `SPACE1_MODEL1_OLLAM_1024_cosine_l2` |
| `indexId` | `INDEX1_SPACE1_MODEL1_OLLAM__40233A471F37_flat_exact` |
| started / ended | `2026-08-23T04:10:00.389Z` / `2026-08-23T04:10:45.454Z` |
| vector input SHA-256 | `632E1C32B4B8F7B5B82F31C83C614D9C0008FB83E3D3433F86606488D3D33CB1` |
| BGE compact authoring input SHA-256 | `D20D5D213AC644801A28F1F2196895097ECBC13CBA9A286D01B128D2512D1E0B` |

ผล vector-only คือ resolved Recall@10 `83.18%`, component Recall@10 `47.92%`,
และ `111` target-not-in-top-20 errors; E5-small ได้ `92.24%`, `58.69%` และ `40`
ตามลำดับบน contract เดียวกัน. Factorial BGE ใช้
`BMR1_5921CC9447EA_authoring-factorial_1485E362F314`,
`RUN1_BMR1_5921CC9447EA_au_20260823T042410225Z_01` และ
`ENV1_3E5CB8DC183B7DF11156`; Luna + BGE actionable `98.18%`, Sol + BGE `92.73%`.

สำหรับ execution นี้ `modelId` ต้องอ้างอิง Ollama model digest จริง ไม่ใช้ชื่อ
Hugging Face แทน provider; runner ใช้ `POST /api/embed` บน local Ollama server,
ส่ง raw Thai/English text ตาม BGE-M3 contract และเก็บ `ollamaVersion`, `modelDigest`,
`device`, `processor` และ endpoint status ใน environment manifest

ผลนี้ยังไม่อนุมัติ production index refresh, label promotion หรือ ProductMaster
overwrite. Attempt ที่ถูกยกเลิกเพราะ oversized candidate packet ไม่รวมใน metrics;
transient CLI logs ที่ซ้ำ raw source evidence ถูกลบหลังตรวจสอบ และใช้เฉพาะ compact
stdin attempt ที่ผ่าน validation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.7.0b | 2026-08-23 | beta | Recorded completed BGE-M3/Ollama execution identity, timings, checksums, and E5 comparison evidence | pending | ATHER |
| 0.6.0b | 2026-08-23 | beta | Bound P3 BGE-M3 execution to local Ollama runtime and digest-backed 1024-dim vector space | pending | ATHER |
| 0.5.0b | 2026-08-23 | beta | Added BGE-M3 P3 follow-up arms and separate 1024-dim vector-space execution contract | pending | ATHER |
| 0.4.0b | 2026-08-23 | beta | Executed four-arm Luna/Sol factorial, E5-small GPU vector run, IDs, timings, and acceptance evidence | pending | ATHER |
| 0.3.1b | 2026-08-23 | candidate | Resolved Sol through Codex CLI as gpt-5.6-sol and recorded bounded probe evidence | pending | ATHER |
| 0.3.0b | 2026-08-23 | candidate | Added Luna/Sol factorial arms, causal effect formulas, and embedding model sweep | pending | ATHER |
| 0.2.0b | 2026-08-23 | candidate | Added dataset, cohort, environment, run/timing IDs and multidimensional measurement contract | pending | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Proposed Round-1 embedding benchmark, lineage IDs, model contract, and sidecar backfill boundary | pending | ATHER |
