---
version: "0.2.0b"
created_at: "2026-09-16T18:00:00+07:00,Claude Sonnet 5,b6e002ef"
last_update: "2026-09-16T18:20:00+07:00,Claude Sonnet 5"
status: accepted
superseded_by: null
attributes:
  domain: platform-control
  doc_type: capability-proposal
  scope: "closes two gaps found while surveying every log surface in the system: no error/exception tracking, no page or feature usage measurement"
---

# CR-020 — Observability gaps: error tracking and feature usage

**Relates to:** [`src/lib/observability/logger.js`](../../apps/server/src/lib/observability/logger.js) (SDD-048, NFR-017, SEC-009), [ADR-086](../decisions/ADR-086-PROGRAMME-DELIVERY-TELEMETRY.md) (measured-vs-planned telemetry precedent), [ADR-092](../decisions/ADR-092-TIME-BOXED-MEMBER-VIEW-OF-THE-PROGRAMME-ROADMAP.md) (privacy-reduced projection precedent), `AuditEvent` model (business-mutation audit)

| Field | Value |
|---|---|
| **Version** | 0.2.0b |
| **Status** | **Accepted by the owner 2026-09-16** — §7 records the decision; work proceeds as ADR + FR declarations, then code |
| Complexity / risk | Error tracking: C-2, LOW-MEDIUM, built on the existing logger. Feature usage: C-3 — accepted at both route and action level, per person, which is the more expensive and more privacy-sensitive of the two options laid out in §3.2 |
| Identity | `platform-control` — every existing measurement surface (ADR-086 usage meter, ADR-087 harness plugin, ADR-092 member view) already lives there and reads the same allowlist discipline this proposal extends |
| Baseline | `b6e002ef`, inspected 2026-09-16 |
| Change | New — written after the owner asked "log ของระบบเราเก็บอะไรบ้าง" and a full-repository survey found these two gaps with nothing partially built to extend |

## 1. ที่มา

ระหว่างสำรวจว่าระบบเก็บ log อะไรบ้าง (คำถามของ owner 2026-09-14/16) พบว่ามี log อยู่ 7
ชั้นแยกกันตามหน้าที่ — structured operational log, `AuditEvent`, access history,
`Session`, `AgentTraceEvent`, `RawExternalRecord`, agent usage detail (ADR-086 D7) —
และไม่มีชั้นไหนตอบคำถามสองข้อนี้ได้เลย:

1. **เกิด error ขึ้นที่ไหนในระบบ ตอนไหน บ่อยแค่ไหน** — ตอนนี้เห็นได้แค่ผ่าน
   `errorCode`/`outcome` ในบรรทัด log ที่หายไปเมื่อ container รีสตาร์ท (ไม่มีที่เก็บถาวร)
   ไม่มี stack trace ไม่มีการนับซ้ำ ไม่มีการแจ้งเตือน
2. **หน้าไหน/ฟีเจอร์ไหนถูกใช้บ่อยแค่ไหน** — ไม่มี log ชั้นไหนบันทึกการ*อ่าน*เลย ทุกชั้นที่มี
   บันทึกเฉพาะการ*เขียน* (`AuditEvent`) หรือแค่ "ยัง active อยู่ไหม" (`Session.lastSeenAt`)

เอกสารนี้เสนอทั้งสองเรื่องแยกกัน เพราะมีเจ้าของ ความเสี่ยง และคำถามที่ owner ต้องตัดสินใจ
คนละชุด — เหมือนกับที่ CR-005 ต้องแยกเป็นสอง FR เพราะ rate card กับ quoting มี
lifecycle ต่างกัน

[ASSUMPTIONS]

1. ทั้งสองเรื่องขยายวินัยเดิมของ `src/lib/observability/logger.js` (allowlist ฟิลด์,
   ไม่เก็บเนื้อหา/ชื่อ/credential) ไม่ใช่เริ่มระบบ log คู่ขนานใหม่
