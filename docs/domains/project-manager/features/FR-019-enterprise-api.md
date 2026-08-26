---
domain: project-manager
feature: FR-019
module: project-manager
source: v2-native
---

# Enterprise API Surface — Backend-first Integration (Salesforce-style)

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Implemented (FR-019) |
| **Author** | Owen + Claude |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-12 |

> **สถานะการ implement (2026-08-12):** ครบตามเอกสารนี้ — `ExternalRef` อยู่ใน schema,
> envelope 1.1 รับ `externalRefs` ได้ทุก entity, upsert เรียง externalRef → code → สร้างใหม่,
> `GET /api/docs` generate จาก Zod จริง, `GET /api/resolve?system=&value=` ใช้ได้
> หลักฐาน: `tests/integration/external-ref-import.test.js` (11),
> `tests/integration/openapi-docs.test.js` (9), `tests/unit/plan-schema.test.js` (6 เคส external ref),
> `tests/e2e/smoke.spec.js` (3 เคส HTTP จริง)

## หลักการ

1. **External ID ของลูกค้าคือ core identity ของธุรกิจเขา** — ระบบเราไม่เปลี่ยน ไม่ทับ
   แค่ map เข้า internal UUID แล้วใช้เป็น label แสดงผล (สอดคล้อง AGENTS.md ข้อ 4:
   external ID ไม่มีวันเป็น primary key)
2. **Backend-first ไม่ต้องมี UI** — จุด integration คือ API + เอกสาร ไม่ใช่หน้าจอ
   (แบบ Salesforce: ระบบลูกค้า upsert ผ่าน API ด้วย ID ของตัวเอง)
3. **Surface ที่ 4 บนท่อเดิม** — ทุกอย่างจบที่ pipeline validate → dry run →
   preview → transactional commit → audit ตัวเดียวกับ UI wizard / Excel / agent JSON

## แบบจำลองข้อมูลที่ต้องเพิ่ม

### ExternalRef (generalize จาก LegalEntityIdentifier + Repository.externalRepoId)

```prisma
model ExternalRef {
  id         String   @id @default(uuid())
  entityType String   // PROJECT | WORK_ITEM | CUSTOMER | ...
  entityId   String   // internal UUID
  system     String   // "SAP" | "SALESFORCE" | "LEGACY_POS" | ...
  value      String   // core id ของลูกค้า เช่น CUST-88421
  labelAs    Boolean  @default(true)  // ใช้ value เป็น display label แทน human code
  verifiedAt DateTime?
  createdAt  DateTime @default(now())

  @@unique([system, value])
  @@index([entityType, entityId])
}
```

### Envelope extension (schemaVersion ถัดไป)

ทุก entity ใน envelope รับ field เสริม:

```json
{ "code": "WI-...", "title": "...",
  "externalRefs": [{ "system": "SAP", "id": "CUST-88421" }] }
```

## การ validate ID เดิม (เกิดใน dry run)

| ผล | เงื่อนไข | การกระทำ |
|---|---|---|
| matched | (system, value) map อยู่แล้ว → entity เดิม | UPDATE (relabel / อัปเดตข้อมูล) |
| new | ไม่เคยเห็น (system, value) | INSERT entity + สร้าง mapping |
| conflict | value ชี้ entity คนละตัวกับที่ envelope อ้าง หรือชนกันเองใน batch | BLOCK — รายงานรายแถว ห้ามเดา |

Upsert key ลำดับ: `externalRef` (ถ้ามี) → `code` → สร้างใหม่

## API surface

- `GET  /api/docs` — OpenAPI 3 spec **generate จาก Zod schema** (`zod-to-openapi`)
  → เอกสารไม่ drift จาก validation จริง
- `POST /api/import/dry-run` / `POST /api/import/commit` — มีอยู่แล้ว รับ envelope
  ที่มี externalRefs ได้เมื่อ schema อัป
- `GET  /api/resolve?system=SAP&value=CUST-88421` — ขยาย endpoint resolve เดิม
  ให้ค้นด้วย external ID ได้
