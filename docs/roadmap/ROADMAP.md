---
title: "ROADMAP: zuri-ai — Live Delivery State"
doc_id: "ROADMAP-ZURI-V2-LAB"
status: "approved"
version: "2.11.0"
updated: "2026-08-30"
owner: "Owen"
source_of_truth: true
live_document: true
---

# ROADMAP: zuri-ai — Live Delivery State

สถานะจริงของโปรเจกต์ zuri-ai (https://github.com/Freshair129/zuri.ai) — ไฟล์นี้เป็น
live document ที่ GoVibe Mission Control อ่านตรง (roadmap parser อ่านตารางด้านล่าง
การแก้ช่อง Status เปลี่ยนสิ่งที่ Mission Control แสดงทันที) ทุกแถวอ้างอิงหลักฐานจริง
ใน repo — ไม่มี mock ตามกฎ PRODUCT.md ของ GoVibe

หลักฐาน: `docs/PRD-SDD-v1.0.md` (FR registry), `docs/TRACE.md` + `docs/FEATURE-MAP.md`
(generated: FR → code → tests), `docs/.preflight-report.json` (doc health),
`.agent/reports/FINAL.md` (acceptance matrix ยุค MVP — บันทึกประวัติศาสตร์)

> **หมายเหตุชื่อ**: `doc_id` คงค่าเดิม (`ROADMAP-ZURI-V2-LAB`) เพราะ id เป็น key
> ที่ไม่เปลี่ยน (AGENTS.md §18) — ผลิตภัณฑ์นี้คือ **zuri-ai** ตาม ADR-024; คำว่า
> "Zuri v2" ในแถวประวัติเป็น label ยุคก่อน ไม่ใช่คำสั่งงาน
> Revision 2.0.0 (2026-08-26): ปรับให้ตรงความจริงตาม gap analysis — เพิ่มงานยุค
> FR-058..FR-105 ที่ส่งมอบแล้วแต่ไม่เคยมีแถว, แก้ path หลักฐานที่ยังชี้
> `zuri-v2-lab/` (โครงสร้างถูก flatten ตั้งแต่ 2026-08-12), และปิดแถวที่งานจริง
> ย้ายไปอยู่ใน id ใหม่แล้ว
> Revision 2.1.0 (2026-08-27): บันทึก FEAT-013 / FR-109..111 (17-Stage Knowledge
> Ingestion & GraphRAG) เป็น **declaration เท่านั้น** — ประกาศใน PRD แล้ว
> แต่ยังไม่มี route/model/code ใด ๆ
> Revision 2.2.0 (2026-08-27): ครอบ FR-106..108 + FR-112 ที่ส่งมอบวันนี้ —
> SEC-006 ปิด (FR-106), operator authority เกิดจริงบน production (FR-107),
> ExecutionPlanBundle ใช้งานจริง (FR-108 — import แผน 17-Stage ขึ้น production
> เป็นเคสแรก), Stage 7 chunking (FR-112); FR-066/067 ส่งมอบแล้ว; RSK-016 ปิด
> (migration ทั้ง 6 apply + ledger ครบ); เพิ่ม PHASE-ZAI-KNOWLEDGE
> Revision 2.3.0 (2026-08-27): บันทึก Stage 8 — entity candidate extraction
> (FR-113, SDD-060) ส่งมอบแล้วใน knowledge lane, ปลดล็อกโดย `source_chunk_id`
> ของ FR-112; PHASE-ZAI-KNOWLEDGE 15 → 20 (สองใน 17 stage มี implementation
> ในเลนนี้แล้ว) แถวนี้ต้อง merge **หลัง** PR ของ lane เสมอ เพราะ PRD row และ
> ledger pin ของ FR-113 อยู่ในนั้น ไม่ใช่ในไฟล์นี้
> Revision 2.3.1 (2026-08-27): ซ่อมช่อง Source Section ที่ชี้ไปไฟล์ซึ่งไม่มีอยู่
> — สามแถวยังใช้ path ยุคก่อน flatten (`features/…`), สองแถวใช้รูป
> `…/FR-xxx (PRD row)` ที่ไม่เคย resolve; FR-112 ชี้ไป feature note จริงแล้ว
> ส่วน FR-107 ไม่มี note จึงอ้าง PRD row ตรง ๆ ตามความจริง เหลือหนึ่งแถว
> (TASK-V2-PARITY) เป็นหนี้ที่รับไว้ใน `docs/.roadmap-evidence-baseline.json`
> เพราะเอกสารหายไปพร้อมโปรแกรมที่ ADR-024 retire คอลัมน์นี้มี preflight
> Check 13 ตรวจแล้วตั้งแต่บัดนี้ — ก่อนหน้านี้ไม่มีอะไรตรวจเลย
> Revision 2.4.0 (2026-08-28): ปิดช่องว่างที่เกิดจากสี่เลนลงติดกันภายในวันเดียว —
> ROADMAP ตามหลัง main อยู่สาม stage เพราะเลน knowledge ไม่เขียนแถวของตัวเอง
> เพิ่ม TASK-FR-114 (Stage 4 normalization), TASK-FR-115 (Stage 2 parsing),
> TASK-FR-116 (Stage 3 provenance); FEAT-013 เป็น in-progress เพราะ FR-111
> ส่งมอบแล้วเหลือ FR-110; PHASE-ZAI-KNOWLEDGE 20 → 40 (หกใน 17 stage มี
> implementation แล้ว และ FR-111 ซึ่งเป็นครึ่งหนึ่งของ exit criteria ปิดแล้ว)
> Revision 2.5.0 (2026-08-28): เพิ่ม TASK-FR-117 (Stage 6 dedup/versioning) ซึ่ง
> ปิด Tier 1 ครบทุก stage; PHASE-ZAI-KNOWLEDGE 40 → 50 แถวนี้ลงในรอบเดียวกับ
> merge-queue pass โดยตั้งใจ — FR-117 อยู่บน main แล้วและ preflight Check 14
> ที่กำลังจะเข้าจะยิง CRITICAL ทันทีที่พบ FR ที่ส่งมอบแล้วแต่ไม่มีแถว การเขียน
> แถวคือทางแก้ ไม่ใช่การขยาย baseline ซึ่ง check นั้นห้ามไว้เอง
> Revision 2.5.1 (2026-08-28): แก้คำกล่าวอ้างเท็จที่ผมเขียนเองใน 2.5.0 — ประโยค
> "2 → 4 → 6 → 7 → 8 เดินเป็น pipeline ได้จริง" ไม่จริง ตรวจ import ของทุกชุดเทสต์
> ในเลน knowledge แล้ว: ชุดที่ประกอบโมดูลมากที่สุดประกอบได้สามตัว และรอยต่อที่
> พิสูจน์แล้วเป็นคู่ ๆ สี่คู่ — สายของคู่ไม่ใช่สาย ไม่มี check ตัวไหนจับข้อนี้ได้และ
> จะไม่มีวันจับได้ เพราะ guard ทุกตัวเริ่มจาก id ที่ประกาศแล้ว ส่วนคำกล่าวอ้างเกินจริง
> เดินทางผ่านร้อยแก้วที่ agent เขียน chain ธรรมาภิบาลเขียวและถูกต้องตลอดเวลา
> Revision 2.5.2 (2026-08-28): เพิ่ม TASK-FR-118 (knowledge ingestion stage
> runner, SDD-068) ก่อนที่ FR-118 จะขึ้น main เอง เพื่อให้ preflight Check 14
> ไม่ยิง CRITICAL ใส่ PR ของมัน — `runKnowledgeIngestionStages` ประกอบ stage
> calculator ทั้งเจ็ดของ Tier 1 เข้าด้วยกันเป็น pure function ตัวเดียว แต่**ปิด
> AC-109.2/.7/.13 ไม่ได้แม้แต่ข้อเดียว** เพราะข้อเหล่านั้นต้องมีหลักฐานเขียนลง
> FR-071 ledger ซึ่ง pure function ไม่เขียน; เลนพบเรื่องนี้เองก่อนเขียนแถว PRD
> ของ FR-118 — เคยเข้าใจผิดว่าจะปิดได้แล้วแก้ก่อนประกาศ; การประกอบเจ็ด stage
> ไม่เท่ากับ pipeline ที่ operable ก็เป็นเรื่องที่ต้องบอกตรง ๆ เช่นกัน ไฟล์นี้ยังไม่มี
> FR-118 อยู่บน main ตอนที่แถวนี้ลง (PR ของ FR-118 เองจะตามมาทีหลัง) จึงเป็น
> ลำดับที่ Check 14 บังคับไว้ ไม่ใช่ความผิดพลาด
> Revision 2.5.3 (2026-08-28): เพิ่ม TASK-FR-119 (per-stage failure attribution +
> BR-022 quarantine) ด้วยลำดับ row-first เดิม — FR-119 ยังไม่อยู่บน main ตอนแถวนี้ลง
> **และแก้ข้อผิดพลาดของแถว TASK-FR-118 ไปพร้อมกัน**: แถวนั้นลงด้วยสถานะ `done`
> ทั้งที่ FR-118 ยังอยู่บน branch ที่ยังไม่ merge — มันเป็นจริงในอีกราวหนึ่งชั่วโมงถัดมา
> แต่ตอนที่ PR ของแถวนั้น merge สถานะเป็นเท็จ TASK-FR-119 จึงลงเป็น `in-progress`
> และจะเปลี่ยนเป็น `done` เมื่อ PR ของ FR-119 ขึ้น main จริงเท่านั้น Check 14 อ่านแค่
> คอลัมน์ ID กับ Title สถานะจึงไม่มีผลต่อการปลดล็อก — ไม่มีอะไรบังคับให้ต้องโกหก
> เพื่อให้ gate ผ่าน และนั่นคือเหตุผลเดียวที่ `done` ถูกใส่ลงไปตั้งแต่แรก
> Revision 2.5.4 (2026-08-29): เพิ่ม TASK-FR-120 (self-serve account creation)
> **พร้อมกับการประกาศ FR-120 เองใน PRD ใน PR เดียวกัน** ไม่ใช่ row-first สองรอบแบบ
> TASK-FR-118/119 เพราะ Check 14 เริ่มจาก requirement ที่ delivered แล้วถามว่าอันไหน
> ไม่มีแถว และ "delivered" อ่านจาก `implements` edge ในกราฟ ไม่ใช่จากช่องสถานะที่ใครพิมพ์
> การประกาศเปล่า ๆ จึงยังไม่ delivered — ไม่มี edge ไม่มีอะไรต้องปลดล็อก แถวกับ id
> ลงพร้อมกันได้โดย main สอดคล้องกันทุกจุดระหว่างทาง
> สถานะลงเป็น `planned` ไม่ใช่ `in-progress` เพราะตอน PR นี้ merge ยังไม่มีโค้ดสักบรรทัด
> — บทเรียนเดียวกับ TASK-FR-118 ที่ลงด้วย `done` ก่อนของจริงจะขึ้น main และตรงตามที่
> revision 2.5.3 บันทึกไว้เองว่า Check 14 อ่านแค่ ID กับ Title ไม่มีอะไรบังคับให้โกหกสถานะ
> Revision 2.5.5 (2026-08-29): เพิ่ม TASK-FR-122 (Profile บังคับ ชื่อ/นามสกุล/เบอร์โทร — done)
> และ TASK-FR-121 (Google เป็นทางเข้าที่สอง — **blocked**, ไม่ใช่ pending: ไม่มี OAuth
> credential และ `ExternalIdentity` ต้องการ Tenant ที่ self-serve signup ไม่มี) พร้อมกับ
> การประกาศ FR-121/FR-122 ใน PRD ใน PR เดียวกัน ตามลำดับเดียวกับ TASK-FR-120.
>
> Revision 2.6.0 (2026-08-29): sync สถานะจริงของเลน knowledge หลัง FR-119 และ
> AC-109.3 ขึ้น main — **TASK-FR-119 เปลี่ยนจาก `in-progress` เป็น `done`** ตามเงื่อนไข
> ที่ revision 2.5.3 ตั้งไว้เองว่าจะเปลี่ยนเมื่อ PR ขึ้น main จริงเท่านั้น ตรวจแล้วว่าอยู่จริง
> (`f80bb87`, PR #162, `src/modules/knowledge/quarantine.js` มีอยู่บน `origin/main`)
> ไม่ใช่เชื่อจากสรุปของตัวเอง. พร้อมกันนั้นแก้คำที่ล้าสมัยสามจุดซึ่งไม่มี check ตัวไหน
> จับได้เพราะทั้งหมดเป็นร้อยแก้ว: (1) แถว PHASE-ZAI-KNOWLEDGE ยังบอกว่า "ยังไม่มีอะไร
> เรียกทั้งแปดตัวเรียงกัน" และ "stage runner ที่ยังไม่มีใครประกาศเป็น FR" — เท็จทั้งคู่
> ตั้งแต่ FR-118 merge; (2) ข้อ 7 ของรายการช่องว่างยังบอกว่า "ส่วนที่เหลือยังไม่มี
> route/model/code" และ "FR-109/110/111 เป็น 🔜" ทั้งที่เหลือ FR-110 ตัวเดียว;
> (3) หมายเหตุ PRD status ท้ายไฟล์บอก "FR-109..111 ยัง 🔜" เช่นกัน. Progress ของ
> เฟส 50 → 60 — ขยับเพราะครึ่ง Tier 1 ที่เคยขาด (composition, failure attribution,
> ledger wiring, artifact_id binding) ลงครบแล้ว **ไม่ใช่เพราะ pipeline ใช้งานได้**:
> FR-110 ยังเป็น declaration ล้วน และ stage 9..17 เป็นของ GKS/GenesisBlockDB
> ตาม ADR-050 ซึ่ง repo นี้ไม่สร้างเอง
> Revision 2.7.0 (2026-08-29): เพิ่มหมายเหตุว่า **มีตัวเลข 17-stage สองตัวใน
> ระบบ และมันวัดคนละอย่าง** — แถวนี้ (phase progress) กับ project
> `PRJ-KNOWLEDGE-17S` ในแอป (stage ที่ปิดได้จริง) เดิมไม่มีอะไรเชื่อมสองตัวนี้
> เข้าด้วยกันเลย ทั้งที่ทั้งคู่ตอบคำถามที่ฟังดูเหมือนกันว่า "17 stage ไปถึงไหน"
> คนที่เห็นทั้งสองตัวจะพยายามปรับให้ตรงกันแล้วสรุปผิดว่าตัวหนึ่งค้าง ซึ่งไม่มี
> check ตัวไหนจับได้เพราะทั้งคู่ถูกในนิยามของตัวเอง
>
> Revision 2.11.0 (2026-08-30): ปิดช่อง consent ของ TASK-FR-123 ตาม ADR-052 D4 —
> `GET /api/plugin/auth/authorize` ไม่ mint แล้ว แต่ redirect ไปหน้า consent `/plugin/authorize`
> ที่แสดงชื่อ plugin ที่ลงทะเบียนไว้, capability ที่ derive จาก viewer ฝั่ง server (ไม่รับ
> `platformGrant` ตาม D3), ปลายทางที่จะได้รับ code และบัญชีที่ให้สิทธิ์ — ทุกอย่างมาจาก server
> ไม่มีอันไหนอ่านจาก query string; การ mint เกิดจาก POST ของฟอร์มนั้นเท่านั้น. เหลือเปิดไว้สอง
> อย่างและระบุไว้ตรง ๆ: ยังไม่มี reaper สำหรับ code/session ที่หมดอายุ และ production client
> registration / device-binding / security sign-off ยังไม่เปลี่ยนแปลง
>
> Revision 2.8.0 (2026-08-30): เพิ่ม TASK-FR-123 (plugin authorization boundary)
> พร้อมกับการประกาศ FR-123/SDD-074/SEC-022 + ADR-052 ใน PRD ใน PR เดียวกัน ตามลำดับ
> เดียวกับ TASK-FR-120. งานนี้เป็นการ **re-apply** `origin/rescue/plugin-auth`
> ซึ่งเป็น rescue commit ที่ไม่เคยผ่าน review และตามหลัง main อยู่ 196 commit —
> ไม่ merge แต่ port มาทีละไฟล์ และ **เปลี่ยนเลข id ทั้งหมด** เพราะเลขเดิมที่มันประกาศ
> (FR-094, ADR-045, SDD-052, SEC-018) ถูก main จองไปหมดแล้ว ตามกฎเดียวกับ PR #117:
> ผู้ประกาศทีหลังเป็นฝ่ายเปลี่ยนเลข. สถานะเป็น `in-progress` ไม่ใช่ `done` เพราะสาม
> อย่างยังไม่ปิด — migration บน Supabase จริงยังไม่ได้ apply (session นี้เข้า project
> ไม่ได้), ยังไม่มี client registration บน production, และ `GET /authorize` **ยังไม่มี
> ขั้นตอน consent** จึงยังเปิดใช้งานจริงไม่ได้
>
> Revision 2.9.0 (2026-08-30): เพิ่ม TASK-FR-124 (Product Readiness dashboard)
> พร้อมกับการประกาศ FR-124 ใน PRD ใน PR เดียวกัน ตามลำดับเดียวกับ TASK-FR-120.
> งานนี้เป็นการ **re-apply** `origin/rescue/domain-dashboard` ซึ่งเป็น rescue commit
> ที่ไม่เคยผ่าน review และตามหลัง main อยู่ 239 commit — ไม่ merge แต่ port มาทีละไฟล์
> และ **เปลี่ยนเลข id** จาก FR-094 เป็น FR-124 เพราะ main จองเลขเดิมไปแล้ว ตามกฎ
> เดียวกับ PR #117 และ PR #180: ผู้ประกาศทีหลังเป็นฝ่ายเปลี่ยนเลข. **มีหนึ่งเรื่องที่
> ต้องให้เจ้าของตัดสิน ไม่ใช่วิศวกร**: น้ำหนัก 20% declaration / 40% code / 40% test
> เป็นการเลือกเชิงนโยบาย ไม่ใช่ข้อเท็จจริงที่คำนวณได้ ตอนนี้อยู่ในค่าคงที่ชื่อเดียว
> (`PROGRESS_METHODOLOGY`) แสดงข้างตัวเลขบนหน้าจอและอยู่ใน snapshot เพื่อให้เห็นว่า
> ถูกตัดสินที่ไหน แต่ยังไม่มีเจ้าของรับรอง. อีกเรื่องคือ **ต้นทุนที่รับไว้โดยตั้งใจ**:
> การประกาศ FR ใหม่ต่อจากนี้ต้องเขียน use case หนึ่งประโยคใน docs/FEATURES.md ด้วย
> มิฉะนั้น `npm run govern` จะหยุด — เพราะ "คนใช้ทำอะไรได้" เป็นฟิลด์เดียวที่ generator
> อนุมานเองไม่ได้
>
> Revision 2.10.0 (2026-08-30): **Stage 9 ขยับ — 8/17 → 9/17 (52.9%)**
> `DPS-KI-ENTITY-RESOLVE` ถูกย้ายเป็น DONE บน `PRJ-KNOWLEDGE-17S` โดยอ้าง merge
> `e412ec0` บน `Freshair129/Genesis-Knowledge-System` เป็นหลักฐาน. **หลักฐานถูก
> ตรวจซ้ำจากฝั่งนี้ ไม่ใช่รับคำบอก** — commit มีอยู่จริงพร้อมข้อความตรงตามอ้าง,
> `migrations/0002_entity_resolution.sql` และ `packages/gks-core/src/resolve.mjs`
> มีอยู่, ชุด acceptance นับได้ 16 เทสต์พอดีตามที่อ้าง, และรันทั้งชุดบนเครื่องนี้
> ได้ 126 vitest + 9 security ผ่านหมด **ไม่มี skip แม้แต่ตัวเดียว** ซึ่งสำคัญเพราะ
> ชุด integration จะข้ามตัวเองเงียบ ๆ ถ้าไม่มี `MSP_REPO_ROOT`.
>
> **เกณฑ์ DONE ที่ใช้คือเกณฑ์เดิมของบอร์ด** — "calculator ships and is tested"
> ไม่ใช่ "pipeline runs" ซึ่งเป็นเกณฑ์เดียวกับที่ stage 1..8 ผ่านมา. ยังไม่มี
> production deployment ของสาย MSP→GKS และยังไม่เคยมี ingestion run จริงเรียกใช้
> Stage 9 — เขียนไว้ตรงนี้เพราะถ้าใครอยากให้ DONE แปลว่า "ถูกเรียกบน production
> แล้ว" stage 1..8 ก็ไม่ผ่านเกณฑ์นั้นเหมือนกัน และการตั้งเกณฑ์พิเศษเฉพาะ stage ที่
> ทีมอื่นทำคืออคติ ไม่ใช่ความเข้มงวด.
>
> ประโยคเดิมที่ว่า "ทั้งสองตัวขยับต่อไม่ได้จากฝั่ง Tier 1 อีกแล้ว" ยังจริง แต่
> **อ่านผิดได้ว่าตัวเลขจะไม่ขยับอีกเลย** — มันขยับแล้ว จากฝั่ง GKS ตามที่ ADR-050
> วางไว้ จึงขยายประโยคให้บอกว่าการเคลื่อนไหวมาจากทางไหน. หมายเหตุ frontmatter:
> `version` ค้างที่ 2.8.0 ขณะที่บันทึกเดินถึง 2.9.0 แล้ว — ซิงก์เป็น 2.10.0 พร้อมกัน

## Phases

| Phase | Goal | Exit Criteria | Status | Progress |
| --- | --- | --- | --- | --- |
| PHASE-ZV2-MVP | Build offline-first PM MVP (spec phases 00-07) | ACCEPTANCE-CRITERIA all PASS (`.agent/reports/FINAL.md`); ตัวเลขชุดเทสต์ปัจจุบันดูจาก `docs/.preflight-report.json` (`scanned.test_files`) ไม่บันทึกเลขตายตัวที่นี่ | done | 100 |
| PHASE-ZV2-GOV | 3-layer docs, doc-graph, @req annotations, GoVibe registration | preflight PASS; candidates in GoVibe .brain/inbound | done | 100 |
| PHASE-ZV2-INTAKE | Intake surfaces: UI wizard, Excel template, Enterprise API, adaptive shell | FR-017..FR-020 implemented + tested through the unified pipeline | done | 100 |
| PHASE-ZV2-DECIDE | Zuri v1 module merge vs Zuri v2 foundation decision | Owner decision recorded per ZURI-INTEGRATION-ASSESSMENT.md | done | 100 |
| PHASE-ZV2-MERGE | ~~Ship PM into Zuri v1 as a module (ADR-002)~~ — **cancelled by ADR-003**: V2 replaces V1, so anything mounted into V1 retires with it | n/a | cancelled | 0 |
| PHASE-V2-REPLACE | ~~Replace the legacy project by reuse~~ — program retired by ADR-024: zuri-ai is standalone, nothing is lifted, no cutover. Delivered tasks below stand as shipped product work | retired | closed (ADR-024) | 8 |
| PHASE-ZAI-PRODUCT | Standalone product build-out หลัง ADR-024: read views + domain surfaces (FR-058..064, FR-086), authorization repayment (FR-065, FR-072..075), execution planning (FEAT-003), inventory/backfill (FR-076..078), schema declaration (FR-090), operator console (FR-105), bundle import orchestration (FR-108/ADR-049 — ใช้จริงแล้ว: แผน 17-Stage ถูก import ขึ้น production ผ่านมัน) | ทุก FR มี code + tests ใน TRACE.md; route/viewer baselines repaid เป็นศูนย์ (2026-08-17/18) | done | 100 |
| PHASE-ZAI-RUNTIME | Phase 1 LINE runtime + ingestion boundary + integrations (FR-079..081, FEAT-004); Pipeline Builder canvas (FEAT-007) ยัง design-only | local delivery เขียวครบ; production gates ที่เหลือ: live Vault provisioning, LINE canary, real-provider evaluation | in-progress | 80 |
| PHASE-ZAI-CRM | CRM console + consent: Conversation Inbox (FR-091), reply receipt (FR-093), PDPA consent attestation (FR-103 ปิด SEC-005), market translation (FR-092) | code + tests ครบทุกตัวรวม e2e (`tests/e2e/fr091-conversation-inbox.spec.js`) | done | 100 |
| PHASE-ZAI-IAM | Production IAM (FEAT-010: FR-094..098, ADR-045) + password reset (FR-104) + onboarding/invites (FR-066/067 — ส่งมอบ 2026-08-27) + Enterprise API token auth (FR-106 ปิด SEC-006) + operator grant store/bootstrap (FR-107 — operator คนแรก live บน production) | เหลือ tail เดียว: FEAT-010 hardening (FR-097 provider evidence) | in-progress | 90 |
| PHASE-ZAI-SOT | SoT pipeline console (FEAT-011: FR-099..101) + data-plane service-account auth (FR-102, ADR-047) | ~~RSK-016~~ ปิดแล้ว 2026-08-27 (migration ทั้ง 6 apply + ledger); เหลือ: decision loop เดินจริงกับ data plane ภายนอก | in-progress | 95 |
| PHASE-ZAI-KNOWLEDGE | 17-Stage Knowledge Ingestion & GraphRAG (ADR-050): governance declaration (FEAT-013: FR-109..111) + Stage 7 chunking calculator ส่งมอบแล้ว (FR-112, SDD-059 — pure calculator, ไม่มี model); Stage 8 entity candidate extraction ส่งมอบแล้ว (FR-113, SDD-060 — candidate เท่านั้น, recognition เป็น seam); Stage 2 parsing (FR-115), Stage 3 provenance (FR-116), Stage 4 normalization (FR-114), Stage 5 classification (FR-111) และ Stage 6 dedup/versioning (FR-117) ส่งมอบครบ — **ทุก stage ของ Tier 1 มี implementation แล้ว** (1..8) — และตั้งแต่ 2026-08-28/29 **ประกอบเป็นสายจริงแล้ว ไม่ใช่คู่ ๆ อีกต่อไป**: FR-118 (`runKnowledgeIngestionStages`, SDD-068) เรียก stage calculator ทั้งเจ็ด (2..8) เรียงตาม ADR-050 D2 ในรอบเดียว, FR-119 (`runKnowledgeIngestionStagesWithTrace`, SDD-072) รายงานว่า stage ไหนล้มพร้อม envelope ของ BR-022 แทนที่จะเงียบทั้งรอบ, และ `ingestKnowledgeDocument` (SDD-069) เขียนหลักฐานลง FR-071 ledger จริง — สามชิ้นนี้คือครึ่ง Tier 1 ที่เคยขาด; AC-109.3 (2026-08-29, PR #165) ผูก `artifact_id` กลับไปหา raw payload ของ FR-081 ทำให้ FR-109 ปิดไป 6 ใน 13 AC; BR-021 กับ SEC-021 หลุดจากรายการ rules-without-code-anchor เป็นหลักฐานเชิงกลไก **แต่ pipeline ยังไม่ operable ครบ**: FR-110 (published snapshot + Stage 17 gate) ยังเป็น declaration ล้วน และ stage 9..17 ไม่ใช่ของ repo นี้ | ทั้ง 17 stages มีเจ้าของ/implementation ตาม tier boundary; ~~**มี stage runner ที่เรียก Tier 1 ต่อกันได้จริง**~~ ปิดแล้ว 2026-08-28 (FR-118/FR-119); FR-110 ส่งมอบ; stage 9..17 เป็นของ GKS/GenesisBlockDB ตาม ADR-050. **ตัวเลข 60 นี้เป็น phase progress ไม่ใช่สัดส่วน stage ที่เสร็จ** — stage ที่ปิดได้จริงคือ 9/17 = 52.9% ซึ่งอ่านได้จาก project `PRJ-KNOWLEDGE-17S` ในแอป (WS-SMARTGIFT, หนึ่ง task ต่อหนึ่ง stage) สองตัวนี้ต่างกันเพราะ phase รวมงาน governance/composition ที่ไม่ใช่ stage เข้ามาด้วย (FR-118 การประกอบ, FR-119 failure attribution, SDD-069 ledger wiring, AC-109.3 artifact binding) ส่วน project นับเฉพาะ stage. **ทั้งสองตัวขยับต่อไม่ได้จากฝั่ง Tier 1 อีกแล้ว** — stage ที่เหลือเป็นของ GKS กับ GenesisBlockDB และ**เริ่มขยับจากฝั่งนั้นแล้ว**: Stage 9 (`DPS-KI-ENTITY-RESOLVE`, entity resolution) ส่งมอบใน GKS เมื่อ 2026-08-29 — merge `e412ec0` บน `Freshair129/Genesis-Knowledge-System`, promotion เปลี่ยนเป็น read-then-decide ผ่าน ladder หกขั้นพร้อม auto-merge floor 0.85 และ human review loop; task ถูกย้ายเป็น DONE บนบอร์ดโดยอ้าง commit นั้นเป็นหลักฐาน ตามที่ tier-boundary doc กำหนดว่าการย้ายต้องอิงหลักฐานไม่ใช่คำกล่าวอ้าง. **เกณฑ์ DONE ที่ใช้คือเกณฑ์เดิมของบอร์ดเอง** — "calculator ships and is tested" ไม่ใช่ "pipeline runs" ซึ่งเป็นเกณฑ์เดียวกับที่ stage 1..8 ผ่านมา; ยังไม่มี production deployment ของสาย MSP→GKS และยังไม่เคยมี ingestion run จริงเรียกใช้ | in-progress | 60 |

## Backlog Items

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-ZV2-MVP-CORE | PHASE-ZV2-MVP | task | Scope model + project core + 7 execution views + progress engine (FR-001..016) | P0 | Claude | done | - | PRD-SDD 1.3 |
| TASK-ZV2-GOV-DOCS | PHASE-ZV2-GOV | task | PRD-SDD v1.0 + appendices + doc-graph + preflight all green | P0 | Claude | done | TASK-ZV2-MVP-CORE | PRD-SDD 1.6 |
| TASK-FR-017 | PHASE-ZV2-INTAKE | task | UI wizard: start-from-objective, builds envelope into validate/dry-run/commit pipeline | P0 | Claude | done | - | PRD-SDD FR-017 |
| TASK-FR-018 | PHASE-ZV2-INTAKE | task | Excel template generator (from Zod schema) + xlsx-to-envelope converter with per-row errors | P1 | Claude | done | TASK-FR-017 | PRD-SDD FR-018 |
| TASK-FR-020 | PHASE-ZV2-INTAKE | task | Adaptive shell: single business hides switchers, multi business gets portfolio landing | P1 | Claude | done | - | ../domains/project-manager/features/FR-020-adaptive-shell.md |
| TASK-FR-040 | PHASE-V2-REPLACE | task | Project-local Work views: WBS Structure Plan plus Dependency Map, without changing shell scope or persistence | P1 | Codex | done | FR-005; FR-007; FR-039; ADR-012 | ../domains/project-manager/features/FR-040-project-work-views.md |
| TASK-FR-041-042 | PHASE-V2-REPLACE | task | Business-first Overview with Business Strategy Roadmap/Goals and HR / People peer domain | P0 | Codex | done | FR-035; FR-039; ADR-013 | ../domains/project-manager/features/FR-041-business-strategy-overview.md; ../domains/project-manager/features/FR-042-hr-people-peer-domain.md |
| TASK-FR-019 | PHASE-ZV2-INTAKE | task | Enterprise API: ExternalRef mapping, upsert-by-external-id, OpenAPI from Zod | P2 | Claude | done | TASK-FR-018 | ../domains/project-manager/features/FR-019-enterprise-api.md |
| TASK-ZV2-DECISION | PHASE-ZV2-DECIDE | task | Record owner decision: merge as v1 module or promote to v2 foundation — decided A→B, ADR-002 | P1 | Owen | done | TASK-FR-017; TASK-FR-020 | ZURI-INTEGRATION-ASSESSMENT |
| TASK-MERGE-VOCAB | PHASE-ZV2-MERGE | task | ~~Adopt canonical scope vocabulary in Zuri v1~~ | P1 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-BIZDIM | PHASE-ZV2-MERGE | task | ~~Business dimension on every new Zuri v1 table~~ | P1 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-ADAPTER | PHASE-ZV2-MERGE | task | ~~Mount PM module inside Zuri v1~~ | P0 | Claude | cancelled | - | ADR-003 |
| TASK-MERGE-TASKPOS | PHASE-ZV2-MERGE | task | ~~Position PM work items vs v1 Task inside v1~~ — folded into TASK-V2-PARITY | P2 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-TRIGGER | PHASE-ZV2-MERGE | task | ~~Watch the B promotion trigger~~ — moot, B is now the plan | P2 | Owen | cancelled | - | ADR-003 |
| TASK-V2-PARITY | PHASE-V2-REPLACE | task | Parity inventory: module × route × page × model × usage, classified must-have / later / drop before cutover | P0 | Claude | done | - | replacement/PARITY-INVENTORY |
| TASK-V2-IDENTITY | PHASE-V2-REPLACE | task | Identity foundations FR-021/022 delivered; the production request-session boundary that this row once held open shipped under FEAT-010 — successor row TASK-FEAT-010 | P0 | Claude | done | - | ADR-017; ADR-024; ADR-045 |
| TASK-V2-CONTRACTS | PHASE-V2-REPLACE | task | ~~Record contract tests for legacy endpoints before reimplementing~~ — no endpoint is being reimplemented | P0 | Claude | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-LINE-INTENT | PHASE-V2-REPLACE | task | FR-023..029 backend/agent foundations delivered; PDPA consent shipped separately (see the consent row under PHASE-ZAI-CRM); production deployment gates live on the runtime rows above | P0 | Claude | done | TASK-V2-IDENTITY | ADR-007; ADR-024 |
| TASK-V2-CUTOVER-RULES | PHASE-V2-REPLACE | task | ~~Single-writer cutover rule per tenant~~ — no cutover will occur | P0 | Owen | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-PILOT | PHASE-V2-REPLACE | task | ~~Pilot one lifted module to measure cost~~ — nothing is lifted | P1 | Claude | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-CROSSBIZ | PHASE-V2-REPLACE | task | Ship one genuinely cross-business screen early (survives ADR-024 as ordinary product work — no longer tied to any migration) | P1 | Claude | planned | - | ADR-024 |
| TASK-V2-LASTDATE | PHASE-V2-REPLACE | task | ~~Final per-tenant cutover date~~ — no cutover will occur | P0 | Owen | cancelled (ADR-024) | - | ADR-024 |
| TASK-FR-045 | PHASE-V2-REPLACE | task | SQLite-authoritative managed local file workspace, Business/Project File Manager, disposable cache and legacy ProjectFile migration | P0 | Codex | done (beta) | ADR-016; ZV2-CR-001 | ../domains/project-manager/features/FR-045-managed-local-file-workspace.md; roadmap/PLAN-FR-045-MANAGED-LOCAL-FILE-WORKSPACE.md |
| TASK-FR-046 | PHASE-V2-REPLACE | task | Trusted request viewer and atomic viewer-scoped `/api/entry` for production-safe Business Routing | P0 | Codex | done | FR-031; FR-044 | ADR-017; ../domains/identity/features/FR-046-production-viewer-entry-contract.md |
| TASK-FR-053-054 | PHASE-V2-REPLACE | task | Phase 1 activation readiness: deterministic golden evaluation, live-role isolation probe and dry-run controlled canary plan | P0 | Codex | done (beta; external activation pending) | FR-047..052; ADR-018 | ADR-019; changes/ZV2-CR-005-PHASE1-ACTIVATION-READINESS.md |
| TASK-FR-079 | PHASE-V2-REPLACE | task | Phase 1 LINE runtime connection cut-over: trusted Business-scoped active-primary selection, provider-neutral SecretManagerPort and local-only Ollama boundary | P0 | ATHER | done (beta; production external gates pending) | FR-047..052; ADR-031 | ../domains/integration/features/FR-079-phase1-line-runtime-connection-cutover.md; PLAN-FR-079-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md |
| TASK-FR-080 | PHASE-V2-REPLACE | task | Platform Integrations UI: owner-scoped metadata management, opaque Supabase Vault references and redacted readiness | P0 | ATHER | in-progress (local slice; live Vault/activation gates pending) | FR-038; FR-061; FR-062; FR-079; ADR-032 | ../domains/integration/features/FR-080-integration-secret-management-ui.md; PLAN-FR-080-INTEGRATION-SECRET-MANAGEMENT-UI.md |
| TASK-FR-057 | PHASE-V2-REPLACE | task | Multi-tenant principal-scoped MSP vaults, per-turn AuthContext and policy-before-retrieval | P0 | ATHER | in-progress | FR-021..029; FR-051..052 | ADR-022; ../domains/agent/features/FR-057-authorized-agent-context-and-vault-resolution.md |
| TASK-FR-058-064 | PHASE-ZAI-PRODUCT | task | Domain surfaces: File Manager views (FR-058), Business Strategy mutation (FR-059), Business Home dashboard (FR-060), per-Business domain visibility (FR-061), permissions read scope (FR-062), Project Board (FR-063), Schedule timeline (FR-064) | P1 | Claude | done | FR-041; FR-045 | ../domains/project-manager/features/FR-060-business-home.md |
| TASK-AUTH-REPAY | PHASE-ZAI-PRODUCT | task | Authorization repayment to zero baselines: import target (FR-065), PM mutation (FR-072), repository ownership (FR-073), scope creation (FR-074), installation-operator authority (FR-075) | P0 | Claude | done | FR-046; FR-061 | ../domains/project-manager/features/FR-065-import-target-authorization.md |
| TASK-FEAT-003 | PHASE-ZAI-PRODUCT | task | Execution planning: human-visible roadmap (FR-068), plan blueprint + intake (FR-069), stable execution/domain/tag identities (FR-070) | P1 | Claude | done | FR-012 | ../domains/project-manager/features/FR-068-human-visible-execution-roadmap.md |
| TASK-FR-076-078 | PHASE-ZAI-PRODUCT | task | Product Owner Business role binding (FR-076), Project Inventory MVP (FR-077), SmartGift customer backfill contract + review queue (FR-078) | P1 | Claude | done | FR-046 | ../domains/crm/features/FR-078-customer-data-backfill-contract.md |
| TASK-FEAT-008 | PHASE-ZAI-PRODUCT | task | Projects Dashboard (FR-086 shipped) + project priority (FR-087), accountable PIC (FR-088), Team grouping models (FR-089) | P1 | Claude | done (FR-087..089 status ruling resolved 2026-08-26 — PRD 1.89.0b) | FR-005; ADR-036; ADR-037 | ../domains/project-manager/features/FR-086-projects-dashboard.md |
| TASK-FR-090 | PHASE-ZAI-PRODUCT | task | Live production-auth table declaration (PersonCredential, PasswordResetToken, laneId) — resolved 2026-08-26: source branch deleted; successors TASK-FEAT-010 (login/session) and the password-reset row under PHASE-ZAI-IAM | P0 | Claude | done | - | PRD-SDD FR-090 |
| TASK-FR-105 | PHASE-ZAI-PRODUCT | task | Platform Programme Roadmap `/control/roadmap`: isOperator-only read-only projection of the 24-week programme (ADR-048) | P2 | Claude | done | FR-075; ADR-048 | ../domains/platform-control/features/FR-105-platform-programme-roadmap.md |
| TASK-FR-108 | PHASE-ZAI-PRODUCT | task | ExecutionPlanBundle import orchestration (FR-108, ADR-049, FEAT-012 live): 5 โมดูล orchestrator + `POST /api/import/bundle/{dry-run,commit}` — one preview / one confirmation / atomic commit / hash-bound idempotent receipt; พิสูจน์ end-to-end แล้ว: แผน 17-Stage ถูก import ขึ้น production SmartGift ผ่านมันเป็นเคสแรก (`PRJ-KNOWLEDGE-17S`) | P0 | Claude | done | FR-012; FR-059; ADR-049; SDD-056 | ../domains/project-manager/features/FR-108-execution-plan-bundle.md |
| TASK-FR-081 | PHASE-ZAI-RUNTIME | task | Raw external ingestion boundary: one normalized envelope, tenant/connection-scoped repository, dead-letter records (FR-081) | P0 | Claude | done | FR-079; BR-002 | ../domains/integration/features/FR-081-raw-external-ingestion.md |
| TASK-FEAT-007 | PHASE-ZAI-RUNTIME | task | Pipeline Builder canvas: structure editing (FR-082), edge creation (FR-083), handoff contracts (FR-084), contract-gated release (FR-085) — ADR-035 design only, implementation not authorized | P2 | Owen | planned | FR-007; FR-040; ADR-035 | ../domains/project-manager/features/FR-082-pipeline-canvas.md |
| TASK-FEAT-013 | PHASE-ZAI-KNOWLEDGE | task | Knowledge Ingestion Governance (FEAT-013, proposed): stage catalog + job trace (FR-109), published snapshot contract (FR-110), sensitivity lattice + processing policy (FR-111 — **ส่งมอบแล้ว** 2026-08-27, SDD-062); เหลือ FR-110 published snapshot contract ที่ยังเป็น declaration | P2 | Owen | in-progress | FR-071; SDD-057; SDD-058; ADR-042; ADR-043; ADR-046; ADR-050 | PRD-SDD FR-109..111; ../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md |
| TASK-FR-112 | PHASE-ZAI-KNOWLEDGE | task | Structural knowledge chunking (FR-112): Stage 7 ของ catalog เป็น pure calculator ใน knowledge lane — ไม่มี model/persistence/route (SDD-059 pin เป็น decision), metadata ตรงตาม FR-109 (`chunk_id`, `parent_id`, `heading_path`, ...) | P1 | Claude | done | FR-109; ADR-050; SDD-059 | ../domains/knowledge/features/FR-112-structural-knowledge-chunking.md |
| TASK-FR-113 | PHASE-ZAI-KNOWLEDGE | task | Entity candidate extraction (FR-113, SDD-060): Stage 8 ของ catalog — pure calculator ใน knowledge lane, ปลดล็อกโดย `source_chunk_id` ของ FR-112; ผลิต **candidate เท่านั้น** ไม่แตะ canonical identity (Stage 9 resolution เป็นของ GKS ตาม ADR-050); recognition เป็น seam + deterministic default แทน model dependency — caller-named fields บน structured record + องค์กรสามรูปแบบ (`บริษัท … จำกัด`, `ห้างหุ้นส่วนจำกัด …`, `… Co., Ltd./Ltd./Limited`) โดยรูปห้างหุ้นส่วนเป็น prefix-only ไม่มีอะไรในไวยากรณ์บอกว่าชื่อจบตรงไหน จึงสแกนถึง delimiter และเมื่อชนขอบ token จะลด confidence ของตัวเอง + ออก warning แทนที่จะตัดชื่อทิ้งเงียบ ๆ; evidence fields ตาม FR-109 (`candidate_id`, type, mention, `normalized_name`, `source_chunk_id`, `confidence`) | P1 | Claude | done | FR-109; FR-112; ADR-050; SDD-060 | ../domains/knowledge/features/FR-113-entity-candidate-extraction.md |
| TASK-FR-115 | PHASE-ZAI-KNOWLEDGE | task | Document parsing (FR-115, SDD-063): Stage 2 ของ catalog — markdown/plain text แบบ deterministic เท่านั้น (ไม่ทำ PDF/DOCX/OCR/vision layout ซึ่งต้องพึ่ง model หรือ binary — ทางนั้นยังเข้าผ่าน `smartgift.document-intake.v1` ของ FR-071 ตามเดิม); SDD-063 pin ว่า output ของ parser **คือ** input shape ของ Stage 7 เพื่อให้รอยต่อเป็นสัญญาไม่ใช่ความบังเอิญ — และสิ่งที่ยึดรอยต่อไว้จริงคือ composition test ที่ป้อน output ของ parser เข้า `chunkDocument` ตรง ๆ ไม่ใช่ประโยคที่ประกาศว่าสอง shape ตรงกัน — ก่อนเลนนี้ ผู้เรียก `chunkDocument` ทุกตัวในเรโปเป็นไฟล์เทสต์ที่สร้าง `blocks` ด้วยมือ | P1 | Claude | done | FR-071; FR-112; ADR-050; SDD-063 | ../domains/knowledge/features/FR-115-document-parsing.md |
| TASK-FR-116 | PHASE-ZAI-KNOWLEDGE | task | Derived-object provenance (FR-116, SDD-064): Stage 3 ของ catalog — สาย lineage Fact → Chunk → ParsedArtifact → RawArtifact → Source; **พกและตรวจ chain ของ identifier ที่ตัวเองไม่ได้เป็นคนออก** (FR-071 เป็นเจ้าของ execution ledger และ record identity); SDD-064 ปิดช่องโหว่ที่ว่าการประกาศ `DERIVED`/`INFERRED`/`COMPUTED` ไม่ใช่ใบยกเว้นจากการมีที่มา — ต้องระบุ `derivation_method` และ source ที่ resolve ได้จริง ไม่ใช่แค่ไม่ว่าง | P1 | Claude | done | FR-071; FR-112; FR-115; ADR-050; SDD-042; SDD-064 | ../domains/knowledge/features/FR-116-derived-object-provenance.md |
| TASK-FR-114 | PHASE-ZAI-KNOWLEDGE | task | Canonical normalization (FR-114, SDD-061): Stage 4 ของ catalog — ทำหกหมวดที่กฎ deterministic และตรวจได้ในที่ (Unicode NFC, whitespace, date, phone, email, ชื่อองค์กร) และ **ประกาศอีกหกหมวดว่าอยู่นอกขอบเขต** (currency, unit, timezone, product code, country/region, identifier format) เพราะต้องพึ่ง business configuration — canonical form ที่คิดขึ้นเองจะผิดในแบบที่ดูน่าเชื่อถือ; SDD-061 กำหนดว่า normalizer ที่ตัดสินไม่ได้ต้อง **ไม่คืน `canonical` เลย** และรายงานความกำกวมแทน — ไม่ใช่แนบ warning ไว้ข้างค่าที่เดามาแล้วอ่านได้ (`25/8/26` = 2526 BE หรือ 2026 CE ผิด 43 ปีแบบไม่มีใครรู้) | P1 | Claude | done | FR-092; FR-113; ADR-050; SDD-061 | ../domains/knowledge/features/FR-114-canonical-normalization.md |
| TASK-FR-117 | PHASE-ZAI-KNOWLEDGE | task | Deduplication and versioning (FR-117, SDD-065): Stage 6 ของ catalog — **stage สุดท้ายของ Tier 1**; วางสิ่งที่เข้ามาเทียบของที่ถืออยู่เป็น `DUPLICATE_OF` / `REVISION_OF` / อิสระ ด้วย ingestion identity สี่ส่วนของ BR-021 (source identity, source version, content hash, pipeline version) คำนวณ**ภายใน tenant เดียวเท่านั้น** (SEC-021) — tenant ถูกพับเข้าไปใน hash เอง การยุบข้าม tenant จึง**เขียนออกมาไม่ได้** แทนที่จะเขียนได้แล้วไปห้ามที่อื่น; supersession ออกเป็น **คู่** (`SUPERSEDES` + `SUPERSEDED_BY`) เพราะกราฟที่มีแต่ขาไปตอบคำถาม "อะไรมาแทนสิ่งนี้" จากฝั่งที่ถูกแทนไม่ได้ ซึ่งเป็นฝั่งที่ถูกถาม; ไม่มีการ default ค่าใด — คีย์ที่ขาดส่วนประกอบถูกปฏิเสธ ไม่ใช่ hash เป็นสตริงว่าง เพราะรูในคีย์ไม่ใช่ความว่างเปล่าแต่เป็นค่าที่ทุกอันที่ขาดส่วนนั้นจะชนกัน; **ประกาศการลดขอบเขต**: §11 ระบุสี่ผลลัพธ์ แต่นี่ให้สาม โดยพับ Replacement เข้า `REVISION_OF` และกลยุทธ์ content-/structural-similarity ถูกปฏิเสธเพราะต้องใช้ threshold ซึ่งเลขที่ตั้งขึ้นในโมดูลนี้จะกลายเป็นคำตัดสินว่าเอกสารไหน "เหมือนกัน" โดยคนที่พิมพ์เลขนั้น; `DERIVED_FROM` ไม่ถูกกำหนดที่นี่ — เป็นของ FR-116 | P1 | Claude | done | FR-081; FR-116; BR-021; SEC-021; ADR-050; SDD-065 | ../domains/knowledge/features/FR-117-deduplication-and-versioning.md |
| TASK-FR-118 | PHASE-ZAI-KNOWLEDGE | task | Knowledge ingestion stage runner (FR-118, SDD-068): `runKnowledgeIngestionStages` ใน `src/modules/knowledge/stage-runner.js` — **pure function หนึ่งตัว** ที่เรียก stage calculator ทั้งเจ็ดของ Tier 1 (parsing, provenance, normalization, classification, dedup, chunking, entity extraction) เรียงตามลำดับ ADR-050 D2 บน artifact เดียวในรอบเดียว; พิสูจน์ด้วย composition test บน artifact จริง (ชื่อองค์กรภาษาไทย, structured record, structured field, และ dedup ครบสามผลลัพธ์ — INDEPENDENT, DUPLICATE_OF, REVISION_OF) บวก determinism test สองตัว (input เดิม → chunk id และ candidate id เดิม ตามที่ BR-021 กำหนด) — 15 เทสต์ในไฟล์นี้, ทั้ง knowledge suite 217 เทสต์ผ่าน; **ปิด AC-109.2/.7/.13 ของ FR-109 ไม่ได้แม้แต่ข้อเดียว** — พูดตรง ๆ ไม่ใช่ caveat: ทุกข้อต้องมีหลักฐานเขียนลง ledger ของ FR-071 (registered run, `PipelineStep` transitions, `PipelineRecordEvent` rows) และ pure function ที่คืน envelope ในหน่วยความจำไม่เขียนสิ่งเหล่านั้นเลย ไม่ว่าจะประกอบกี่ stage ก็ตาม; การประกอบเจ็ด stage เข้าด้วยกัน **ไม่ใช่** pipeline ที่ operable — ยังไม่มี persistence, ไม่มีการเขียน ledger, ไม่มี job lifecycle; ครึ่งที่จะเรียก FR-118 แล้วเขียน ledger ยังไม่มีชื่อและยังไม่มีใครสร้าง (charter กับ note ของ FR-109 เรียกมันว่า "ledger-writing wiring" ไม่ใช่ "stage runner" เพื่อไม่ให้ชนชื่อกับ FR-118 เอง) | P1 | Claude | done | FR-109; FR-111; FR-112; FR-113; FR-114; FR-115; FR-116; FR-117; ADR-050; BR-021; SDD-068 | PRD-SDD FR-118 |
| TASK-FR-119 | PHASE-ZAI-KNOWLEDGE | task | Per-stage failure attribution และ BR-022 quarantine (FR-119, SDD-072): `runKnowledgeIngestionStagesWithTrace` เพิ่มเข้าไปใน `src/modules/knowledge/stage-runner.js` เป็น export ตัวที่สอง — catch รายด่านแล้วรายงานว่า stage ไหนสำเร็จก่อนถึงตัวที่ล้ม แทนที่จะ throw ทิ้งทั้งรอบ; `runKnowledgeIngestionStages` ตัวเดิมของ FR-118 **ไม่ถูกแก้สัญญา** ยังคง throw ที่ความล้มเหลวแรกเหมือนเดิม; `ingestKnowledgeDocument` เขียน `STEP_SUCCEEDED` จริงให้ stage ที่ผ่านไปแล้ว และ `STEP_FAILED` + envelope ของ BR-022 ให้ตัวที่ล้ม — เดิมความล้มเหลวใด ๆ ทำให้ ledger เงียบสนิททั้งรอบ; ทุกความล้มเหลวของ Tier 1 จัดเป็น `NON_RETRYABLE` เพราะ stage calculator ทั้งเจ็ดเป็น pure และ deterministic (ไม่มี I/O ไม่มี transient) ส่วน `RETRYABLE`/`REVIEW_REQUIRED` เป็นคำศัพท์จริงของ BR-022 ที่ยังไม่มี trigger — **ระบุเป็นข้อค้นพบ ไม่ใช่ที่ว่างรอเติม** เพราะเคสกำกวมปฏิเสธด้วย `canonical: null` (FR-114) ตั้งแต่ต้นทางจึงไม่เคยเดินมาถึง quarantine; `errorRef` ยังคง redact ตาม SDD-073 | P1 | Claude | done | FR-118; FR-109; FR-114; BR-022; ADR-050 | PRD-SDD FR-119 |
| TASK-FEAT-009 | PHASE-ZAI-CRM | task | CRM Conversation Inbox (FR-091, read-only per BR-011) + LINE reply delivery receipt (FR-093) | P0 | Claude | done | FR-023; FR-052; FR-081 | ../domains/crm/features/FR-091-conversation-inbox.md |
| TASK-FR-103 | PHASE-ZAI-CRM | task | PDPA consent attestation on Customer (FR-103) — closes SEC-005, P0 open since 2026-08-12; owner attests GRANTED/DECLINED in the CRM console, legacy rows GRANDFATHERED | P0 | Claude | done | FR-091; SEC-005 | ../domains/crm/features/FR-103-pdpa-consent-attestation.md |
| TASK-FR-092 | PHASE-ZAI-CRM | task | Market translation core: RawExternalRecord → provider-neutral MarketObservation (FR-092) | P1 | Claude | done | FR-081 | ../domains/market-intelligence/features/FR-092-market-translation-core.md |
| TASK-FEAT-010 | PHASE-ZAI-IAM | task | Production IAM (ADR-045): canonical principal (FR-094), persisted sessions (FR-095), shared policy enforcement (FR-096), verified channel onboarding (FR-097), agent/tool/MSP authorization (FR-098) | P0 | Claude | in-progress (code + tests landed; production hardening tail per Issue #99) | FR-046; ADR-045 | ../domains/identity/features/FR-094-production-iam-boundary.md |
| TASK-FR-104 | PHASE-ZAI-IAM | task | Owner-assisted password reset (FR-104): authenticated mint + public consume, digest-only storage, all sessions revoked — deliberately no public forgot-password route | P0 | Claude | done | FR-090; FR-095 | ../domains/identity/features/FR-104-owner-assisted-password-reset.md |
| TASK-SEC-006 | PHASE-ZAI-IAM | task | Enterprise API tenant token auth — delivered as FR-106: `ApiAccessKey` per-Tenant bearer key on the FR-019 surface, key-or-session (ADR-047 D3 generalized); closes SEC-006 | P1 | Claude | done | FR-019; FR-102; ADR-047 | ../domains/identity/features/FR-106-enterprise-api-access-key.md |
| TASK-FR-107 | PHASE-ZAI-IAM | task | Installation-operator grant store + bootstrap (FR-107): `PlatformGrant` resolved per request in the session port (แทน hardcoded false), bootstrap CLI + `--grant-only` mode; operator คนแรกถูก bootstrap บน production แล้ว (PER-BOSS) | P0 | Claude | done | FR-075; FR-095; FR-104 | PRD-SDD FR-107 |
| TASK-FR-066-067 | PHASE-ZAI-IAM | task | Profile-first onboarding + Waiting Room (FR-066) และ workspace collaboration invites (FR-067): `WorkspaceMembership`/`WorkspaceInvite` เป็น authority layer แยก (BR-016), invite ตามวินัย SEC-014 | P0 | Claude | done | FR-046; ADR-027 | ../domains/identity/features/FR-066-profile-first-workspace-onboarding.md |
| TASK-FR-120 | PHASE-ZAI-IAM | task | Self-serve account creation (FR-120): `/signup` สาธารณะ + `POST /api/auth/signup` สร้าง `Person` + `PersonCredential` ของผู้สมัครเอง แล้วเดินต่อเข้า FR-066 ที่ขั้น `PROFILE` — **ปิดประตูบานเดียวที่ผลิตภัณฑ์ยังไม่มี**: FR-066 เริ่มต้น *หลังจาก* มี local identity แล้ว และไม่เคยบอกว่ามันเกิดขึ้นได้อย่างไร, invite ของ FR-067 รับด้วย `personId: viewer.principal.id` จึงผูก membership กับคนที่ล็อกอินอยู่แล้วและรับคนแปลกหน้าไม่ได้, ส่วนคนที่เขียน credential ได้มีแค่ `prisma/seed.js` กับ operator bootstrap ของ FR-107 — ไม่มีใครใหม่เข้าได้ จึงไม่มีใครใหม่ให้เชิญด้วย เพราะ invite ต้องมี Person ให้ผูก; **การสมัครไม่ให้อำนาจอะไรเลย** — ไม่สร้าง `PlatformGrant`, Tenant, Business, Space, Project หรือ `WorkspaceMembership`; สิ่งที่ Person ใหม่ทำต่อได้คือสิ่งที่ FR-066 ให้ Person ที่มี profile ทุกคนอยู่แล้ว (owner path ของ `createOnboardingWorkspace` = หนึ่ง `Portfolio` + หนึ่ง OWNER membership, ศูนย์ Org/Tenant/Business ตาม AC-066.2) ไม่มากกว่านั้น — signup ขยายว่า *ใคร* เดินเข้าเส้นทางนั้นได้ ไม่ได้ขยาย *เส้นทาง*; hashing/validation เรียก `hashPassword` ของ FR-046/FR-104 ไม่ก๊อป, code `PSN-` มาจาก `uniqueHumanCode` เดิม (BR-002), session มาจากทางมินต์ของ FR-046, และล็อกอินให้ทันทีเมื่อสำเร็จด้วย browser-session cookie ตาม default ของ AC-046-15 (signup ไม่มีช่อง "จดจำฉัน"); **email เป็นตัวระบุตัวตน ไม่ใช่ช่องทางติดต่อ** — installation นี้ไม่มี mail transport (เหตุผลเดียวกับที่ FR-104 ไม่มี public forgot-password) จึงไม่มีขั้นยืนยันอีเมลและไม่มี "เช็คกล่องจดหมาย" ให้ซ่อนอีเมลซ้ำไว้ข้างหลัง อีเมลซ้ำจึงตอบด้วย error ที่แยกแยะได้ — ยอมรับ enumeration นี้โดยตั้งใจ เพราะบัญชีที่ได้มาไม่ถือ scope, capability หรือ membership ใด ๆ จนกว่าเจ้าของจะสร้าง Workspace หรือมีคนเชิญ โดยมี audit trail กับ rate limit **แบบ in-process ต่อ instance** (reset เมื่อ restart, ไม่ข้าม replica) เป็น compensating control ที่ระบุข้อจำกัดไว้ตรง ๆ แทนที่จะกลบ | P1 | Claude | done | FR-066; FR-067; FR-046; FR-104; FR-107; BR-002; SEC-008 | PRD-SDD FR-120 |
| TASK-FR-121 | PHASE-ZAI-IAM | task | Google เป็นทางเข้าที่สองเหนือ `Person` เดิม (FR-121): `/signup` และ `/login` รับบัญชี Google แล้ว callback resolve `sub` เป็น `Person` ภายในหนึ่งคนตาม FR-094 — เป็นวิธีพิสูจน์ตัวตนวิธีที่สอง ไม่ใช่เส้นทางสมัครที่สอง; **ประกาศแล้วแต่ blocked ไม่ใช่แค่ยังไม่ทำ** และ blocked ด้วยของสองอย่างที่ระบุชื่อได้: (1) installation นี้ไม่มี OAuth client credential และสร้างจากในนี้ไม่ได้ เป็น account action ใน Google Cloud Console ที่เจ้าของต้องทำเอง, (2) `ExternalIdentity` คีย์ด้วย `(tenantId, provider, providerSubject)` โดย `tenantId` เป็น FK บังคับ เพราะผู้เขียนรายเดียวตอนนี้คือ `link-line-identity.js` ซึ่ง LINE subject มากับ LINE OA ของ tenant เสมอ — แต่ signup ของ FR-120 **ตั้งใจไม่สร้าง Tenant** binding ของบัญชี self-serve จึงไม่มี tenant ให้ key และเขียนลงตารางไม่ได้เลย ต้องตัดสินก่อนเขียนโค้ดว่า `tenantId` จะ nullable สำหรับ binding ที่มาก่อน tenant หรือจะแยก model ใหม่ ทั้งสองทางเป็น schema change ที่มี migration ไม่ใช่รายละเอียดที่ตัดสินกลางทางได้; **ไม่ทดแทน FR-122** — Google ให้อีเมลกับ display name ของตัวเอง ส่วนชื่อ นามสกุล และเบอร์โทรยังต้องกรอกเอง และเบอร์โทร Google ไม่เคยให้; อีเมลที่ตรงกับบัญชีเดิมผูกได้**เฉพาะเมื่อ `email_verified` เป็นจริง** ถ้าไม่ยืนยันให้ปฏิเสธ เพราะการผูกด้วยอีเมลที่ยังไม่ยืนยันคือการยึดบัญชีด้วยการสมัคร | P2 | — | blocked | FR-094; FR-120; FR-122; BR-002 | ../domains/identity/features/FR-121-google-second-way-in.md |
| TASK-FR-122 | PHASE-ZAI-IAM | task | Profile บอกว่าคนคนนั้นเป็นใคร ไม่ใช่แค่จะเรียกว่าอะไร (FR-122): ขั้น PROFILE ของ FR-066 บังคับ **ชื่อ นามสกุล เบอร์โทรศัพท์** เพิ่มจาก display name ที่เก็บอยู่แล้วและอีเมลที่ไม่บังคับ; **คอลัมน์ nullable แต่บังคับที่ boundary** และการแยกนี้คือสาระ ไม่ใช่ความหย่อน — มี `Person` ที่ไม่มีวันกรอกได้อยู่แล้ว: `prisma/seed.js`, operator bootstrap ของ FR-107 และเหนืออื่นใดคือ Person ทุกตัวที่ LINE ingest ของ FR-023 สร้างตอน first contact จาก `lineUserId` ล้วน ๆ ซึ่งมี channel subject และไม่มีอย่างอื่นเลย `NOT NULL` ตรงนี้จะทำให้เส้นทาง intake หลักเขียนไม่ได้และล้มทั้งสาย ข้อบังคับจึงอยู่ที่ `completeProfile` ซึ่งเป็นที่เดียวที่คนพูดเรื่องนี้ด้วยตัวเอง; **display name เลิกถูกพิมพ์สองครั้ง** — ฟอร์มทำให้ไม่บังคับ และ service ประกอบจาก `firstName lastName` เมื่อไม่ส่งมา แต่ไม่เคยเก็บค่าว่าง เพราะทุกหน้าจอ render มัน (contract ผ่อนจาก required เป็น optional ทางเดียว caller เดิมทุกตัวจึงยังผ่าน) | P1 | Claude | done | FR-066; FR-023; FR-107; BR-016; SEC-014 | ../domains/identity/features/FR-122-profile-identity-fields.md |
| TASK-FR-123 | PHASE-ZAI-IAM | task | Plugin authorization boundary (FR-123 / ADR-052): `/api/plugin/auth` สี่ route — browser session อนุมัติ code ที่ผูก PKCE S256 อายุ 60 วินาที ใช้ได้ครั้งเดียว, แลกเป็น opaque bearer session อายุ 15 นาที, capability มาจาก `resolveViewer` ฝั่ง server, revoke idempotent; code กับ token เก็บเป็น SHA-256 hash เท่านั้น. **ไม่ใช่ `ApiAccessKey` ของ FR-106** — อันนั้นเป็น service credential ผูก Tenant อายุยาว ส่วนอันนี้เป็นการมอบอำนาจจากคนที่ล็อกอินอยู่ให้ plugin ตัวเดียวบนเครื่องตัวเอง และไม่เคยรับ `platformGrant` ต่อ จึงติดตั้ง plugin แล้วมองเห็นได้ไม่เกินที่คนคนนั้นเห็นอยู่แล้ว; redirect ต้องตรงเป๊ะ `localhost` กับ `127.0.0.1` นับเป็นคนละรายการ (ADR-052 D1 — Preview transport เขียนทับตัวหนึ่งเป็นอีกตัว จึงมี test กันไว้ไม่ให้ใครไป normalize ทีหลัง); code ที่ถูก replay ไม่ได้แค่ปฏิเสธ แต่ **เพิกถอน session ที่ code นั้นเคยออกไปแล้วด้วย** (RFC 9700 §4.1.1) ซึ่งเป็นช่องที่ draft เดิมเปิดทิ้งไว้. **ยังไม่ done** เพราะสามอย่าง: migration บน Supabase จริงยังไม่ได้ apply (ต้องให้คนรัน SQL เอง — session ไหนก็เข้า project ไม่ได้), ยังไม่มี production client registration, และยังไม่มีตัวเก็บกวาด (reaper) code/session ที่หมดอายุ. **ขั้น consent ปิดแล้ว (2026-08-30, ADR-052 D4)**: `GET /authorize` เปลี่ยนเป็น redirect ไปหน้า `/plugin/authorize` ซึ่ง render อย่างเดียว ไม่อ่าน session ไม่แตะ database และไม่ mint อะไรเลย — เดิมมัน mint จาก session cookie ตรง ๆ และเพราะ `zuri_session` เป็น `sameSite: 'lax'` ซึ่ง Lax **ส่ง** cookie ไปกับ top-level GET navigation หน้าเว็บใดก็ตามที่พาให้ browser navigate ได้จึงออก code แทนคนที่ล็อกอินอยู่ได้โดยไม่ต้องถามเขาเลย. การ mint ต้องเป็น POST จากฟอร์มบนหน้า consent เท่านั้น และต้องครบสามอย่าง: session cookie, anti-CSRF token ที่ผูกกับ session, และ request token ที่เซ็น HMAC ด้วย `ZURI_SESSION_SECRET` อายุ 5 นาที ซึ่งเป็น**แหล่งเดียว**ของพารามิเตอร์ที่ handler ใช้ — ฟอร์มจึงถูกยัดพารามิเตอร์คนละชุดกับที่ผู้ใช้เห็นไม่ได้เชิงโครงสร้าง; ปฏิเสธได้จริง ตอบ `error=access_denied` พร้อม `state` เดิม. ไม่มี Prisma model และไม่มี DDL ใหม่ | P2 | Claude | in-progress | FR-106; FR-046; ADR-047; ADR-017; SEC-022; SDD-074 | ../domains/identity/features/FR-123-plugin-authentication-and-capability-discovery.md |
| TASK-FR-124 | PHASE-ZAI-PRODUCT | task | Product Readiness `/platform/product-readiness` + `/[domain]` (FR-124): read-only projection ของ `docs/.domain-state.json` ที่ตอบสี่คำถามแยกกัน — สร้างไปเท่าไร, FR ไหน verified แล้ว, feature พร้อมใช้หรือยัง, และคนใช้ทำอะไรได้ — โดย **readiness ไม่ใช่ progress**: 100% ยังอ่านว่าไม่พร้อมได้ ถ้า FEAT registry ยังเป็น `building`. ไม่มี model, ไม่มี write path, ไม่มี poll, ไม่มี API ภายนอก. **re-apply จาก `origin/rescue/domain-dashboard`** (rescue commit ที่ไม่เคย review, ตามหลัง main 239 commit) เปลี่ยนเลขจาก FR-094 เป็น FR-124. สามอย่างที่แก้ไม่ใช่ port ตรง ๆ: (1) น้ำหนัก 20/40/40 ย้ายไปอยู่ในค่าคงที่ชื่อเดียวพร้อมเหตุผล และยกเป็น **คำถามค้างให้เจ้าของรับรอง** แทนที่จะกลายเป็นข้อเท็จจริงโดยไม่มีใครเห็นว่าตัดสินที่ไหน, (2) ปิดช่องที่ metadata array ว่างเปล่าทำให้ guard ผ่านเงียบ ๆ — array ว่างตอนนี้เป็นคำตอบที่ผิดและบอกชื่อ id ที่ขาดทุกตัว, (3) resolve viewer **ฝั่ง server** ก่อน render เพราะสองหน้านี้เป็นหน้าแรกใต้ `(pm)` ที่แบก payload มาในตัว ขณะที่ route group นั้นมีแต่ guard ฝั่ง client — snapshot จะถูกส่งไปทั้งก้อนใน RSC payload แล้วค่อยไม่แสดง. snapshot ไม่มีข้อมูล Tenant/Business/Person ใด ๆ แต่เป็นภายในของงานวิศวกรรม และ FR-105 วางแบบแผนไว้แล้วว่า static projection resolve viewer ฝั่ง server | P2 | Claude | done | FR-060; FR-046; FR-105; ADR-025; NFR-008 | ../domains/project-manager/features/FR-124-product-readiness-dashboard.md |
| TASK-FEAT-011 | PHASE-ZAI-SOT | task | SoT pipeline console: plan board (FR-099), approval inbox + decision export (FR-100), graph dashboard (FR-101) | P0 | Claude | done | FR-071; ADR-046 | ../domains/integration/features/FR-100-sot-approval-inbox.md |
| TASK-FR-102 | PHASE-ZAI-SOT | task | SoT data-plane service-account key (FR-102, ADR-047): Bearer `sdpk_` auth for submit/export, SHA-256 digest only, per-Tenant binding | P0 | Claude | done (RSK-016 ปิด 2026-08-27 — migration apply + ledger ครบ) | FR-100; ADR-047 | ../domains/identity/features/FR-102-sot-data-plane-service-account.md |

## สิ่งที่ยังไม่ได้สร้างจริง (จาก gap analysis 2026-08-26 — เรียงตามน้ำหนัก)

รายการนี้คือส่วนที่ registry ประกาศแล้วแต่ยังไม่มีโค้ด หรือมี gate ภายนอกค้าง —
ตัวเลขสถานะในตารางข้างบนไม่นับสิ่งเหล่านี้ว่าเสร็จ:

1. ~~FR-066 / FR-067~~ — **ส่งมอบแล้ว 2026-08-27** (แถว TASK-FR-066-067)
2. ~~SEC-006~~ — **ปิดแล้ว** ผ่าน FR-106 (แถว TASK-SEC-006)
3. **FEAT-007 / FR-082..085** — Pipeline Builder canvas: design-only ตาม ADR-035
4. **FR-071 tail** — canonical apply, Product/Customer promotion, publish (SoT loop
   ที่ FR-100 เปิดทางเดินข้างไว้ให้)
5. **Production/activation gates** บน slice ที่โค้ดเสร็จแล้ว: LINE canary +
   real-provider evaluation (FR-053..055), live Vault provisioning (FR-079/080),
   remote identity migration (FR-076) — ~~live Supabase apply (RSK-016)~~ ปิดแล้ว 2026-08-27
6. **ADR-044 in-repo seam** — ยังไม่มี FR สำหรับ Conversation ↔ unified-thread join
   และ group-thread isolation rule; งานหลัก (console, thread minting, dispatcher)
   อยู่นอก repo นี้ตาม ADR-044 D1
7. **FEAT-013 / FR-109..111** — 17-Stage Knowledge Ingestion & GraphRAG pipeline:
   ประกาศใน PRD เมื่อ 2026-08-27 (revision 1.97.0b) ภายใต้ ADR-050 — **ข้อความเดิม
   ของข้อนี้ล้าสมัยตั้งแต่ 2026-08-28** และถูกแทนที่ทั้งย่อหน้า: Tier 1 ส่งมอบครบ
   ทั้ง Stage 1..8 (FR-112..FR-117), ประกอบเป็นสายเดียวด้วย FR-118 และรายงาน
   ความล้มเหลวรายด่านด้วย FR-119, เขียนหลักฐานลง FR-071 ledger ผ่าน SDD-069;
   FR-109 ✅ (6/13 AC) และ FR-111 ✅ แล้ว **เหลือ FR-110 ตัวเดียวที่ยังเป็น 🔜**
   (published snapshot contract + Stage 17 gate — ยังไม่มี route/model/code) ส่วน
   FEAT-013 ยังเป็น proposed. ADR-050 เองก็ Accepted เฉพาะ contract/documentation
   boundary — ไม่ authorize runtime slice. SDD-057 ระบุให้ reuse execution ledger
   ของ FR-071 แทนการประกาศ model ใหม่ ส่วน SDD-058 / NFR-020 / BR-021 / BR-022 /
   SEC-021 เป็นกฎที่ประกาศล่วงหน้าก่อน pipeline ที่มันกำกับ. เอกสารต้นทางคือ
   `../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md`

> **PRD status columns**: sync ล่าสุด 2026-08-27 (PRD 1.94.0b "RSK-016 closed" ถึง 1.99.0b) —
> FR-100/102/103/106/107 เป็น ✅ หลัง migration ทั้ง 6 apply บน live; FR-105 มี
> deployment evidence (`zuri-ai-woad.vercel.app`); FR-108/112 ✅; FR-109 ✅ (6/13 AC) และ FR-111 ✅ ตั้งแต่ 2026-08-27..29 ส่วน
> **FR-110 ยัง 🔜 ตัวเดียว**; ค้าง 🟠 เดียวคือ FR-097 (provider evidence)