2. ยังไม่ตัดสินใจว่าจะสร้างเองหรือใช้บริการภายนอก (Sentry/PostHog ฯลฯ) — ข้อ 4 และ 5
   วางตัวเลือกไว้ให้ owner เลือก ไม่ได้เลือกไว้ล่วงหน้า
3. ไม่เสนอ column หรือ migration ใดในเอกสารนี้ — ตาม README ของโฟลเดอร์นี้ CR ไม่ใช่
   requirement ที่ปักหมุดได้ การออกแบบ schema จริงมาในขั้น FR/ADR ถ้า owner อนุมัติ

## 2. ส่วนที่ 1 — Error / exception tracking

### 2.1 ปัญหาที่เห็นจริงระหว่างสำรวจ

ระหว่างงาน TASK-ZAI-104 (roadmap member view) และงานก่อนหน้าในเซสชันนี้ วินิจฉัย e2e
ที่ fail ต้องอ่าน raw CI log ทีละบรรทัดหา `Error:` เพราะไม่มีที่รวบรวม error แบบ
query ได้ — เทียบกับ `AuditEvent` ที่ query ผ่าน `GET /api/audit` ได้ทันที error
กลับไม่มีอะไรแบบนั้นเลยทั้งที่น่าจะสำคัญกว่า

### 2.2 ขอบเขตที่เสนอ

- **เก็บ:** error name, message (ข้อความ error ของระบบเอง ไม่ใช่ข้อมูลผู้ใช้), stack
  trace, route/handler ที่เกิด, correlationId/requestId (โยงกับ log ชั้น 1 และ
  `AuditEvent` ได้), เวลาที่เกิด, จำนวนครั้งที่เกิดซ้ำ (fingerprint เดียวกัน), environment
  (production/staging)
- **ไม่เก็บ:** เหมือนกับ allowlist ปัจจุบันทุกประการ — ไม่มี request body, ไม่มี token,
  ไม่มีชื่อ/ข้อความลูกค้า แม้จะอยู่ใน stack trace ก็ต้อง redact (นี่คือความเสี่ยงจริง:
  stack trace มักพ่วงค่าตัวแปรมาด้วยโดยไม่ตั้งใจ ต้องออกแบบการ redact ก่อนเปิดสวิตช์)
- **เห็นได้:** operator เท่านั้น (เหมือน `/control/roadmap` และ `GET /api/audit`)

### 2.3 ตัวเลือกที่ owner ต้องตัดสินใจ

| ตัวเลือก | ข้อดี | ข้อเสีย |
|---|---|---|
| **A. ต่อยอดจาก `logger.js` เดิม** — เพิ่ม level `error` ให้เขียนลง DB (ตารางใหม่ หรือ `AuditEvent` ที่ entityType ใหม่) แทนที่จะไปแค่ stdout | วินัย allowlist เดิมคุ้มครองอัตโนมัติ, ไม่มี dependency ภายนอก, ข้อมูลอยู่ใน Supabase เดียวกับทุกอย่าง | ไม่มี alerting (แจ้งเตือนทันทีที่ error เกิด), ไม่มี dashboard สำเร็จรูป, ต้องสร้างเอง |
| **B. ใช้บริการภายนอก (เช่น Sentry)** | ได้ alerting, dashboard, grouping ตาม fingerprint, ทีมทำงานเร็วกว่า | ข้อมูล error (รวม stack trace) ออกนอกระบบไปยัง third party — ต้องตรวจว่า PDPA/สัญญากับลูกค้ายอมรับได้ไหม, มีค่าใช้จ่ายรายเดือน, เพิ่ม dependency ใหม่ทั้งที่ระบบตั้งใจไม่มีมาก่อน |

**ข้อเสนอ:** เริ่มด้วยตัวเลือก A ก่อน (ของฟรี ควบคุมได้เต็ม ต่อยอดของเดิม) แล้วค่อยประเมิน
B ถ้า A ไม่พอ — แต่เป็นการตัดสินใจของ owner ไม่ใช่ข้อสรุปของเอกสารนี้

## 3. ส่วนที่ 2 — Feature / page usage

