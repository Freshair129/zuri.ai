---
domain: integration
feature: FR-094
module: integration
source: v2-native
version: "0.1.0b"
created_at: "2026-08-20T10:41:14+07:00,ATHER"
last_update: "2026-08-20T10:41:14+07:00,ATHER"
status: "candidate"
superseded_by: null
---

# FR-094 — FlowAccount read-only pull pipeline

## Rationale

Integration Platform มี metadata, opaque credential reference และ raw-ingestion
substrate แล้ว แต่ไม่มี provider adapter ที่ดึงข้อมูลบัญชี และ FR-080 form ปัจจุบัน
ถูกออกแบบสำหรับ Phase 1 LLM เท่านั้น การเพิ่ม FlowAccount ต้องใช้ path เดิมโดยไม่
เปิด secret หรือสร้าง persistence/translation path ใหม่

FlowAccount public OpenAPI ปัจจุบันใช้ REST pull + Bearer token และ Client
Credentials สำหรับ 1 Client ต่อ 1 บริษัท ไม่มี webhook contract ใน specification
ที่ enumerate เมื่อ 2026-08-20 และไม่มี read endpoint สำหรับ GL/TB/P&L ดังนั้น
ความสามารถนี้เป็น external-evidence acquisition ไม่ใช่ full accounting import

รายละเอียดสถาปัตยกรรมและแหล่งอ้างอิงอยู่ใน
[ADR-039](../../../decisions/ADR-039-FLOWACCOUNT-READ-ONLY-PULL-PIPELINE-AND-CREDENTIAL-PROVISIONING.md)

## Contract

ผู้มี OWNER authority ต่อ Business สามารถเปิด FlowAccount wizard ใต้
`/platform/integrations`, เลือก Sandbox/Production, กรอก Client ID และ Client
Secret แบบ write-only, เลือก resource allow-list/backfill start date และทดสอบ
การเชื่อมต่อ ระบบเก็บ credential bundle ใน approved secret manager และเก็บเฉพาะ
opaque reference ใน `IntegrationCredential`

เมื่อผู้ใช้กด sync, server-owned adapter แลก token, เรียกเฉพาะ GET endpoints ที่
อนุมัติ, paginate ภายใต้ FlowAccount limit แล้วส่งแต่ละ record เข้า FR-081
`zIngestionEnvelope` / `RawExternalRecord` path พร้อม trusted Tenant/Business/
connection scope, external identity, payload hash, run, cursor และ dead-letter
evidence

## Acceptance criteria

### AC-094.1 — Verified connection mode

V1 ใช้ `client_credentials` + `scope=flowaccount-api` ต่อหนึ่ง Business และ fixed
FlowAccount Sandbox/Production endpoints เท่านั้น Custom endpoint, arbitrary
scope และ OpenID refresh-token entry ไม่อยู่ใน V1

### AC-094.2 — Write-only credential UI

Client Secret เดินทางจาก password field ผ่าน TLS ไปยัง server provisioner ครั้ง
เดียว ไม่เข้า browser storage, URL, Prisma, response, log หรือ AuditEvent หน้า
แสดงเฉพาะ masked Client ID fingerprint, credential version และ configured state

### AC-094.3 — Trusted Business scope

ทุก create/test/sync/run/disable operation re-resolve trusted viewer และ authority
ก่อนอ่าน connection หรือเรียก FlowAccount Client-supplied Tenant/Business/
connection fields ไม่เป็น authority และ resource นอก scope ตอบเหมือนไม่มีอยู่

### AC-094.4 — Company verification

Connection เริ่ม `DRAFT` และเป็น `ACTIVE` หลัง token exchange กับ
`GET /company/info` สำเร็จ `companyId` ถูกเก็บเป็น external account identifier;
tax ID หรือ FlowAccount ID ไม่เป็น Zuri primary key

### AC-094.5 — Read-only resource allow-list

adapter เรียกได้เฉพาะ V1 GET catalog ใน ADR-039 ไม่มี POST/PUT/DELETE/status/
payment/attachment operation reachable Bank Channels, OpenID, webhook และ
attachment/PDF อยู่นอก scope

### AC-094.6 — One raw ingestion path

ทุก provider record ผ่าน `ingestRawExternalRecord`; same external id + payload
hash เป็น `UNCHANGED`, changed payload เก็บ evidence ใหม่ ไม่มี provider-specific
raw table และไม่มีการเขียน Accounting/CRM/Sales/Inventory truth

### AC-094.7 — Honest cursor and reconciliation

document resources ใช้ date watermark + 7-day lookback และ full reconciliation
ตามคำสั่งผู้ใช้ ส่วน Contacts/Products/Company/Chart of Accounts ทำ full snapshot
เพราะ FlowAccount ไม่ประกาศ generic updated-since cursor `SyncCursor` เลื่อนเมื่อ
resource run จบครบทุกหน้าเท่านั้น

### AC-094.8 — Rate limit and failures

limiter รักษา headroom ใต้ Sandbox 20 และ Production 100 requests/minute; 429/
transient failures retry แบบ bounded exponential backoff + jitter; terminal
failure บันทึก IngestionRun/DeadLetterRecord ด้วย safe code และไม่เลื่อน cursor

### AC-094.9 — DATA_SOURCE health

หน้า Integration แสดง computed health จาก credential, company test, latest run
และ cursor evidence ด้วย vocabulary เดิม CONNECTED/DEGRADED/ERROR/DISABLED/
MISCONFIGURED โดยไม่เก็บ stale health snapshot และไม่ใช้ inbound silence rule ของ
CHANNEL

### AC-094.10 — No false accounting completeness

UI และ API ระบุว่า FlowAccount OpenAPI data เป็น raw external evidence และไม่
ประกาศ GL, TB, P&L, revenue reconciliation หรือ net profit หาก source classes
เหล่านั้นไม่มีอยู่ การ publish เข้า owner domain ต้องมี requirement/approval แยก

### AC-094.11 — Verification gates

ก่อน production ต้องมี unit/integration/E2E/security tests, live Sandbox contract
evidence, operator company-match approval, rollback drill และ `npm run verify`
ผ่าน ไม่มี automated test ใดถูกนับแทน live Sandbox หรือ owner acceptance

## Dependencies

- ADR-032 / FR-080 — Platform Integration surface และ deferred secret provisioner
- FR-081 / BR-019 — normalized immutable raw evidence
- SEC-001/003/008/016 — scope, audit, trusted session และ secret-safe management
- SDD-048 — allow-listed observability + correlation ID
- FlowAccount Sandbox/Production credentials และแพ็กเกจที่ provider อนุญาต

## Out of scope

- FlowAccount writes, automatic scheduler, OpenID Partner flow, webhook, Bank
  Channels, attachments/PDF, ledger/report APIs ที่ provider ไม่เปิดให้ read
- domain translation/publish และ raw-record deletion/retention mutation

## Delivery state

Documentation candidate only. ยังไม่มี FlowAccount provider code, wizard, route,
schema migration, secret provisioner หรือ Sandbox/Production evidence ใน repository
นี้

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-20 | candidate | Declared the FlowAccount read-only pull, write-only credential, raw evidence, rate-limit, cursor and no-false-accounting contract | working-tree | ATHER |
