---
id: "GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-REPORT"
version: "0.2.0b"
created_at: "2026-08-23T10:29:33+07:00, ATHER"
last_update: "2026-08-23T11:37:18+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Round-1 local catalog authoring and embedding benchmark"
  spec: "GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-SPEC@0.7.0b"
  risk: "HIGH"
  production_decision: "not_approved"
---

# SmartGift Catalog — Vector Benchmark Round 1 Report

## สรุปผล

รอบทดสอบนี้ตอบคำถามได้แล้วว่า **โมเดลภาษาและ embedding มีผลต่อผลการแยกจริง** แต่
ผลที่วัดได้ยังเป็น candidate/review evidence ไม่ใช่ accuracy สำหรับ production เพราะ
กลุ่ม 55 รายการยังไม่มี gold label อิสระครบทุกแถว

- `Luna` กับ `Sol` ให้ผลต่างกันแม้ใช้ input และ prompt เดียวกันโดยไม่มี embedding:
  decision ตรงกัน `47/55 = 85.45%` แต่ decision + `typeId` ตรงกันเพียง
  `27/55 = 49.09%`
- no-embedding actionable coverage: Luna `53/55 = 96.36%`, Sol
  `51/55 = 92.73%`
- เมื่อเพิ่ม `multilingual-e5-small` เป็น vector candidate source: Luna
  `54/55 = 98.18%`, Sol `53/55 = 96.36%` ในมิติ actionable coverage เท่านั้น
  ไม่ใช่ accuracy
- GPU ทำให้ encode `1,441` vectors จาก `120.185s` บน CPU เหลือ `14.317s` บน
  RTX 3060 หรือประมาณ `6.96x` เร็วขึ้น
- `bge-m3:latest` ผ่าน Ollama `0.32.15` และ `/api/embed` ใช้ GPU ได้จริง
  (1,024d; encode `44.086s`) แต่คุณภาพ vector-only ต่ำกว่า E5-small ใน corpus นี้:
  resolved Recall@10 `83.18%` เทียบกับ `92.24%` และ component Recall@10
  `47.92%` เทียบกับ `58.69%`
- ใน factorial รอบ BGE, Luna + BGE ได้ actionable `98.18%` เท่ากับ Luna + E5,
  แต่ Sol + BGE ได้ `92.73%` ต่ำกว่า Sol + E5 ที่ `96.36%`; ความสอดคล้องที่เพิ่มขึ้น
  ไม่ใช่หลักฐานว่า label ถูกต้อง
- แขน authoring ทั้ง 6 แขนผ่าน output schema และส่ง `55/55` records ครบ ไม่มี invented หรือ
  duplicate `productId`

ข้อควรระวังที่สำคัญที่สุดคือ ทั้ง no-embedding และ embedding-assisted ยังให้
`decision=classified` กับ owner-mapped 5 รายการ แม้ owner reference กำหนด
`review_required` ทั้ง 5 รายการ ดังนั้น model มีแนวโน้ม classify ต่อแม้ evidence
ควรส่ง review และยังไม่ควรนำ output ไปเขียนทับ ProductMaster/Graph

## ขอบเขตและ provenance

| Layer | ค่าในรอบนี้ |
|---|---:|
| Raw pricing rows | 1,017 |
| Canonical offers | 1,016 |
| Baseline ProductMasters | 425 |
| Resolved ProductMasters | 375 |
| Frozen baseline-unclassified ProductMasters | 55 |
| Owner component links | 3,170 |
| Vector corpus | 425 ProductMaster documents |
| Vector queries | 1,016 CatalogOffer documents |
| Embedding P2 | `intfloat/multilingual-e5-small`, 384d, cosine, L2 |
| Embedding P3 | `bge-m3:latest` via Ollama `/api/embed`, 1,024d, cosine, L2 |

Round A (`GENESIS-RAG-TAXONOMY-PROJECTION`) และ Round B
(`GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW`) เป็น deterministic projection/review
และ **ไม่มี embedding**. `Luna 5.6` ในสองรอบเดิมเป็น script-authoring model ไม่ใช่
runtime decision model. ตารางด้านล่างเป็นการรันใหม่ผ่าน Codex CLI เพื่อวัด model factor
โดยตรง:

