---
id: ZAI:DATA-PIPELINE-MAP
title: Data pipeline map — where data enters, where it is combined, who receives it
version: "1.0.0b"
status: beta
created_at: "2026-09-13T22:00:00+07:00,Claude Opus 5,base b919c98b"
last_update: "2026-09-13T22:00:00+07:00,Claude Opus 5"
relations:
  - type: references
    target: ZAI:ADR-085
  - type: relates_to
    target: ZAI:FR-212
  - type: relates_to
    target: ZAI:FR-213
  - type: relates_to
    target: ZAI:FR-124
---

# Data pipeline map — ข้อมูลเข้าจากไหน รวมที่ไหน และส่งให้ใคร

หน้านี้ตอบคำถามเดียว: **zuri-ai รับข้อมูลจากไหน, รวมข้อมูลที่ไหนก่อนส่งต่อ, และใครรับข้อมูลจากเรา**
— แต่ละ hop มีโดเมนเจ้าของ, FEAT, และสถานะว่ามี surface แล้วหรือยัง ถ้ามีอยู่ระดับไหน
ภาพ node-edge อยู่ที่ `/knowledge/data-pipeline` (FR-213) ในแถบ **Knowledge (GKS)** ([ADR-085](decisions/ADR-085-KNOWLEDGE-GKS-SLOT-AND-THE-DATA-PIPELINE-MAP.md))

แทนที่ data flow diagram ใน [ARCHITECTURE-DIAGRAMS.md](ARCHITECTURE-DIAGRAMS.md) §3 (2026-08-15) และเสริม
[SYSTEM-DIAGRAM.md](SYSTEM-DIAGRAM.md) (2026-09-05) ซึ่งทั้งสองเก็บไว้เป็นบันทึกตามวันที่วาด
รายละเอียดเฉพาะโดเมน knowledge อยู่ที่ [KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md](KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md)

## 1. อะไรเขียนเอง อะไร generate

ส่วนท้ายของหน้านี้คือ **registry** (JSON ระหว่าง marker `data-pipeline-registry`) — nodes, edges และ chains
ที่คนเขียน เพราะไม่มี scan ไหนรู้ได้ว่าข้อมูลจาก webhook ถูกรวมเข้า evidence packet ก่อนเรียก model
นั่นเป็นการออกแบบ ไม่ใช่โครงสร้างไฟล์

ส่วนที่ derive ได้ **ห้ามเขียนเอง** และ generator (`apps/server/scripts/data-pipeline-map.mjs`, FR-212) คำนวณให้ทุกครั้งที่รัน `npm run govern`:

| สิ่งที่ generator ทำ | ถ้าไม่ผ่าน |
|---|---|
| surface `ENDPOINT` ต้องมี `src/app/api/**/route.js` จริง, `UI` ต้องมี `page.jsx` จริง, `MCP` ต้องมีชื่อ tool ใน MCP registry, `WORKER` / `FILE` ต้องมีไฟล์จริง | generation ล้ม บอกชื่อ node และ path |
| สถานะของ requirement และ FEAT อ่านจาก snapshot ของ FR-124 (`runtime/domain-state.json`) | id ที่ snapshot ไม่รู้จัก → ล้ม |
| สถานะ `PRODUCTION` รับเฉพาะ node ที่เขียนหลักฐานไว้ | claim ไม่มีหลักฐาน → ล้ม |
| edge ต้องชี้ node ที่มีจริง, ทุก node ต้องมี edge อย่างน้อยหนึ่งเส้น, path ของ chain ต้องต่อกันและเริ่มที่ SOURCE จบที่ RECIPIENT | ล้ม |
| chain ในตาราง §5 ต้องตรงกับ chain ใน registry ทุกตัว | ล้ม |

ผลลัพธ์เขียนเป็น `apps/server/runtime/data-pipeline-map.json` (commit ไว้ เหตุผลเดียวกับ `domain-state.json` — ADR-081 D2)

**สิ่งที่ generator ตรวจไม่ได้:** surface ข้อมูลใหม่ที่ไม่มีใครเพิ่มเข้า registry — มันตรวจสิ่งที่ registry บอก ไม่เห็นสิ่งที่ registry ไม่ได้บอก (§6)

## 2. วิธีอ่านสถานะ — สองแกน ไม่รวมเป็นตัวเลขเดียว

ชนิด node (คอลัมน์ในภาพ ซ้าย → ขวา): **SOURCE** ต้นทางภายนอก · **ENTRY** จุดรับข้อมูลเข้า zuri-ai · **PROCESS** ขั้นที่รวม/แปลงข้อมูล · **STORE** ที่เก็บ · **RECIPIENT** ผู้รับภายนอก

node ภายใน zuri-ai (ENTRY / PROCESS / STORE) มีสองแกน:

| สถานะการสร้าง | ความหมาย |
|---|---|
| `BLOCKED` | ประกาศแล้วและถูก block ไว้ (node เขียนเหตุผล) |
| `DECLARED` | ประกาศใน PRD แล้ว ยังไม่มี code |
| `PARTIAL` | มี code หรือ test บางส่วน ยังไม่ verified ทุก requirement |
| `CODE_TESTS` | ทุก requirement มี code และ test (`verified` ของ FR-124) |
| `PRODUCTION` | ใช้งานบน production แล้ว มีหลักฐานเขียนไว้บน node |

| ระดับ surface | ความหมาย |
|---|---|
| `NONE` | ไม่มี surface ของตัวเอง |
| `WORKER` | worker / script / ไฟล์ เท่านั้น |
| `MCP` | MCP tool |
| `ENDPOINT` | HTTP endpoint |
| `UI` | หน้า console |

edge ได้สถานะอ่อนสุดของ node ภายในที่มันเชื่อม (edge ที่ registry ระบุ `"wired": false` เป็น `DECLARED` เสมอ) และ chain ได้สถานะอ่อนสุดของทุก edge ใน chain

## 3. ข้อมูลเข้ามาจากไหน

- **ผู้ใช้ LINE** — ลูกค้าและพนักงานที่ยืนยันตัวตน เข้าทาง webhook ของบัญชีที่ server เป็นเจ้าของ (ADR-061) และทาง transport เดิม
- **เจ้าของ / พนักงานผ่านเบราว์เซอร์** — แผนงาน (wizard / Excel / bundle), สินค้า (JSON / Excel), เอกสารความรู้, หลักฐานทรัพย์สิน, ขายหน้าร้าน, rich menu, แผนการตลาด
- **Enterprise API · MCP · plugin clients** — PlanEnvelope, คำขอ admit ความรู้, คำถามความรู้
- **Zuri Edge Device** — heartbeat, pairing, ผลของงานสนทนาและงาน extraction ที่ device ดึงไปทำ
- **SmartGift (business-01-smart-gift)** — catalog projection, business knowledge export, หลักฐาน pipeline ผ่าน Codex worker, ประวัติลูกค้า
- **GKS (Tier 3)** — stage evidence ที่ push กลับหรือถูก pull ผ่าน MSP
- **SoT data plane ภายนอก** — plan และคำขอ decision
- **ซัพพลายเออร์และไฟล์ภายนอก** — ใบเสร็จ, xlsx, Google Sheets snapshot, ของที่ส่งมอบตาม PO
- **Repository ของ zuri-ai** — docs, annotations และ tests ที่กลายเป็น readiness snapshot
- **ยังไม่ต่อ:** marketplace / ราคาตลาด (adapter ยังไม่ wire), FlowAccount (FR-125 declared), GitHub (FR-130 ถูก block)

## 4. ใครรับข้อมูลจากเรา

- **LINE Messaging API → ผู้ใช้ LINE** — reply, push, rich menu (JSON + รูป + default / alias)
- **Model providers** (OpenAI · Anthropic · Gemini · OpenRouter · Groq) — คำถาม + evidence packet ของรอบสนทนา, และหลักฐานทรัพย์สินสำหรับ vision extraction
- **MSP (Tier 2) → GKS → GenesisBlockDB** — batch ของ Stage 1–8 ผ่าน stdio; zuri-ai ไม่คุยกับ GKS หรือ GenesisBlockDB ตรง (ADR-063)
- **Zuri Edge Device** — งานสนทนาและ bytes ของหลักฐานเฉพาะตอนถือ lease (แสดงเป็น PROCESS ฝั่ง edge เพราะผลกลับเข้ามา)
- **MCP · Enterprise API clients** — ผล dry-run / commit, work read, คำตอบความรู้พร้อม citation
- **SoT data plane** — decision ที่ตัดสินแล้ว (`export?since=`)
- **เจ้าของ / พนักงาน / operator** — dashboard, รายได้, เอกสารภาษี, asset register, market observations, Data Migration monitor, readiness และ backup export

