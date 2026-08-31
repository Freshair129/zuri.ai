# Gap Analysis — zuri-ai requirements × ความสามารถเดิมใน GoVibe

| Field | Value |
|-------|-------|
| **Version** | 1.0.1 |
| **Status** | Active |
| **Author** | Owen + Claude |
| **Created** | 2026-08-31 |
| **Last Updated** | 2026-08-31 |

> **อัปเดต 1.0.1**: หลังจุดตัดของการวิเคราะห์นี้ Stage 9 (entity resolution)
> ส่งมอบแล้วฝั่ง GKS เมื่อ 2026-08-30 (ROADMAP revision 2.10.0, merge `e412ec0`
> บน Genesis-Knowledge-System) — แถว stage 9 ในตาราง 2.2 จึงเป็นบันทึก
> ประวัติศาสตร์ว่า GoVibe มีอะไรให้ยก ไม่ใช่สถานะปัจจุบันของ GKS;
> งานสร้างใหม่ที่เหลือคือ stage 10–14/17

เทียบ requirements ของ repo นี้ (PRD-SDD v1.0, ADR-050, FR-057, PHASE-04/05, CR-002)
กับความสามารถที่มีอยู่จริงใน `G:\govibe` (msp-runtime, govibe-core, MCP server,
Mission Control) เพื่อระบุว่าอะไรยกมาใช้ได้ อะไรต้องสร้างใหม่ และงานลงที่ repo ไหน

## ข้อสรุปหลัก

GoVibe ครอบคลุมดีที่สุดตรง **แกน memory runtime** — API-009 ทั้งเก้า tool,
3-tier vault, bitemporal entity, fail-closed GKS bridge (คือของที่ถูก extract
เป็น `D:\msp` แล้ว) — และมี **hybrid retrieval ที่ทำงานจริง** (FTS5 + bge-m3
1024-dim ผ่าน Ollama + RRF k=60) ซึ่งตรงกับสเปค embedding ใน CR-002 พอดี

ช่องว่างใหญ่มีสามกลุ่ม และเกือบทั้งหมด**ไม่ใช่งานของ GoVibe อีกต่อไป**:

1. **Episodic memory เชิง channel/thread** ที่ PHASE-04 กำหนดให้ MSP เป็นเจ้าของ — GoVibe ไม่มีเลย
2. **Stage 9–14 + 17 ของ pipeline สิบเจ็ดขั้น** (งานของ GKS) — GoVibe มีแค่ POC ที่ zero production imports
3. **query-ir.v1 / Evidence Packet / FR-110 snapshot publish** — ยังไม่มีที่ไหนสร้าง

## 1. กรอบการเทียบ: ใครอยู่ tier ไหน

ตาม ADR-043/ADR-050 สถาปัตยกรรม runtime เป็นสี่ tier และ **GoVibe ไม่ใช่ tier ใดเลย**
`GOVIBE-INTEGRATION.md` (v1.0.0, 2026-08-12) เก่ากว่า ADR ชุดหลัง — บทบาทปัจจุบัน
ของ GoVibe คือ *dev-time governance meta-layer* + *repo ต้นทางของ MSP runtime* เท่านั้น

| Tier | ระบบ | เจ้าของอะไร |
|---|---|---|
| 1 | zuri-ai | product, IAM, CRM, agent turn, ingestion stage 1–8 |
| 2 | MSP (`D:\msp`) | session control, thread-id authority, memory policy, vault resolve |
| 3 | GKS (`D:\gks`) | canonical entity, ontology, stage 9–14, GraphRAG |
| 4 | GenesisBlockDB | embedding, 6-lane index, graph storage, stage 15–16 |

ดังนั้น "ความสามารถเดิมใน GoVibe" ที่เอามาปิด gap ได้ จะไหลไปลงสาม repo ปลายทาง
(MSP / GKS / GenesisBlockDB) — ไม่ใช่เอา GoVibe มาต่อเป็น runtime ตรง ๆ

## 2. Gap matrix

### 2.1 Tier 2 — สิ่งที่ zuri-ai ต้องการจาก MSP

