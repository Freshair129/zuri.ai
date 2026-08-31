---
version: "0.1.0b"
created_at: "2026-08-31T09:52:22+07:00,ATHER,base f95cd5b"
last_update: "2026-08-31T10:00:03+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "cross-domain"
  doc_type: "implementation-plan"
  scope: "next local wave: CRM reader tenant correlation; remaining candidates held"
  language: "th"
  complexity: "C-3"
  risk: "HIGH"
---

# รอบถัดไป — ปิด tenant boundary ของ CRM reader ก่อนเพิ่ม derived profile

**Version:** 0.1.0b
**Status:** candidate — มีหลักฐานและข้อเสนอพร้อม review; ยังไม่ได้อนุมัติ application code รอบใหม่

## เป้าหมายและขอบเขตคำสั่ง

ผู้ใช้สั่ง “ต่อไป” หลัง local wave แรกจบ จึงตรวจงานค้างต่อด้วย
gpt-5.6-luna / reasoning effort max สามสายขนาน:
CustomerProfile และ CRM contracts, CRM reader isolation, Knowledge/Identity local backlog.

[แผนหลัก](PLAN-PENDING-PARALLEL-20260831.md) อนุมัติรอบก่อนเฉพาะ IDN-01, KNO-01
และ FR-127 local persistence/read. ไม่เปิด FR-126/128, external reporter, production
หรือนโยบายข้อมูลเพิ่มเติม. ADR-054 รับรอง declaration/shape แต่ระบุชัดว่าไม่อนุมัติ
migration/runtime; คำสั่งให้เดินงานต่อจึงไม่ถูกใช้แทนคำตอบนโยบายที่ยังไม่มี.

ผลที่แนะนำรอบนี้คืออนุมัติ W2-CRM-SCOPE เพียงรายการเดียวก่อน.
การจัดลำดับข้าม lane เป็น C-3/HIGH; fix ที่เสนอเป็น C-2/HIGH เพราะกระทบ authorization
แต่ไม่เปลี่ยน architecture/schema. AGENTS R5/R6 กำหนดให้ส่งเอกสาร/RCA แล้วรอ
อนุมัติก่อนเขียนโค้ดที่ต้องพึ่งข้อเสนอใหม่; จึงไม่มี implementation ปะปนกับเอกสารนี้.

## ฐานที่ตรวจจริงและสิ่งที่ทำแล้ว

- ผลรอบแรกอยู่ที่ b0e9395; full verify ของ application source บันทึกใน
  [รายงานรอบแรก](../../.agent/reports/PARALLEL-WAVE1-20260831.md).
