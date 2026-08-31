---
version: "0.1.0b"
created_at: "2026-08-31T09:52:22+07:00,ATHER,b0e9395"
last_update: "2026-08-31T10:00:03+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "crm"
  doc_type: "root-cause-analysis"
  scope: "FR-091 Conversation to Customer tenant correlation"
  complexity: "C-2"
  risk: "HIGH"
---

# RCA — CRM inbox อ่าน Customer ที่อยู่คนละ tenant กับ Conversation

**สถานะ:** ยืนยัน root cause ด้วยข้อมูลจำลองบน SQLite แล้ว; ยังไม่ได้แก้ application code
และยังไม่ตรวจว่าข้อมูลผิดรูปชนิดนี้มีอยู่ใน production หรือไม่.
ข้อเสนอ implementation อยู่ใน [แผนรอบถัดไป](../../docs/roadmap/PLAN-PARALLEL-WAVE2-20260831.md).

## Symptom

เมื่อ Conversation ระบุ tenant A แต่ customerId ชี้ Customer ของ tenant B,
ผู้ใช้ที่มองเห็นเฉพาะ Business ใน A อ่านชื่อ/code/consentNote ของ Customer B
ผ่าน getConversationInbox และ getConversationThread ได้.
เงื่อนไขสำคัญคือมีความสัมพันธ์ผิดรูปอยู่ก่อน ไม่ใช่หลักฐานว่าผู้ใช้ทั่วไปสร้างแถวดังกล่าวผ่าน API ได้.

## Evidence

ตรวจ source ที่ b0e9395743925417f41740a6146956c6236ec4a6 และเทียบ main
5787c8a541fff45cbb0d115f30d8191a042305df: conversation-read-model.js มี blob
1ed357eed3ebff08ee03a6cc6bcf5fb3932b5f7c ตรงกัน. Main ชุดใหม่เปลี่ยนเฉพาะเอกสาร.
Local merge f95cd5b ไม่เปลี่ยน application source.

- src/modules/crm/conversation-read-model.js:78–101: resolveScope ตรวจ selected Business,
  Conversation.tenantId และ businessId ที่ viewer เห็น แต่ไม่มี predicate บน Customer.tenantId.
- prisma/schema.prisma:1241–1259: customerId FK ตรวจเพียง Customer.id ไม่ผูก tenantId
  ทั้งสอง aggregate. จึงสร้างความสัมพันธ์ผิดรูปนี้ได้ใน SQLite schema ปัจจุบัน.
- reader เลือก nested customer และส่ง customerDto ออกทั้ง inbox และ thread.
  DTO มี displayName, code, consentStatus, consentRecordedAt และ consentNote.
- src/app/api/crm/conversations/route.js กับ conversations/[id]/route.js
  เรียก readers ดังกล่าวหลัง resolve viewer. รอบนี้พิสูจน์ service จริง แต่ไม่ได้ยิง HTTP/browser.
- หลักฐาน JSON ที่ไม่มีข้อมูลลูกค้าจริง:
  C:/Users/freshair/AppData/Local/Temp/zuri-wave2-inbox-audit-nRbbm7/result.json.
  schema-push.log อยู่ใน directory เดียวกัน. ไฟล์ TEMP เป็นหลักฐานประกอบ;
  ขั้นตอนและผลที่จำเป็นต่อการทำซ้ำบันทึกถาวรไว้ด้านล่าง.

### การทำซ้ำที่ไม่ใช้ข้อมูลจริง

1. สร้าง SQLite scratch ใหม่บน C; สร้างไฟล์ว่างก่อน Prisma db push --skip-generate
   ด้วย prisma/schema.prisma ของ worktree นี้. ใช้ client ที่ generate สำหรับ worktree นี้.
2. ล้าง PostgreSQL selectors เฉพาะ process โดยไม่อ่านหรือพิมพ์ค่า และตั้ง DATABASE_URL
   ให้ชี้ scratch เท่านั้น; ไม่แก้ .env, primary, application DB หรือ production.
3. สร้าง Portfolio, Tenant A/B, Business A/B, Person และ Customer B ด้วย fixture สังเคราะห์.
   Customer B มี consentStatus GRANTED และ consentNote เป็น marker สังเคราะห์.
4. สร้าง Conversation ที่ tenantId=A, businessId=Business A, customerId=Customer B,
   channel=LINE พร้อมหนึ่ง Message สังเคราะห์. FK ของ schema ปัจจุบันยอมรับ.