### 3.1 ปัญหาที่เห็นจริงระหว่างสำรวจ

owner ถามตรงๆ ว่า "จะได้รู้ว่าอะไรที่คนใช้บ่อย หน้าไหนใช้บ่อย" — คำตอบตอนนี้คือไม่มีทาง
ตอบได้เลย `Session.lastSeenAt` บอกแค่ "ยัง active" ไม่บอกว่าอยู่หน้าไหน `AuditEvent`
บอกแค่ตอนเขียนข้อมูล การเปิดดูหน้าเฉยๆ (อ่านอย่างเดียว) ไม่ถูกบันทึกที่ไหนเลย

### 3.2 ขอบเขตที่เสนอ

- **ระดับที่เก็บ — ต้องเลือกอย่างใดอย่างหนึ่ง:**
  - **route-level** ("`/control/roadmap` ถูกเปิด N ครั้ง") — ง่าย เก็บที่ middleware
    หรือ layout เดียว ครอบคลุมทุกหน้าอัตโนมัติ
  - **action-level** ("ปุ่ม X ถูกกด N ครั้ง") — ละเอียดกว่า ตอบคำถามเชิง product ได้ดีกว่า
    แต่ต้องแปะ instrumentation ทีละจุดที่อยากวัด ไม่ครอบคลุมอัตโนมัติ
- **แยกตามคน หรือรวมทั้งระบบ:**
  - **รวม (aggregate)** — "หน้านี้ถูกเปิดกี่ครั้งทั้งระบบ" ไม่ผูกกับ personId เป็นความเสี่ยง
    ด้าน privacy ต่ำสุด แต่ตอบไม่ได้ว่า *ใคร* ใช้บ่อย
  - **แยกตามคน** — ตอบได้ละเอียดกว่า (เหมือนที่ operator เห็น breakdown ตามคนใน
    ADR-086/ADR-087) แต่เป็นข้อมูลพฤติกรรมส่วนบุคคล ต้องมีเรื่อง consent/สิทธิ์เข้าถึง
    เพิ่ม ตามแนวทางเดียวกับที่ ADR-092 ต้องตัดยอดแยกตามคนออกจาก view สาธารณะ
- **ใครดูได้:** ข้อเสนอเริ่มต้น — operator เท่านั้น เหมือนทุกอย่างใน `/control/roadmap`
  วันนี้ ถ้าจะให้เจ้าของ Business ดูของ Business ตัวเองด้วย (แบบ access history) เป็น
  ขอบเขตขั้นถัดไป ไม่ใช่รอบแรก

### 3.3 ข้อเสนอเริ่มต้น (ต่ำสุดที่ยังมีประโยชน์)

route-level + aggregate (ไม่ผูกคน) เป็นจุดเริ่มที่ปลอดภัยที่สุดและตอบคำถามเดิมของ owner
ได้ตรงที่สุด ("หน้าไหนใช้บ่อย") โดยยังไม่แตะคำถาม privacy ที่ซับซ้อนกว่า (แยกตามคน)
ถ้าต้องการระดับ action หรือแยกตามคนในภายหลัง ขยายจากฐานนี้ได้โดยไม่ต้องรื้อ

## 4. สิ่งที่ยังไม่ตัดสินใจ — ต้องได้คำตอบจาก owner ก่อนประกาศ FR

1. Error tracking: เลือกตัวเลือก A (ต่อยอดของเดิม) หรือ B (บริการภายนอก)?
2. Feature usage: เก็บระดับ route หรือ action? แยกตามคนหรือรวม?
3. Feature usage: ต้องมี consent/แจ้งผู้ใช้ก่อนไหม ถ้าเลือกแยกตามคน (สอดคล้องกับ SEC-009
   ที่ระบบยึดอยู่แล้วว่า "secrets/PII/... excluded from prompts, logs and responses" —
   การเก็บพฤติกรรมส่วนคนต้องตรวจว่าอยู่ในข้อยกเว้นไหนของกฎนี้)