| Requirement (zuri-ai) | ของเดิมใน GoVibe | สถานะ |
|---|---|---|
| API-009 ทั้งเก้า tool: 3 vault, bitemporal, journal, decay, links, NDJSON JSON-RPC over stdio | `packages/msp-runtime` มีครบและเกินสเปค (~20 tools), test 24 ไฟล์ + security lane 8 ไฟล์ — ต้นทางของ `D:\msp` โดยตรง | ✅ COVERED |
| API-010 `msp_vault_resolve` — รับ AuthContext (tenant, business, principal, agent, workspace, authorization flags) คืน authorized vault set (FR-057, ADR-022) | มี `msp_vault_resolve` + migration `0007_principal_scoped_vaults` แต่ shape เป็นโลก workspace/agent ของ GoVibe — ไม่มี tenant/business/H-ceiling/`catalogVaultId` ตาม CR-002 | 🟠 PARTIAL |
| Episodic memory ownership (PHASE-04): `ChannelThread`, `ConversationEvent`, `Session`, `Episode`, summaries, retention/tombstone, export/erase, `MspPersistencePort` (SQLite + Postgres) | ไม่มี model เชิง channel/conversation เลย — vault ของ GoVibe ออกแบบเพื่อ dev-agent memory; SQLite-only, ไม่มี retention/erase | 🔴 GAP |
| Thread-id minting (`th_grp_`/`th_usr_`) + identity federation LINE/FB → Person (HMAC-SHA256) + H0–H4 ceilings (ADR-044) | ไม่มี — H-axis ของ GoVibe คนละความหมาย และ audit ของตัวเอง (GV AUD-23) ยอมรับว่า H เป็น declared ceiling ไม่ใช่ sandbox | 🔴 GAP |
| GKS bridge fail-closed: promote ต้องตอบ `gks_provider_unconfigured` เมื่อไม่มี provider | มีจริง พิสูจน์ด้วย test ทั้งใน GoVibe และใน `D:\msp` (Gate A 30/30) | ✅ COVERED |

### 2.2 Tier 3–4 — pipeline สิบเจ็ดขั้น (stage 9–17)

Stage 1–8 ปิดฝั่ง Tier 1 แล้ว (FR-112..119) และตัวเลขความคืบหน้า
เดินต่อจากฝั่งนี้ไม่ได้ — เก้า stage ที่เหลือเป็นของ GKS/GenesisBlockDB:

| Stage | เจ้าของ | ของเดิมใน GoVibe | สถานะ |
|---|---|---|---|
| 9 Entity Resolution | GKS | เฉพาะ `govibe-core/src/poc/` (candidate-extractor, canonical-store, semantic-delta) — GV AUD-09 ระบุ *zero production imports* — เป็น design reference ไม่ใช่โค้ดพร้อมส่ง | 🟠 POC เท่านั้น |
| 10–12 Fact / Ontology / Temporal | GKS | ไม่มีเชิง business knowledge (Deep Scan 12 ขั้นเป็นโลก code-symbol ซึ่ง ADR-009 ตัดออกจาก scope แล้ว) | 🔴 GAP |
| 13–14 Graph build / Enrich | GKS + T4 | impact engine + `links` table เป็น primitive ที่เกี่ยว แต่ GenesisBlockDB ยังไม่ถูกสร้างที่ไหนเลย (GoVibe มีแค่ GV ADR-025 boundary doc) | 🔴 GAP |
| 15 Embedding | GenesisBlockDB | `msp-runtime/src/retrieval/vector.mjs`: bge-m3 ผ่าน Ollama, 1024-dim, circuit breaker, graceful degradation — **ตรง CR-002 พอดี** | 🔵 ยกไปใช้ได้ |
| 16 Multi-Lane Index | GenesisBlockDB | มีจริง 2/6 lane (Lexical = FTS5, Semantic = vector + RRF k=60); Temporal/Provenance มี primitive (temporal-engine, journal); Graph/Structured ไม่มี | 🟠 PARTIAL 2/6 |
| 17 Quality Gate + publish | GKS + T4 | ไม่มีทั้งสองฝั่ง (verify-gate ของ GoVibe เป็นเรื่อง workflow ไม่ใช่ retrieval quality); FR-110 เป็น 🔜 เดียวที่ค้างใน FEAT-013 | 🔴 GAP |

**query-ir.v1 / Evidence Packet / GraphRAG orchestration** — GoVibe มีแค่ตาราง
`gks_retrieval_evidence` + `msp_evidence_record` เป็นเมล็ดพันธุ์ ระหว่างนี้ zuri
ใช้ `zuri-rag-service :8888` คั่นไว้ (ADR-046, Recall@5 0.80) โดย seam
ถูกออกแบบให้สลับเป็น GKS ได้จุดเดียว

