---
version: "0.2.0b"
created_at: "2026-08-31T05:01:00+07:00,ATHER,f2749f9"
last_update: "2026-08-31T05:35:00+07:00,ATHER"
status: "under review"
attributes:
  domain: cross-domain
  doc_type: phase-report
  language: th
---

# รายงาน local implementation รอบแรก — 2026-08-31

## ขอบเขตที่อนุมัติ

ผู้ใช้ตอบ "ลุย" หลังรับชุดแผน PLAN-PENDING-PARALLEL-20260831; รอบนี้จำกัดที่ IDN-01 reaper,
KNO-01 FR-110 contract และ Business P5 increment FR-127 persistence/read.
ใช้ gpt-5.6-luna / effort max สามสาย; root เป็นผู้รวมและตรวจ shared governance.
งานเป็น C-3 / HIGH เนื่องจากมี authentication, consent และ schema boundary.

ไม่มี production deployment/migration, credential change, external provider execution,
remote push/merge หรือการเปลี่ยน primary D:\zuri-ai ในรอบนี้.

## ผล implementation

| Increment | ผลที่รวมแล้ว | สิ่งที่ยังไม่รวม |
|---|---|---|
| IDN-01 / FR-123 | ลบ session/code ที่หมดอายุโดยเก็บ code ที่ยังมี active linked session; รักษา replay revocation, expiry boundary, concurrency และ idempotence | ไม่มี scheduler/cron/route/DDL หรือ production invocation |
| KNO-01 / FR-110 | strict snapshot และ Stage 9–16 aggregate-report contract; Stage 17 evidence แยกจาก ledger status; snapshot/event/server-run scope checks และ fail-closed publication eligibility | ไม่มี external reporter authorization, atomic publication, actual retrieval หรือ Tier-4 operation |
| FR-127 increment | ConversationAnalysis ต่อหนึ่ง run, owner writes/visible Business reads, consent/tenant checks, private raw output, erasure รวม Customer ที่ soft delete แล้ว และ snapshot roundtrip | ไม่มี FR-126/128, worker/LLM/provider, UI/public API หรือ applied production migration |

FR ทั้งสามยังเป็น partial ใน registry. Local increment ของ CRM มี roadmap phase แยกจาก
CRM console ที่เสร็จเดิม; binary acceptance ของ increment ไม่ใช่เปอร์เซ็นต์ความพร้อม FEAT-014.

## ฐานและหลักฐานรายสาย

- Product base: 424f5fab525d20fdf1180fabee4c8cf9d16dd994; approved plan base: f2749f9.
- npm ci แยกจริงต่อ worktree; ไม่มีการแชร์ node_modules หรือ generated Prisma client.
- Baseline npm test: PASS — 332 files passed / 4 skipped; 2809 tests passed / 14 skipped, 247.01s.
- Baseline build: PASS; baseline e2e: 96 passed / 4 skipped / 0 flaky, 296.656s.
- IDN source commit 664cd25 → integration 6a78b4b: focused 37 tests รวม reaper 5 cases.
- KNO source commit 38732c1 → integration 11267bd: unit/service 55 และ related integration 34 tests; build PASS.
- CRM source commit 90406bb → integration 2fe5615: focused 70 tests / 10 files; build PASS.
- CRM Supabase artifact สร้างด้วย Supabase CLI 2.114.0, `npx supabase migration new conversation_analysis`;
  path `supabase/migrations/20260830221729_conversation_analysis.sql`. ไม่ได้ apply หรือเชื่อมต่อ project ภายนอก.

Stage 17 review เพิ่ม guard ผูก decision กับ quality step/attempt ที่มีอยู่จริงใน run เดียวกัน;
RED tests พิสูจน์ว่า wrong-stage/unknown-step เคยถูกยอมรับ ก่อนแก้และตรวจ positive handoff.
ดู [RCA](../../.brain/rca/2026-08-31-knowledge-stage17-step-binding.md); source followup 5a21b0b.

## Final integration verification

| Check | ผล |
|---|---|
| npm test | PENDING |
| npm run build | PENDING |
| npm run govern | interim PASS — critical 0 / warning 0 / info 24; รอ reconcile หลัง final review |
| npm run test:e2e | PENDING |
| git diff --check / isolated worktree state | PENDING |