| Arm | Runtime model | Embedding | Input |
|---|---|---|---|
| `LLM_NOEMB_LUNA` | `gpt-5.6-luna` | none | 55 baseline-unclassified |
| `LLM_NOEMB_SOL` | `gpt-5.6-sol` | none | ชุดเดียวกัน |
| `LLM_EMB_LUNA_E5S` | `gpt-5.6-luna` | E5-small vector top-20 | ชุดเดียวกัน + compact candidates |
| `LLM_EMB_SOL_E5S` | `gpt-5.6-sol` | E5-small vector top-20 | ชุดเดียวกัน + compact candidates |
| `LLM_EMB_LUNA_BGE_M3` | `gpt-5.6-luna` | BGE-M3 via Ollama vector top-20 | ชุดเดียวกัน + compact candidates |
| `LLM_EMB_SOL_BGE_M3` | `gpt-5.6-sol` | BGE-M3 via Ollama vector top-20 | ชุดเดียวกัน + compact candidates |
| `EMB_ONLY_E5S` | none | E5-small vector top-20 | 1,016 offers → 425 PMs |
| `EMB_ONLY_BGE_M3_OLLAMA` | none | BGE-M3 via Ollama vector top-20 | 1,016 offers → 425 PMs |

## Experiment IDs

| Identity | Value |
|---|---|
| `datasetId` | `DS1_SMARTGIFT_2A40933922C181C2440C` |
| `datasetRevisionId` | `DSR1_5921CC9447EA2EE8B125` |
| canonical snapshot | `5488a37eec8819bf1b744e0a2e6b09e7b7afe832dbcda99cba53ff14859bc8e0` |
| `dataset inputId` | `AINPUT1_CC7B421F4F669F5F69F4` |
| `vector inputId` | `VINPUT1_D3329F661F9EDB19059B` |
| embedding authoring inputId | `AINPUT1_EMB_3A2216FE97905B19E32B` |
| BGE-M3 embedding authoring inputId | `AINPUT1_EMB_AA9CB0C58D5C998942A4` |
| `querySetId` | `QUERYSET1_BD6DE65E9ED470E377A3` |
| metric set | `METRICS1_benchmark-measurement-v1` |
| no-embedding benchmark | `BMR1_5921CC9447EA_authoring-factorial_FDFA18DA8033` |
| four-arm factorial benchmark | `BMR1_5921CC9447EA_authoring-factorial_238EBF5AB9B5` |
| four-arm run | `RUN1_BMR1_5921CC9447EA_au_20260823T031942000Z_01` |
| four-arm environment | `ENV1_0AADB8F22BFD673516B8` |
| E5-small vector run | `RUN1_BMR1_5921CC9447EA_ve_20260823T025634936Z_01` |
| E5-small environment | `ENV1_A6A63ABE91F3F1F1E001` |
| E5-small model | `MODEL1_HF_intfloat_multilingual_e5_small_614241f622f5` |
| E5-small revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| E5-small embedding space | `SPACE1_MODEL1_HF_in_384_cosine_l2` |
| E5-small vector index | `INDEX1_SPACE1_MODEL1_HF_in__40233A471F37_flat_exact` |
| BGE-M3 Ollama vector run | `RUN1_BMR1_5921CC9447EA_ve_20260823T041000389Z_01` |
| BGE-M3 Ollama benchmark | `BMR1_5921CC9447EA_vector-benchmark-round1-ollama-v1_291C1B3F485E` |
| BGE-M3 Ollama environment | `ENV1_2A2F1427CD826CD7A6AC` |
| BGE-M3 Ollama model | `MODEL1_OLLAMA_bge_m3_latest_790764642607` |
| BGE-M3 model revision | `7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab` |
| BGE-M3 embedding space | `SPACE1_MODEL1_OLLAM_1024_cosine_l2` |
| BGE-M3 vector index | `INDEX1_SPACE1_MODEL1_OLLAM__40233A471F37_flat_exact` |
| BGE-M3 factorial benchmark | `BMR1_5921CC9447EA_authoring-factorial_1485E362F314` |
| BGE-M3 factorial run | `RUN1_BMR1_5921CC9447EA_au_20260823T042410225Z_01` |
| BGE-M3 factorial environment | `ENV1_3E5CB8DC183B7DF11156` |

