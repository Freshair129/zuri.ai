---
id: ZAI:KNOWLEDGE-INGESTION-17-STAGE-FLOW
title: GenesisRAG17 execution flow and extension map
version: "1.1.0b"
status: beta
created_at: "2026-09-08T00:51:36+07:00,RWANG,base b64b46df"
last_update: "2026-09-08T04:00:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:ADR-071
  - type: references
    target: ZAI:GENESISRAG17-CONTRACT
  - type: relates_to
    target: ZAI:FR-109
  - type: relates_to
    target: ZAI:FR-110
---

# GenesisRAG17 — execution flow and extension map

เริ่มจากตารางเลือก stage ด้านล่างเมื่อจะเพิ่มความสามารถใหม่ แล้วอ่าน contract ของ stage ก่อนแก้ implementation เอกสารนี้อธิบาย **ระบบทดสอบที่ทำแล้ว** ตาม ADR-071; [spec §§1–42](KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) ยังเก็บข้อกำหนดผลิตภัณฑ์ที่กว้างกว่าไว้ โดยแต่ละ stage มีหมายเหตุขอบเขตที่ทำจริง

ขอบเขตปัจจุบัน: synthetic text/Markdown, หนึ่งเอกสารต่อ run, ฐานข้อมูลแยก, scope `private`, rule-based extraction, local CPU embeddings และ worker loop ที่เริ่ม/หยุดและ resume ได้ ไม่มี production deployment, LLM extraction, UI ใหม่ หรือ OS scheduled task ในงานนี้ การเพิ่ม capability ในตารางคือจุดที่ควรออกแบบต่อ ไม่ใช่ plugin/API ที่มีอยู่แล้วทุกข้อ

## เจ้าของและขอบเขตการเรียก