14 skipped baseline tests เป็น controlled-line-activation.postgres (3), line-binding-activation.postgres (5),
line-oa-cross-repo-round-trip (5), runtime-isolation-probe.postgres (1). ไม่ใช่ PostgreSQL/production proof.
Standalone `npm run lint` ยังเข้าหน้า first-run ESLint setup เดิมของ repository; ไม่เพิ่ม config นอก scope.
Build ผ่านขั้น validation ของ Next.js แต่ไม่อ้าง standalone lint PASS.

## Review และขอบเขตความปลอดภัย

Root review ปิด write authority ที่ต้องเป็นเจ้าของ Business, ป้องกัน Conversation/Customer tenant mismatch,
ยืนยัน same-day analysis ใช้คนละ UUID และ CTA ที่ไม่มีอยู่ต้องเป็น null ได้. Erasure ต้องครอบ Customer
ที่ถูก soft delete ไปก่อนหน้า; raw output ไม่ออก DTO/audit. Supabase DDL มี ENABLE/FORCE RLS,
application-runtime policy และ REVOKE จาก public/anon/authenticated/service_role; หลักฐานรอบนี้เป็น
static DDL + local SQLite tests ไม่ใช่ผล policy enforcement บน PostgreSQL จริง.

การตรวจเอกสาร RLS อ้างอิง [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
และ [official changelog](https://supabase.com/changelog); ไม่ใช้ default exposure แทนการกำหนดสิทธิ์ของตาราง.

Reaper ใช้ transaction-local marker/restore ที่ผ่าน replay และ deterministic concurrency tests.
ข้อเสนอทำให้ lock สั้นลงเป็น no-op UPDATE ถูก auto-review ปฏิเสธว่าเป็น security downgrade;
ไม่ได้ retry ผ่าน root หรือเปลี่ยน guard เพื่อหลบข้อจำกัด และคงเวอร์ชันที่ทดสอบไว้.
Optional cross-lane migration review โดย reaper agent ถูก auto-review ปฏิเสธเรื่อง scope เช่นกัน;
ไม่ได้รันส่วนนั้น. Root และ CRM owner ตรวจ SQL ในขอบเขต integration เดิมแล้ว.
ยังไม่พบ defect ที่พิสูจน์ได้ใน marker version แต่ PostgreSQL concurrency ยังไม่ได้ทดสอบจริง.

## ข้อจำกัดเครื่องและวิธีแยกตรวจ

Prisma schema apply ใน scratch SQLite บน D ค้างหลายนาทีและไฟล์ยังถูกล็อกอยู่.
การนำ schema เดียวกันไปสร้าง SQLite ชั่วคราวบน C ด้วย --skip-generate ผ่านใน 3.07s.
ยกเลิกเฉพาะ baseline ของ root แล้วเก็บ scratch directory เดิมไว้ ไม่ลบข้อมูลของงานอื่น.
คำสั่งเดิมเมื่อใช้ scratch store บน C ของ worktree นี้ schema apply 1.25s และ full tests ผ่าน.
นี่เป็นหลักฐานว่าตำแหน่ง storage มีผล ไม่ใช่การวินิจฉัยฮาร์ดแวร์; ไม่มีการแก้ source/test เพื่อหลบ assertion.

Final verification ใช้ C:\Users\freshair\AppData\Local\Temp\zuri-ai-verify-20260831
ซึ่งมี dependency และ test databases ของตัวเอง. ผลรวมที่ review อยู่
D:\zuri-ai-parallel-backlog-20260831 บน branch codex/parallel-backlog-review-20260831.
ก่อนทุก application check ล้าง process-only PostgreSQL connection selectors โดยไม่อ่านหรือพิมพ์ค่า.
ไม่ได้แก้ environment ของเครื่องหรือ credential ใด.

## External / policy gates ที่ยังไม่เปิด

Plugin production migration/client registration/device security/maintenance invocation;
Google linking policy/credentials; FR-110 external reporter authorization, immutable snapshot/atomic
publication/retrieval in owning tiers; FR-126/128 และ CRM runtime producer/provider/retention policy;
catalog signer policy, GitHub path attestation, shipping scope/quotation policy,
FlowAccount sandbox/provider evidence. Local PASS ไม่เปลี่ยนสถานะเหล่านี้.

## Version diff

ไม่มีรายงาน → 0.1.0b: บันทึก scope และ baseline.
0.1.0b → 0.2.0b: รวมผลสามสาย, review decisions, migration provenance และ external gates;
final integration verification ยังรอผลในรุ่นนี้.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-31 | under review | Baseline และ storage workaround | f2749f9 | ATHER |
| 0.2.0b | 2026-08-31 | under review | รวม implementation และ review ก่อน final verification | 2fe5615 | ATHER |