## 5. Chains — ข้อมูลที่ถูกรวมก่อนส่งต่อ

chain คือเส้นทางจากต้นทางภายนอกผ่านขั้นที่รวมข้อมูล ไปถึงผู้รับ นับจาก registry โดย generator
สถานะของแต่ละ chain ไม่เขียนในตารางนี้ เพราะคำนวณจาก node — ดูในภาพหรือใน `runtime/data-pipeline-map.json`

| Chain | ชื่อ | รวมอะไรก่อนส่ง |
|---|---|---|
| CH-01 | LINE turn — ตอบบน Edge Device | event จาก webhook + CRM inbound → งานที่ device claim → คำตอบ → reply ไป LINE |
| CH-02 | LINE turn — ตอบบน server | ประวัติ CRM + business knowledge + ATP/ต้นทุน (FR-181) + policy → model → คำตอบที่ตรวจแล้ว → LINE |
| CH-03 | Business knowledge → คำตอบใน LINE | export ของ SmartGift → business_knowledge rows → evidence ของรอบสนทนา → LINE |
| CH-04 | Knowledge 17 stage → MSP / GKS / GenesisBlockDB | เอกสาร / catalog projection → Tier 1 Stage 1–8 → batch ไป MSP |
| CH-05 | GKS stage evidence → pipeline ledger → monitor | evidence ของ Stage 9–17 → run ledger → หน้าจอ |
| CH-06 | คำถามความรู้ → คำตอบพร้อม citation | คำถาม → published corpus snapshot → คำตอบ |
| CH-07 | SmartGift pipeline evidence → Data Migration monitor | หลักฐานที่ redact แล้ว → run/stage/record ledger → monitor |
| CH-08 | หลักฐานทรัพย์สิน → asset register | ไฟล์ใน private bucket → OpenAI หรือ Edge extraction → คนตรวจ → register |
| CH-09 | ราคาตลาด → market observations | raw record → translation + GKS resolve → observation |
| CH-10 | PlanEnvelope → Project system | wizard / Excel / MCP / marketing handoff → dry run → commit ธุรกรรมเดียว |
| CH-11 | Catalogue intake → catalogue | JSON / Excel / `#sku` → resolve ก่อนสร้าง → commit ทั้งชุด |
| CH-12 | รับของตาม PO → ATP → ราคาใน LINE | stock ledger + catalogue → ATP → เครื่องมือของ agent → LINE |
| CH-13 | ขายหน้าร้าน → รายได้และเอกสาร | order + payment ที่ verified → revenue + ใบกำกับ / ใบเสร็จ |
| CH-14 | Rich menu → LINE | version ที่ freeze → publish job → LINE rich menu API |
| CH-15 | SoT decision loop | plan / decision request → inbox ที่คนตัดสิน → data plane ดึงกลับ |
| CH-16 | Repository → readiness และ roadmap | docs + code + tests → domain-state / data-pipeline-map → หน้าจอ |
| CH-17 | Backup export | snapshot ของ Project system → ไฟล์ของ operator |
| CH-18 | Conversation analysis → Daily Sales Brief | ข้อความที่มี consent → analysis → brief ไป LINE (FR-128 declared) |
| CH-19 | Broadcast planning → LINE | broadcast intent → dispatch (ยังไม่เปิด FR-185) |
| CH-20 | ประวัติลูกค้าจาก SmartGift → บริบทของรอบสนทนา | backfill → CRM → evidence ของ agent → LINE |
| CH-21 | LINE turn — grounded ด้วย corpus ที่ publish แล้ว | คำถาม + snapshot ที่ publish (citation) → evidence packet → model → คำตอบที่ตรวจแล้ว → LINE; business_knowledge เป็น fallback ที่บันทึกใน trace (ADR-090, declared) |
| CH-22 | FAQ candidate จาก LINE → review → 17 stage → corpus | บทสนทนาที่มี consent → Q/A แบบ locator-only → OWNER / LINE_OA_PUBLISHER อนุมัติ (audited) → Text admission → Stage 1–17 → corpus manifest (ADR-090 D6, FR-236 built) |

## 6. แก้ map เมื่อไหร่

- เพิ่ม route / page / MCP tool / worker ที่ **รับข้อมูลเข้า** หรือ **ส่งข้อมูลออก** → เพิ่ม node และ edge ใน registry ในการเปลี่ยนแปลงเดียวกัน
- ขั้นใหม่ที่ **รวมข้อมูลจากหลายที่ก่อนส่ง** → เพิ่ม PROCESS node และ chain พร้อมแถวในตาราง §5
- ของที่ขึ้น production แล้ว → เพิ่ม `"production": { "evidence": "..." }` บน node พร้อมหลักฐานที่ตรวจได้ (commit, migration ที่ apply, deploy, RCA)
- หลังแก้ รัน `npm run govern` แล้ว commit `apps/server/runtime/data-pipeline-map.json` ที่เปลี่ยน

## 7. Registry