| Repo | สิ่งที่ถือและทำจริง | สิ่งที่ต้องส่งผ่าน contract |
|---|---|---|
| zuri-ai, Tier 1 | Stage 1–8, immutable raw/parsed/chunk lineage, run/attempt ledger, source outbox, evidence cursor, finish guard | ส่ง batch และอ่านผล/ค้นคืนผ่าน MSP; ไม่เก็บ canonical fact payload หรือเขียน substrate |
| [MSP](https://github.com/Freshair129/Memory-and-Soul-Passport/tree/codex/ki17-integration), Tier 2 | runtime credential, exact scope/role checks, relay; **ไม่มี stage** | source และ worker ใช้ grant คนละ role; relay ไป GKS และ query ไป worker loopback |
| [GKS](https://github.com/Freshair129/Genesis-Knowledge-System/tree/codex/ki17-integration), Tier 3 | Stage 9–14 decisions, canonical knowledge, Stage 17 quality verdict, durable receipts/evidence | เป็น passive server; ไม่เรียก GenesisBlock ออกไปเอง |
| [GenesisBlock worker](https://github.com/Freshair129/GenesisBlock/tree/codex/ki17-integration/genesisrag17-worker), Tier 4 | physical Stage 13, Stage 15–16, physical publication ของ Stage 17 และ query | แพ็กเกจแยกจาก engine; ดึงงาน/ส่ง receipts ผ่าน MSP; process เดียวถือ native store |

## Flow ที่รันจริง

```mermaid
sequenceDiagram
    participant S as Source caller
    participant Z as zuri source worker
    participant M as MSP relay
    participant G as GKS passive authority
    participant W as GenesisBlock worker
    S->>Z: ingestGenesisRag17Raw(raw, scope, policy)
    Note over Z: Persist source intent and derivation configuration before Stage1
    Note over Z: 1 receive → 2 parse → 3 provenance → 4 normalize<br/>5 classify → 6 version → 7 chunks → 8 mentions
    Z->>M: submit: one durable batch / Stage 9 attempt
    M->>G: authenticated submit
    Note over G: 9 resolve → 10 extract → 11 ontology → 12 temporal<br/>13 immutable graph decision, not yet terminal
    G-->>M: batch acknowledgement
    M-->>Z: acknowledgement
    W->>M: claim pending decision
    M->>G: claim
    G-->>M: immutable decision + hash
    M-->>W: decision
    Note over W: 13 graph-only transaction, flush, readback
    W->>M: graph_receipt
    M->>G: graph_receipt
    Note over G: verify write → terminal 13 → execute/terminal 14
    G-->>M: graphReceiptHash + derived + derivedHash
    M-->>W: enrichment result
    Note over W: 15 real embeddings → 16 final candidate transaction<br/>flush/checkpoint, indexes/readback, benchmark
    W->>M: write_receipt
    M->>G: write_receipt
    Note over G: verify physical evidence → terminal 15/16
    W->>M: gate
    M->>G: evaluate five dimensions
    G-->>M: verdict + allowPublication
    M-->>W: bound verdict
    alt PASS and policy allow
        Note over W: atomically replace publication pointer
        W->>M: publication_receipt
        M->>G: verify exact gate/write receipt
        Note over G: terminal 17 SUCCEEDED
    else verdict is not PASS or policy denies
        Note over G,W: no publication; terminal failure, no invented downstream success
    end
    Z->>M: evidence(runId, afterCursor)
    M->>G: evidence
    G-->>M: exact-attempt terminal rows + publication receipt
    M-->>Z: evidence page
    Note over Z: durable import + cursor transaction<br/>successful finish requires all 17 successes and matching publication receipt
```

ลำดับสำคัญคือ **13 เขียนจริงและรับ receipt → 14 enrich → 15 embed → 16 indexes → 17 gate และ publish** ไม่รวม 13/15/16 เป็น acknowledgement เดียวก่อนทำ 14 การส่งซ้ำของ message ไม่ใช่การ execute stage ใหม่

## เลือก stage ที่จะต่อขยาย

| ต้องการเพิ่ม | เริ่มที่ stage | ผลกระทบถัดไปและหลักฐานที่ต้องเพิ่ม |
|---|---|---|
| connector/แหล่งเอกสาร | 1 | immutable raw + source identity; ผ่าน 2–8 และหนึ่ง batch ต่อ attempt; multi-source concurrency ต้องออกแบบเพิ่ม |
| PDF/OCR/HTML/table parser | 2 | mapping กลับ raw ที่ 3 และ offsets ที่ 7/8/9; v1 ปัจจุบันเป็น exact text จึงเพิ่ม binary parser อย่างเดียวไม่พอ |
| ตำแหน่งหน้า/เซลล์/หลักฐานละเอียด | 3 | ขยาย provenance contract ถึง 13/16 และ citation query; ทดสอบ resolve หลัง restart |
| หน่วย/รูปแบบชื่อ/ข้อความ canonical | 4 | แยก canonical value จาก raw; หากเปลี่ยนข้อความที่ chunk ต้องเปลี่ยน mapping/version และทดสอบ hash/offset |
| PII/sensitivity/processing policy | 5 + MSP | ทุก boundary และ 15/17/query ต้อง enforce เหมือนกัน; v1 มีสอง flags ยังไม่ใช่ full sensitivity runtime |
| correction/dedup strategy | 6 | source version ใหม่, FR-071 replay attempt ใหม่, snapshot ใหม่; citation เดิมต้องยัง resolve |
| semantic/table-aware chunking | 7 | chunk version/identity, occurrence offsets ที่ 8 และ benchmark 15–17 |
| entity type/NER recognizer | 8 | ส่งทุก occurrence พร้อม type; 9 resolution และ 11 endpoint schema ต้องรองรับด้วย |
| alias/entity matching/merge policy | 9 | canonical IDs และ fact endpoints; ทดสอบชื่อซ้ำไม่ทำ mention หายและ scope ไม่ปน |
| relation pattern หรือ LLM extractor | 10 | raw predicate/confidence/provenance, floor/HELD; หากเป็น predicate ใหม่ต้องต่อ 11 ด้วย; LLM ยังนอก baseline |
| predicate ใหม่หรือ synonym | 11 | ontology version + endpoint types; 10 ต้องผลิต candidate และ 13/17 ต้องตรวจได้ |
| valid time/interval/source date | 12 | temporal semantics + parity fixtures; 13 persistence, 16 lane readback, 17 applicability |
| assertion/node/edge class | 13 | immutable decision schema/hash, worker projection, physical counts/readback, provenance and gate |
| entity summary/derived feature | 14 | แยกจาก verified facts; derivedHash/source refs; worker final write และ gate counts |
| embedding model/dimension | 15 | pin revision/artifact hashes, new vector generation, 16 schema and 17 fixed benchmark; ห้าม silent fallback |
| index lane หรือ retrieval projection | 16 | manifest status/reason/objects, real readback, candidate isolation, gate readiness |
| quality threshold/check | 17 | evidence จริง + policy + publication receipt; negative cases ต้องพิสูจน์ว่าไม่ publish |
| reranker/context builder/answer generation | หลัง 17: query path | read-only published generation, scope/citations, evaluation ของ query; ไม่เพิ่ม Stage 18 โดยอัตโนมัติ |

## Contract ราย stage

ทุกแถวใช้ terminal envelope เดียวกันจาก [wire contract](plans/GENESISRAG17-CONTRACT.md): `runId + pipelineStageId + executionStepId + attemptId`, `startedAt`, `finishedAt`, `outcome` และ metrics หกค่า Stage IDs ด้านล่างเป็นคีย์ถาวร; เลข 1–17 เป็นลำดับ ไม่ใช้แทน identity

| Stage / stable ID | Input → output ที่ทำจริง | เงื่อนไขจบ / หยุด | จุดแก้ implementation |
|---|---|---|---|
| 1 `DPS-KI-INGEST` | raw content + authorized run scope/source/version → `RawExternalRecord` และ `KnowledgeRawArtifact` | สำเร็จหลังบันทึกหลักฐานรับเข้าจริง; identity เดิมแต่เนื้อหาต่าง conflict | Z-executor `ensureCanonicalRawRecord` / `ensureRaw` |
| 2 `DPS-KI-PARSE` | persisted raw → versioned parsed text/structure | เก็บ exact text และ parser version; ไม่มี binary/OCR parser ใน profile นี้ | Z-source `parseGenesisRag17Document`, Z-executor `ensureParsedArtifact` |
| 3 `DPS-KI-PROVENANCE` | raw + parsed → checked provenance digest/source references | ต้องมี parent จริง; lineage resolver ตรวจ chain และ hashes หลัง restart | Z-executor Stage 3, Z-lineage, `provenance.js` |
| 4 `DPS-KI-NORMALIZE` | original text → canonical text hash + retained raw hash | วัด normalization แต่ไม่ได้แทน raw/chunk text ด้วย canonical text | Z-executor Stage 4, `normalization.js` |
| 5 `DPS-KI-CLASSIFY` | run scope + policy → indexable/publishable evidence | scope exact; flags `allowEmbedding`/`allowPublication` มีผลที่ 15/17; Stage 5 ผ่านได้แม้ flag false | Z-executor Stage 5 + Z-contract; MSP grants |
| 6 `DPS-KI-DEDUPE` | immutable current raw + same-scope prior versions → relationship evidence | version/content identity conflict ปฏิเสธ; comparison ไม่ลบหรือ rewrite ต้นฉบับ | Z-executor Stage 6 + dedup classifier |
| 7 `DPS-KI-CHUNK` | parsed text/heading sections → persisted exact-substring chunks | hash/UTF-16 offsets/ordinal ตรง parent; default 80 whitespace tokens ไม่ใช่ model tokenizer | Z-source parser/chunk helper, Z-executor `ensureChunks` |
| 8 `DPS-KI-ENTITY-EXTRACT` | chunks → typed source occurrences | แยก `sourceMentionId` จาก `resolutionKey`; ส่งทั้งหมดในหนึ่ง Stage 9 batch | Z-source `extractGenesisRag17Mentions`, recognizer option |
| 9 `DPS-KI-ENTITY-RESOLVE` | validated complete batch → canonical entities + all occurrence references | source/chunk/mention hash+span ตรวจผ่านก่อนใช้; terminal หนึ่งชุดต่อ attempt | G-core / G-service `pipelineSubmit` |
| 10 `DPS-KI-FACT-EXTRACT` | resolved occurrences + text → raw-predicate fact candidates/HELD | `rule_v1`: explicit .90, structured .85, inferred ≤.70; write floor .80 | G-core extraction rules |
| 11 `DPS-KI-ONTOLOGY-MAP` | candidates → typed canonical `WORKS_FOR` / `PURCHASED` facts หรือ HELD | `ontology_v1` synonyms และ endpoint types; unknown/invalid มีเหตุผลไม่เป็น verified fact | G-core ontology mapping |
| 12 `DPS-KI-TEMPORAL-MAP` | facts + time evidence → temporal metadata | แยก unmapped, open-ended, explicit `not_applicable`; parity กับ MSP source ที่ pin ไว้ | G-temporal + G-core mapping |
| 13 `DPS-KI-GRAPH-BUILD` | immutable scoped graph decision → committed graph + graph receipt | GKS decided counts แยก worker written counts; terminal หลังตรวจ graph receipt จริงเท่านั้น | G-service decision/receipt + W-worker graph transaction |
| 14 `DPS-KI-ENRICH` | graph acknowledged + source facts → `enrich_v1` per-entity counts | distinct documents/chunks/facts + source references; derivedHash แยก ไม่แก้ decisionHash | G-core enrichment + G-service graph-receipt response |
| 15 `DPS-KI-EMBED` | allowed chunks → real CPU E5 vectors, model/hash evidence | 384 dimensions cosine, exact pinned artifacts; policy denial/model error ไม่ทำ fake vectors | W-worker + Python embedder |
| 16 `DPS-KI-INDEX` | graph + derived + vectors → candidate generation, six-lane manifest, write receipt | flush/checkpoint/readback+benchmark; required lane ต้อง ready; candidate ยังไม่ visible | W-worker final transaction/index/readback |
| 17 `DPS-KI-QUALITY-GATE` | decision + exact physical receipts + benchmark + policy → verdict, published pointer, publication receipt | GKS ตรวจ 5 dimensions; success หลัง matching publication receipt; quality PASS แต่ policy deny ก็ FAILED | G-service gate/publication; W-worker pointer/outbox; Z-importer/finish |

### แผนที่ไฟล์และ tests

Paths เป็นจุดแก้ที่มีอยู่จริง ไม่รับรองว่าฟังก์ชันภายในเป็น public plugin interface:

| Key | Code / proof |
|---|---|
| Z-executor | [genesisrag17-executor.js](../apps/server/src/platform/integrations/core/genesisrag17-executor.js); [Tier 1 integration tests](../apps/server/tests/integration/genesisrag17-tier1.test.js) |
| Z-source | [genesisrag17-source.js](../apps/server/src/modules/knowledge/genesisrag17-source.js); [source tests](../apps/server/tests/unit/genesisrag17-source.test.js) |
| Z-lineage | [repository](../apps/server/src/modules/knowledge/genesisrag17-lineage-repository.js); [repository tests](../apps/server/tests/unit/genesisrag17-lineage-repository.test.js) |
| Z-contract | [strict schema/hash](../apps/server/src/modules/knowledge/genesisrag17-contract.js); [contract tests](../apps/server/tests/unit/genesisrag17-contract.test.js) |
| Z pure helpers | [provenance](../apps/server/src/modules/knowledge/provenance.js), [normalization](../apps/server/src/modules/knowledge/normalization.js), [dedup](../apps/server/src/modules/knowledge/dedup.js); adapter behavior is verified by the Tier 1 integration suite |
| Z-importer/finish | [importer](../apps/server/src/platform/integrations/core/genesisrag17-importer.js), [publication guard](../apps/server/src/platform/integrations/core/genesisrag17-publication.js), [source worker](../apps/server/src/platform/integrations/core/genesisrag17-worker.js) |
| G-core | [pipeline processing](https://github.com/Freshair129/Genesis-Knowledge-System/blob/codex/ki17-integration/packages/gks-core/src/pipeline.mjs) |
| G-service | [service transitions](https://github.com/Freshair129/Genesis-Knowledge-System/blob/codex/ki17-integration/packages/gks-core/src/index.mjs); [pipeline tests](https://github.com/Freshair129/Genesis-Knowledge-System/blob/codex/ki17-integration/tests/contract/pipeline-genesisrag17.test.mjs) |
| G-temporal | [temporal implementation](https://github.com/Freshair129/Genesis-Knowledge-System/blob/codex/ki17-integration/packages/gks-core/src/temporal.mjs); [parity tests](https://github.com/Freshair129/Genesis-Knowledge-System/blob/codex/ki17-integration/tests/contract/temporal-engine-parity.test.mjs) |
| MSP | [relay handlers](https://github.com/Freshair129/Memory-and-Soul-Passport/blob/codex/ki17-integration/apps/msp-server/src/transport/handlers/pipeline-handlers.mjs), [nine-tool schema](https://github.com/Freshair129/Memory-and-Soul-Passport/blob/codex/ki17-integration/packages/msp-contracts/schemas/GENESISRAG17.tools.json) |
| W-worker | [native owner](https://github.com/Freshair129/GenesisBlock/blob/codex/ki17-integration/genesisrag17-worker/src/worker.mjs), [embedder](https://github.com/Freshair129/GenesisBlock/blob/codex/ki17-integration/genesisrag17-worker/src/embedder.py), [setup and model hashes](https://github.com/Freshair129/GenesisBlock/blob/codex/ki17-integration/genesisrag17-worker/README.md) |
| Cross-repo proof | [raw-entrypoint acceptance suite](../apps/server/tests/acceptance/genesisrag17-e2e.test.js), [fixed corpus](../apps/server/tests/fixtures/genesisrag17-corpus-v1.json), [historical acceptance report](../.brain/reports/GENESISRAG17-ACCEPTANCE.md) |

## Durability, receipt และ query flow

1. **Lineage:** `Fact.sourceReferences → KnowledgeChunk → KnowledgeParsedArtifact → KnowledgeRawArtifact → RawExternalRecord → Source`. Worker citation ส่ง source/raw/parsed/chunk IDs + contentHash ให้ Tier 1 resolve; source version ใหม่สร้างแถวใหม่ ชื่อเดิมไม่ใช่เหตุผลให้ rewrite row เดิม
2. **Handoff:** source outbox `PENDING → ACKNOWLEDGED`; timeout/reply loss ส่ง request เดิมและ idempotency key เดิม การประมวลผลใหม่จริงใช้ FR-071 `replayRunId` และ newly materialized attempt ไม่เลือก step ล่าสุดให้หลักฐานเก่า
3. **Evidence:** terminal หนึ่งชุดต่อ stage/attempt; metrics คือ `records_in`, `records_out`, `records_quarantined`, `error_count`, `retry_count`, `duration_ms`. ศูนย์ต้องเกิดจากการวัด ราย item อยู่ใน owner store. Import ทั้ง page และ cursor ใน transaction; invalid row ไม่ทำให้ cursor ข้ามหลักฐานผิด
4. **Publication:** graphReceiptHash + derivedHash + final receiptHash ผูก decision/scope/run/stages/snapshot/generation/model/transaction/frontier/readback; GKS quality PASS อย่างเดียวไม่พอ ต้อง policy allow และ publication receipt ตรงกันจึง finish สำเร็จ
5. **Recovery:** graph/write/failure/publication outbox ส่งซ้ำเนื้อหาเดิมได้; crash ก่อน pointer switch ยังอ่าน snapshot เก่า หลัง switch แต่ก่อนตอบ resume receipt จาก durable state; generation เก่ายังอยู่สำหรับ audit/correction
6. **Query หลัง ingestion:** `source caller → MSP credential/scope check → worker loopback /query → one published generation → citation → Tier 1 lineage resolver`. Query ไม่เรียก ingestion; candidate และ snapshot นอก published history ใช้ไม่ได้. GKS query planning/reranking/LLM answer เป็นอีกความสามารถที่ต้องออกแบบ ไม่ใช่สิ่งที่ acceptance query นี้พิสูจน์

การแก้จาก audit ตาม [contract 1.3.0b](plans/GENESISRAG17-CONTRACT.md#audit-remediation-contract-130b):
source loop ต้อง resume จาก intent ก่อนมี Stage9 batch และ reuse occurrence output
ของ attempt เดิม; Pending/null acknowledgement ยังไม่ใช่ข้อผิดพลาด. Native worker
เก็บ transaction payload/frontier ก่อน commit แล้วส่ง payload เดิมเมื่อ retry.
เก็บ graph receipt/derived state ก่อนลบ outbox. Lexical index เขียนที่16 เท่านั้น.
Stage17 รับ PASS เท่านั้น; WARN เป็น terminal failure ที่ไม่ publish. หาก atomic
pointer replacement ล้ม ต้องเก็บ pointer เดิมไว้ ห้ามย้ายของเดิมออกก่อนติดตั้งใหม่.

## Six lanes และ version boundaries

| Lane | Current implementation/evidence | เมื่อเพิ่มต้องตรวจ |
|---|---|---|
| vector | pinned native vector collection + real 384-d E5 vectors | dimension/model/hash/generation และ benchmark |
| lexical | worker-owned derived SQLite FTS5; manifest reason `worker_sqlite_fts5` | ไม่กล่าวว่า native engine มี text-index API ที่ไม่มี |
| graph | native physical nodes/edges + readback | decided vs written counts, endpoint/provenance scope |
| sqlite | physical structured projection count | receipt objects เท่าจำนวน physical nodes |
| bitemporal | explicit applicability; actual temporal Query IR เมื่อ applicable/API รองรับ | unmapped ไม่กลายเป็น not_applicable; unsupported ต้องเหตุผลจริงที่ gate อนุญาต |
| provenance | persisted chunk/source references + citation readback | resolve chain/hash หลัง restart และ historical snapshot |

Engine source pin `e15e35b0093394e0a8880af7f4e6f63cf81223b7`; model `intfloat/multilingual-e5-small` revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`; pipeline wire `genesisrag17.v1`; parser `genesisrag17-parser-1`; processing profiles `rule_v1`, `ontology_v1`, `enrich_v1`. Temporal parity ตรึง MSP source commit `8b8667dadf01fd7f421260af8b8b260f6cac267f`. Legacy promotion/evidence ports อยู่คนละ protocol ไม่ใช้หลักฐานที่ไม่มี attempt ปิด attempt ใหม่

## ขั้นตอนเพิ่มความสามารถและ acceptance

1. ระบุ stage เจ้าของ, input/output ที่เปลี่ยน, parent ADR/FR และ affected next stages; รักษา ID/subject เดิม หากเป็น requirement ใหม่ใช้ tooling จัด ID
2. อัพเดท spec/profile และ frozen contract ก่อน implementation หาก schema/hash/policy/receipt เปลี่ยนให้เจ้าของ zuri/MSP/GKS/worker ตกลงพร้อมกัน ห้ามให้แต่ละ repo เติม field เอง
3. กำหนด version/replay/migration: semantic change ต้องสร้าง processing version/attempt/generation ที่แยกได้ และกำหนด backward reader ของหลักฐานเก่า ไม่เขียนทับ snapshot ที่เผยแพร่แล้ว
4. เพิ่ม positive/negative fixtures ที่พิสูจน์ capability ใหม่และผลต่อ stage ถัดไป พร้อม duplicate/reply loss/restart/wrong-scope tests ตาม boundary ที่เปลี่ยน
5. รัน acceptance จาก raw entrypoint ผ่าน worker จริงจน query พร้อม citation; ห้าม test ใส่ผลสำเร็จ stage หรือเรียก promotion แทน ingestion แล้วถือว่าครบ 17 stages
6. ตรวจ fixed-corpus Recall@5 ≥ .80, MRR ≥ .65, citation correctness = 1.00, cross-tenant leaks = 0; ระบุ fixture/commit/model/schema versions ทุกครั้ง ผลนี้เป็น benchmark ของชุดทดสอบ ไม่ใช่คุณภาพ production
7. Root เดียว regenerate governance และตรวจ cross-repo links/flow. เอกสารรอบนี้เปลี่ยนคำอธิบายและจุดต่อขยาย ไม่ใช่การ rerun หรือขยายขอบเขตหลักฐาน runtime เดิม

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.1.0b | 2026-09-08 | beta | Audit remediation: pre-stage intent, exact transaction retry, PASS-only publication and safe pointer replacement | working-tree | RWANG |
| 1.0.0b | 2026-09-08 | beta | Actual 17-stage sequence, owner/input/output/terminal contracts, extension routing and proof map | base b64b46df | RWANG |