5. สร้าง viewer ผ่าน tests/factories/viewer.js makeViewer ให้เห็นและเป็น owner เฉพาะ Business A.
6. เรียก exported getConversationInbox({ viewer, businessId: Business A }) และ
   getConversationThread({ viewer, businessId: Business A, conversationId: malformedConversationId }) ด้วย client เดียวกัน.
   เปรียบเทียบ IDs กับ Customer B แล้ว disconnect โดยไม่แตะ application source.

| การตรวจ | ผลที่สังเกตจริง |
|---|---|
| persist malformed relationship | สำเร็จ |
| viewer เห็น Business B | false |
| inbox คืน Customer B | true |
| thread คืน Customer B | true |
| inbox คืน consentNote marker ของ B | true |
| จำนวน Message ใน thread | 1 |
| production/application data หรือ source ถูกแก้ | false |

Diagnostic ครั้งแรกไม่ผ่าน schema engine ขณะยังไม่มีไฟล์ SQLite ว่าง.
หลังทำตามการเตรียมไฟล์ของ test harness เดิม schema push และ diagnostic จบ exit 0.
รอบแรกไม่ใช่หลักฐานว่า bug เกิดหรือไม่เกิด และไม่มีการแก้ test/implementation เพื่อให้ผ่าน.

## Root Cause

Scope predicate เชื่อ tenantId ที่ Conversation ระบุเพียงฝั่งเดียว.
การเลือก nested Customer เชื่อ customerId FK ต่อ ทั้งที่ FK นี้รับประกันเพียงการมีอยู่ของ Customer
ไม่ได้รับประกันว่า Customer.tenantId เท่ากับ Conversation.tenantId.
จึงเกิดช่องว่างระหว่าง authorization ที่ aggregate แรกกับข้อมูลส่วนบุคคลที่ reader ดึงจาก aggregate ถัดไป.

## Why the issue escaped detection

Integration suite crm-conversation-inbox.test.js ส่ง fixture IDs ที่จัด tenant ให้ตรงกันเข้า
ingestLineMessage; ไม่ได้พิสูจน์ว่า writer บังคับ alignment ในทุก input; มี ordinary foreign-conversation denial แต่ไม่มี
foreign-Customer relation ใต้ Conversation ที่ผ่าน scope. Unit query-count suite mock findMany
คืน rows โดยไม่ประเมิน where จึงใช้ยืนยันความปลอดภัยของ relation ไม่ได้.
FR-127 มี customer tenant guard ของตัวเองแล้ว แต่ไม่ได้เปลี่ยน FR-091 reader เดิม.

## Proposed prevention

เพิ่ม Customer.tenantId = selected Business.tenantId ใน scope.where เดียวที่ inbox/thread ใช้
ก่อนดึง rows ไม่ filter หลัง DTO. คง Conversation.tenantId และ business visibility predicates เดิม.
ไม่ต้องเพิ่ม model, role, route หรือ schema migration.

เพิ่ม integration regression ที่สร้าง malformed relation กับฐานจริงทั้ง business-bound และ
tenant-shared (businessId null), ตรวจ inbox/counts/preview ไม่เผยแพร่และ thread ตอบ 404.
ทดสอบ viewer ที่มีสิทธิ์ทั้งสอง tenant ด้วย: selected tenant A ยังต้องไม่คืน Customer B.
เก็บ positive cases ของ tenant-shared และ visible same-tenant Business, ordinary foreign denial,
constant query count และ read-only behavior.

เรื่อง deletedAt, consent renewal, snapshot resurrection/completeness และ retention เป็นคนละ
ข้อกำหนด/นโยบาย ไม่เพิ่ม predicates หรือ repair/delete ข้อมูลเหล่านั้นใน fix นี้.
การแก้โค้ดยังรออนุมัติเอกสารตาม AGENTS R5/R6 เพราะเป็น authorization change ระดับ HIGH.

## Version diff / CHANGELOG

ไม่มี artifact → 0.1.0b: เพิ่ม RCA พร้อม local runtime evidence และข้อเสนอ regression;
ยังไม่มี code fix หรือ production evidence.

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-31 | candidate | Confirmed synthetic SQLite relation disclosure; scoped fix proposal | b0e9395; main reader blob identical | ATHER |