<!-- data-pipeline-registry:start -->
```json
{
  "nodes": [
    { "id": "src.line-users", "kind": "SOURCE", "system": "external", "label": "ผู้ใช้ LINE (ลูกค้า · พนักงานที่ยืนยันตัวตน)" },
    { "id": "src.staff", "kind": "SOURCE", "system": "external", "label": "เจ้าของ / พนักงาน ผ่านเบราว์เซอร์" },
    { "id": "src.api-clients", "kind": "SOURCE", "system": "external", "label": "Enterprise API · MCP · plugin clients" },
    { "id": "src.edge-device", "kind": "SOURCE", "system": "edge", "label": "Zuri Edge Device", "detail": "heartbeat และ pairing request" },
    { "id": "src.smartgift", "kind": "SOURCE", "system": "external", "label": "SmartGift (business-01-smart-gift)", "detail": "local agent · ETL 5 ขั้น · catalog / knowledge / customer exports" },
    { "id": "src.gks", "kind": "SOURCE", "system": "external", "label": "GKS (Tier 3)", "detail": "stage evidence ของ Stage 9–17" },
    { "id": "src.sot-data-plane", "kind": "SOURCE", "system": "external", "label": "SoT data plane ภายนอก" },
    { "id": "src.suppliers", "kind": "SOURCE", "system": "external", "label": "ซัพพลายเออร์และไฟล์ภายนอก", "detail": "ใบเสร็จ · xlsx · Google Sheets snapshot · ของที่ส่งมอบตาม PO" },
    { "id": "src.repository", "kind": "SOURCE", "system": "external", "label": "Repository ของ zuri-ai", "detail": "docs · annotations · tests" },
    { "id": "src.market-sources", "kind": "SOURCE", "system": "external", "label": "Marketplace / ราคาขายปลีก" },
    { "id": "src.flowaccount", "kind": "SOURCE", "system": "external", "label": "FlowAccount" },
    { "id": "src.github", "kind": "SOURCE", "system": "external", "label": "GitHub" },

    { "id": "in.line-webhook", "kind": "ENTRY", "system": "zuri-ai", "domain": "line-oa-studio", "label": "LINE webhook (server-owned)", "detail": "ตรวจลายเซ็นก่อน parse, บันทึก evidence ทุก event ก่อน ack",
      "requirements": ["FR-148", "FR-149"], "decisions": ["ADR-061"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/line-oa/accounts/[id]/webhook" }],
      "production": { "evidence": ".brain/rca/2026-09-11-line-server-overlay-dropped-on-redeploy.md, 'Verified end to end, 2026-09-12': LINE delivery 200, edge claim 200 with a job, edge complete 200; web runs with ZURI_LINE_SERVER_ENABLED=true, re-checked on the 2026-09-13 deploy of release-eb1fcfa8" } },
    { "id": "in.line-legacy", "kind": "ENTRY", "system": "zuri-ai", "domain": "agent", "label": "LINE webhook เดิม + delivery receipt", "detail": "adapter ของ FR-081 และ receipt ของ transport owner",
      "requirements": ["FR-081", "FR-093"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/agent/line-webhook" }, { "type": "ENDPOINT", "ref": "/api/agent/line-delivery" }] },
    { "id": "in.line-asset-handoff", "kind": "ENTRY", "system": "zuri-ai", "domain": "agent", "label": "LINE asset handoff", "detail": "FileAsset id จาก LINE binding ที่เชื่อถือได้",
      "requirements": ["FR-140"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/agent/line-asset-handoff" }] },
    { "id": "in.edge-heartbeat", "kind": "ENTRY", "system": "zuri-ai", "domain": "agent", "label": "Edge heartbeat และ pairing",
      "requirements": ["FR-141", "FR-144"], "decisions": ["ADR-041"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/agent/heartbeat" }, { "type": "ENDPOINT", "ref": "/api/edge/pairing/start" }, { "type": "UI", "ref": "/edge/pair" }] },
    { "id": "in.edge-conversation", "kind": "ENTRY", "system": "zuri-ai", "domain": "line-oa-studio", "label": "Edge conversation jobs (claim · complete)",
      "requirements": ["FR-150"], "decisions": ["ADR-061"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/edge/conversation-jobs/claim" }, { "type": "ENDPOINT", "ref": "/api/edge/conversation-jobs/[id]/complete" }],
      "production": { "evidence": ".brain/rca/2026-09-11-line-server-overlay-dropped-on-redeploy.md, 'Verified end to end, 2026-09-12': edge worker claim 200 (a job, not an empty 204) and complete 200" } },
    { "id": "in.edge-extraction", "kind": "ENTRY", "system": "zuri-ai", "domain": "asset-management", "label": "Edge extraction jobs (claim · evidence · complete)",
      "requirements": ["FR-143"], "decisions": ["ADR-059"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/edge/extraction-jobs/claim" }, { "type": "ENDPOINT", "ref": "/api/edge/extraction-jobs/[id]/evidence" }, { "type": "ENDPOINT", "ref": "/api/edge/extraction-jobs/[id]/complete" }] },
    { "id": "in.plan-intake", "kind": "ENTRY", "system": "zuri-ai", "domain": "project-manager", "label": "PlanEnvelope intake", "detail": "JSON · Excel · wizard · bundle · MCP — envelope เดียว (BR-009)",
      "requirements": ["FR-012", "FR-017", "FR-018", "FR-019", "FR-108"], "decisions": ["ADR-049"],
      "surfaces": [
        { "type": "ENDPOINT", "ref": "/api/import/dry-run" }, { "type": "ENDPOINT", "ref": "/api/import/commit" }, { "type": "ENDPOINT", "ref": "/api/import/xlsx" },
        { "type": "ENDPOINT", "ref": "/api/import/bundle/dry-run" }, { "type": "ENDPOINT", "ref": "/api/import/bundle/commit" },
        { "type": "MCP", "ref": "project_manager.plan_dry_run" }, { "type": "MCP", "ref": "project_manager.plan_commit" },
        { "type": "UI", "ref": "/projects/[projectId]/import" }],
      "production": { "evidence": "docs/roadmap/ROADMAP.md TASK-FR-108: the seventeen-stage plan was imported to production SmartGift through the bundle import (PRJ-KNOWLEDGE-17S)" } },
    { "id": "in.catalog-intake", "kind": "ENTRY", "system": "zuri-ai", "domain": "inventory", "label": "Catalogue intake", "detail": "JSON · Excel template · #sku ใน LINE",
      "requirements": ["FR-208", "FR-209", "FR-210"], "decisions": ["ADR-084"],
      "surfaces": [
        { "type": "ENDPOINT", "ref": "/api/inventory/catalog-intakes/preview" }, { "type": "ENDPOINT", "ref": "/api/inventory/catalog-intakes/commit" },
        { "type": "ENDPOINT", "ref": "/api/inventory/catalog-intakes/xlsx" }, { "type": "ENDPOINT", "ref": "/api/inventory/catalog-intakes/template" },
        { "type": "UI", "ref": "/inventory/catalog-intake" }],
      "production": { "evidence": "FR-208 status: migration 20260913200000_inventory_catalog_intake APPLIED on production 2026-09-13 (ADR-057) and main ada5188b deployed (PR #377)" } },
    { "id": "in.knowledge-admission", "kind": "ENTRY", "system": "zuri-ai", "domain": "knowledge", "label": "Knowledge admission", "detail": "Text/Markdown · FileAsset · SMARTGIFT_CATALOG_V1",
      "requirements": ["FR-173", "FR-187"], "decisions": ["ADR-072", "ADR-075"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/knowledge/ingestions" }, { "type": "MCP", "ref": "knowledge.ingestion_create" }, { "type": "UI", "ref": "/files" }] },
    { "id": "in.knowledge-query", "kind": "ENTRY", "system": "zuri-ai", "domain": "knowledge", "label": "Knowledge query และ citation",
      "requirements": ["FR-173", "FR-110"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/knowledge/queries" }, { "type": "MCP", "ref": "knowledge.query" }, { "type": "MCP", "ref": "knowledge.citation" }] },
    { "id": "in.knowledge-import", "kind": "ENTRY", "system": "zuri-ai", "domain": "knowledge", "label": "Business knowledge import", "detail": "governed export ของ SmartGift → business_knowledge",
      "requirements": ["FR-047"],
      "surfaces": [{ "type": "WORKER", "ref": "apps/server/scripts/export_smartgift_business_knowledge.py" }, { "type": "WORKER", "ref": "apps/server/scripts/build_business_knowledge_import.py" }],
      "production": { "evidence": "FR-047 status: Phase 1 active - owner-approved 2026-08-14" } },
    { "id": "in.pipeline-bridge", "kind": "ENTRY", "system": "zuri-ai", "domain": "knowledge", "label": "SmartGift pipeline bridge (data_pipeline.*)", "detail": "EVIDENCE_ONLY ผ่าน Codex worker",
      "requirements": ["FR-071"], "decisions": ["ADR-030", "ADR-040"],
      "surfaces": [
        { "type": "MCP", "ref": "data_pipeline.run_create" }, { "type": "MCP", "ref": "data_pipeline.document_stage" }, { "type": "MCP", "ref": "data_pipeline.event_record" },
        { "type": "ENDPOINT", "ref": "/api/pipelines/runs" }, { "type": "ENDPOINT", "ref": "/api/pipelines/runs/[executionRunId]/events" }] },
    { "id": "in.gks-evidence", "kind": "ENTRY", "system": "zuri-ai", "domain": "knowledge", "label": "GKS stage evidence (push · pull)",
      "requirements": ["FR-109", "FR-110"], "decisions": ["ADR-067", "ADR-068"],
      "surfaces": [
        { "type": "ENDPOINT", "ref": "/api/pipelines/knowledge/[executionRunId]/stages" }, { "type": "ENDPOINT", "ref": "/api/pipelines/knowledge/[executionRunId]/gate" },
        { "type": "ENDPOINT", "ref": "/api/pipelines/knowledge/[executionRunId]/finish" }, { "type": "ENDPOINT", "ref": "/api/pipelines/knowledge/evidence/pull" }] },
    { "id": "in.asset-evidence", "kind": "ENTRY", "system": "zuri-ai", "domain": "asset-management", "label": "Asset evidence intake", "detail": "อัปโหลดหลักฐาน · xlsx · Google Sheets snapshot",
      "requirements": ["FR-137", "FR-139"], "decisions": ["ADR-056"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/assets/evidence" }, { "type": "ENDPOINT", "ref": "/api/assets/import/xlsx" }, { "type": "ENDPOINT", "ref": "/api/assets/import/sheets" }, { "type": "UI", "ref": "/assets/receiving" }] },
    { "id": "in.market-translation", "kind": "ENTRY", "system": "zuri-ai", "domain": "market-intelligence", "label": "Market translation trigger",
      "requirements": ["FR-092"], "decisions": ["ADR-038"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/market/translations" }, { "type": "UI", "ref": "/market" }],
      "production": { "evidence": "FR-092 status: production translation trigger delivered 2026-09-03 (POST /api/market/translations, owner-only)" } },
    { "id": "in.customer-backfill", "kind": "ENTRY", "system": "zuri-ai", "domain": "crm", "label": "Customer backfill และ review queue",
      "requirements": ["FR-078"],
      "surfaces": [
        { "type": "WORKER", "ref": "apps/server/scripts/build_smartgift_customer_backfill.py" }, { "type": "WORKER", "ref": "apps/server/scripts/apply_smartgift_customer_backfill.py" },
        { "type": "ENDPOINT", "ref": "/api/platform/customer-import-reviews" }, { "type": "UI", "ref": "/platform/customer-import-reviews" }],
      "production": { "evidence": "FR-078 status: production queue, application schema/identity projection and CUSTOMER_DATA_REVIEWER binding verified" } },
    { "id": "in.sot-submit", "kind": "ENTRY", "system": "zuri-ai", "domain": "integration", "label": "SoT plan และ decision submit", "detail": "SotDataPlaneKey",
      "requirements": ["FR-099", "FR-102"], "decisions": ["ADR-047"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/platform/sot/plan" }, { "type": "ENDPOINT", "ref": "/api/platform/sot/decisions" }, { "type": "UI", "ref": "/platform/sot-pipeline" }],
      "production": { "evidence": "FR-100 status: Supabase migration applied and ledger-recorded 2026-08-27 (RSK-016 closed); FR-102 data-plane authentication implemented" } },
    { "id": "in.goods-receipt", "kind": "ENTRY", "system": "zuri-ai", "domain": "procurement", "label": "Goods receipt ตาม PO",
      "requirements": ["FR-165"], "decisions": ["ADR-066"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/procurement/purchase-orders/[id]/receipts" }, { "type": "UI", "ref": "/procurement/receipts" }] },
    { "id": "in.pos-checkout", "kind": "ENTRY", "system": "zuri-ai", "domain": "commerce", "label": "POS checkout",
      "requirements": ["FR-183"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/commerce/pos/checkout" }, { "type": "UI", "ref": "/commerce/pos" }] },
    { "id": "in.rich-menu-design", "kind": "ENTRY", "system": "zuri-ai", "domain": "line-oa-studio", "label": "Rich menu designer",
      "requirements": ["FR-151"], "decisions": ["ADR-060"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/line-oa/rich-menus" }, { "type": "UI", "ref": "/line-oa/rich-menus" }] },
    { "id": "in.marketing-handoff", "kind": "ENTRY", "system": "zuri-ai", "domain": "marketing", "label": "Marketing execution handoff",
      "requirements": ["FR-158"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/growth/plans/[id]/handoff" }, { "type": "UI", "ref": "/growth/operations" }] },
    { "id": "in.broadcast-planning", "kind": "ENTRY", "system": "zuri-ai", "domain": "marketing", "label": "LINE broadcast planning", "detail": "dispatch เป็นสถานะ unavailable โดยตั้งใจ",
      "requirements": ["FR-185"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/growth/broadcast-intents" }, { "type": "UI", "ref": "/growth/broadcast" }] },
    { "id": "in.flowaccount-pull", "kind": "ENTRY", "system": "zuri-ai", "domain": "integration", "label": "FlowAccount read-only pull",
      "requirements": ["FR-125"], "decisions": ["ADR-053"] },
    { "id": "in.github-projection", "kind": "ENTRY", "system": "zuri-ai", "domain": "integration", "label": "GitHub repository projection",
      "requirements": ["FR-130"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/repositories" }, { "type": "UI", "ref": "/repositories" }],
      "blocked": "Repository records are local metadata; the GitHub read and webhook projection is blocked on the PII attestation gap recorded in FR-130's feature note" },

    { "id": "p.line-jobs", "kind": "PROCESS", "system": "zuri-ai", "domain": "line-oa-studio", "label": "LINE conversation jobs + line-worker", "detail": "LineConversationJob ledger, reply/push transport, transport health",
      "requirements": ["FR-149", "FR-190"], "decisions": ["ADR-061"],
      "surfaces": [{ "type": "WORKER", "ref": "apps/server/scripts/server-line-worker.mjs" }, { "type": "ENDPOINT", "ref": "/api/line-oa/worker" }, { "type": "ENDPOINT", "ref": "/api/line-oa/jobs/failures" }, { "type": "UI", "ref": "/line-oa/live-crm" }],
      "production": { "evidence": ".brain/rca/2026-09-11-line-server-overlay-dropped-on-redeploy.md, 'Verified end to end, 2026-09-12': line-worker returned to IDLE with nothing pending; line-worker ticks 200 IDLE after the 2026-09-13 deploy of release-eb1fcfa8" } },
    { "id": "p.agent-turn", "kind": "PROCESS", "system": "zuri-ai", "domain": "agent", "label": "Agent turn (server)", "detail": "ประกอบบริบท: identity · CRM history · business knowledge · SmartGift tools · policy → model → verified reply · execution trace",
      "requirements": ["FR-171", "FR-098", "FR-181"], "decisions": ["ADR-070"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/modules/agent/turn.js" }, { "type": "ENDPOINT", "ref": "/api/line-oa/jobs/[id]/trace" }] },
    { "id": "p.edge-execution", "kind": "PROCESS", "system": "edge", "domain": "line-oa-studio", "label": "Edge Device execution", "detail": "รอบสนทนาด้วย local model และ vision extraction บน device",
      "requirements": ["FR-150", "FR-143"], "decisions": ["ADR-059", "ADR-061"],
      "surfaces": [{ "type": "FILE", "ref": "apps/edge/src/answer/providers/openai-compatible.ts" }],
      "production": { "evidence": ".brain/rca/2026-09-11-line-server-overlay-dropped-on-redeploy.md, 'Verified end to end, 2026-09-12': a real LINE message was claimed and completed by the edge worker on desktop-vetatmq (conversation jobs only; edge extraction is not production-evidenced)" } },
    { "id": "p.plan-import", "kind": "PROCESS", "system": "zuri-ai", "domain": "project-manager", "label": "Plan import (dry run → commit)", "detail": "writer เดียวของ Project system, AuditEvent + receipt",
      "requirements": ["FR-012", "FR-108"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/modules/project-manager/import/plan-import-service.js" }],
      "production": { "evidence": "docs/roadmap/ROADMAP.md TASK-FR-108: the seventeen-stage plan was imported to production SmartGift through the bundle import (PRJ-KNOWLEDGE-17S)" } },
    { "id": "p.catalog-planner", "kind": "PROCESS", "system": "zuri-ai", "domain": "inventory", "label": "Catalogue planner (resolve ก่อนสร้าง)",
      "requirements": ["FR-208"], "decisions": ["ADR-084"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/modules/inventory/application/catalog-intake-service.js" }],
      "production": { "evidence": "FR-208 status: migration 20260913200000_inventory_catalog_intake APPLIED on production 2026-09-13 and main ada5188b deployed (PR #377)" } },
    { "id": "p.knowledge-tier1", "kind": "PROCESS", "system": "zuri-ai", "domain": "knowledge", "label": "GenesisRAG17 Tier 1 (Stage 1–8) + MSP handoff",
      "requirements": ["FR-109", "FR-173"], "decisions": ["ADR-050", "ADR-073"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/modules/knowledge/ingestion-job.js" }, { "type": "FILE", "ref": "apps/server/src/platform/integrations/core/genesisrag17-worker.js" }] },
    { "id": "p.knowledge-candidate-review", "kind": "PROCESS", "system": "zuri-ai", "domain": "knowledge", "label": "LINE FAQ candidate draft + review", "detail": "consent-gated extractor เหนือ CRM read projection → OWNER / LINE_OA_PUBLISHER แก้ไข อนุมัติ หรือปฏิเสธ (audited)",
      "requirements": ["FR-236"], "decisions": ["ADR-090"],
      "surfaces": [
        { "type": "ENDPOINT", "ref": "/api/knowledge/candidates" }, { "type": "ENDPOINT", "ref": "/api/knowledge/candidates/[id]" },
        { "type": "ENDPOINT", "ref": "/api/knowledge/candidates/[id]/decision" }, { "type": "UI", "ref": "/knowledge/candidates" }] },
    { "id": "p.knowledge-gap-report", "kind": "PROCESS", "system": "zuri-ai", "domain": "knowledge", "label": "LINE knowledge gap report", "detail": "รวม EVIDENCE_SELECTED (reason=NO_EVIDENCE) ต่อ Business เป็นจำนวน, product locator (ถ้าทราบ) และเวลาล่าสุดเท่านั้น — คำนวณจาก AgentTraceEvent ที่มีอยู่ ไม่มี store ใหม่ ไม่มีข้อความคำถาม",
      "requirements": ["FR-237"], "decisions": ["ADR-090"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/knowledge/gap-report" }, { "type": "UI", "ref": "/knowledge/gap-report" }] },
    { "id": "p.raw-ingestion", "kind": "PROCESS", "system": "zuri-ai", "domain": "integration", "label": "Raw external ingestion boundary", "detail": "envelope เดียว, redaction, ExternalRef",
      "requirements": ["FR-081"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/platform/integrations/core/raw-ingest-service.js" }] },
    { "id": "p.market-translator", "kind": "PROCESS", "system": "zuri-ai", "domain": "market-intelligence", "label": "Market translator + GKS product resolve",
      "requirements": ["FR-092"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/modules/market-intelligence/application/translate-raw-record.js" }],
      "production": { "evidence": "FR-092 status: production translation trigger delivered 2026-09-03" } },
    { "id": "p.asset-extraction", "kind": "PROCESS", "system": "zuri-ai", "domain": "asset-management", "label": "Asset evidence extraction", "detail": "OpenAI adapter หรือ extraction job ของ Edge (ADR-059)",
      "requirements": ["FR-138", "FR-143"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/modules/asset-management/infrastructure/openai-asset-evidence-extractor.js" }, { "type": "ENDPOINT", "ref": "/api/assets/evidence/[id]/extract" }] },
    { "id": "p.asset-review", "kind": "PROCESS", "system": "zuri-ai", "domain": "asset-management", "label": "Human review ของ candidate", "detail": "ACCEPT · CORRECT · REJECT แบบ immutable (BR-025)",
      "requirements": ["FR-138"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/assets/evidence/[id]/review" }, { "type": "UI", "ref": "/assets/receiving" }] },
    { "id": "p.sot-decisions", "kind": "PROCESS", "system": "zuri-ai", "domain": "integration", "label": "SoT decision inbox และ export",
      "requirements": ["FR-100"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/platform/sot/decisions/[decisionId]/decide" }, { "type": "ENDPOINT", "ref": "/api/platform/sot/decisions/export" }, { "type": "UI", "ref": "/platform/sot-pipeline/inbox" }],
      "production": { "evidence": "FR-100 status: Supabase migration applied and ledger-recorded 2026-08-27 (RSK-016 closed)" } },
    { "id": "p.commerce-ledger", "kind": "PROCESS", "system": "zuri-ai", "domain": "commerce", "label": "Revenue และ billing documents", "detail": "รายได้จาก payment ที่ VERIFIED เท่านั้น, snapshot เอกสารภาษี",
      "requirements": ["FR-163", "FR-186"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/commerce/revenue" }, { "type": "ENDPOINT", "ref": "/api/commerce/billing/documents" }, { "type": "UI", "ref": "/commerce/invoices" }] },
    { "id": "p.stock-atp", "kind": "PROCESS", "system": "zuri-ai", "domain": "inventory", "label": "Available-to-Promise และ landed cost",
      "requirements": ["FR-180", "FR-175"], "decisions": ["ADR-074"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/inventory/reservations" }, { "type": "UI", "ref": "/inventory/reservations" }] },
    { "id": "p.rich-menu-jobs", "kind": "PROCESS", "system": "zuri-ai", "domain": "line-oa-studio", "label": "Rich menu publish jobs",
      "requirements": ["FR-152", "FR-153"], "decisions": ["ADR-061"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/line-oa/rich-menu-worker" }] },
    { "id": "p.conversation-analysis", "kind": "PROCESS", "system": "zuri-ai", "domain": "crm", "label": "Conversation analysis → Daily Sales Brief", "detail": "ยังไม่มี producer; brief ประกาศไว้เท่านั้น",
      "requirements": ["FR-127", "FR-128"], "decisions": ["ADR-054"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/modules/crm/conversation-analysis-service.js" }] },
    { "id": "p.readiness-projection", "kind": "PROCESS", "system": "zuri-ai", "domain": "project-manager", "label": "Doc graph → readiness และ pipeline map projection",
      "requirements": ["FR-124", "FR-211", "FR-212"], "decisions": ["ADR-081", "ADR-085"],
      "surfaces": [{ "type": "WORKER", "ref": "apps/server/scripts/doc-graph.mjs" }, { "type": "WORKER", "ref": "apps/server/scripts/data-pipeline-map.mjs" }, { "type": "UI", "ref": "/platform/product-readiness" }, { "type": "UI", "ref": "/control/roadmap" }],
      "production": { "evidence": "release-eb1fcfa8 deployed 2026-09-13 carries runtime/domain-state.json; /control/roadmap and its domain map tab (FR-211) read it in that image" } },
    { "id": "p.backup-export", "kind": "PROCESS", "system": "zuri-ai", "domain": "project-manager", "label": "Backup export",
      "requirements": ["FR-013", "FR-045"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/backup/export" }, { "type": "UI", "ref": "/backup" }] },

    { "id": "s.crm", "kind": "STORE", "system": "zuri-ai", "domain": "crm", "label": "CRM: Customer · Conversation · Message",
      "requirements": ["FR-023", "FR-091", "FR-148"],
      "surfaces": [{ "type": "UI", "ref": "/customer/conversations" }],
      "production": { "evidence": "ADR-061 D4: the server-owned webhook commits evidence, the CRM inbound message and the job in one transaction before it answers 200; .brain/rca/2026-09-11-line-server-overlay-dropped-on-redeploy.md records real deliveries answered 200 on production on 2026-09-12" } },
    { "id": "s.project-data", "kind": "STORE", "system": "zuri-ai", "domain": "project-manager", "label": "Project system: Project · Workstream · WorkItem",
      "requirements": ["FR-003", "FR-012"],
      "surfaces": [{ "type": "MCP", "ref": "project_manager.work_read" }, { "type": "UI", "ref": "/projects" }] },
    { "id": "s.catalogue", "kind": "STORE", "system": "zuri-ai", "domain": "inventory", "label": "Catalogue: ProductMaster · Product · identifiers",
      "requirements": ["FR-154", "FR-203"],
      "surfaces": [{ "type": "UI", "ref": "/inventory/products/[productId]" }] },
    { "id": "s.stock-ledger", "kind": "STORE", "system": "zuri-ai", "domain": "inventory", "label": "Stock ledger: StockMovement",
      "requirements": ["FR-155", "FR-175"],
      "surfaces": [{ "type": "UI", "ref": "/inventory" }] },
    { "id": "s.pipeline-ledger", "kind": "STORE", "system": "zuri-ai", "domain": "knowledge", "label": "Pipeline ledger: PipelineRun · Step · Attempt", "detail": "DPL-KNOWLEDGE-INGEST-V1 และ DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1",
      "requirements": ["FR-071"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/pipelines/runs/[executionRunId]" }, { "type": "UI", "ref": "/execution/[mode]" }] },
    { "id": "s.knowledge-corpus", "kind": "STORE", "system": "zuri-ai", "domain": "knowledge", "label": "Knowledge lineage, receipts และ corpus generations",
      "requirements": ["FR-110", "FR-173"] },
    { "id": "s.knowledge-candidates", "kind": "STORE", "system": "zuri-ai", "domain": "knowledge", "label": "KnowledgeCandidate (LINE FAQ, PENDING_REVIEW · APPROVED · REJECTED · TOMBSTONED)",
      "requirements": ["FR-236"], "decisions": ["ADR-090"],
      "surfaces": [{ "type": "UI", "ref": "/knowledge/candidates" }] },
    { "id": "s.business-knowledge", "kind": "STORE", "system": "zuri-ai", "domain": "knowledge", "label": "zuri_core.business_knowledge", "detail": "registered queries เท่านั้น, PUBLIC sensitivity",
      "requirements": ["FR-047"],
      "production": { "evidence": "FR-047 status: Phase 1 active - owner-approved 2026-08-14" } },
    { "id": "s.raw-records", "kind": "STORE", "system": "zuri-ai", "domain": "integration", "label": "RawExternalRecord",
      "requirements": ["FR-081"] },
    { "id": "s.object-storage", "kind": "STORE", "system": "zuri-ai", "domain": "asset-management", "label": "Supabase Storage: asset-evidence bucket", "detail": "private, REST ด้วย service-role key บน server",
      "requirements": ["FR-137"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/src/platform/storage/supabase-object-storage.js" }] },
    { "id": "s.asset-register", "kind": "STORE", "system": "zuri-ai", "domain": "asset-management", "label": "Asset register",
      "requirements": ["FR-133"],
      "surfaces": [{ "type": "UI", "ref": "/assets/register" }] },
    { "id": "s.market-observations", "kind": "STORE", "system": "zuri-ai", "domain": "market-intelligence", "label": "MarketObservation",
      "requirements": ["FR-092"],
      "surfaces": [{ "type": "ENDPOINT", "ref": "/api/market/observations" }, { "type": "UI", "ref": "/market" }],
      "production": { "evidence": "FR-092 status: production translation trigger delivered 2026-09-03" } },
    { "id": "s.sot-decisions", "kind": "STORE", "system": "zuri-ai", "domain": "integration", "label": "SotDecision",
      "requirements": ["FR-100"],
      "production": { "evidence": "FR-100 status: Supabase migration applied and ledger-recorded 2026-08-27" } },
    { "id": "s.commerce", "kind": "STORE", "system": "zuri-ai", "domain": "commerce", "label": "SalesOrder · Payment",
      "requirements": ["FR-166", "FR-163"],
      "surfaces": [{ "type": "UI", "ref": "/commerce/orders" }] },
    { "id": "s.line-oa-config", "kind": "STORE", "system": "zuri-ai", "domain": "line-oa-studio", "label": "LineOaAccount · rich menu versions",
      "requirements": ["FR-146", "FR-151"] },
    { "id": "s.agent-trace", "kind": "STORE", "system": "zuri-ai", "domain": "agent", "label": "AgentTraceEvent (execution trace)",
      "requirements": ["FR-171"] },
    { "id": "s.domain-state", "kind": "STORE", "system": "zuri-ai", "domain": "project-manager", "label": "runtime/domain-state.json · data-pipeline-map.json",
      "requirements": ["FR-124", "FR-212"],
      "surfaces": [{ "type": "FILE", "ref": "apps/server/runtime/domain-state.json" }],
      "production": { "evidence": "release-eb1fcfa8 deployed 2026-09-13 ships runtime/domain-state.json" } },

    { "id": "r.line-api", "kind": "RECIPIENT", "system": "external", "label": "LINE Messaging API → ผู้ใช้ LINE", "detail": "reply · push · rich menu" },
    { "id": "r.model-providers", "kind": "RECIPIENT", "system": "external", "label": "Model providers", "detail": "OpenAI · Anthropic · Gemini · OpenRouter · Groq" },
    { "id": "r.msp", "kind": "RECIPIENT", "system": "external", "label": "MSP (Tier 2) → GKS → GenesisBlockDB", "detail": "stdio ด้วย env ที่ allowlist" },
    { "id": "r.api-clients", "kind": "RECIPIENT", "system": "external", "label": "MCP · Enterprise API clients (ผลลัพธ์)" },
    { "id": "r.sot-data-plane", "kind": "RECIPIENT", "system": "external", "label": "SoT data plane (ดึง decision กลับ)" },
    { "id": "r.staff", "kind": "RECIPIENT", "system": "external", "label": "เจ้าของ / พนักงาน (dashboard · รายงาน · เอกสาร)" },
    { "id": "r.operator", "kind": "RECIPIENT", "system": "external", "label": "Operator (ไฟล์ backup)" }
  ],

  "edges": [
    { "id": "e.line-to-webhook", "from": "src.line-users", "to": "in.line-webhook", "label": "ข้อความและ event ที่ LINE ลงลายเซ็น" },
    { "id": "e.line-to-legacy", "from": "src.line-users", "to": "in.line-legacy", "label": "event ผ่าน transport เดิม" },
    { "id": "e.line-to-asset-handoff", "from": "src.line-users", "to": "in.line-asset-handoff", "label": "FileAsset id จาก LINE" },
    { "id": "e.webhook-to-jobs", "from": "in.line-webhook", "to": "p.line-jobs", "label": "evidence + CRM inbound + job (ธุรกรรมเดียว)" },
    { "id": "e.jobs-to-crm", "from": "p.line-jobs", "to": "s.crm", "label": "ข้อความขาเข้า / ขาออก" },
    { "id": "e.legacy-to-raw", "from": "in.line-legacy", "to": "p.raw-ingestion", "label": "normalized envelope" },
    { "id": "e.raw-to-records", "from": "p.raw-ingestion", "to": "s.raw-records", "label": "raw record (redacted)" },
    { "id": "e.legacy-to-agent", "from": "in.line-legacy", "to": "p.agent-turn", "label": "handleAgentTurn" },
    { "id": "e.jobs-to-edge", "from": "p.line-jobs", "to": "p.edge-execution", "label": "งานสนทนาที่ device claim (edgk_)" },
    { "id": "e.edge-to-complete", "from": "p.edge-execution", "to": "in.edge-conversation", "label": "คำตอบจาก device" },
    { "id": "e.complete-to-jobs", "from": "in.edge-conversation", "to": "p.line-jobs", "label": "settle job" },
    { "id": "e.jobs-to-line", "from": "p.line-jobs", "to": "r.line-api", "label": "reply / push (retry key)" },
    { "id": "e.jobs-to-agent", "from": "p.line-jobs", "to": "p.agent-turn", "label": "งานที่ server ตอบเอง" },
    { "id": "e.agent-to-jobs", "from": "p.agent-turn", "to": "p.line-jobs", "label": "คำตอบที่ตรวจแล้ว" },
    { "id": "e.agent-to-models", "from": "p.agent-turn", "to": "r.model-providers", "label": "คำถาม + evidence packet (policy ALLOW)" },
    { "id": "e.crm-to-agent", "from": "s.crm", "to": "p.agent-turn", "label": "ประวัติสนทนา · ตัวตนลูกค้า" },
    { "id": "e.knowledge-to-agent", "from": "s.business-knowledge", "to": "p.agent-turn", "label": "registered query → evidence records" },
    { "id": "e.atp-to-agent", "from": "p.stock-atp", "to": "p.agent-turn", "label": "ATP · landed cost (FR-181 tools)" },
    { "id": "e.agent-to-trace", "from": "p.agent-turn", "to": "s.agent-trace", "label": "execution trace" },
    { "id": "e.handoff-to-asset", "from": "in.line-asset-handoff", "to": "p.asset-extraction", "label": "evidence intake จาก LINE" },
    { "id": "e.device-heartbeat", "from": "src.edge-device", "to": "in.edge-heartbeat", "label": "heartbeat · pairing request" },

    { "id": "e.staff-to-plan", "from": "src.staff", "to": "in.plan-intake", "label": "wizard · xlsx · bundle" },
    { "id": "e.clients-to-plan", "from": "src.api-clients", "to": "in.plan-intake", "label": "PlanEnvelope ผ่าน MCP / Enterprise API" },
    { "id": "e.staff-to-handoff", "from": "src.staff", "to": "in.marketing-handoff", "label": "ส่งแผนการตลาดเข้า Development" },
    { "id": "e.handoff-to-plan", "from": "in.marketing-handoff", "to": "in.plan-intake", "label": "strategy → PlanEnvelope" },
    { "id": "e.plan-to-import", "from": "in.plan-intake", "to": "p.plan-import", "label": "validate → dry run → preview" },
    { "id": "e.import-to-project", "from": "p.plan-import", "to": "s.project-data", "label": "commit ธุรกรรมเดียว + AuditEvent" },
    { "id": "e.project-to-staff", "from": "s.project-data", "to": "r.staff", "label": "Board · Schedule · Dashboard" },
    { "id": "e.project-to-clients", "from": "s.project-data", "to": "r.api-clients", "label": "project_manager.work_read" },

    { "id": "e.staff-to-catalog", "from": "src.staff", "to": "in.catalog-intake", "label": "JSON · Excel template" },
    { "id": "e.catalog-to-planner", "from": "in.catalog-intake", "to": "p.catalog-planner", "label": "resolve ก่อนสร้าง · preview hash" },
    { "id": "e.jobs-to-catalog", "from": "p.line-jobs", "to": "p.catalog-planner", "label": "#sku จากพนักงานที่ยืนยันแล้ว" },
    { "id": "e.planner-to-jobs", "from": "p.catalog-planner", "to": "p.line-jobs", "label": "preview / ยืนยัน กลับเข้าแชท" },
    { "id": "e.planner-to-catalogue", "from": "p.catalog-planner", "to": "s.catalogue", "label": "commit ทั้งชุดหรือไม่บันทึกเลย" },
    { "id": "e.catalogue-to-staff", "from": "s.catalogue", "to": "r.staff", "label": "หน้า SKU · Hygiene" },
    { "id": "e.catalogue-to-atp", "from": "s.catalogue", "to": "p.stock-atp", "label": "SKU · recipe" },

    { "id": "e.staff-to-admission", "from": "src.staff", "to": "in.knowledge-admission", "label": "Text/Markdown · FileAsset" },
    { "id": "e.smartgift-to-admission", "from": "src.smartgift", "to": "in.knowledge-admission", "label": "SMARTGIFT_CATALOG_V1 projection" },
    { "id": "e.clients-to-admission", "from": "src.api-clients", "to": "in.knowledge-admission", "label": "knowledge.ingestion_create" },
    { "id": "e.admission-to-tier1", "from": "in.knowledge-admission", "to": "p.knowledge-tier1", "label": "freeze bytes / hash → Stage 1" },
    { "id": "e.tier1-to-msp", "from": "p.knowledge-tier1", "to": "r.msp", "label": "batch Stage 1–8 → GKS 9–12,14 → GenesisBlockDB 13 + publish" },
    { "id": "e.tier1-to-ledger", "from": "p.knowledge-tier1", "to": "s.pipeline-ledger", "label": "PipelineRun DPL-KNOWLEDGE-INGEST-V1" },
    { "id": "e.tier1-to-corpus", "from": "p.knowledge-tier1", "to": "s.knowledge-corpus", "label": "lineage · receipt · generation" },
    { "id": "e.gks-to-evidence", "from": "src.gks", "to": "in.gks-evidence", "label": "stage evidence (push · pull ผ่าน MSP)" },
    { "id": "e.evidence-to-ledger", "from": "in.gks-evidence", "to": "s.pipeline-ledger", "label": "attempt ของ Stage 9–17" },
    { "id": "e.ledger-to-staff", "from": "s.pipeline-ledger", "to": "r.staff", "label": "Data Migration monitor" },
    { "id": "e.clients-to-query", "from": "src.api-clients", "to": "in.knowledge-query", "label": "คำถาม (HTTP / MCP)" },
    { "id": "e.query-to-corpus", "from": "in.knowledge-query", "to": "s.knowledge-corpus", "label": "published snapshot เท่านั้น" },
    { "id": "e.corpus-to-clients", "from": "s.knowledge-corpus", "to": "r.api-clients", "label": "คำตอบพร้อม citation" },
    { "id": "e.smartgift-to-import", "from": "src.smartgift", "to": "in.knowledge-import", "label": "governed export" },
    { "id": "e.import-to-bk", "from": "in.knowledge-import", "to": "s.business-knowledge", "label": "business_knowledge rows" },
    { "id": "e.smartgift-to-bridge", "from": "src.smartgift", "to": "in.pipeline-bridge", "label": "หลักฐานที่ redact แล้ว ผ่าน Codex worker" },
    { "id": "e.bridge-to-ledger", "from": "in.pipeline-bridge", "to": "s.pipeline-ledger", "label": "run · stage · record events" },

    { "id": "e.staff-to-asset", "from": "src.staff", "to": "in.asset-evidence", "label": "อัปโหลดหลักฐาน" },
    { "id": "e.suppliers-to-asset", "from": "src.suppliers", "to": "in.asset-evidence", "label": "ใบเสร็จ · xlsx · Sheets snapshot" },
    { "id": "e.asset-to-storage", "from": "in.asset-evidence", "to": "s.object-storage", "label": "ไฟล์หลักฐาน (private bucket)" },
    { "id": "e.asset-to-extraction", "from": "in.asset-evidence", "to": "p.asset-extraction", "label": "สั่ง extract" },
    { "id": "e.storage-to-extraction", "from": "s.object-storage", "to": "p.asset-extraction", "label": "bytes ของหลักฐาน" },
    { "id": "e.extraction-to-models", "from": "p.asset-extraction", "to": "r.model-providers", "label": "หลักฐาน → vision model" },
    { "id": "e.extraction-to-edge", "from": "p.asset-extraction", "to": "p.edge-execution", "label": "extraction job + bytes ใต้ lease" },
    { "id": "e.edge-to-extraction-in", "from": "p.edge-execution", "to": "in.edge-extraction", "label": "candidate (complete)" },
    { "id": "e.extraction-in-to-review", "from": "in.edge-extraction", "to": "p.asset-review", "label": "candidate รอตรวจ" },
    { "id": "e.extraction-to-review", "from": "p.asset-extraction", "to": "p.asset-review", "label": "candidate รอตรวจ" },
    { "id": "e.review-to-register", "from": "p.asset-review", "to": "s.asset-register", "label": "ACCEPT / CORRECT" },
    { "id": "e.register-to-staff", "from": "s.asset-register", "to": "r.staff", "label": "Asset register" },

    { "id": "e.market-to-raw", "from": "src.market-sources", "to": "p.raw-ingestion", "label": "listing / ราคา (adapter ยังไม่ wire)", "wired": false },
    { "id": "e.records-to-translator", "from": "s.raw-records", "to": "p.market-translator", "label": "raw record ที่ยังไม่แปล" },
    { "id": "e.staff-to-translation", "from": "src.staff", "to": "in.market-translation", "label": "สั่งแปล (owner)" },
    { "id": "e.translation-to-translator", "from": "in.market-translation", "to": "p.market-translator", "label": "trigger" },
    { "id": "e.translator-to-observations", "from": "p.market-translator", "to": "s.market-observations", "label": "MarketObservation" },
    { "id": "e.observations-to-staff", "from": "s.market-observations", "to": "r.staff", "label": "/market" },

    { "id": "e.smartgift-to-backfill", "from": "src.smartgift", "to": "in.customer-backfill", "label": "ประวัติลูกค้า (read-only source)" },
    { "id": "e.backfill-to-crm", "from": "in.customer-backfill", "to": "s.crm", "label": "Person · Customer + review queue" },
    { "id": "e.crm-to-analysis", "from": "s.crm", "to": "p.conversation-analysis", "label": "ข้อความที่มี consent" },
    { "id": "e.analysis-to-line", "from": "p.conversation-analysis", "to": "r.line-api", "label": "Daily Sales Brief (FR-128 declared)", "wired": false },

    { "id": "e.dataplane-to-sot", "from": "src.sot-data-plane", "to": "in.sot-submit", "label": "plan · decision request" },
    { "id": "e.sot-to-decisions", "from": "in.sot-submit", "to": "s.sot-decisions", "label": "SotDecision" },
    { "id": "e.decisions-to-inbox", "from": "s.sot-decisions", "to": "p.sot-decisions", "label": "รอคนตัดสิน" },
    { "id": "e.staff-to-inbox", "from": "src.staff", "to": "p.sot-decisions", "label": "ตัดสินใน inbox" },
    { "id": "e.inbox-to-dataplane", "from": "p.sot-decisions", "to": "r.sot-data-plane", "label": "export?since= decisions" },

    { "id": "e.suppliers-to-receipt", "from": "src.suppliers", "to": "in.goods-receipt", "label": "ของที่ส่งมอบตาม PO" },
    { "id": "e.receipt-to-ledger", "from": "in.goods-receipt", "to": "s.stock-ledger", "label": "RECEIPT movement (PO/GRN)" },
    { "id": "e.ledger-to-atp", "from": "s.stock-ledger", "to": "p.stock-atp", "label": "on-hand ที่คำนวณใหม่" },
    { "id": "e.staff-to-pos", "from": "src.staff", "to": "in.pos-checkout", "label": "ขายหน้าร้าน" },
    { "id": "e.pos-to-commerce", "from": "in.pos-checkout", "to": "s.commerce", "label": "SalesOrder + Payment PENDING" },
    { "id": "e.pos-to-ledger", "from": "in.pos-checkout", "to": "s.stock-ledger", "label": "ตัดสต๊อก" },
    { "id": "e.commerce-to-billing", "from": "s.commerce", "to": "p.commerce-ledger", "label": "payment ที่ VERIFIED" },
    { "id": "e.billing-to-staff", "from": "p.commerce-ledger", "to": "r.staff", "label": "รายได้ · ใบกำกับ / ใบเสร็จ" },

    { "id": "e.staff-to-richmenu", "from": "src.staff", "to": "in.rich-menu-design", "label": "ออกแบบ rich menu" },
    { "id": "e.richmenu-to-config", "from": "in.rich-menu-design", "to": "s.line-oa-config", "label": "version ที่ freeze" },
    { "id": "e.config-to-richmenu-jobs", "from": "s.line-oa-config", "to": "p.rich-menu-jobs", "label": "publish job" },
    { "id": "e.richmenu-jobs-to-line", "from": "p.rich-menu-jobs", "to": "r.line-api", "label": "rich menu JSON + image + default / alias" },
    { "id": "e.staff-to-broadcast", "from": "src.staff", "to": "in.broadcast-planning", "label": "broadcast intent" },
    { "id": "e.broadcast-to-line", "from": "in.broadcast-planning", "to": "r.line-api", "label": "dispatch (ยังไม่เปิด)", "wired": false },

    { "id": "e.repo-to-projection", "from": "src.repository", "to": "p.readiness-projection", "label": "docs · annotations · tests" },
    { "id": "e.projection-to-state", "from": "p.readiness-projection", "to": "s.domain-state", "label": "domain-state · data-pipeline-map" },
    { "id": "e.state-to-staff", "from": "s.domain-state", "to": "r.staff", "label": "Product Readiness · roadmap · pipeline map" },
    { "id": "e.staff-to-backup", "from": "src.staff", "to": "p.backup-export", "label": "สั่ง export" },
    { "id": "e.project-to-backup", "from": "s.project-data", "to": "p.backup-export", "label": "snapshot" },
    { "id": "e.backup-to-operator", "from": "p.backup-export", "to": "r.operator", "label": "ไฟล์ backup" },

    { "id": "e.flowaccount-to-pull", "from": "src.flowaccount", "to": "in.flowaccount-pull", "label": "read-only pull", "wired": false },
    { "id": "e.pull-to-raw", "from": "in.flowaccount-pull", "to": "p.raw-ingestion", "label": "envelope", "wired": false },
    { "id": "e.github-to-projection", "from": "src.github", "to": "in.github-projection", "label": "repo metadata", "wired": false },
    { "id": "e.github-to-project", "from": "in.github-projection", "to": "s.project-data", "label": "Repository links (local metadata)" },
    { "id": "e.corpus-to-agent", "from": "s.knowledge-corpus", "to": "p.agent-turn", "label": "published corpus → evidence ตาม grounding mode ของบัญชี (FR-235, ADR-090, ยังไม่ wire)", "wired": false },
    { "id": "e.crm-to-candidate-review", "from": "s.crm", "to": "p.knowledge-candidate-review", "label": "บทสนทนาที่ consent = GRANTED (FR-236, CRM read projection)" },
    { "id": "e.candidate-review-to-store", "from": "p.knowledge-candidate-review", "to": "s.knowledge-candidates", "label": "draft · edit · decision (audited)" },
    { "id": "e.candidate-review-to-admission", "from": "p.knowledge-candidate-review", "to": "in.knowledge-admission", "label": "อนุมัติแล้วเท่านั้น → TEXT source LINE_FAQ_CANDIDATE ก่อน Stage 1 (FR-236)" },
    { "id": "e.agent-trace-to-gap-report", "from": "s.agent-trace", "to": "p.knowledge-gap-report", "label": "อ่าน EVIDENCE_SELECTED (reason=NO_EVIDENCE) — คำนวณตอนอ่าน ไม่มี store ใหม่ (FR-237)" },
    { "id": "e.agent-to-msp-session", "from": "p.agent-turn", "to": "r.msp", "label": "MSP session tier ตาม memoryPolicy (FR-231, ADR-091, ปิดไว้จนกว่า MSP main มี thread + erase tool)", "wired": false }
  ],

  "chains": [
    { "id": "CH-01", "name": "LINE turn — ตอบบน Edge Device", "summary": "เส้นทางที่ใช้งานจริงบน production วันนี้",
      "path": ["e.line-to-webhook", "e.webhook-to-jobs", "e.jobs-to-edge", "e.edge-to-complete", "e.complete-to-jobs", "e.jobs-to-line"], "branches": ["e.jobs-to-crm"] },
    { "id": "CH-02", "name": "LINE turn — ตอบบน server", "summary": "ประกอบบริบทหลายแหล่งก่อนเรียก model",
      "path": ["e.line-to-webhook", "e.webhook-to-jobs", "e.jobs-to-agent", "e.agent-to-jobs", "e.jobs-to-line"],
      "branches": ["e.agent-to-models", "e.crm-to-agent", "e.knowledge-to-agent", "e.atp-to-agent", "e.agent-to-trace", "e.jobs-to-crm"] },
    { "id": "CH-03", "name": "Business knowledge → คำตอบใน LINE",
      "path": ["e.smartgift-to-import", "e.import-to-bk", "e.knowledge-to-agent", "e.agent-to-jobs", "e.jobs-to-line"], "branches": ["e.agent-to-models"] },
    { "id": "CH-04", "name": "Knowledge 17 stage → MSP / GKS / GenesisBlockDB",
      "path": ["e.staff-to-admission", "e.admission-to-tier1", "e.tier1-to-msp"],
      "branches": ["e.smartgift-to-admission", "e.clients-to-admission", "e.tier1-to-ledger", "e.tier1-to-corpus"] },
    { "id": "CH-05", "name": "GKS stage evidence → pipeline ledger → monitor",
      "path": ["e.gks-to-evidence", "e.evidence-to-ledger", "e.ledger-to-staff"] },
    { "id": "CH-06", "name": "คำถามความรู้ → คำตอบพร้อม citation",
      "path": ["e.clients-to-query", "e.query-to-corpus", "e.corpus-to-clients"] },
    { "id": "CH-07", "name": "SmartGift pipeline evidence → Data Migration monitor",
      "path": ["e.smartgift-to-bridge", "e.bridge-to-ledger", "e.ledger-to-staff"] },
    { "id": "CH-08", "name": "หลักฐานทรัพย์สิน → asset register",
      "path": ["e.staff-to-asset", "e.asset-to-extraction", "e.extraction-to-review", "e.review-to-register", "e.register-to-staff"],
      "branches": ["e.suppliers-to-asset", "e.asset-to-storage", "e.storage-to-extraction", "e.extraction-to-models", "e.extraction-to-edge", "e.extraction-in-to-review", "e.handoff-to-asset"] },
    { "id": "CH-09", "name": "ราคาตลาด → market observations",
      "path": ["e.market-to-raw", "e.raw-to-records", "e.records-to-translator", "e.translator-to-observations", "e.observations-to-staff"],
      "branches": ["e.translation-to-translator"] },
    { "id": "CH-10", "name": "PlanEnvelope → Project system",
      "path": ["e.staff-to-plan", "e.plan-to-import", "e.import-to-project", "e.project-to-staff"],
      "branches": ["e.clients-to-plan", "e.handoff-to-plan", "e.project-to-clients"] },
    { "id": "CH-11", "name": "Catalogue intake → catalogue",
      "path": ["e.staff-to-catalog", "e.catalog-to-planner", "e.planner-to-catalogue", "e.catalogue-to-staff"],
      "branches": ["e.jobs-to-catalog", "e.planner-to-jobs"] },
    { "id": "CH-12", "name": "รับของตาม PO → ATP → ราคาใน LINE",
      "path": ["e.suppliers-to-receipt", "e.receipt-to-ledger", "e.ledger-to-atp", "e.atp-to-agent", "e.agent-to-jobs", "e.jobs-to-line"],
      "branches": ["e.catalogue-to-atp", "e.agent-to-models"] },
    { "id": "CH-13", "name": "ขายหน้าร้าน → รายได้และเอกสาร",
      "path": ["e.staff-to-pos", "e.pos-to-commerce", "e.commerce-to-billing", "e.billing-to-staff"], "branches": ["e.pos-to-ledger"] },
    { "id": "CH-14", "name": "Rich menu → LINE",
      "path": ["e.staff-to-richmenu", "e.richmenu-to-config", "e.config-to-richmenu-jobs", "e.richmenu-jobs-to-line"] },
    { "id": "CH-15", "name": "SoT decision loop",
      "path": ["e.dataplane-to-sot", "e.sot-to-decisions", "e.decisions-to-inbox", "e.inbox-to-dataplane"], "branches": ["e.staff-to-inbox"] },
    { "id": "CH-16", "name": "Repository → readiness และ roadmap",
      "path": ["e.repo-to-projection", "e.projection-to-state", "e.state-to-staff"] },
    { "id": "CH-17", "name": "Backup export",
      "path": ["e.staff-to-backup", "e.backup-to-operator"], "branches": ["e.project-to-backup"] },
    { "id": "CH-18", "name": "Conversation analysis → Daily Sales Brief",
      "path": ["e.line-to-webhook", "e.webhook-to-jobs", "e.jobs-to-crm", "e.crm-to-analysis", "e.analysis-to-line"] },
    { "id": "CH-19", "name": "Broadcast planning → LINE",
      "path": ["e.staff-to-broadcast", "e.broadcast-to-line"] },
    { "id": "CH-20", "name": "ประวัติลูกค้าจาก SmartGift → บริบทของรอบสนทนา",
      "path": ["e.smartgift-to-backfill", "e.backfill-to-crm", "e.crm-to-agent", "e.agent-to-jobs", "e.jobs-to-line"] },
    { "id": "CH-21", "name": "LINE turn — grounded ด้วย corpus ที่ publish แล้ว", "summary": "ADR-090: อ่าน published corpus ก่อนเรียก model ตามโหมดของบัญชี business knowledge เป็น fallback ที่บันทึกใน trace",
      "path": ["e.line-to-webhook", "e.webhook-to-jobs", "e.jobs-to-agent", "e.agent-to-jobs", "e.jobs-to-line"],
      "branches": ["e.corpus-to-agent", "e.knowledge-to-agent", "e.agent-to-models", "e.agent-to-trace", "e.agent-to-msp-session", "e.jobs-to-crm"] },
    { "id": "CH-22", "name": "FAQ candidate จาก LINE → review → 17 stage → corpus", "summary": "ADR-090: ความรู้จากแชทเข้า GKS ได้เฉพาะ Q/A แบบ locator-only ที่คนอนุมัติ",
      "path": ["e.line-to-webhook", "e.webhook-to-jobs", "e.jobs-to-crm", "e.crm-to-candidate-review", "e.candidate-review-to-admission", "e.admission-to-tier1", "e.tier1-to-msp"],
      "branches": ["e.candidate-review-to-store", "e.staff-to-admission", "e.tier1-to-corpus"] }
  ]
}
```
<!-- data-pipeline-registry:end -->