- เฟส production: token auth ต่อ tenant ✅ ทำแล้ว (FR-106 — `ApiAccessKey`,
  `Authorization: Bearer apik_...` ต่อ tenant, ดู
  `docs/domains/identity/features/FR-106-enterprise-api-access-key.md`);
  rate limit และ idempotency key ต่อ request ยังไม่ทำ

## ใช้งานจริง (curl)

ตัวอย่างเต็มอยู่ที่ `contracts/sample-enterprise-plan.json` — สาม request ต่อไปนี้คือ
integration ทั้งหมดที่ลูกค้าต้องรู้

```bash
# 1) สัญญา API แบบเครื่องอ่านได้ (generate จาก Zod ทุกครั้งที่เรียก)
curl -s http://localhost:3100/api/docs > openapi.json

# 2) ตรวจก่อนเขียน — ไม่มีการเขียนข้อมูลใด ๆ ในขั้นนี้
curl -s -X POST http://localhost:3100/api/import/dry-run \
  -H 'Content-Type: application/json' \
  -d "{\"plan\": $(cat contracts/sample-enterprise-plan.json)}"

# 3) ยืนยัน — transaction เดียว พร้อม audit event
curl -s -X POST http://localhost:3100/api/import/commit \
  -H 'Content-Type: application/json' \
  -d "{\"plan\": $(cat contracts/sample-enterprise-plan.json)}"

# ถามด้วย id ของลูกค้าเอง → ได้ internal id กลับไป
curl -s "http://localhost:3100/api/resolve?system=SAP&value=PS-2026-0042"
# → {"id":"<uuid>","code":"PRJ-ERP-ROLLOUT","type":"PROJECT","externalRef":{...}}
```

การตอบกลับที่ integrator ต้องแยกให้ออก:

| สถานะ | ความหมาย |
|---|---|
| `200` + `valid:true` | ผ่าน — `preview.matchedByExternalId` บอกว่ากี่รายการที่ match ด้วย id เดิม |
| `200` + `valid:false` | มี conflict — อ่าน `preview.conflicts` รายแถว ไม่มีการเขียนข้อมูล |
| `400` | คำขอผิดรูป (Zod) หรือคีย์ค้นหาไม่ครบ |
| `404` | external id นั้นยังไม่เคย map |
| `410` | เคย map แต่ record ปลายทางถูกลบไปแล้ว (mapping ค้าง) |

พฤติกรรมที่รับประกัน:

- **code ของเราไม่ถูกเขียนทับ** — ถ้า external id match record เดิม ระบบอัปเดต record นั้น
  โดยคง `code` เดิมไว้ ต่อให้ลูกค้าส่ง code ใหม่มา (ตอบกลับใน `preview.updates[].planCode`)
- **ส่งซ้ำได้ปลอดภัย** — one mapping ต่อหนึ่ง (system, value) เสมอ
- **envelope 1.0 เดิมยังใช้ได้** — `externalRefs` เป็น optional ทุกจุด

## สิ่งที่ไม่ทำ

- ไม่มี sync สองทางอัตโนมัติใน MVP (import เป็นรอบ ๆ พร้อม audit)
- ~~ยังไม่มี token auth ต่อ tenant~~ **แก้แล้ว 2026-08-26 (FR-106):** ทุก route ของ
  surface นี้รับ `Authorization: Bearer apik_...` ที่ผูกกับ tenant เดียว ตรวจก่อน
  session seam; key ที่ผิด/ถูก revoke/ไม่ส่ง ตอบเหมือนกันหมด — ยังเหลือ rate limit /
  idempotency key ก่อนเปิดสู่ภายนอกเต็มรูปแบบ
- `labelAs` ถูกเก็บและส่งกลับทาง API แล้ว แต่ยังไม่มีจุดไหนใน UI ที่เอา external id
  มาแสดงแทน code (surface นี้ไม่มี UI ตามสเปก) — เป็นงานของฝั่งที่จะเรียกใช้
- ไม่ import external ID มาเป็น `code` ตรง ๆ (code = namespace ของเรา,
  external value = namespace ของลูกค้า — แยกกันเสมอ)
- ไม่มี UI สำหรับ surface นี้ — เอกสาร + ตัวอย่าง curl คือ deliverable