4. เก็บนานแค่ไหน (retention) — ทั้งสองเรื่องยังไม่มีตัวเลขเสนอในเอกสารนี้
5. อยู่ domain ไหน — เสนอ `platform-control` เพราะทุกงาน telemetry ที่ผ่านมาอยู่ที่นั่น
   แต่ error tracking อาจสมควรเป็น charter ใหม่แยกต่างหากถ้าขอบเขตขยายเกินแค่
   operator dashboard (เช่น ถ้าจะแจ้งเตือนอัตโนมัติ)

## 5. สิ่งที่เอกสารนี้ไม่ได้เสนอ

- ไม่มี Prisma model ใหม่ ไม่มี migration ไม่มี route — รอ owner ตอบข้อ 4 ก่อน
- ไม่เสนอ retention เจาะจง เพราะยังไม่มีข้อมูลจริงประเมินขนาด
- ไม่ครอบคลุมงานที่ระบบภายนอกเป็นเจ้าของ (MSP/GKS/GenesisBlockDB/zuri-edge-device) —
  ถ้าอยากรู้ activity ของระบบเหล่านั้นต้องเป็นข้อเสนอแยกไปที่ repo ของมันเอง

## 6. เมื่อ owner ตัดสินใจแล้ว

ตามขั้นตอนปกติของ repo นี้ (`CLAUDE.md` → *Adding a feature*, และตัวอย่างที่ CR-003/004/005
ผ่านมาแล้ว): ประกาศ FR (และ ADR ถ้าต้องบันทึกเหตุผลการตัดสินใจ เหมือน ADR-086/ADR-092)
→ `docs:ids -- --write` → ทำงานใน chartered lane → annotate → `npm run govern`
ไม่มีทางลัดเพราะมาจาก CR

## 7. คำตอบของ owner (2026-09-16)

- **Error tracking → ตัวเลือก A**: ต่อยอดจาก `logger.js` เดิม ไม่ใช้บริการภายนอก
- **Feature usage → เก็บทุกระดับ**: ทั้ง route-level และ action-level พร้อมกัน ไม่ใช่
  เลือกแบบเดียวตามที่ §3.2 เสนอไว้เป็นทางเลือก
- **Feature usage → แยกตามคน (per-person)**: ไม่ใช่ตัวเลือก aggregate ที่ §3.3 เสนอเป็น
  จุดเริ่มต้นปลอดภัยสุด — owner เลือกตัวที่ละเอียดและมีความเสี่ยง privacy สูงกว่าโดยตรง

คำถามใน §4 ที่ยังไม่ถูกตอบตรงๆ (retention, consent, domain) — จะกำหนดเป็นค่าเริ่มต้นตอน
เขียน ADR โดยระบุไว้ชัดว่าเป็นค่าที่เสนอ ไม่ใช่คำตอบของ owner โดยตรง เพื่อให้แก้ทีหลังได้
ง่ายถ้าไม่ตรงใจ:
- **Retention**: เหตุการณ์ระดับคนดิบ 90 วัน (ตามแบบแผนเดิมของระบบ — `RawExternalRecord`
  payload text, MSP session content, `AgentTraceEvent` payload ล้วนใช้ 90 วัน) หลังจากนั้น
  ยุบเหลือแค่ยอดรวมรายวันแบบไม่ผูกคน (aggregate) — ทำให้ข้อมูลที่ผูกกับตัวบุคคลมีอายุจำกัด
  โดยอัตโนมัติแม้จะเก็บแบบ per-person
- **Consent**: ไม่มี consent screen แยก เพราะเป็นเครื่องมือภายใน (operator/staff ที่ signed-in
  แล้ว) ไม่ใช่ข้อมูลลูกค้าภายนอก เหมือนกับที่ audit log และ access history วันนี้ไม่มี consent
  screen เช่นกัน — แจ้งใน privacy note ของหน้า operator เท่านั้น ไม่ใช่ gate
- **Owner ของ domain**: `platform-control` ตามที่เสนอใน header ด้านบน ไม่มีข้อคัดค้าน
