---
title: "ROADMAP: Business-01 SmartGift — Delivery"
doc_id: "ROADMAP-BUSINESS01-SMARTGIFT"
status: "approved"
version: "1.0.0"
updated: "2026-08-12"
owner: "Owen"
source_of_truth: true
live_document: true
---

# ROADMAP: Business-01 SmartGift — Delivery

สถานะจริงของงานส่งมอบ SmartGift (Business-01) — เขียนใน dialect เดียวกับ
`ROADMAP-zuri-v2-lab.md` เพื่อให้ GoVibe Mission Control อ่านเป็นอีก tab หนึ่ง
คู่กับ Zuri V2 ทุกแถวอ้างหลักฐานจริงในเวิร์กสเปซ (`D:\workspace\Bussiness-01-SmartGift`)

หลักฐานหลัก: `data/sot.duckdb` (SoT), `docs/SGMP01-state.md` (สถานะ pipeline D0–D8
สร้างจาก SoT), `docs/rag-design-genesisblockdb.md` (graph), `explore migrate-status
--json` (feed ที่ Mission Control อ่านได้)

> **กติกา denominator (จาก SGMP01-state.md):** ตัวเลขความคืบหน้าเป็นของ **Business-01
> เท่านั้น** (1 จาก 4 ธุรกิจในเครือ = 25%). ห้ามนำเสนอ coverage ของ SmartGift เป็น
> coverage ของทั้งเครือ

## Phases

| Phase | Goal | Exit Criteria | Status | Progress |
| --- | --- | --- | --- | --- |
| PHASE-SG-FOUNDATION | Shared foundation (ADR-007): extract MSP · Zuri identity primitive + full P3 gate + backend slice | MSP Gate A passed · FR-021 primitive + FR-023 slice + FR-022 P3 gate (link/erase/split) all tested | done | 100 |
| PHASE-SG-DATA | ไมเกรทเอกสารธุรกิจดิบ → DuckDB SoT ที่สะอาด มี provenance | SoT ครบ 13 ตาราง, ทุกแถวมีที่มา, business-01 ไฟล์เข้าครบ | done | 100 |
| PHASE-SG-GRAPH | ฉาย SoT เป็น knowledge graph (GenesisBlockDB) + RAG/MCP | graph sync + eval ผ่าน + MCP server อ่านอย่างเดียวใช้งานได้ | done | 92 |
| PHASE-SG-COPILOT | LINE OA ตอบคำถามธุรกิจ/วิเคราะห์/วิจัยเหนือข้อมูล SmartGift | ถามไทยผ่าน LINE → ตอบจาก SoT จริง พร้อม citation + guard | in-progress | 45 |
| PHASE-SG-CLOUD | Mirror SoT ขึ้น Supabase (DuckDB เป็น static/local) | ตาราง aggregate ขึ้น cloud, PDPA ตัดสินแล้ว | planned | 0 |
| PHASE-SG-SCALE | ออนบอร์ดอีก 3 ธุรกิจในเครือด้วย pipeline เดียวกัน | business 02–04 มี SoT + graph | planned | 0 |