The current vector input artifact hash is
`632E1C32B4B8F7B5B82F31C83C614D9C0008FB83E3D3433F86606488D3D33CB1`.
The embedding input hash is
`E9AAB888B60715F32BCF9D73133BB32945C52182BAA8ABAEFA620E755F549747`.
The BGE-M3 compact authoring input hash is
`D20D5D213AC644801A28F1F2196895097ECBC13CBA9A286D01B128D2512D1E0B`.

## LLM factorial results

| Arm | classified | review | unclassified | actionable | exact owner `typeId` agreement (n=5) |
|---|---:|---:|---:|---:|---:|
| Luna, no embedding | 44 | 9 | 2 | 96.36% | 0/5 |
| Sol, no embedding | 42 | 9 | 4 | 92.73% | 0/5 |
| Luna + E5-small | 47 | 7 | 1 | 98.18% | 1/5 |
| Sol + E5-small | 52 | 1 | 2 | 96.36% | 0/5 |
| Luna + BGE-M3 (Ollama) | 49 | 5 | 1 | 98.18% | 1/5 |
| Sol + BGE-M3 (Ollama) | 51 | 0 | 4 | 92.73% | 1/5 |

`actionable` หมายถึง `classified + review_required`; ใน 50 รายการที่ไม่มี independent
gold ค่า metric นี้บอก coverage/abstention behavior เท่านั้น ไม่บอก correctness.

### Pairwise and causal reading

| Comparison | Decision agreement | Type agreement | Joint agreement |
|---|---:|---:|---:|
| Luna no-emb vs Sol no-emb | 47/55 (85.45%) | 30/55 (54.55%) | 27/55 (49.09%) |
| Luna + E5-small vs Sol + E5-small | 49/55 (89.09%) | 24/55 (43.64%) | 21/55 (38.18%) |
| Luna no-emb vs Luna + E5-small | 51/55 (92.73%) | 39/55 (70.91%) | 36/55 (65.45%) |
| Sol no-emb vs Sol + E5-small | 44/55 (80.00%) | 38/55 (69.09%) | 31/55 (56.36%) |
| Luna + BGE-M3 vs Sol + BGE-M3 | 50/55 (90.91%) | 38/55 (69.09%) | 36/55 (65.45%) |
| Luna no-emb vs Luna + BGE-M3 | 47/55 (85.45%) | 42/55 (76.36%) | 36/55 (65.45%) |
| Sol no-emb vs Sol + BGE-M3 | 45/55 (81.82%) | 43/55 (78.18%) | 37/55 (67.27%) |
| Luna + E5-small vs Luna + BGE-M3 | 49/55 (89.09%) | 39/55 (70.91%) | 33/55 (60.00%) |
| Sol + E5-small vs Sol + BGE-M3 | 53/55 (96.36%) | 35/55 (63.64%) | 34/55 (61.82%) |

Using `M = actionable coverage` on the same 55-row query set:

```text
LLM_effect_no_embedding = 96.36% - 92.73% = +3.64 pp (Luna - Sol)
Embedding_lift_Luna     = 98.18% - 96.36% = +1.82 pp
Embedding_lift_Sol      = 96.36% - 92.73% = +3.64 pp
Interaction              = +1.82 pp - +3.64 pp = -1.82 pp

Embedding_lift_Luna_BGE = 98.18% - 96.36% = +1.82 pp
Embedding_lift_Sol_BGE  = 92.73% - 92.73% = +0.00 pp
Luna_E5_vs_BGE          = 98.18% - 98.18% = +0.00 pp
Sol_E5_vs_BGE           = 92.73% - 96.36% = -3.64 pp
```

For `classified` rate specifically, E5-small lifted Luna from `80.00%` to `85.45%`
(`+5.45 pp`) and Sol from `76.36%` to `94.55%` (`+18.18 pp`). This is a behavior
change, not a quality gain claim: the owner-reference decision agreement remained
`0/5` for both E5-assisted arms.