- Primary เปลี่ยนโดยงานอื่นเป็น main 5787c8a (PR #198) และสะอาด ณ การตรวจ 2026-08-31.
  ไม่ใช่ detached 4ecc1f2/WIP snapshot ในรายงานรอบก่อนแล้ว. ไม่แก้ primary.
- เปรียบเทียบ main ใหม่: เปลี่ยนเฉพาะ GoVibe gap analysis/roadmap/generated documents,
  ไม่มี src/prisma/tests/contracts/scripts/package changes จากฐานร่วม 424f5fa.
- รวม main ดังกล่าวเข้า worktree D:/zuri-ai-parallel-backlog-20260831 เป็น local merge
  f95cd5b. คงเอกสารของทั้งสองงาน; เปลี่ยน revision local wave ใน ROADMAP เป็น 2.13.0
  เพราะ main ใช้ 2.12.0 แล้ว; ไม่เปลี่ยน requirement IDs หรือ phase progress.
- Merge governance PASS: critical 0, warning 0, info 23; application source เท่า b0e9395.
  ไม่ push, merge remote, deploy, migrate หรือเรียก provider.
- Root ยืนยัน finding CRM ด้วย schema และ exported service จริงบน SQLite scratch.
  ดู [RCA](../../.brain/rca/2026-08-31-crm-inbox-customer-tenant-binding.md).
  ข้อมูลทั้งหมดเป็น synthetic; ยังไม่พิสูจน์การมี malformed rows หรือ exposure ใน production.

## Parent / peer alignment

| Authority | สิ่งที่คงไว้ |
|---|---|
| PRODUCT / ADR-024 / ADR-025 | standalone product และ domain ownership |
| PRD-SDD: FR-091, BR-001, SEC-001, SEC-009, SDD-050 | tenant isolation, per-Business visibility, reader-only และ constant query count |
| CRM CHARTER / FR-091 note | shared Customer ภายใน tenant; ไม่เป็น writer หรือ reply path |
| FR-103 / SEC-005 | consent DTO เป็นข้อมูลส่วนบุคคล; ไม่แก้ consent writer/policy |
| FR-127 note / ADR-054 | derived analysis increment เดิมคงเดิม; ไม่มี profile/brief/runtime expansion |

## W2-CRM-SCOPE — ข้อเสนอที่ขออนุมัติ

**Root cause:** Conversation.tenantId ผ่าน authorization แต่ nested Customer ถูกอ่านด้วย FK
ที่ตรวจเพียง id จึงอาจอยู่คนละ tenant. Diagnostic สร้าง Conversation(A) → Customer(B)
แล้วผู้ใช้ A-only ได้ Customer B และ consentNote จากทั้ง inbox/thread.

**การแก้ขั้นต่ำ:** ใน resolveScope ของ conversation-read-model.js เพิ่ม relation predicate
ให้ Customer.tenantId เท่ากับ tenantId ของ selected Business ด้วย customer: { tenantId: business.tenantId } ภายใน resolveScope. ใช้ scope.where เดียว
กับทั้ง getConversationInbox/getConversationThread. คง Conversation.tenantId และ
OR ของ businessId null/visible same-tenant Business เดิม.

~~~mermaid
flowchart LR
  V[Trusted viewer] --> B[Selected Business and visible businesses in its tenant]
  B --> Q[Conversation tenant + visible/null Business + Customer same tenant]
  Q --> I[Inbox rows and aggregate counts]
  Q --> T[Thread or 404]
~~~

ห้ามแก้ด้วยการ filter หลังดึง rows/DTO, เปิด scope กว้างขึ้น, เชื่อ customer tenant
จาก request หรือเลือก Customer แรกที่พบ. ไม่เพิ่ม grant หรือ schema constraint
ในรอบนี้; การ cleanup ข้อมูลผิดรูปจริงต้องมีขอบเขตและหลักฐานแยก. ไม่เพิ่ม composite FK หรือเปลี่ยน RLS; production ancestry/isolation evidence ตาม ADR-018 ยังคงแยกจากการปิด reader path นี้.

### Acceptance criteria

| Case | ผลหลัง implementation ที่ต้องพิสูจน์ |
|---|---|
| A-bound Conversation ชี้ Customer B, viewer A-only | inbox ไม่คืน row/customer/consent/preview; thread 404 |
| A-shared Conversation (businessId null) ชี้ Customer B | denial เหมือน business-bound |
| viewer เห็น/เป็น owner ทั้ง A และ B แต่เลือก Business A | malformed Customer B ยังถูกปฏิเสธ ไม่ใช้รวม tenant grants |
| valid Customer/Conversation ใน A, businessId null | ยังคงอ่านได้ตาม BR-001 |
| valid same-tenant visible Business / hidden Business | visible อ่านได้; hidden ไม่ปรากฏใน inbox และ thread 404 |
| ordinary foreign Conversation | inbox ไม่แสดง; thread 404 เดิม |
| counts, previews, row limit | ไม่มีข้อมูลจาก rejected relation และยอดตรงกับ rows ที่อนุญาต |
| side effects / performance | reader ไม่มี write/AuditEvent; จำนวน query คงที่เมื่อ page โตขึ้น |

Viewer fixtures ต้องผ่าน makeViewer/ownsElsewhere ใน tests/factories/viewer.js.
Regression หลักต้องใช้ schema/Prisma จริง; mock ที่ไม่ประเมิน where ใช้พิสูจน์ isolation ไม่ได้.

### File ownership หลังอนุมัติ

- CRM implementation lane: src/modules/crm/conversation-read-model.js และ
  tests/integration/crm-conversation-inbox.test.js; unit test เดิมแก้เฉพาะถ้าจำเป็นต่อ AC.
- CRM peer document: docs/domains/crm/features/FR-091-conversation-inbox.md.
- Root: RCA นี้, master/wave plan status, phase report และ generated governance.
- ไม่มี Prisma/migration, new route/UI, enum/ID, provider, IAM role หรือ consent writer change.

### ลำดับทำงานและ exit หลังอนุมัติ

1. แตก worktree จากผลรวมล่าสุดที่สะอาด; dependencies และ scratch SQLite แยก.
2. เพิ่ม integration counterexamples → ยืนยัน RED ว่าเปิดเผย/ตอบสำเร็จก่อน fix.
3. เพิ่ม relation predicate ขั้นต่ำ → GREEN ทั้ง negative cases และ positive sharing controls.
4. Luna MAX อีก lane review สิทธิ์และ no-writer invariant แบบ read-only;
   root ตรวจ parent/peer/doc status และรัน governance เพียงคนเดียว.
5. รัน npm run verify (tests/build/govern/e2e), ไม่ยอมรับ zero tests หรือ flaky PASS.
   ล้าง PostgreSQL selectors เฉพาะ process; ไม่ใช้ production DB.
6. รายงาน source hash, executed/skipped tests, docs version diff และข้อจำกัด.
   Local commit ได้ตาม workflow เดิม; push/merge remote/deploy ยังไม่อยู่ใน scope.

## งานอื่นที่ตรวจแล้ว แต่ไม่เปิดโค้ดในข้ออนุมัตินี้

| งาน | เหตุผล/ขั้นถัดไป |
|---|---|
| FR-126 CustomerProfile | ADR-054/registry ประกาศ 1:0..1 advisory shape; ต้องมี field vocabulary, provenance/recompute และ consent-scoped writer contract ที่ review ได้ก่อน schema/service |
| FR-128 DailyBrief | รอ FR-127 recompute/source selection, Business/day contract และ push authority; ไม่สร้าง LINE writer ที่สอง |
| KNO-02 external reporter/finalization | KNO-01 เป็น contract foundation; ต้องกำหนด trusted reporter authorization, completion ownership และ retry semantics ก่อน route/finalization |
| KNO-03 / MSP / SoT | external transport, atomic publish, authentication และ apply receipts ยังต้องมี owning-tier evidence; ไม่เขียนข้าม repo |
| Plugin / Google | reaper local ปิดแล้ว; invocation/device/registration/account-linking และ credentials ยังเป็น owner gates |
| Backup/consent followups | stale restore, missing tables, deleted-customer re-consent เป็นคนละ policy/compatibility decision; ไม่ถือว่าได้รับอนุมัติจาก reader fix |
| Catalog / GitHub / Shipping / FlowAccount | signer, attestation, rate ownership/provider facts และ sandbox gates ตามแผนย่อยเดิม |

### ข้อสรุปของ reviewers สำหรับคิวที่ยัง HOLD

FR-126 ยังไม่มี CustomerProfile model/service/feature note จากการ enumerate source, schema
และ CRM notes; ไฟล์ customer-profile-backfill ที่มีอยู่เป็น FR-078 คนละงาน.
ก่อนเสนอ schema ต้องระบุ budgetSignal vocabulary (ยังไม่เลือกค่า),
motivation/motivations กับ JSON storage naming, null/validation bounds,
การแทน attributes และนับ inferenceCount/lastInferredAt ตลอดจนสิทธิ์และ consent gate.
การยืมกติกา GRANTED/OWNER ของ FR-127 เป็นข้อเสนอได้ แต่ยังไม่ใช่ policy ของ FR-126
และไม่อนุมัติ producer/LLM หรือเพิ่ม raw output โดยปริยาย.

Knowledge executor ปัจจุบันตั้งใจคง run ไม่ terminal หลัง Tier 1 อยู่แล้ว;
ห้ามเปิดงาน “แก้ terminal หลัง Stage 8” จากข้อความเก่าใน candidate plan.
ทางเลือก KNO-02R คือ read-only projection จาก ledger เดิมเพื่อบอกว่ายังรอ external stages/gate ใด;
ยังต้องกำหนด response fields/status semantics ก่อน implementation และไม่ปิด KNO-02/FR-110.
Identity ไม่มี local code increment เพิ่มที่ไม่พึ่ง invocation/device/linking policy ในการตรวจครั้งนี้.

## เกณฑ์รับเอกสารรอบนี้

- RCA มี symptom, evidence, root cause, detection gap และ prevention ที่แยกข้อเท็จจริงจาก proposal.
- ไม่แก้ application code/test/schema หรืออ้างว่าปิด security defect แล้ว.
- ทำ governance และ docs:check หลังรวมเอกสาร; generated artifacts มาจาก tooling เท่านั้น.
- ทดสอบ docs/readiness/roadmap ที่เกี่ยวกับ merge; full application verification ของรอบก่อน
  อ้างเป็น historical baseline เท่านั้น ไม่อ้างว่ารันใหม่ทั้งหมดในรอบเอกสารนี้.
- ไม่เปลี่ยนข้อความของ pinned requirement subject หรือ id ledger เพื่อให้ gate ผ่าน.

## ผล review รอบเอกสาร

Independent review สามสายเสร็จแล้ว; existing focused tests 145/145 และ governance ไม่มี critical/warning. ผลนี้ไม่ปิด bug และไม่อนุมัติโค้ด ดู [รายงานพร้อมหลักฐาน](../../.agent/reports/PARALLEL-WAVE2-REVIEW-20260831.md).

## Approval gate

ขออนุมัติเฉพาะ W2-CRM-SCOPE: เพิ่ม Customer tenant predicate ให้ inbox/thread เดิม
พร้อม integration regressions และเอกสาร โดยไม่มี DDL, data repair หรือ production action.
การอนุมัตินี้ไม่ครอบคลุม FR-126/128 หรือ policy gates ในตารางอื่น.
Please review and approve this documentation. I will generate the code once approved.

## Version diff / CHANGELOG

ไม่มี artifact → 0.1.0b: เพิ่ม next-wave scope และ confirmed RCA handoff.
ROADMAP ที่รวม main แล้ว: 2.12.0 ของ local wave → 2.13.0; main PR #198 ยังคง revision 2.12.0.
ไม่มี application/schema version change.

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-31 | candidate | Prioritize confirmed FR-091 tenant relation fix; keep profile and external gates separate | based on f95cd5b; document commit in git history | ATHER |
