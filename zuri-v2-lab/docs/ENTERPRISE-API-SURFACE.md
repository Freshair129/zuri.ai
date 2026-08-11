# Enterprise API Surface — Backend-first Integration (Salesforce-style)

| Field | Value |
|-------|-------|
| **Version** | 1.0.1 |
| **Status** | Draft (FR-019 ยังไม่ implement) |
| **Author** | Owen + Claude |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-11 |

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
- เฟส production: token auth ต่อ tenant, rate limit, idempotency key ต่อ request

## สิ่งที่ไม่ทำ

- ไม่มี sync สองทางอัตโนมัติใน MVP (import เป็นรอบ ๆ พร้อม audit)
- ไม่ import external ID มาเป็น `code` ตรง ๆ (code = namespace ของเรา,
  external value = namespace ของลูกค้า — แยกกันเสมอ)
- ไม่มี UI สำหรับ surface นี้ — เอกสาร + ตัวอย่าง curl คือ deliverable