## Embedding-only retrieval results — selected GPU run

The selected quality run is the corrected GPU run. The earlier CPU and first GPU
artifacts remain as performance/replay evidence; they are not used for the corrected
quality numbers.

| Metric | Result |
|---|---:|
| Resolved target-bearing offers | 1,005 |
| Vector Recall@1 | 687/1,005 = 68.36% |
| Vector Recall@5 | 882/1,005 = 87.76% |
| Vector Recall@10 | 927/1,005 = 92.24% |
| Vector MRR | 0.770 |
| Set component recall@1 | 741/3,166 = 23.40% |
| Set component recall@5 | 1,595/3,166 = 50.38% |
| Set component recall@10 | 1,858/3,166 = 58.69% |
| Component target availability | 3,166/3,170 = 99.87% |
| Frozen-unclassified nearest-candidate coverage | 168/168 = 100% |
| Frozen-unclassified reference target coverage | 157/168 = 93.45% |
| Masked holdout | unavailable; no independent masked corpus field |

The `3,166` component denominator is intentional: four owner-added component links
point to ProductMaster IDs outside the frozen 425-document baseline corpus. The
missing four are reported as target coverage, not silently counted as vector misses.
Set self-match candidate rate before hard rule filtering was `743/984 = 75.51%`;
this is a diagnostic of why graph/rule filtering remains necessary, not a production
false-merge rate.

### E5-small เทียบกับ BGE-M3/Ollama

ทั้งสองเป็น exact cosine search บน corpus/query และ candidate contract เดียวกัน
ต่างกันที่ embedding model, dimension และ runtime providerเท่านั้น:

| Metric | E5-small | BGE-M3/Ollama | Delta BGE - E5 |
|---|---:|---:|---:|
| Resolved target-bearing offers | 1,005 | 1,005 | — |
| Recall@1 | 68.36% | 51.24% | -17.11 pp |
| Recall@5 | 87.76% | 76.72% | -11.04 pp |
| Recall@10 | 92.24% | 83.18% | -9.05 pp |
| MRR | 0.7695 | 0.6249 | -0.1445 |
| Component recall@1 | 23.40% | 17.78% | -5.62 pp |
| Component recall@5 | 50.38% | 40.93% | -9.44 pp |
| Component recall@10 | 58.69% | 47.92% | -10.77 pp |
| Target-not-in-top-20 errors | 40 | 111 | +71 |
| Frozen-unclassified candidate coverage | 168/168 | 168/168 | same |

ผลนี้ชี้ว่า BGE-M3/Ollama พร้อมใช้งานเชิงระบบและใช้ GPU ได้ แต่ยังไม่ชนะ
`multilingual-e5-small` บน catalog/query contract นี้ ขนาด model และ dimension ที่สูงกว่า
ไม่ได้แปลเป็น retrieval quality ที่สูงกว่าโดยอัตโนมัติ

## Runtime and hardware

| Run | Device | Runtime | Encode | Vector query |
|---|---|---|---:|---:|
| CPU baseline `RUN1_BMR1_5921CC9447EA_ve_20260823T024205730Z_01` | CPU | PyTorch `2.9.1+cpu` | 120.185s | 29ms |
| Selected GPU `RUN1_BMR1_5921CC9447EA_ve_20260823T025634936Z_01` | RTX 3060 12GB | PyTorch `2.9.1+cu128` / CUDA 12.8 | 14.317s | 30ms |
| BGE-M3 Ollama `RUN1_BMR1_5921CC9447EA_ve_20260823T041000389Z_01` | RTX 3060 12GB | Ollama `0.32.15`, `/api/embed`, `bge-m3:latest` | 44.086s | 31ms |

GPU was verified through NVIDIA driver `610.88` and `nvidia-smi`. For the BGE run,
`nvidia-smi` observed a sample of `40%` utilization and `1,815/12,288 MB` used;
Ollama `/api/ps` reported `664,000,265` bytes VRAM for the loaded model. These are
runtime evidence samples, not full-run utilization metrics. The GPU venv is outside
the repository at
`C:\Users\freshair\.cache\zuri-vector-benchmark-venv`.

## Artifact lineage