### 2.3 ความคาดหวังเชิง dev-time (GOVIBE-INTEGRATION.md)

| ความคาดหวัง | สภาพจริง | สถานะ |
|---|---|---|
| Mission Control อ่าน `docs/roadmap/ROADMAP.md` ตรง ๆ | ทำงานจริง — roadmap parser + RoadmapBoard มี test | ✅ |
| Impact analysis ก่อนแก้ schema | `impact-engine.mjs` ทำงานจริง, explainable, มี test | ✅ |
| Doc-drift check + intake ผ่าน `.brain/inbound/` | validator + diff-check มีจริง; candidates สองตัวลงทะเบียนแล้ว | ✅ |
| Route งานผ่าน tiered SLM (PlanEnvelope, T0–T3 + verify gates) | Contracts/tests แน่น แต่ GV AUD-03 บันทึกว่า execution stack ~15 module *ไม่มี runtime consumer* — `govibe.agent.run` ยิงผ่าน PowerShell launcher โดยไม่ตัดสิน tier/budget | 🟠 PARTIAL |

## 3. ข้อควรระวังก่อนใช้ตัวเลขฝั่ง GoVibe

- **GV AUD-01 (BLOCKER ของ GoVibe เอง):** ไม่เคยมี MSP process ถูก config
  เป็น governed path ใน `.env` ของ GoVibe — ทุก path ที่พึ่ง MSP fail closed
  ความสามารถ memory "เดิม" พิสูจน์ด้วย test suite (417 unit / 54 ไฟล์ +
  security 75/75) และการรันตรงของ runtime (มี `.govibe/msp/msp.sqlite3` จริง)
  ไม่ใช่การใช้งาน production
- เอกสารเฉลิมฉลองที่ root ของ `G:\govibe` (`FINAL_SUMMARY.md`,
  `SETUP_COMPLETE.md` ฯลฯ) อ้าง "production ready" ด้วย pass rate ประมาณการ —
  audit ของ repo เองตีตกเป็น orphan แล้ว อย่าใช้อ้างอิง
- `GoVibe_Implementation_Plan.md` เป็นแผน Tauri/monorepo เก่าที่ไม่ตรง tree
  ปัจจุบัน; `engine/` ว่างเปล่า (0 tracked files) — core จริงคือ `packages/` +
  `scripts/mcp/`; E2E ระดับแอปมี spec เดียว
- เลข ADR ชนกันระหว่างสอง repo (ADR-001..019 คนละความหมาย) — อ้างข้ามระบบ
  ต้องใช้ prefix `Z-`/`GV-` ตาม ADR-023 (ในเอกสารนี้ finding ของ GoVibe
  ใช้ prefix `GV`)

## 4. ลำดับการปิด gap ที่แนะนำ

1. **API-010 ใน `D:\msp`** — port ความหมาย `msp_vault_resolve` +
   principal-scoped vaults (migration 0007) จาก `G:\govibe` แล้วขยาย
   AuthContext เป็น shape ของ FR-057 (tenant/business/H-ceiling/catalogVaultId)
   — blocker ตรงของ FR-057 ที่ in progress อยู่
2. **Episodic model (PHASE-04)** — งานสร้างใหม่ทั้งก้อนใน MSP:
   thread/session/episode + retention/erase + Postgres adapter
   ไม่มีของเดิมให้ยก มีแต่ pattern (journal, bitemporal) ให้ทำตาม
3. **ยก retrieval stack ไป GenesisBlockDB** — `fts.mjs` / `vector.mjs` /
   `fusion.mjs` เป็นรากฐาน stage 15–16 ที่ดีที่สุดที่มี เหลือสร้าง
   Graph/Structured lane เพิ่ม
4. **GKS stage 9–14** — ใช้ `poc/` canonical-loop เป็นแบบร่าง แต่วางแผนเป็น
   งานสร้างใหม่ พร้อม cross-repo ADR ที่ PHASE-05 บังคับให้มีก่อนลงมือ
5. **FR-110 snapshot publish + stage 17 gate** — ประกาศ contract ฝั่ง Tier 1
   ได้เลย (🔜 เดียวของ FEAT-013) โดยไม่ต้องรอ GKS เสร็จ
6. **อย่า reuse Deep Scan / code-symbol IR** สำหรับ business knowledge —
   ADR-009 ตัดออกจาก scope แล้ว (ตัวแทนคือ `@req`/`@spec` annotation graph)