## Backlog Items

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SG-DATA-SOT | PHASE-SG-DATA | task | สร้าง DuckDB SoT: 8,285 เอกสาร / 3,569 ลูกค้า / ใบเสนอราคา ฿1.29B / บิล ฿78M | P0 | Agent | done | - | data/sot.duckdb |
| SG-DATA-PIPE | PHASE-SG-DATA | task | Pipeline D0–D8 (explore_agent) + migration ledger + migrate-status --json | P0 | Agent | done | SG-DATA-SOT | docs/SGMP01-state.md |
| SG-GRAPH-SYNC | PHASE-SG-GRAPH | task | ฉาย SoT → GenesisBlockDB: 17.9k nodes / 9.7k edges, eval recall=precision=1.0 | P0 | Agent | done | SG-DATA-SOT | docs/rag-design-genesisblockdb.md |
| SG-GRAPH-MCP | PHASE-SG-GRAPH | task | MCP server อ่านอย่างเดียว: smartgift_ask_knowledge_base + graph_traverse (fail-closed) | P1 | Agent | done | SG-GRAPH-SYNC | explore_agent/mcp_server.py |
| SG-GRAPH-P54 | PHASE-SG-GRAPH | task | เส้น Document→Product line-item ("ลูกค้าคนนี้ซื้ออะไร") | P2 | Agent | blocked | SG-GRAPH-SYNC | docs/rag-design-genesisblockdb.md P5.4 |
| SG-KG-PROJECTION | PHASE-SG-GRAPH | task | Production P5 (FR-024): project Zuri **relations** → GKS/KG via pluggable sink, **live facts stay a Zuri query** (assertNoLiveFacts) + `queryKnowledge` contract — tested | P1 | Claude | done | SG-BACKEND-SLICE | ADR-007 P5; FR-024 |
| SG-COP-SEAM | PHASE-SG-COPILOT | task | ต่อท่อ: LINE (zuri-command-agent) → query จริงเหนือ sot.duckdb → ตอบมี guard | P0 | Claude | in-progress | SG-DATA-SOT | DEMO-RUNBOOK §3 D1 |
| SG-COP-FIXTURE | PHASE-SG-COPILOT | task | ลบ fetchQueryData ตัวปลอม (hardcoded revenue) — query ที่ไม่รู้จัก fail-closed | P0 | Claude | planned | SG-COP-SEAM | DEMO-RUNBOOK §5 risk 1 |
| SG-COP-QUERIES | PHASE-SG-COPILOT | task | เพิ่ม query อ่านอย่างเดียว: monthly_sales / top_customers / tier_counts / pipeline | P1 | Claude | planned | SG-COP-SEAM | DEMO-RUNBOOK §3 D2 |
| SG-MSP-EXTRACT | PHASE-SG-FOUNDATION | task | Extract MSP → standalone Freshair129/msp (Gate A: standalone + GoVibe still works) — verified 176 vitest + 30 security green | P0 | Codex | done | - | ADR-007 P1; docs/prompts/EXTRACT-MSP.codex.md |
| SG-IDENTITY-PRIM | PHASE-SG-FOUNDATION | task | ExternalIdentity model + resolveLineIdentity (LINE→Person, tenant-scoped, idempotent, audited) | P0 | Claude | done | - | FR-021; IMPACT-SCAN-IDENTITY |
| SG-BACKEND-SLICE | PHASE-SG-FOUNDATION | task | Zuri Backend Slice CRM core (FR-023): Customer+Conversation+Message + LINE ingest through the identity seam (tested 140/140) | P0 | Claude | done | SG-IDENTITY-PRIM | ADR-007 P2; FR-023 |
| SG-IDENTITY-P3 | PHASE-SG-FOUNDATION | task | Full P3 gate on FR-021 (FR-022): `resolveLinePrincipal` seam + account linking (single-use token, merge-aware) + PDPA erase-revoke + staff/customer split — tested 160/160 | P0 | Claude | done | SG-IDENTITY-PRIM | ADR-007 P3; IMPACT-SCAN-IDENTITY; FR-022 |
| SG-AGENT-CONTEXT | PHASE-SG-COPILOT | task | Production P6 (FR-025): `assembleAgentContext` = Identity + MSP memory (**principal-keyed**) + KG (FR-024) + **read-only** tools, Gate E (write tool refused at registration) — tested | P1 | Claude | done | SG-IDENTITY-P3, SG-KG-PROJECTION | ADR-007 P6; FR-025 |
| SG-AGENT-WRITE | PHASE-SG-COPILOT | task | Gate F (FR-026): agent write/action gate — RBAC + ownership + sensitivity authz, single-use step-up for HIGH, audited transactional execute; refund/order gated (executor absent) — tested | P1 | Claude | done | SG-AGENT-CONTEXT | ADR-007 P7 Gate F; FR-026 |
| SG-COP-MEMORY | PHASE-SG-COPILOT | task | ต่อ MSP memory (msp-client จริง) หลัง port — **principal-keyed** ผ่าน `memoryKey` (FR-025) แทน in-memory | P1 | Claude | planned | SG-AGENT-CONTEXT | DEMO-RUNBOOK §3 D3; ADR-007 |
| SG-COP-PROD | PHASE-SG-COPILOT | task | ย้ายไป line-copilot-runtime ตัว production (หลังผ่าน contract gate REQ-CR-012) | P2 | Owen | planned | SG-COP-QUERIES | REQ-CR-012 §16 |
| SG-CLOUD-PDPA | PHASE-SG-CLOUD | task | ตัดสิน PDPA: ข้อมูลลูกค้าออกนอกเครื่องได้ไหม — ตัดสินแล้ว: ออกได้ (override local_only เฉพาะเดโม) | P0 | Owen | done | - | DEMO-RUNBOOK §6.1 |
| SG-CLOUD-MIRROR | PHASE-SG-CLOUD | task | สคริปต์ mirror SoT → Supabase (aggregate ก่อน) จาก copy นอก dir บังคับ, DuckDB คง static | P1 | Claude | planned | SG-CLOUD-PDPA | DEMO-RUNBOOK §3 D3 |
| SG-CLOUD-DASH | PHASE-SG-CLOUD | task | ชี้ dashboard-app (Vercel) อ่านจาก Supabase — ปิดวง local→cloud→จอ cloud | P1 | Claude | planned | SG-CLOUD-MIRROR | DEMO-RUNBOOK §5a |
| SG-SCALE-B02 | PHASE-SG-SCALE | task | ออนบอร์ด Business-02 ด้วย pipeline เดียวกัน | P2 | Agent | planned | SG-DATA-PIPE | migration-status-per-business |
| SG-SCALE-B03 | PHASE-SG-SCALE | task | ออนบอร์ด Business-03 | P2 | Agent | planned | SG-SCALE-B02 | migration-status-per-business |
| SG-SCALE-B04 | PHASE-SG-SCALE | task | ออนบอร์ด Business-04 | P2 | Agent | planned | SG-SCALE-B03 | migration-status-per-business |