All output below is sidecar-only. The old identity-review, user-logic-review and active
Genesis store were not modified.

- [Round-1 benchmark spec](D:\workspace\zuri-edge-device\docs\GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-SPEC.md)
- [Four-arm factorial manifest](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\llm-factorial-run-manifest.json)
- [Four-arm comparison](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\llm-factorial-comparison.json)
- [Four-arm row results](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\llm-factorial-results.jsonl)
- [Four-arm checksums](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\llm-factorial-checksums.sha256)
- [Selected GPU manifest](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\gpu-run-corrected-20260823T025624Z\manifest.json)
- [Selected GPU run manifest](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\gpu-run-corrected-20260823T025624Z\run-manifest.json)
- [Selected GPU metrics](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\gpu-run-corrected-20260823T025624Z\metrics.jsonl)
- [Selected GPU checksums](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\gpu-run-corrected-20260823T025624Z\checksums.sha256)
- [BGE-M3/Ollama vector run manifest](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\bge-m3-ollama-run-20260823T110700Z\run-manifest.json)
- [BGE-M3/Ollama vector metrics](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\bge-m3-ollama-run-20260823T110700Z\metrics.jsonl)
- [BGE-M3/Ollama vector checksums](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\bge-m3-ollama-run-20260823T110700Z\checksums.sha256)
- [BGE-M3 factorial manifest](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\bge-m3-ollama-run-20260823T110700Z\llm-factorial-run-manifest.json)
- [BGE-M3 factorial comparison](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\bge-m3-ollama-run-20260823T110700Z\llm-factorial-comparison.json)
- [BGE-M3 factorial checksums](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\bge-m3-ollama-run-20260823T110700Z\llm-factorial-checksums.sha256)
- [LLM factorial metrics](D:\workspace\zuri-edge-device\data\catalog_vector_benchmark_round1_v1\llm-factorial-metrics.jsonl)
- [Vector input builder](D:\workspace\zuri-edge-device\scripts\build-catalog-vector-input.ts)
- [GPU/vector benchmark runner](D:\workspace\zuri-edge-device\scripts\run-catalog-vector-benchmark.py)
- [Ollama vector benchmark runner](D:\workspace\zuri-edge-device\scripts\run-catalog-vector-benchmark-ollama.py)
- [LLM factorial evaluator](D:\workspace\zuri-edge-device\scripts\evaluate-catalog-llm-factorial.ts)

The aborted oversized candidate attempts were recorded as failed attempts and their
transient CLI logs were removed after verification because they duplicated raw source
evidence. They are excluded from all metrics. Only the compact stdin attempts with
schema-valid outputs are used for the E5-small and BGE-M3 arms. BGE-M3 Luna and Sol
outputs each contain `55/55` unique rows.

## Conclusion and next gate

1. Model choice matters. Luna/Sol cannot be treated as interchangeable for this
   classification task.
2. E5-small changes model behavior, especially Sol's classified rate, but the current
   evidence does not prove that it improves correctness. It changes candidate context;
   graph rules and a controlled taxonomy are still required.
3. BGE-M3 through Ollama is operational on the RTX 3060, but its vector-only retrieval
   is below E5-small on this dataset and its Sol actionable result is lower. Do not
   promote BGE-M3 as the replacement embedding model from this round. It remains a
   candidate for a future hybrid/rerank experiment only.
4. The safe architecture remains: vector retrieves candidates → graph/component rules
   enforce identity boundaries → controlled `typeId` vocabulary maps aliases → human
   review handles unresolved/high-conflict cases.
5. Do not refresh the production vector index, promote LLM labels, or overwrite
   ProductMaster from this report. The next acceptance gate is an independent gold set
   for all 55 plus at least three repeated runs per arm. After that, compare embedding
   quality/cost again with the same model/provider contract and a rerank/hybrid arm.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Completed Luna/Sol no-embedding and E5-small embedding factorial evidence with CPU/GPU provenance | ATHER |
| 0.2.0b | 2026-08-23 | candidate | Added BGE-M3/Ollama GPU vector run, Luna/Sol BGE factorial comparison, IDs, checksums, and E5-vs-BGE analysis | ATHER |
